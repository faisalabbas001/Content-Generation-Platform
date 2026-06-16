/**
 * POST /api/agents/cco/visual-qc
 *
 * Full visual scoring pass — called by the confidence-gate AFTER fal.ai
 * returns the Supabase Storage URL (image always generates; scoring happens
 * after). The result is stored on calendar_posts.visual_score and is one of
 * the four pillars in the composite confidence formula.
 *
 * SCORING MODEL (4 dimensions → single visual_score 0-100):
 *
 *   Dimension 1 — Hard block compliance (gates everything)
 *     Any of the 10 Saudi cultural hard blocks detected → visual_score = 0
 *     immediately, no further scoring. Non-negotiable.
 *
 *   Dimension 2 — Chain / visual grammar fidelity (30 pts)
 *     Does the image actually match the chain template's visual grammar?
 *     (e.g. TF04 Food Architecture expects macro depth-of-field food photography
 *     — a lifestyle shot would score low here). Scored 0-30.
 *
 *   Dimension 3 — Brand style register alignment (25 pts)
 *     Does the image match the brand's confirmed style_register
 *     (traditional / modern / youth / mixed) and color palette?
 *     Scored 0-25.
 *
 *   Dimension 4 — Occasion visual correctness (20 pts)
 *     When an occasion is active, does the image carry the right visual
 *     register for that occasion phase? (e.g. Ramadan week 1-2 = warm glow /
 *     crescent / lantern; NOT food during daylight). Scored 0-20.
 *
 *   Base score — general composition quality (25 pts)
 *     Lighting, composition, subject clarity, aesthetic polish.
 *     Scored 0-25.
 *
 * Final: sum of all scored dimensions, capped at 100.
 * Falls back to score=80 (no penalty) when vision API is unavailable,
 * so the pipeline never blocks on a missing key.
 *
 * Hard blocks checked (spec §11.1):
 *   left_hand_serving, left_hand_exchange, sole_pointing, beckoning_palm_up,
 *   cross_gender_contact, food_ramadan_daylight, quran_mishandling,
 *   index_finger_pointing, western_head_shake, counting_wrong_sequence
 */
import { z } from 'zod'
import { getOpenAIClient } from '@repo/ai'
import { makeAgentRoute } from '@/lib/agent-route'
import { adminClient } from '@repo/db/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VISION_MODEL = 'gpt-4o'
const VISION_MAX_TOKENS = 1500

// ── Request schema ───────────────────────────────────────────────────────────

const RequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    image_url:      z.string().url(),
    post_id:        z.string().uuid().optional(),
    // Chain context — needed to grade visual grammar fidelity (Dimension 2)
    chain_id:       z.string().optional(),
    chain_description: z.string().optional(),
    // The ACTUAL English prompt used to generate this image (fal.ai input).
    // When provided, fidelity scoring compares the image against what actually
    // created it — far more accurate than comparing against chain_description alone.
    visual_brief_en: z.string().optional(),
    // Brand style context — needed for style register alignment (Dimension 3)
    style_register: z.string().nullish(),   // 'traditional' | 'modern' | 'youth' | 'mixed'
    color_palette:  z.array(z.string()).optional(), // brand hex values
    // Occasion context — needed for occasion visual correctness (Dimension 4)
    occasion_flags: z.array(z.string()).optional(),
    occasion_phase: z.string().nullish(),   // 'pre', 'active_early', 'active_late', 'post'
    // Content type — informs composition expectations
    content_type:   z.string().nullish(),
    channel:        z.string().nullish(),
    religious_sensitivity: z.enum(['Low', 'Medium', 'High']).optional(),
  }),
})

// ── Vision response schema ───────────────────────────────────────────────────

const HardBlockCheck = z.object({
  block_id:   z.string(),
  detected:   z.boolean(),
  confidence: z.number().min(0).max(1),
  note:       z.string().optional(),
})

const VisualIssue = z.object({
  code:     z.string(),
  label:    z.string(),
  severity: z.enum(['high', 'med', 'low']),
  detail:   z.string().optional(),
})

const VisionResponse = z.object({
  // Hard block pass
  hard_block_checks: z.array(HardBlockCheck),
  violations:        z.array(z.string()),
  // Dimension scores
  chain_fidelity_score:   z.number().min(0).max(30),
  style_register_score:   z.number().min(0).max(25),
  occasion_score:         z.number().min(0).max(20),
  composition_score:      z.number().min(0).max(25),
  // Structured issues for admin UI
  visual_issues: z.array(VisualIssue),
  // Overall reasoning
  reasoning: z.string(),
})

// ── Prompt builder ───────────────────────────────────────────────────────────

function buildVisionPrompt(payload: z.infer<typeof RequestBody>['payload']): string {
  const { chain_id, chain_description, visual_brief_en, style_register, color_palette, occasion_flags, occasion_phase, content_type, religious_sensitivity } = payload

  // visual_brief_en is the ACTUAL prompt sent to fal.ai — use it as the fidelity benchmark.
  // chain_description is a text description of the template's visual grammar — secondary context.
  // When both are present, the brief is primary (it's what created the image).
  const chainCtx = visual_brief_en
    ? `Generation prompt (what fal.ai was asked to render):
"${visual_brief_en}"
${chain_id ? `Chain template: ${chain_id}` : ''}${chain_description ? ` — ${chain_description}` : ''}`
    : chain_description
      ? `Chain: ${chain_id ?? 'unknown'} — "${chain_description}"`
      : chain_id
        ? `Chain ID: ${chain_id} (no description provided)`
        : 'No chain context provided'

  const styleCtx = style_register
    ? `Brand style register: ${style_register}`
    : 'Brand style register: unknown'

  const paletteCtx = color_palette && color_palette.length > 0
    ? `Brand color palette: ${color_palette.join(', ')}`
    : 'Brand color palette: not specified'

  const occasionCtx = occasion_flags && occasion_flags.length > 0
    ? `Active occasions: ${occasion_flags.join(', ')}${occasion_phase ? ` (phase: ${occasion_phase})` : ''}`
    : 'No active occasion'

  const contentCtx = content_type ? `Content type: ${content_type}` : ''
  const religionCtx = religious_sensitivity === 'High'
    ? 'Religious sensitivity: HIGH — cross_gender_contact check is ACTIVE'
    : 'Religious sensitivity: standard'

  return `You are an expert Saudi social media visual compliance and quality inspector.

CONTEXT:
${chainCtx}
${styleCtx}
${paletteCtx}
${occasionCtx}
${contentCtx ? contentCtx + '\n' : ''}${religionCtx}

TASK: Analyse this image across 5 evaluation areas. Return ONLY valid JSON.

═══ AREA 1: HARD BLOCK COMPLIANCE (Saudi cultural violations) ═══
Check all 10 hard blocks. A single CONFIRMED detection = visual_score of 0 regardless of other scores.

1. left_hand_serving — person serving food/beverages with LEFT hand
2. left_hand_exchange — formal giving/receiving object with LEFT hand
3. sole_pointing — sole of foot visible and pointed at a person
4. beckoning_palm_up — beckoning/calling with palm facing UP
5. cross_gender_contact — physical contact between unrelated man and woman (ONLY flag if religious_sensitivity=High)
6. food_ramadan_daylight — person eating/drinking in Ramadan daylight context (ONLY flag if occasion includes 'ramadan')
7. quran_mishandling — Quran/religious text handled disrespectfully
8. index_finger_pointing — index finger pointing directly AT a person
9. western_head_shake — western "no" head shake gesture depicted
10. counting_wrong_sequence — counting starting from index finger (not thumb)

═══ AREA 2: CHAIN / VISUAL GRAMMAR FIDELITY (0-30 points) ═══
When a "Generation prompt" is provided above: score how faithfully the IMAGE matches that specific prompt.
Key questions: Does the image render the objects described? Does it use the lighting/composition/mood specified?
Does it match the chain template's visual grammar (food macro, lifestyle, space, etc.)?
If no chain context at all, score 20 as neutral.
Score 25-30 = image closely matches the prompt + template. 15-24 = partial match (some elements missing). 5-14 = weak match (different visual direction). 0-4 = does not match prompt at all.

═══ AREA 3: BRAND STYLE REGISTER ALIGNMENT (0-25 points) ═══
Does the image match the brand's style register and color palette?
- traditional: heritage colours, warm tones, classical Saudi aesthetic
- modern: clean lines, minimal, contemporary palette
- youth: vibrant, energetic, bold colours
- mixed: balanced blend
Also check if brand's hex colors are visually present.
If no style context provided, score 17 as neutral.
Score 20-25 = strong alignment. 12-19 = partial. 4-11 = poor fit. 0-3 = jarring mismatch.

═══ AREA 4: OCCASION VISUAL CORRECTNESS (0-20 points) ═══
When an occasion is active, does the image carry the right visual cues?
Ramadan early: warm amber/gold lighting, lanterns, crescent, family togetherness — NOT food during daylight
Ramadan late: offer-adjacent, celebratory
Eid: festive colours, joy, celebration
National Day: Saudi flag colours (green/white), heritage symbols
If no occasion active, score 16 as neutral (no occasion demand).
Score 17-20 = excellent occasion fit. 10-16 = decent. 3-9 = weak. 0-2 = wrong register for occasion.

═══ AREA 5: COMPOSITION QUALITY (0-25 points) ═══
General visual quality: lighting, sharpness, subject framing, aesthetic polish, platform-appropriate composition.
Score 20-25 = professional quality. 14-19 = good. 8-13 = acceptable. 0-7 = poor quality.

═══ VISUAL ISSUES ═══
List every specific problem found as structured issues. Severity:
- high: blocks or severely hurts content quality / compliance
- med: reduces quality but fixable
- low: minor observation

Return ONLY this JSON (no markdown, no extra text):
{
  "hard_block_checks": [
    { "block_id": "left_hand_serving", "detected": false, "confidence": 0.95, "note": "hands not visible" },
    { "block_id": "left_hand_exchange", "detected": false, "confidence": 0.90 },
    { "block_id": "sole_pointing", "detected": false, "confidence": 0.99 },
    { "block_id": "beckoning_palm_up", "detected": false, "confidence": 0.85 },
    { "block_id": "cross_gender_contact", "detected": false, "confidence": 0.92 },
    { "block_id": "food_ramadan_daylight", "detected": false, "confidence": 0.80 },
    { "block_id": "quran_mishandling", "detected": false, "confidence": 0.99 },
    { "block_id": "index_finger_pointing", "detected": false, "confidence": 0.88 },
    { "block_id": "western_head_shake", "detected": false, "confidence": 0.75 },
    { "block_id": "counting_wrong_sequence", "detected": false, "confidence": 0.70 }
  ],
  "violations": [],
  "chain_fidelity_score": 25,
  "style_register_score": 20,
  "occasion_score": 16,
  "composition_score": 22,
  "visual_issues": [],
  "reasoning": "Brief 2-3 sentence explanation of the overall visual assessment."
}`
}

// ── Route handler ────────────────────────────────────────────────────────────

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-V01',
  handler: async (input) => {
    const db = adminClient()
    const apiKey = process.env.OPENAI_API_KEY

    const { payload } = input
    const isRamadan = payload.occasion_flags?.includes('ramadan') ?? false

    // No OpenAI key — return neutral pass so pipeline continues unblocked
    if (!apiKey) {
      return buildFallbackResult(input.brand_id, payload, 'vision_model_not_configured')
    }

    const client = getOpenAIClient()
    const t0 = Date.now()

    let parsed: z.infer<typeof VisionResponse>
    let visionFailed = false

    try {
      const response = await client.chat.completions.create({
        model: VISION_MODEL,
        max_tokens: VISION_MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: payload.image_url, detail: 'high' },
              },
              {
                type: 'text',
                text: buildVisionPrompt(payload),
              },
            ],
          },
        ],
      })

      const elapsed = Date.now() - t0

      const raw = response.choices[0]?.message?.content ?? '{}'
      try {
        const json = JSON.parse(raw)
        parsed = VisionResponse.parse(json)
      } catch {
        parsed = buildNeutralScores('Vision response parse failed — manual review recommended')
        visionFailed = true
      }

      // Log cost
      const tokIn  = response.usage?.prompt_tokens ?? 0
      const tokOut = response.usage?.completion_tokens ?? 0
      const costUsd = Number(((tokIn / 1_000_000) * 2.5 + (tokOut / 1_000_000) * 10.0).toFixed(6))
      try {
        await db.from('usage_logs').insert({
          brand_id:      input.brand_id,
          flow_id:       input.flow_id,
          agent:         'cco_visual_qc',
          provider:      'openai',
          model:         VISION_MODEL,
          tokens_in:     tokIn,
          tokens_out:    tokOut,
          tokens_cached: 0,
          cost_usd:      costUsd,
          elapsed_ms:    elapsed,
        } as never)
      } catch { /* non-fatal */ }

    } catch (e) {
      console.warn(`[cco/visual-qc] vision API failed: ${(e as Error).message}`)
      parsed = buildNeutralScores(`Vision API unavailable: ${(e as Error).message}`)
      visionFailed = true
    }

    // ── Hard block enforcement ─────────────────────────────────────────────
    // Ramadan: force food_ramadan_daylight to hard-block score=0
    if (isRamadan) {
      const foodCheck = parsed.hard_block_checks.find((c) => c.block_id === 'food_ramadan_daylight')
      if (foodCheck?.detected) {
        if (!parsed.violations.includes('food_ramadan_daylight')) {
          parsed.violations.push('food_ramadan_daylight')
        }
      }
    }

    // cross_gender_contact only applies to High sensitivity brands
    if (payload.religious_sensitivity !== 'High') {
      parsed.violations = parsed.violations.filter((v) => v !== 'cross_gender_contact')
      const check = parsed.hard_block_checks.find((c) => c.block_id === 'cross_gender_contact')
      if (check) check.detected = false
    }

    const hasHardBlock = parsed.violations.length > 0

    // ── Composite visual score ─────────────────────────────────────────────
    // Hard block = 0 immediately (non-negotiable)
    // Otherwise: sum of all 4 dimension scores, max 100
    let visual_score: number
    if (hasHardBlock) {
      visual_score = 0
    } else {
      visual_score = Math.min(
        100,
        parsed.chain_fidelity_score +
        parsed.style_register_score +
        parsed.occasion_score +
        parsed.composition_score,
      )
    }

    // Add hard-block violations as high-severity visual issues
    const visual_issues: z.infer<typeof VisualIssue>[] = [
      ...parsed.violations.map((v) => ({
        code:     v,
        label:    HARD_BLOCK_LABELS[v] ?? v.replace(/_/g, ' '),
        severity: 'high' as const,
        detail:   'Saudi cultural hard block — this post cannot be published.',
      })),
      ...parsed.visual_issues,
    ]

    // Write visual_score + visual_issues back to calendar_posts (best-effort)
    if (payload.post_id) {
      try {
        await db
          .from('calendar_posts')
          .update({ visual_score, visual_issues } as never)
          .eq('post_id', payload.post_id)
      } catch (e) {
        console.warn(`[cco/visual-qc] DB write failed post=${payload.post_id}: ${(e as Error).message}`)
      }
    }

    return {
      task_type:     'visual_qc' as const,
      brand_id:      input.brand_id,
      image_url:     payload.image_url,
      post_id:       payload.post_id ?? null,
      // Composite score
      visual_score,
      // Pillar breakdown (for admin transparency)
      pillars: {
        hard_block_pass:      !hasHardBlock,
        chain_fidelity:       hasHardBlock ? 0 : parsed.chain_fidelity_score,
        style_register:       hasHardBlock ? 0 : parsed.style_register_score,
        occasion_alignment:   hasHardBlock ? 0 : parsed.occasion_score,
        composition_quality:  hasHardBlock ? 0 : parsed.composition_score,
      },
      // Structured issues for admin QA UI
      visual_issues,
      // Hard block details
      hard_block_checks: parsed.hard_block_checks,
      violations:        parsed.violations,
      // Metadata
      reasoning:     parsed.reasoning,
      vision_failed: visionFailed,
      note: visionFailed ? 'vision_model_unavailable — manual review recommended' : null,
    }
  },
})

// ── Helpers ──────────────────────────────────────────────────────────────────

const HARD_BLOCK_LABELS: Record<string, string> = {
  left_hand_serving:              'Left hand serving',
  left_hand_exchange:             'Left hand exchange',
  sole_pointing:                  'Sole pointing at person',
  beckoning_palm_up:              'Palm-up beckoning',
  cross_gender_contact:           'Cross-gender contact',
  food_ramadan_daylight:          'Food during Ramadan daylight',
  quran_mishandling:              'Quran mishandling',
  index_finger_pointing:          'Index finger pointing at person',
  western_head_shake:             'Western "no" gesture',
  counting_wrong_sequence:        'Wrong counting sequence',
}

function buildNeutralScores(reason: string): z.infer<typeof VisionResponse> {
  return {
    hard_block_checks: [],
    violations: [],
    chain_fidelity_score:  20,
    style_register_score:  17,
    occasion_score:        16,
    composition_score:     17,
    visual_issues: [{
      code:     'vision_unavailable',
      label:    'Vision check unavailable',
      severity: 'low',
      detail:   reason,
    }],
    reasoning: reason,
  }
}

function buildFallbackResult(
  brand_id: string,
  payload: z.infer<typeof RequestBody>['payload'],
  reason: string,
) {
  return {
    task_type:     'visual_qc' as const,
    brand_id,
    image_url:     payload.image_url,
    post_id:       payload.post_id ?? null,
    visual_score:  80,
    pillars: {
      hard_block_pass:     true,
      chain_fidelity:      20,
      style_register:      17,
      occasion_alignment:  16,
      composition_quality: 17,
    },
    visual_issues:     [],
    hard_block_checks: [],
    violations:        [],
    reasoning:         reason,
    vision_failed:     true,
    note:              reason,
  }
}
