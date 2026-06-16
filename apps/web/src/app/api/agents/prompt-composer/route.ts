/**
 * POST /api/agents/prompt-composer
 *
 * Prompt Composer (Claude Sonnet 4.6) — Doc §6, Visual Generation pipeline.
 * Called by N8N-V01 AFTER CEO selects a chain and BEFORE fal.ai image generation.
 *
 * Receives:
 *   - BrandDNA Layers 1-4 (brand identity, owner profile, visual identity, strategic intel)
 *   - The selected chain's prompt_template
 *   - A strategic brief for this specific post
 *
 * Produces:
 *   - A single English-only photographic/cinematic fal.ai prompt
 *
 * Hard Rule #3: Arabic text MUST NEVER appear in the output — Arabic overlays
 * are applied post-generation via Sharp in N8N-V01.
 */
import { adminClient, brandDnaQ, chainsQ } from '@repo/db'
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@repo/ai/deepseek-client'
import { z } from 'zod'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Migrated off Anthropic (over budget) → DeepSeek (OpenAI-compatible chat API, no
// OpenAI TPM ceiling). Same single English-only photographic prompt output.
const MODEL = DEEPSEEK_MODEL

// Two callers, two payload shapes:
//   1. Chain path (on-demand/calendar with a chain template): full chain fields.
//   2. Decoupled V01 path (N8N-V01-Worker → V01 sub-workflow): a free-form
//      `user_prompt` that is authoritative (the post's image_prompt_en). It has
//      no chain_template/strategic_brief, so those must be optional and the
//      handler falls back to user_prompt when they're absent.
const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    // ── On-demand intent-preserving mode (N8N-V01) ──────────────────────────
    // The user's free-text request. When present, it is refined into a single
    // photographic fal.ai prompt with the user's subject kept as the literal hero,
    // styled with the brand's visual identity. Used for on-demand (N8N-A02).
    user_prompt: z.string().min(1).optional(),
    /** When true (default for on-demand), the user's subject must be depicted literally. */
    user_intent_authoritative: z.boolean().optional().default(true),
    /** For video, the composed prompt is treated as the opening keyframe. */
    expected_media_type: z.enum(['image', 'video']).optional().default('image'),
    // ── Calendar / batch mode (existing N8N-A01 path) ───────────────────────
    // All optional so the same route serves both modes. Legacy callers send a
    // chain_template; on-demand callers send user_prompt instead.
    chain_id: z.string().min(1).optional(),
    chain_template: z.string().min(1).optional(),
    strategic_brief: z.string().min(1).optional(),
    post_type: z.string().min(1).optional(),
    platform: z.string().min(1).optional(),
    objective: z.string().min(1).optional(),
  }).refine(
    (p) => Boolean(p.user_prompt) || (Boolean(p.chain_template) && Boolean(p.strategic_brief)),
    { message: 'Provide either user_prompt (V01 path) or chain_template+strategic_brief (chain path)' },
  ),
})

const SYSTEM_PROMPT = `You are a senior brand visual director for a Saudi-market, Arabic-first social platform.

Your task: turn the user's post (its caption meaning + visual brief) + the brand context into a
single photographic/cinematic English fal.ai prompt that is SPECIFIC to THIS brand and MARKETING-
EFFECTIVE — not a generic stock photo.

HARD RULES (non-negotiable):
1. English only. Zero Arabic characters anywhere in the output.
2. A single contiguous prompt string — no JSON, no markdown, no headings, no labels.
3. Photographic/cinematic: real lighting, composition, lens, mood. Never illustration unless asked.
4. Keep it under 400 words. No Arabic brand name (English only if referenced).

BRAND-GROUNDING (this is what makes images relevant, not generic):
5. The image must serve the post's MARKETING INTENT from its caption — an offer post looks
   appetizing + value-forward; an emotional post evokes the brand's stated emotions (e.g. warm,
   trusted, family); a testimonial implies real people's satisfaction; a launch feels fresh/new.
6. SAUDI CULTURAL AUTHENTICITY: set scenes in a believable Saudi/Gulf context — Saudi homes,
   majlis, family tables, Riyadh cafes; modest dress; halal food only; warm Gulf hospitality.
   When people are implied, they read as Saudi/Gulf, respect the audience gender mix, never show
   alcohol, pork, immodest dress, or left-hand serving.
7. Match the brand's PRODUCTION TIER + EMOTIONS + SOUL from the context: a warm family F&B brand
   = inviting golden light, generous portions, togetherness — NOT cold luxury or clinical studio.
8. VARIETY WITH PURPOSE: vary angle, setting, framing, and human/no-human across posts so the
   feed looks alive — but every variation must still fit the post's caption and the brand identity.
9. Use the brand color palette + visual style naturally; never force unrelated objects (no random
   laptops/props that don't belong to a food scene).
8. If a USER REQUEST is provided, it is AUTHORITATIVE: depict its subject literally and
   completely as the hero of the image. Layer the brand visual identity around it — never
   replace, omit, or contradict the user's subject. Translate any non-English user request
   into English. Do NOT render any words or text inside the image.

Output: plain text only — the prompt string, nothing else.`

function buildBrandContext(dna: Awaited<ReturnType<typeof brandDnaQ.getBrandDna>>): string {
  if (!dna) return ''

  const brand = dna.brand
  const visual = dna.visual_style
  const method = dna.method_profile

  const parts: string[] = []

  // Layer 1 — Brand Identity
  parts.push(`Brand: ${brand.brand_name_en ?? 'Unknown'} | Sector: ${brand.sector ?? 'General'}`)
  if (brand.tone_register) parts.push(`Tone: ${brand.tone_register}`)
  if (brand.archetype_primary) parts.push(`Archetype: ${brand.archetype_primary}`)
  if (brand.cultural_tension_owned) parts.push(`Cultural context: ${brand.cultural_tension_owned}`)
  // GROUNDING (why images were generic): weave in the brand's REAL identity so the
  // image is specific to THIS Saudi brand, not a stock photo. brand_differentiator =
  // the soul of the brand; emotions = the feeling each image must evoke; city +
  // audience = the people who should appear/be implied; price_position = the visual
  // production tier (mid_market → warm, authentic, not luxury-cold or cheap).
  const bAny = brand as unknown as Record<string, unknown>
  if (bAny.brand_differentiator) parts.push(`Brand soul: ${String(bAny.brand_differentiator).slice(0, 200)}`)
  if (Array.isArray(bAny.emotions) && bAny.emotions.length) parts.push(`Evoke emotions: ${(bAny.emotions as string[]).join(', ')}`)
  if (bAny.price_position) parts.push(`Production tier: ${bAny.price_position} (match the visual quality to this price level)`)
  const city = bAny.city_primary ?? bAny.region_primary
  if (city) parts.push(`Market: ${city}, Saudi Arabia — authentic Saudi setting, Gulf cultural cues, modest dress, halal context`)
  const gmix = bAny.audience_gender_mix as { male?: number; female?: number } | null
  if (gmix && (gmix.male || gmix.female)) parts.push(`Audience: ${gmix.male ?? 0}% male / ${gmix.female ?? 0}% female Saudi audience`)

  // Layer 2 — Owner/Audience Profile
  const audience = dna.audience
  if (audience) {
    const ageRange = audience.age_range
      ? `${audience.age_range.min ?? '?'}-${audience.age_range.max ?? '?'}`
      : null
    if (ageRange) parts.push(`Audience age: ${ageRange}`)
    if (audience.language_preference) parts.push(`Language preference: ${audience.language_preference}`)
  }

  // Layer 3 — Visual Identity
  if (visual) {
    if (visual.style_descriptor) parts.push(`Visual style: ${visual.style_descriptor}`)
    if (visual.color_palette && visual.color_palette.length > 0) {
      parts.push(`Color palette: ${visual.color_palette.slice(0, 5).join(', ')}`)
    }
  }

  // Layer 4 — Strategic Intelligence (method profile / creative direction)
  if (method) {
    if (method.visual_idiom) parts.push(`Visual idiom: ${method.visual_idiom}`)
    if (method.creative_direction_text) {
      // Truncate to keep context concise
      const excerpt = method.creative_direction_text.slice(0, 300)
      parts.push(`Creative direction: ${excerpt}`)
    }
  }

  // Negative patterns — tell the model what to avoid
  const negatives = [
    ...dna.negative_patterns.slice(0, 5).map((n) => n.pattern_text),
    ...dna.global_negative_patterns.slice(0, 3).map((n) => n.pattern_text),
  ]
  if (negatives.length > 0) {
    parts.push(`Visual prohibitions: ${negatives.join('; ')}`)
  }

  return parts.join('\n')
}

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-V01',
  handler: async (input, ctx) => {
    const db = adminClient()

    // Mode select: on-demand sends user_prompt; calendar/batch sends chain_template.
    const userPrompt = input.payload.user_prompt?.trim()
    const intentMode = !!userPrompt
    if (!intentMode && !input.payload.chain_template) {
      throw new Error('[prompt-composer] no prompt source: provide user_prompt (on-demand) or chain_template (calendar)')
    }

    // ── Load BrandDNA (non-fatal) ────────────────────────────────────────────────
    // On-demand brands may be new / incomplete — a missing profile must NOT fail
    // generation. Refine with whatever brand context exists (empty is acceptable).
    let dna: Awaited<ReturnType<typeof brandDnaQ.getBrandDna>> = null
    try {
      dna = await brandDnaQ.getBrandDna(input.brand_id, db)
    } catch (e) {
      console.warn(`[prompt-composer] BrandDNA load failed for brand_id=${input.brand_id}: ${(e as Error).message}`)
    }
    if (!dna && !intentMode) {
      // Legacy calendar callers depend on full BrandDNA — keep the hard failure there.
      throw new Error(`[prompt-composer] BrandDNA not found for brand_id=${input.brand_id}`)
    }

    const brandContext = dna ? buildBrandContext(dna) : ''

    // ── Chain style guidance (intent mode) ────────────────────────────────────────
    // On-demand keeps the user's subject as hero, but the CEO-selected chain still
    // carries the photographic/compositional recipe + prohibitions. Fold the chain's
    // prompt_template (as STYLE guidance, placeholders stripped) and negative_prompt
    // into the refinement so the result follows: user subject + brand style + chain style.
    let chainStyle = ''
    let chainNegative = ''
    if (intentMode && input.payload.chain_id) {
      try {
        const chain = await chainsQ.getChain(input.payload.chain_id)
        if (chain) {
          chainStyle = (chain.prompt_template ?? '')
            .replace(/\{\w+\}/g, ' ')   // drop unfilled {placeholders} — keep only the style language
            .replace(/\s+/g, ' ')
            .trim()
          chainNegative = (chain.negative_prompt ?? '').trim()
        }
      } catch (e) {
        console.warn(`[prompt-composer] chain ${input.payload.chain_id} lookup failed: ${(e as Error).message}`)
      }
    }

    // ── Build user message ─────────────────────────────────────────────────────
    let userMessage: string
    if (intentMode) {
      const mediaNote = input.payload.expected_media_type === 'video'
        ? 'MEDIA: video — this prompt is the opening keyframe of a short clip; describe a single strong, animatable frame.'
        : 'MEDIA: image.'
      const chainBlock = chainStyle
        ? `\n\nCHAIN STYLE GUIDANCE (adopt this composition / photographic style, but keep the USER REQUEST as the literal subject — ignore any leftover template wording that is not about style):\n${chainStyle}`
        : ''
      const negativeBlock = chainNegative
        ? `\n\nAVOID (do not include any of these): ${chainNegative}`
        : ''
      userMessage = `USER REQUEST (authoritative — this is exactly what the user asked for; depict it literally and completely as the hero subject):
${userPrompt}

BRAND CONTEXT (visual styling only — layer it AROUND the subject, never replace the subject):
${brandContext || '(no brand visual identity on file — use a clean, neutral, premium style)'}${chainBlock}${negativeBlock}

${mediaNote}

Compose a single English-only photographic/cinematic fal.ai prompt that depicts the user's requested subject faithfully and completely, styled with the brand identity and chain style above. Translate any non-English request into English. Do NOT render any words or text inside the image.`
    } else {
      const { chain_template, strategic_brief, post_type, platform, objective } = input.payload
      userMessage = `CHAIN TEMPLATE:
${chain_template}

BRAND CONTEXT:
${brandContext}

POST DETAILS:
- Type: ${post_type ?? 'n/a'}
- Platform: ${platform ?? 'n/a'}
- Objective: ${objective ?? 'n/a'}

STRATEGIC BRIEF:
${strategic_brief ?? ''}

Compose a single English-only photographic/cinematic fal.ai prompt based on the chain template and brand context above.`
    }

    // ── Call DeepSeek deepseek-chat ────────────────────────────────────────────
    const deepseek = getDeepSeekClient()
    const response = await deepseek.chat.completions.create({
      model: MODEL,
      max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
    })

    const composedPrompt = (response.choices[0]?.message?.content ?? '').trim()

    // Paranoia guard — Hard Rule #3: reject if Arabic slipped through somehow
    // Arabic Unicode block: U+0600–U+06FF
    const arabicPattern = /[؀-ۿ]/
    if (arabicPattern.test(composedPrompt)) {
      console.error(
        `[prompt-composer] Hard Rule #3 violation: Arabic text found in composed prompt ` +
        `flow_id=${ctx.flowId} brand_id=${input.brand_id} chain_id=${input.payload.chain_id ?? 'none'}`,
      )
      throw new Error(
        '[prompt-composer] Hard Rule #3 violation: composed prompt contains Arabic text — aborting',
      )
    }

    const tokenCount =
      (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0)

    console.info(
      `[prompt-composer] ok flow_id=${ctx.flowId} brand_id=${input.brand_id} ` +
      `chain_id=${input.payload.chain_id ?? 'none'} tokens=${tokenCount} ` +
      `prompt_length=${composedPrompt.length}`,
    )

    return {
      task_type: 'compose_prompt' as const,
      brand_id: input.brand_id,
      composed_prompt_en: composedPrompt,
      chain_id: input.payload.chain_id ?? null,
      token_count: tokenCount,
    }
  },
})
