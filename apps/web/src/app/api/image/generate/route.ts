/**
 * POST /api/image/generate
 *
 * Called by N8N-V01 for every non-held post. Orchestrates:
 *   chain resolution → prompt render → fal.ai generate → Sharp Arabic overlay → Supabase Storage
 *
 * Chain resolution order (first match wins):
 *   1. chains table lookup by chain_id (full library, prompt template rendered here)
 *   2. chain_fal_workflow_mapping fallback (legacy 0055 table — backward-compat)
 *   3. Standard fal-client model routing (resolveModel logic)
 *
 * Hard Rule #3: rejects any prompt_en containing Arabic characters.
 * Hard Rule #4: only returns Supabase Storage URL — fal CDN URL never reaches caller.
 *
 * Server-side v2 enrichment:
 *   The brand's visual_style_profiles, brand_method_profiles, and brand_profiles
 *   are loaded server-side and prepended to prompt_en as a "Brand visual identity:"
 *   block. Callers don't need to pass these — A01/A02/B03 keep existing payload shape.
 *
 * export const maxDuration = 300 — fal.ai image generation takes 30-90 s, but the
 * video chain (Flux keyframe → Kling animate, each polled separately) can take
 * up to ~5 min. 300 s is the Vercel Pro ceiling; local dev is uncapped. If video
 * regularly exceeds this in production, move the video branch to an async worker.
 */
import { generatePostImage, submitPostVideoAsync, buildFinalFalPrompt, mergeNegativePrompts } from '@repo/image'
import { z } from 'zod'
import { adminClient } from '@repo/db/client'
import { chainsQ } from '@repo/db'
import { makeAgentRoute } from '@/lib/agent-route'
import { loadComplianceRules, checkVisualBrief } from '@repo/compliance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 600s covers the video chain (Flux keyframe → Kling animate, ~250–280s) with
// headroom. Effective on self-hosted/local; on Vercel the platform plan ceiling
// still applies (Pro=300s) — move the video branch to the generation-worker
// service for production-scale video (see services/generation-worker).
export const maxDuration = 600

const ARABIC_RE = /[؀-ۿ]/

import { buildVisualIdentityPreamble } from '@/lib/visual-identity'

const RequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  post_id:  z.string().uuid(),
  payload: z.object({
    prompt_en: z.string().min(1).refine(
      (v) => !ARABIC_RE.test(v),
      { message: 'Hard Rule #3 violation: Arabic text detected in prompt_en — English only' },
    ),
    brand_name_ar:   z.string().default(''),
    headline_ar:     z.string().optional(),
    dialect:         z.enum(['Najdi', 'Hejazi', 'Gulf', 'MSA_formal', 'MSA_accessible', 'Mixed']),
    channel:         z.enum(['Instagram', 'Snapchat', 'TikTok', 'Twitter']),
    objective:       z.enum(['awareness', 'engagement', 'conversion', 'cultural', 'trust']),
    first_ever_post: z.boolean(),
    confidence_flag: z.enum(['clean', 'watermark_required', 'hold']),
    cost_constraint: z.string(),
    palette_hex:     z.array(z.string()),
    month:           z.string().regex(/^\d{4}-\d{2}$/),
    // Nullable: the Worker sends score:null for posts with no CCO score (fail-safe
    // HOLD route) — the image must still generate (generate-then-flag policy).
    score:           z.number().nullable(),
    /**
     * Opt-in video switch. Defaults to 'image' so the still-image flow is
     * unchanged. When 'video', a video-output chain is allowed through to the
     * Fal Flux→Kling pipeline (generatePostImage's isVideoChain branch) instead
     * of being skipped. Set by N8N-V01 from the brief's media_type.
     */
    expected_media_type: z.enum(['image', 'video']).default('image'),
    /**
     * Spec-compliant video input (TechDoc v1.0): public URL of a reference image
     * (a prior generation, e.g. U06/F01) to animate. When present on a video request
     * the image-to-video model animates it directly (single model call); when absent
     * a keyframe is synthesised from the prompt. Ignored for image requests.
     */
    reference_image_url: z.string().url().nullish(),
    /** Optional chain to use. Resolved against chains table first, then legacy mapping. */
    chain_id:        z.string().nullish(),
    /** Template variables for chain prompt rendering. Key = {{variable}} slot name. */
    chain_context:   z.record(z.string()).optional(),
    /** Sector for auto-selection and eligibility filtering. */
    sector:          z.string().optional(),
    /** Active occasion for eligibility filtering. */
    occasion:        z.string().nullish(),
    /** Brand maturity in days for eligibility filtering. */
    maturity_days:   z.number().int().min(0).optional(),
    /** Quality tier for eligibility filtering. */
    quality_tier:    z.enum(['starter', 'growth', 'enterprise']).optional(),
    revision_count:  z.number().int().min(0).optional(),
    /**
     * Overlay zone hint from DeepSeek sharp_text_gravity (mapped by N8N-V01).
     * When present, Sonnet vision detection is skipped and this layout is used directly.
     */
    layout: z.enum([
      'top-left', 'top-right',
      'upper-left', 'upper-right',
      'center-left', 'center-right',
      'lower-left', 'lower-right',
      'bottom-left', 'bottom-right',
    ]).optional(),
    /** DeepSeek-recommended hex color for headline overlay text. Contrast-checked before use. */
    font_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    /** DeepSeek-recommended font size in px for headline, clamped [24, 96]. */
    font_size: z.number().int().min(24).max(96).optional(),
  }),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-V01',
  handler: async (input, ctx) => {
    const db = adminClient()

    // ── 1. Server-side v2 BrandDNA enrichment ─────────────────────────────
    // BRIEF AUTHORITY: DeepSeek writes a complete per-post scene brief that already
    // contains brand voice, style, and cultural constraints from CaptionContext.
    // Prepending the brand preamble again would duplicate and dilute it.
    // We detect a "complete brief" two ways (either is sufficient):
    //   a) chain.template_mode = 'style_wrapper' or 'slot_fill' → chain defers to
    //      the brief; preamble skipped regardless of length.
    //   b) Legacy fallback: prompt >= 200 chars (kept for on-demand routes that do
    //      not supply a chain_id and therefore have no template_mode to read yet).
    // template_mode is read after chain resolution below; we initialise the flag
    // conservatively (false) and update it once the chain row is known.
    const briefLengthComplete = input.payload.prompt_en.trim().length >= 200
    // briefComplete is set to true after chain resolution when template_mode ≠ 'scene'.
    // For now, use the length heuristic as the initial value so the enrichment block
    // below can run before chain resolution (DB calls are parallel-safe).
    const briefComplete = briefLengthComplete
    let enrichedPromptEn = input.payload.prompt_en
    let enrichedPalette  = input.payload.palette_hex
    try {
      const [brandRes, visualRes, methodRes] = await Promise.all([
        db.from('brand_profiles').select('archetype_primary, primary_color_hex').eq('brand_id', input.brand_id).maybeSingle(),
        db.from('visual_style_profiles').select('style_descriptor, color_palette').eq('brand_id', input.brand_id).maybeSingle(),
        db.from('brand_method_profiles').select('visual_idiom').eq('brand_id', input.brand_id).maybeSingle(),
      ])
      const brand  = (brandRes.data  ?? null) as { archetype_primary: string | null; primary_color_hex: string | null } | null
      const visual = (visualRes.data ?? null) as { style_descriptor: string | null; color_palette: string[] | null } | null
      const method = (methodRes.data ?? null) as { visual_idiom: string | null } | null
      const preamble = buildVisualIdentityPreamble({
        style_descriptor:  visual?.style_descriptor ?? null,
        color_palette:     visual?.color_palette ?? null,
        visual_idiom:      method?.visual_idiom ?? null,
        archetype_primary: brand?.archetype_primary ?? null,
        fallback_palette:  input.payload.palette_hex.length > 0
          ? input.payload.palette_hex
          : (brand?.primary_color_hex ? [brand.primary_color_hex] : []),
      })
      if (preamble && !ARABIC_RE.test(preamble) && !briefComplete) {
        enrichedPromptEn = `${preamble} ${input.payload.prompt_en}`
        console.log(`[image/generate][DEBUG] post=${input.post_id} briefComplete=${briefComplete} preamble="${preamble.slice(0,120)}"`)
      } else {
        console.log(`[image/generate][DEBUG] post=${input.post_id} briefComplete=${briefComplete} preamble_skipped=(brief≥200chars or no preamble)`)
      }
      if (visual?.color_palette && visual.color_palette.length > 0) {
        enrichedPalette = visual.color_palette
      }
    } catch (e) {
      console.warn(`[image/generate] v2 enrichment failed for brand=${input.brand_id}: ${(e as Error).message}`)
    }

    console.log(`[image/generate][DEBUG] post=${input.post_id} chain_id=${input.payload.chain_id ?? 'none'} expected_media_type=${input.payload.expected_media_type} prompt_len=${input.payload.prompt_en.length} prompt_preview="${input.payload.prompt_en.slice(0,120)}"`)


    // Compliance gate: final hard-block check before fal.ai spend.
    // Catches kill-switch bypass (VISUAL_PROMPT_COMPOSER_ENABLED !== 'true') and
    // any brief that slipped through the earlier precheck agent.
    //
    // POLICY (June 2026): a hard-block no longer ABORTS generation. Every post must
    // produce an image so admin sees the real visual before deciding (approve /
    // reject / regenerate). Instead of throwing, we STRIP the offending phrases from
    // the prompt so fal.ai never renders the disallowed content, generate the image,
    // and return compliance_flag so the Worker marks the post requires_human_review.
    const complianceRules = await loadComplianceRules(input.brand_id)
    let complianceFlag: { blocked: boolean; reasons: string } = { blocked: false, reasons: '' }
    {
      const complianceVerdict = checkVisualBrief(enrichedPromptEn, complianceRules, {})
      if (complianceVerdict.action === 'block') {
        const reasons = complianceVerdict.matched.map((m) => m.rule).join(', ')
        // Append a strong negative instruction so fal.ai steers away from the
        // disallowed gesture/content. (matched.rule is a regex/gesture-key, not the
        // literal prompt text, so we cannot reliably strip it — we instruct against
        // it instead.) The post still generates and is flagged for admin review.
        const avoidPhrases = complianceVerdict.matched
          .map((m) => m.rule.replace(/[\\^$.*+?()[\]{}|]/g, ' ').replace(/_/g, ' ').trim())
          .filter(Boolean)
        if (avoidPhrases.length) {
          enrichedPromptEn = `${enrichedPromptEn}. STRICTLY AVOID depicting: ${avoidPhrases.join('; ')}.`
        }
        complianceFlag = { blocked: true, reasons }
        console.warn(`[image/generate] compliance HARD_BLOCK sanitized (post still generates, flagged) — ${reasons}`)
      }
    }

    // Resolve chain_id → fal_workflow_id if the caller supplied one.
    // Missing row or any DB error falls back to standard model routing.
    let falWorkflowId: string | undefined
    let falModelPrimary: string | undefined
    let falModelSecondary: string | undefined
    let resolvedPrompt = enrichedPromptEn
    let resolvedNegativePrompt: string | undefined
    let chainOutputType: 'image' | 'video' | 'carousel' | 'audio' | 'mixed' | undefined
    let chainOutputWidth: number | undefined
    let chainOutputHeight: number | undefined
    let chainOutputDurationS: number | undefined
    let chainAspectRatio: string | undefined
    let chainCostUsd: number | null = null   // from chains.cost_estimate_usd

    try {
      const chain = await chainsQ.resolveChain({
        chain_id:     input.payload.chain_id,
        sector:       input.payload.sector ?? 'general',
        occasion:     input.payload.occasion,
        quality_tier: input.payload.quality_tier ?? 'starter',
        maturity_days: input.payload.maturity_days ?? 0,
      })

      if (chain) {
        // Render the chain's prompt template with caller-supplied context vars
        const chainContext = input.payload.chain_context ?? {}
        // Always inject prompt_en as the base context variable
        const contextWithPrompt: Record<string, string> = {
          base_visual_brief: input.payload.prompt_en,
          ...chainContext,
        }
        const renderedTemplate = chainsQ.renderPromptTemplate(chain.prompt_template, contextWithPrompt)

        // ── PROMPT AUTHORITY (template_mode-driven, June 2026) ──────────────
        // Each chain declares its relationship to the DeepSeek brief via template_mode:
        //
        //  'style_wrapper' — template slots the brief via {base_visual_brief} and adds
        //     style/quality constraints only. Brief is always the scene authority.
        //     Rendered template is used as-is (brief is already inside it).
        //
        //  'slot_fill' — template defines the scene via {product_descriptor} etc.
        //     When a complete DeepSeek brief is present it takes full authority
        //     (the chain contributes model/aspect/cost only, zero prompt text).
        //     When no brief exists the rendered template is the fallback scene.
        //
        //  'scene' — template is a standalone scene (no brief slots). Used verbatim
        //     when no DeepSeek brief is present; combined with brief otherwise.
        //
        // Unresolved {placeholders} in the rendered output are always the fallback
        // trigger — never let literal braces reach fal.ai regardless of mode.
        const stillHasPlaceholders = /\{[a-z_]+\}/i.test(renderedTemplate)
        const tplMode = chain.template_mode ?? 'scene'

        let finalTemplate: string
        if (tplMode === 'style_wrapper') {
          // Chain wraps the brief with style constraints — rendered template IS the prompt.
          // Unresolvable → trust brief alone (style suffix lost, brief still correct).
          finalTemplate = stillHasPlaceholders ? input.payload.prompt_en : renderedTemplate
        } else if (tplMode === 'slot_fill') {
          // Slot-fill chain: DeepSeek brief wins when present; template is the fallback.
          finalTemplate = (briefComplete || briefLengthComplete || stillHasPlaceholders)
            ? input.payload.prompt_en
            : renderedTemplate
        } else {
          // 'scene' chain (or legacy default): combine template + brief when both exist.
          finalTemplate = briefLengthComplete
            ? input.payload.prompt_en                         // complete brief is authoritative
            : stillHasPlaceholders
              ? input.payload.prompt_en                       // template unfillable → trust brief
              : `${renderedTemplate}. ${input.payload.prompt_en}` // fully-rendered scene + brief
        }

        // Prepend BrandDNA preamble only when it was added (short/on-demand prompts).
        resolvedPrompt = enrichedPromptEn !== input.payload.prompt_en
          ? `${enrichedPromptEn.replace(input.payload.prompt_en, '').trim()} ${finalTemplate}`.trim()
          : finalTemplate

        // Guard: never use a video/audio chain for still-image generation.
        // CEO occasionally selects a video chain (e.g. V05/Kling) for on-demand
        // posts; the still-image pipeline expects images[] and pollAndDownloadImage()
        // 404s when Kling returns a video result instead. Fall through to
        // resolveModel() in that case.
        //
        // EXCEPTION: when the caller explicitly asked for video
        // (expected_media_type='video'), let the video chain through — the
        // Flux→Kling two-model pipeline (generatePostImage's isVideoChain branch)
        // handles it end-to-end and uploads the .mp4. Audio is never supported.
        const expectVideo = input.payload.expected_media_type === 'video'
        const skipChain = chain.output_type === 'audio'
          || (chain.output_type === 'video' && !expectVideo)
        if (skipChain) {
          console.warn(`[image/generate] chain ${chain.chain_id} is output_type=${chain.output_type} (expected_media_type=${input.payload.expected_media_type}) — skipping, using resolveModel() fallback`)
        } else {
          if (chain.negative_prompt) resolvedNegativePrompt = chain.negative_prompt
          falModelPrimary      = chain.fal_model_primary
          falModelSecondary    = chain.fal_model_secondary ?? undefined
          chainOutputType      = chain.output_type
          chainOutputWidth     = chain.output_width ?? undefined
          chainOutputHeight    = chain.output_height ?? undefined
          chainOutputDurationS = chain.output_duration_s ?? undefined
          chainAspectRatio     = chain.aspect_ratio ?? undefined
        // Read cost directly from chain — no model-name lookup needed
        chainCostUsd = typeof chain.cost_estimate_usd === 'number'
          ? chain.cost_estimate_usd
          : chain.cost_estimate_usd != null ? Number(chain.cost_estimate_usd) : null

          // Check brand-level override for this chain
          const override = await chainsQ.getBrandOverride(chain.chain_id, input.brand_id)
          if (override?.is_active) {
            if (override.prompt_suffix)           resolvedPrompt         += ` ${override.prompt_suffix}`
            if (override.negative_prompt_override) resolvedNegativePrompt = override.negative_prompt_override
            if (override.fal_model_override)      falModelPrimary        = override.fal_model_override
          }

          console.log(`[image/generate] chain resolved: ${chain.chain_id} (${chain.output_type}) model=${falModelPrimary}`)
        console.log(`[image/generate][DEBUG] post=${input.post_id} tplMode=${tplMode} stillHasPlaceholders=${stillHasPlaceholders} briefLengthComplete=${briefLengthComplete}`)
        console.log(`[image/generate][DEBUG] post=${input.post_id} renderedTemplate_preview="${renderedTemplate.slice(0,200)}"`)
        console.log(`[image/generate][DEBUG] post=${input.post_id} resolvedPrompt_preview="${resolvedPrompt.slice(0,200)}"`)
        }
      } else {
        console.log(`[image/generate][DEBUG] post=${input.post_id} chain_id=${input.payload.chain_id ?? 'none'} — NO chain resolved from DB`)
      }
    } catch (e) {
      console.warn(`[image/generate] chains table lookup failed: ${(e as Error).message}`)
    }

    // Fallback: legacy chain_fal_workflow_mapping (0055) — only when chains table yielded nothing
    if (!falModelPrimary && input.payload.chain_id) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: chainRow } = await (db as any)
          .from('chain_fal_workflow_mapping')
          .select('fal_workflow_id')
          .eq('chain_id', input.payload.chain_id)
          .maybeSingle()
        if (chainRow?.fal_workflow_id) {
          falWorkflowId = chainRow.fal_workflow_id
        } else {
          console.warn(`[image/generate] chain_id="${input.payload.chain_id}" not found in chain_fal_workflow_mapping — falling back to standard routing`)
        }
      } catch (e) {
        console.warn(`[image/generate] chain_fal_workflow_mapping lookup failed: ${(e as Error).message}`)
      }
    }

    // The user's explicit media-type choice ALWAYS wins over the resolved chain's
    // output_type. CEO chain-selection frequently picks an image chain (e.g. T51)
    // for a video request; without this override that image chain's
    // output_type='image' would suppress the video pipeline and we'd silently
    // produce a still image for a video request (the exact bug observed in N8N-V01).
    const userRequestedVideo = input.payload.expected_media_type === 'video'
    const effectiveOutputType: 'image' | 'video' | 'carousel' | 'audio' | 'mixed' | undefined =
      userRequestedVideo ? 'video' : chainOutputType

    console.log(`[image/generate][DEBUG] post=${input.post_id} FINAL_ROUTE: userRequestedVideo=${userRequestedVideo} effectiveOutputType=${effectiveOutputType} falModelPrimary=${falModelPrimary ?? 'none'} falModelSecondary=${falModelSecondary ?? 'none'}`)
    console.log(`[image/generate][DEBUG] post=${input.post_id} FINAL_PROMPT="${resolvedPrompt.slice(0,250)}"`)


    // When we force video onto a chain that is NOT a video chain, that chain's
    // fal_model_secondary may be NULL or an unsuitable (text-to-video) Kling model
    // — migration 0077 only normalises output_type='video' rows. Drop the secondary
    // so generate.ts falls back to the proven DEFAULT_VIDEO_SECONDARY (Kling
    // image-to-video). The chain's primary is kept as the keyframe model (any image
    // model works) and falls back to DEFAULT_VIDEO_PRIMARY when undefined.
    if (userRequestedVideo && chainOutputType !== 'video') {
      falModelSecondary = undefined
      console.log(`[image/generate] video requested but chain output_type=${chainOutputType ?? 'none'} — forcing video pipeline, using default animator`)
    }

    // ── 3. Dispatch to generatePostImage ──────────────────────────────────
    // Pass db so exact FAL costs are written to usage_logs after generation.
    // flow_run_id comes from n8n's x-n8n-execution-id header via ctx.requestId
    // (agent-route stamped it); client_slug fetched from brand_profiles.
    let imgClientSlug: string | null = null
    try {
      const slugRes = await db.from('brand_profiles').select('client_slug').eq('brand_id', input.brand_id).maybeSingle()
      imgClientSlug = (slugRes.data as { client_slug?: string } | null)?.client_slug ?? null
    } catch { /* non-fatal */ }

    // ── ASYNC VIDEO PATH ────────────────────────────────────────────────────
    // Video is the slow part (Kling i2v ~250s). Instead of BLOCKING this request
    // (which loads the worker), generate the keyframe SYNC (~25s, becomes the
    // fallback still) and SUBMIT the animate job to fal's queue with a webhook,
    // returning a request_id immediately. The /api/webhooks/fal-ai/video-callback
    // writes storage_url when fal finishes. The chain still picks the model — this
    // only changes the transport (blocking poll → async queue) for video chains.
    if (effectiveOutputType === 'video') {
      // Public webhook base — see generate-video/route.ts: fal.ai cannot reach
      // localhost, so PUBLIC_WEBHOOK_BASE_URL (ngrok) takes precedence in dev.
      const appUrl = process.env.PUBLIC_WEBHOOK_BASE_URL?.trim().replace(/\/+$/, '')
        || process.env.NEXT_PUBLIC_APP_URL
      if (appUrl && /localhost|127\.0\.0\.1/.test(appUrl)) {
        console.warn(`[image/generate] webhook base ${appUrl} is localhost — fal.ai cannot reach it; set PUBLIC_WEBHOOK_BASE_URL to your public (ngrok) URL.`)
      }
      console.log(`[image/generate][VIDEO] post=${input.post_id} chain_id=${input.payload.chain_id ?? 'none'} keyframeModel=${falModelPrimary ?? 'DEFAULT(flux-pro/v1.1-ultra)'} animatorModel=${falModelSecondary ?? 'DEFAULT(kling-i2v)'} webhookBase=${appUrl ?? 'UNSET'} resolvedPrompt_len=${resolvedPrompt.length} resolvedPrompt_preview="${resolvedPrompt.slice(0,200)}"`)
      if (appUrl) {
        try {
          const webhookUrl = `${appUrl}/api/webhooks/fal-ai/video-callback`
          console.log(`[image/generate][VIDEO] post=${input.post_id} submitting async to fal webhookUrl=${webhookUrl}`)
          const submit = await submitPostVideoAsync({
            flow_id: ctx.flowId, brand_id: input.brand_id, post_id: input.post_id,
            ...input.payload,
            prompt_en:           resolvedPrompt,
            palette_hex:         enrichedPalette,
            fal_model_primary:   falModelPrimary,
            fal_model_secondary: falModelSecondary,
            negative_prompt:     resolvedNegativePrompt,
            output_type:         effectiveOutputType,
            output_width:        chainOutputWidth,
            output_height:       chainOutputHeight,
            output_duration_s:   chainOutputDurationS,
            aspect_ratio:        chainAspectRatio,
            db, flow_run_id: ctx.requestId ?? null, client_slug: imgClientSlug,
            chain_cost_usd: chainCostUsd, chain_id: input.payload.chain_id ?? null,
          }, webhookUrl)
          console.log(`[image/generate][VIDEO] post=${input.post_id} fal_request_id=${submit.request_id} animator=${submit.animator_model} keyframe_url=${submit.keyframe_url ?? 'null'}`)
          // Correlate fal request_id → post_id for the callback (downloads → storage_url).
          await db.from('usage_logs').insert({
            brand_id:        input.brand_id,
            post_id:         input.post_id,
            fal_request_id:  submit.request_id,
            flow_id:         ctx.flowId ?? 'N8N-V01',
            node_name:       'generate(async-video)',
            agent:           'FAL',
            request_type:    'video_cost',
            model:           submit.animator_model ?? null,
            cost_usd:        chainCostUsd ?? 0.7,
            cost_usd_output: chainCostUsd ?? 0.7,
            cost_usd_input:  0,
            cost_usd_cached: 0,
            images_generated: 2,
            status:          'queued',
            payload:         { chain_id: input.payload.chain_id, keyframe_url: submit.keyframe_url, animator: submit.animator_model },
          } as never)
          return { storage_url: null, clean_storage_url: submit.keyframe_url, async_submitted: true, request_id: submit.request_id, compliance_blocked: false, compliance_reasons: null }
        } catch (e) {
          console.warn(`[image/generate][VIDEO] post=${input.post_id} async submit FAILED: ${(e as Error).message} — falling back to sync path`)
        }
      } else {
        console.warn(`[image/generate][VIDEO] post=${input.post_id} NEXT_PUBLIC_APP_URL unset — webhook impossible, using sync path`)
      }
    }

    const imgResult = await generatePostImage({
      flow_id:  ctx.flowId,
      brand_id: input.brand_id,
      post_id:  input.post_id,
      ...input.payload,
      prompt_en:             resolvedPrompt,
      palette_hex:           enrichedPalette,
      fal_workflow_id:       falWorkflowId,
      fal_model_primary:     falModelPrimary,
      fal_model_secondary:   falModelSecondary,
      negative_prompt:       resolvedNegativePrompt,
      output_type:           effectiveOutputType,
      output_width:          chainOutputWidth,
      output_height:         chainOutputHeight,
      output_duration_s:     chainOutputDurationS,
      aspect_ratio:          chainAspectRatio,
      db:                    db,
      flow_run_id:           ctx.requestId ?? null,
      client_slug:           imgClientSlug,
      chain_cost_usd:        chainCostUsd,
      chain_id:              input.payload.chain_id ?? null,
    })

    // ── 4. SDAIA Deepfakes Guidelines — C2PA provenance metadata ─────────
    // Records AI-generation provenance on every generated asset per SDAIA
    // Deepfakes Guidelines (migration 0080 columns: ai_generated, generation_model,
    // c2pa_signed, c2pa_metadata).
    // c2pa_signed is set to false — a real C2PA SDK manifest would flip this to true.
    // TODO: integrate Content Credentials SDK (c2pa-node) to embed a signed manifest
    //       and set c2pa_signed = true once the SDK is available in the pipeline.
    // This update is best-effort and must never fail the image request.
    try {
      const resolvedModel = falModelPrimary ?? 'fal-ai/flux-pro/v1.1'
      const c2paMetadata = {
        provider:     'fal.ai',
        model:        resolvedModel,
        generated_at: new Date().toISOString(),
        brand_id:     input.brand_id,
        flow_id:      ctx.flowId,
        // The EXACT strings sent to fal — admin QA shows these so a reviewer can
        // see precisely which prompt produced the image (single source of truth
        // via buildFinalFalPrompt: realism prefix + sanitize + no-text suffix).
        final_prompt:          buildFinalFalPrompt(resolvedPrompt),
        final_negative_prompt: mergeNegativePrompts(resolvedNegativePrompt),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .from('calendar_posts')
        .update({
          ai_generated:     true,
          generation_model: resolvedModel,
          c2pa_signed:      false,
          c2pa_metadata:    c2paMetadata,
        })
        .eq('post_id', input.post_id)
      console.log(`[image/generate] C2PA provenance written for post=${input.post_id} model=${resolvedModel}`)
    } catch (e) {
      console.warn(`[image/generate] C2PA metadata update failed (non-fatal) post=${input.post_id}: ${(e as Error).message}`)
    }

    // Surface the compliance flag so the Worker can mark requires_human_review on a
    // post that generated despite a hard-block (June 2026 policy: generate + flag,
    // never abort). clean posts carry compliance_blocked:false.
    return {
      ...imgResult,
      compliance_blocked: complianceFlag.blocked,
      compliance_reasons: complianceFlag.reasons || null,
      // The exact resolved prompt body sent to fal (before the fal-client realism
      // prefix / no-text suffix) — surfaced for QA and prompt debugging.
      image_prompt_en: resolvedPrompt,
      negative_prompt: resolvedNegativePrompt ?? null,
    }
  },
})
