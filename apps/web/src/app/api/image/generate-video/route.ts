/**
 * POST /api/image/generate-video
 *
 * Called by n8n for video posts. Immediately submits a text-to-video job to
 * fal.ai's async queue (Kling via fal_model_secondary from the chains table)
 * and returns a request_id without waiting for completion.
 *
 * The webhook at /api/webhooks/fal-ai/video-callback receives the result,
 * downloads the video from fal CDN, and uploads it to Supabase Storage.
 *
 * Hard Rule #3: Arabic text is NEVER sent to fal.ai.
 * Hard Rule #4: fal CDN URLs are never stored — the webhook handler does that.
 *
 * export const maxDuration = 30 — we only submit to the queue, not wait for result.
 */
import { z } from 'zod'
import { adminClient } from '@repo/db/client'
import { makeAgentRoute } from '@/lib/agent-route'
import { loadComplianceRules, checkVisualBrief } from '@repo/compliance'
import { submitPostVideoAsync } from '@repo/image'
import { buildVisualIdentityPreamble } from '@/lib/visual-identity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Same Arabic-detection regex used across the codebase.
const ARABIC_RE = /[؀-ۿ]/

const FAL_QUEUE_BASE = 'https://queue.fal.run'

/** Strip text-overlay instructions and promo copy from a prompt. */
function sanitizePrompt(raw: string): string {
  const TEXT_ELEMENT_RE =
    /\b(headline|typography|caption|label|tagline|lettering|overlay|watermark|font|title|slogan|text overlay|promo text|promotional text)\b/i
  const TEXT_ACTION_RE =
    /\b(add|include|place|put|show|display|write|render|insert|overlay)\b/i

  const sentences = raw
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const kept = sentences.filter((s) => {
    const lower = s.toLowerCase()
    const isTextInstruction = TEXT_ACTION_RE.test(lower) && TEXT_ELEMENT_RE.test(lower)
    const hasPromoText =
      /\d+\s*%\s*(off|discount|sale)|\bspecial (offer|feast|deal)\b|\bpromo\b/i.test(lower)
    return !isTextInstruction && !hasPromoText
  })

  return kept
    .join(' ')
    .replace(/"[^"]*\d+\s*%[^"]*"/g, '')
    .replace(/"[A-Z][A-Z\s]{3,}"/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

interface FalQueueSubmitResponse {
  request_id: string
  status_url: string
  response_url: string
}

// Zod schema. CRITICAL: n8n sends the calendar-post fields NESTED under `payload`
// (same envelope as /api/image/generate), e.g.
//   { flow_id, brand_id, post_id, payload: { chain_id:'V03', visual_brief_en, ... } }
// The old schema declared chain_id/post_id at the TOP level, so every video request
// 400'd with `chain_id: Required` (it was actually at body.payload.chain_id) — which
// silently dropped EVERY video post. Wrapping the fields in `payload` to match the
// real n8n envelope (and the image route) fixes it.
const RequestBody = z.object({
  flow_id:  z.string().optional(),
  brand_id: z.string().uuid(),
  post_id:  z.string().uuid().optional(),   // also present at top level in some callers
  payload: z.object({
    // post_id is sent at the TOP level by n8n (Map Post -> V01 Input), not inside
    // payload — so it's OPTIONAL here and the handler reads `p.post_id ?? input.post_id`.
    post_id:  z.string().uuid().optional(),
    chain_id: z.string().min(1),
    brand_id: z.string().uuid().optional(),
    // Optional placeholder values (n8n sends these for chains that need them)
    product_descriptor:      z.string().optional(),
    occasion_visual_motif:   z.string().optional(),
    brand_color_palette:     z.string().optional(),
    // Refined, English-only prompt from the Visual Prompt Composer. When present and
    // non-empty, it is used verbatim as the fal.ai prompt (gives video the same
    // refinement quality as images); otherwise we fall back to the chain template.
    visual_brief_en: z.string().optional(),
    prompt_en: z.string().optional(),
    // Optional prior image to animate directly (skips keyframe synthesis).
    reference_image_url: z.string().optional(),
    month: z.string().optional(),
  }),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'async-video',
  handler: async (input) => {
    const db = adminClient()

    // n8n nests the post fields under `payload`. Flatten to the local names the
    // handler already uses. brand_id may be top-level or in payload; post_id too.
    const p = input.payload
    const chain_id = p.chain_id
    const post_id  = p.post_id ?? input.post_id
    const brand_id = input.brand_id ?? p.brand_id
    if (!post_id)  throw new Error('[generate-video] post_id missing in body and payload')
    if (!brand_id) throw new Error('[generate-video] brand_id missing in body and payload')

    // 1. Fetch chain details. A video chain needs BOTH models:
    //    fal_model_primary  = keyframe IMAGE model (e.g. flux-pro) — text→image
    //    fal_model_secondary = image-to-video model (e.g. Seedance/Kling) — image→video
    //    The i2v model REQUIRES image_url; submitting only a prompt to it returns fal
    //    422 "Field required" (the bug). So we generate the keyframe first, then animate.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chainRow, error: chainErr } = await (db as any)
      .from('chains')
      .select('fal_model_primary, fal_model_secondary, prompt_template, template_mode, aspect_ratio, output_duration_s')
      .eq('chain_id', chain_id)
      .maybeSingle() as {
        data: {
          fal_model_primary:   string | null
          fal_model_secondary: string | null
          prompt_template:     string | null
          template_mode:       string | null
          aspect_ratio:        string | null
          output_duration_s:   number | null
        } | null
        error: { message: string } | null
      }

    if (chainErr) {
      throw new Error(`[generate-video] chains lookup failed: ${chainErr.message}`)
    }
    if (!chainRow?.prompt_template) {
      throw new Error(`[generate-video] chain_id="${chain_id}" has no prompt_template`)
    }

    console.log(`[generate-video][DEBUG] post=${post_id} chain fal_model_primary=${chainRow.fal_model_primary} fal_model_secondary=${chainRow.fal_model_secondary} template_mode=${chainRow.template_mode} template_preview="${chainRow.prompt_template.slice(0,120)}"`)



    const falModel      = chainRow.fal_model_secondary  // image-to-video animator
    const keyframeModel = chainRow.fal_model_primary    // text-to-image keyframe
    if (!falModel) {
      throw new Error(`[generate-video] chain_id="${chain_id}" has no fal_model_secondary`)
    }
    if (!keyframeModel) {
      throw new Error(`[generate-video] chain_id="${chain_id}" has no fal_model_primary (keyframe model) — i2v needs an input image`)
    }

    // 2. Brand enrichment — parity with /api/image/generate.
    //    For short/on-demand prompts (< 200 chars) that don't carry brand context,
    //    load BrandDNA and prepend a visual identity preamble so the keyframe model
    //    anchors the scene to the brand's style, archetype, and palette.
    //    Complete DeepSeek briefs (≥ 200 chars) already contain this context and
    //    pass through clean to avoid duplication.
    const rawBrief = (p.visual_brief_en || p.prompt_en)?.trim() ?? ''
    const briefIsComplete = rawBrief.length >= 200
    let enrichedBrief = rawBrief

    console.log(`[generate-video][DEBUG] post=${post_id} chain_id=${chain_id} raw_brief_len=${rawBrief.length} briefIsComplete=${briefIsComplete} brief_preview="${rawBrief.slice(0,150)}"`)


    if (rawBrief && !briefIsComplete) {
      try {
        const [brandRes, visualRes, methodRes] = await Promise.all([
          db.from('brand_profiles').select('archetype_primary, primary_color_hex').eq('brand_id', brand_id).maybeSingle(),
          db.from('visual_style_profiles').select('style_descriptor, color_palette').eq('brand_id', brand_id).maybeSingle(),
          db.from('brand_method_profiles').select('visual_idiom').eq('brand_id', brand_id).maybeSingle(),
        ])
        const brand  = brandRes.data  as { archetype_primary: string | null; primary_color_hex: string | null } | null
        const visual = visualRes.data as { style_descriptor: string | null; color_palette: string[] | null } | null
        const method = methodRes.data as { visual_idiom: string | null } | null
        const preamble = buildVisualIdentityPreamble({
          style_descriptor:  visual?.style_descriptor  ?? null,
          color_palette:     visual?.color_palette     ?? null,
          visual_idiom:      method?.visual_idiom      ?? null,
          archetype_primary: brand?.archetype_primary  ?? null,
          fallback_palette:  brand?.primary_color_hex  ? [brand.primary_color_hex] : [],
        })
        if (preamble && !ARABIC_RE.test(preamble)) {
          enrichedBrief = `${preamble} ${rawBrief}`
        }
      } catch (e) {
        console.warn(`[generate-video] brand enrichment failed for brand=${brand_id}: ${(e as Error).message}`)
      }
    }

    // 3. Choose the final prompt using template_mode (same logic as /api/image/generate).
    //    style_wrapper — template slots the brief; rendered template is the prompt.
    //    slot_fill     — DeepSeek brief wins when present; template is only the fallback.
    //    scene         — standalone scene template; combined with brief when both exist.
    const tplMode = (chainRow as { template_mode?: string }).template_mode ?? 'scene'
    let finalPrompt: string

    if (enrichedBrief) {
      if (tplMode === 'style_wrapper' && chainRow.prompt_template.includes('{base_visual_brief}')) {
        // Slot the brief into the wrapper template (brief + style constraints).
        const rendered = chainRow.prompt_template.replace(/\{base_visual_brief\}/g, enrichedBrief)
        const stillHasPlaceholders = /\{[a-z_]+\}/i.test(rendered)
        finalPrompt = stillHasPlaceholders ? enrichedBrief : rendered
      } else {
        // slot_fill or scene with a present brief — brief takes full authority.
        finalPrompt = enrichedBrief
      }
    } else {
      // No brief at all — fall back to chain template slot-filling.
      finalPrompt = chainRow.prompt_template
      if (p.product_descriptor)    finalPrompt = finalPrompt.replace(/\{product_descriptor\}/g,    p.product_descriptor)
      if (p.occasion_visual_motif) finalPrompt = finalPrompt.replace(/\{occasion_visual_motif\}/g, p.occasion_visual_motif)
      if (p.brand_color_palette)   finalPrompt = finalPrompt.replace(/\{brand_color_palette\}/g,   p.brand_color_palette)
    }
    // SAFETY: never let a literal {placeholder} reach fal.
    finalPrompt = finalPrompt.replace(/\{[^}]+\}/g, '').replace(/\s{2,}/g, ' ').trim()

    console.log(`[generate-video][DEBUG] post=${post_id} finalPrompt_len=${finalPrompt.length} finalPrompt_preview="${finalPrompt.slice(0,250)}"`)

    // 3. Sanitize the prompt (remove text overlay / promo instructions)
    //    For video, we do NOT add PHOTOREALISM_PREFIX – that prefix is for still images.
    let sanitizedPrompt = sanitizePrompt(finalPrompt)
    console.log(`[generate-video][DEBUG] post=${post_id} sanitizedPrompt_len=${sanitizedPrompt.length} sanitizedPrompt_preview="${sanitizedPrompt.slice(0,250)}"`)


    // Compliance gate: hard-block → SANITIZE + FLAG (parity with /api/image/generate),
    // NOT a hard throw. A blocked video used to 500 → the post was left blank with no
    // image and no video. Instead, append a strong negative instruction so the model
    // steers away from the disallowed gesture/content, generate the keyframe+video
    // anyway, and flag it (compliance_blocked) so the Worker marks requires_human_review.
    const complianceRules = await loadComplianceRules(brand_id)
    let compliance_blocked = false
    let compliance_reasons: string | null = null
    {
      const complianceVerdict = checkVisualBrief(sanitizedPrompt, complianceRules, {})
      if (complianceVerdict.action === 'block') {
        const reasons = complianceVerdict.matched.map((m) => m.rule).join(', ')
        const avoidPhrases = complianceVerdict.matched
          .map((m) => m.rule.replace(/[\\^$.*+?()[\]{}|]/g, ' ').replace(/_/g, ' ').trim())
          .filter(Boolean)
        if (avoidPhrases.length) {
          sanitizedPrompt = `${sanitizedPrompt}. STRICTLY AVOID depicting: ${avoidPhrases.join('; ')}.`
        }
        compliance_blocked = true
        compliance_reasons = reasons
        console.warn(`[generate-video] compliance HARD_BLOCK sanitized (video still generates, flagged) — ${reasons}`)
      }
    }

    // Belt-and-suspenders: reject if sanitised prompt still contains Arabic.
    if (ARABIC_RE.test(sanitizedPrompt)) {
      throw new Error(
        'Hard Rule #3: Arabic characters found in sanitised prompt — aborting fal.ai submission'
      )
    }

    // 4. Submit the TWO-STAGE async video job:
    //      a) synthesise a keyframe IMAGE from the prompt via fal_model_primary (Flux),
    //         upload it to Storage at {post_id}-kf.jpg, then
    //      b) submit the image-to-video animate job (fal_model_secondary, Seedance/Kling)
    //         to fal's QUEUE with image_url=keyframe + ?fal_webhook → returns request_id.
    //    submitPostVideoAsync (packages/image) does both and wires the keyframe upload.
    //    THIS fixes the fal 422 "Field required" (i2v had no image_url before).
    const falKey = process.env.FAL_KEY
    if (!falKey) throw new Error('FAL_KEY env var is not set')

    // fal.ai calls this URL from its cloud when the video finishes — it MUST be
    // publicly reachable. In local dev NEXT_PUBLIC_APP_URL is localhost (which fal
    // can never reach → request stuck 'generating' forever), so a dedicated
    // PUBLIC_WEBHOOK_BASE_URL (e.g. the ngrok tunnel) takes precedence.
    const appUrl = process.env.PUBLIC_WEBHOOK_BASE_URL?.trim().replace(/\/+$/, '')
      || process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) throw new Error('PUBLIC_WEBHOOK_BASE_URL / NEXT_PUBLIC_APP_URL env var is not set')
    if (/localhost|127\.0\.0\.1/.test(appUrl)) {
      console.warn(`[generate-video] webhook base ${appUrl} is localhost — fal.ai cannot reach it; the video callback will NEVER arrive. Set PUBLIC_WEBHOOK_BASE_URL to your public (ngrok) URL.`)
    }

    const webhookUrl = `${appUrl}/api/webhooks/fal-ai/video-callback`

    console.log(`[generate-video][VIDEO] post=${post_id} FINAL submitPostVideoAsync: keyframeModel=${keyframeModel} animatorModel=${falModel} prompt_len=${sanitizedPrompt.length} prompt_preview="${sanitizedPrompt.slice(0,200)}"`)

    const submitResult = await submitPostVideoAsync(
      {
        post_id,
        brand_id,
        prompt_en:           sanitizedPrompt,
        month:               p.month ?? new Date().toISOString().slice(0, 7),
        first_ever_post:     false,
        cost_constraint:     'normal',
        score:               null,   // was hardcoded 80 — null = unknown score, let model-routing decide
        objective:           'awareness',
        channel:             'Instagram',
        fal_model_primary:   keyframeModel,
        fal_model_secondary: falModel,
        reference_image_url: p.reference_image_url ?? null,
        aspect_ratio:        chainRow.aspect_ratio ?? '1:1',
        output_duration_s:   chainRow.output_duration_s ?? undefined,
      } as Parameters<typeof submitPostVideoAsync>[0],
      webhookUrl,
    )
    console.log(`[generate-video][VIDEO] post=${post_id} fal queued: request_id=${submitResult.request_id} keyframe_url=${submitResult.keyframe_url ?? 'null'} animator=${submitResult.animator_model}`)

    const queue = { request_id: submitResult.request_id }
    if (!queue.request_id) {
      throw new Error('fal.ai queue submit returned no request_id')
    }

    // 5. Write usage_logs row (for tracking and webhook correlation)
    const { error: logErr } = await db.from('usage_logs').insert({
      brand_id: brand_id,
      post_id: post_id,
      fal_request_id: queue.request_id,
      flow_id: 'async-video',
      node_name: 'generate-video',
      cost_usd: 0.7, // base cost – will be updated with actual cost from webhook if needed
      status: 'queued',
      payload: { chain_id: chain_id },
    })

    if (logErr) {
      // Non-fatal – log and continue so the fal job is not orphaned.
      console.error(`[generate-video] usage_logs insert failed: ${logErr.message}`)
    }

    // 6. Mark the calendar post as video format (already set by n8n but ensure)
    const { error: postErr } = await db
      .from('calendar_posts')
      .update({
        format_tier: 'video',
        // Flag a compliance-sanitized video so admin reviews it (parity with images).
        ...(compliance_blocked ? { requires_human_review: true, hold_reason: 'compliance_sanitized' } : {}),
      })
      .eq('post_id', post_id)

    if (postErr) {
      console.error(`[generate-video] calendar_posts update failed: ${postErr.message}`)
    }

    // 7. Return immediately – webhook will handle completion.
    // keyframe_url: the still image the animator animates (first frame of the
    // video). N8N-A02 runs cco/visual-qc on it so video gets the SAME brand
    // relevance + cultural gate as images, before delivery.
    // image_prompt_en: the EXACT sanitized prompt sent to fal (keyframe + animate)
    // — without it, video posts stored image_prompt_en NULL and the admin QA
    // "Image Prompt" panel showed "No image prompt stored" for every video.
    return {
      request_id: queue.request_id,
      status: 'queued',
      keyframe_url: submitResult.keyframe_url ?? null,
      image_prompt_en: sanitizedPrompt,
      compliance_blocked,
      compliance_reasons,
    }
  },
})