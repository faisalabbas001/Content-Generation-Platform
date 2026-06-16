/**
 * POST /api/agents/strategy
 *
 * Strategy Agent (spec §9 — Phase 3).
 * Runs the full 8-step strategic reasoning model for every content brief.
 * Called by N8N-A01/A02 AFTER CEO classify and BEFORE COO compile-caption-context.
 *
 * The 8-step model transforms a surface brief into a strategically-grounded
 * prompt that respects cultural permission, brand anti-attributes, and the
 * approved creative formula library.
 *
 * Steps:
 *   1. Reject the surface brief → find the real human ask
 *   2. Name the cultural tension
 *   3. Define/confirm permission level
 *   4. Select creative formula
 *   5. Pick register and dialect deliberately
 *   6. Test against anti-attributes and policy rules
 *   7. Generate safe route AND brave route
 *   8. Score confidence before release
 */
import { z } from 'zod'
import { getAnthropicClient } from '@repo/ai'
import { adminClient } from '@repo/db/client'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STRATEGY_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

const BrandContext = z.object({
  archetype_primary:         z.string().nullable().optional(),
  lifecycle_stage:           z.string().nullable().optional(),
  permission_level:          z.string().nullable().optional(),
  cultural_tension_owned:    z.string().nullable().optional(),
  tone_anti_attribute_ids:   z.array(z.string()).nullable().optional(),
  religious_sensitivity:     z.enum(['None', 'Low', 'Medium', 'High']).nullable().optional(),
  arabic_dialect:            z.string().nullable().optional(),
  creative_formulas_approved: z.array(z.string()).nullable().optional(),
  brave_safe_default:        z.boolean().nullable().optional(),
})

const RequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    surface_brief:  z.string().min(1),
    intent:         z.enum(['awareness', 'engagement', 'conversion', 'cultural', 'trust']),
    channel:        z.enum(['Instagram', 'Snapchat', 'TikTok', 'Twitter']),
    sector:         z.string().min(1),
    occasion:       z.string().nullable().optional(),
    brand_context:  BrandContext,
  }),
})

const StrategyResponse = z.object({
  real_ask:         z.string(),
  cultural_tension: z.string(),
  permission_level: z.string(),
  creative_formula: z.enum([
    'manifesto_build', 'paradox_play', 'freeze_then_action',
    'scene_pair', 'number_reframe', 'gamified_hook', 'metaphor_system',
  ]),
  register:          z.string(),
  dialect:           z.string(),
  anti_attribute_check: z.object({
    pass:       z.boolean(),
    violations: z.array(z.string()),
  }),
  safe_route:        z.string(),
  brave_route:       z.string(),
  confidence_score:  z.number().min(0).max(100),
  reasoning:         z.string(),
})

function buildSystemPrompt(ctx: z.infer<typeof BrandContext>): string {
  const formulas = ctx.creative_formulas_approved?.length
    ? ctx.creative_formulas_approved.join(' | ')
    : 'manifesto_build | paradox_play | freeze_then_action | scene_pair | number_reframe | gamified_hook | metaphor_system'

  const antiAttrs = ctx.tone_anti_attribute_ids?.length
    ? ctx.tone_anti_attribute_ids.join(', ')
    : 'none specified'

  return `You are the OGz AI Strategy Agent — a Saudi market content strategist running the 8-step strategic reasoning model.

BRAND CONTEXT:
- Archetype: ${ctx.archetype_primary ?? 'unknown'}
- Lifecycle: ${ctx.lifecycle_stage ?? 'unknown'}
- Permission level: ${ctx.permission_level ?? 'challenger'}
- Cultural tension owned: ${ctx.cultural_tension_owned ?? 'none — select the most relevant'}
- Anti-attributes (NEVER sound like these): ${antiAttrs}
- Religious sensitivity: ${ctx.religious_sensitivity ?? 'Medium'}
- Arabic dialect: ${ctx.arabic_dialect ?? 'MSA_accessible'}
- Approved creative formulas: ${formulas}
- Default posture: ${ctx.brave_safe_default ? 'BRAVE (push boundaries within permission)' : 'SAFE (stay within established comfort)'}

RUN THE 8-STEP MODEL:

STEP 1 — REAL HUMAN ASK
Reject the surface brief. What does the human ACTUALLY need? (not "post about our product" but the real emotional/social/business need)

STEP 2 — CULTURAL TENSION
Name the specific Saudi cultural tension this content will navigate. Must be a real tension in Saudi society (tradition vs modernity, ambition vs humility, global vs local, etc). If the brand owns a tension, use it. Otherwise select the most relevant.

STEP 3 — PERMISSION LEVEL
Confirm or refine the brand's permission level based on the brief. Can this brand make this move? Why?

STEP 4 — CREATIVE FORMULA
Select ONE formula from the approved list. Explain WHY this formula fits this tension + archetype + intent combination.

STEP 5 — REGISTER AND DIALECT
State the exact register (formal/professional/warm/playful/etc) and dialect. Both must match the channel and the brand's established voice.

STEP 6 — ANTI-ATTRIBUTE TEST
Check the proposed direction against the brand's anti-attributes. If any violation: name it and explain how to avoid it.

STEP 7 — SAFE AND BRAVE ROUTES
Generate two complete visual/copy briefs (1-3 sentences each):
- Safe route: within established brand permission, no risk
- Brave route: pushes the cultural tension, more memorable, higher risk

STEP 8 — CONFIDENCE SCORE
Score your own output 0-100. Consider: cultural fit, formula-archetype alignment, anti-attribute clearance, dialect accuracy.

RETURN ONLY a JSON object with this exact structure:
{
  "real_ask": "string",
  "cultural_tension": "string",
  "permission_level": "string",
  "creative_formula": "one_of_seven_formulas",
  "register": "string",
  "dialect": "string",
  "anti_attribute_check": {
    "pass": true,
    "violations": []
  },
  "safe_route": "string — 1-3 sentences, complete visual+copy brief",
  "brave_route": "string — 1-3 sentences, complete visual+copy brief",
  "confidence_score": 85,
  "reasoning": "string — 2-3 sentences explaining the strategic choices"
}`
}

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input) => {
    const db = adminClient()
    const client = getAnthropicClient()

    const systemPrompt = buildSystemPrompt(input.payload.brand_context)

    const userMessage = JSON.stringify({
      surface_brief: input.payload.surface_brief,
      intent:        input.payload.intent,
      channel:       input.payload.channel,
      sector:        input.payload.sector,
      occasion:      input.payload.occasion ?? null,
    })

    const t0 = Date.now()
    const response = await client.messages.create({
      model: STRATEGY_MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })
    const elapsed = Date.now() - t0

    const raw = (response.content as Array<{type: string; text?: string}>).find((b) => b.type === 'text')?.text ?? '{}'
    let parsed: z.infer<typeof StrategyResponse>
    try {
      const json = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
      // Coerce creative_formula to closest match if needed
      const validFormulas = ['manifesto_build','paradox_play','freeze_then_action','scene_pair','number_reframe','gamified_hook','metaphor_system']
      if (!validFormulas.includes(json.creative_formula)) {
        json.creative_formula = 'manifesto_build'
      }
      parsed = StrategyResponse.parse(json)
    } catch {
      // Return safe fallback if strategy agent parse fails — pipeline continues
      parsed = {
        real_ask:         input.payload.surface_brief,
        cultural_tension: 'tradition_meets_modernity',
        permission_level: input.payload.brand_context.permission_level ?? 'challenger',
        creative_formula: 'scene_pair',
        register:         'warm',
        dialect:          input.payload.brand_context.arabic_dialect ?? 'MSA_accessible',
        anti_attribute_check: { pass: true, violations: [] },
        safe_route:       `${input.payload.surface_brief} — show authentic brand moment`,
        brave_route:      `${input.payload.surface_brief} — challenge the expected with unexpected cultural insight`,
        confidence_score: 55,
        reasoning:        'Strategy agent parse failed — using safe defaults. Manual review recommended.',
      }
    }

    // Log to strategy_updates_log if this changes the brand's strategic posture
    // (stored separately from the generation flow for strategy analytics)
    try {
      await db.from('usage_logs').insert({
        brand_id:        input.brand_id,
        flow_id:         input.flow_id,
        agent:           'strategy_agent',
        provider:        'anthropic',
        model:           STRATEGY_MODEL,
        tokens_in:       response.usage.input_tokens,
        tokens_out:      response.usage.output_tokens,
        tokens_cached:   response.usage.cache_read_input_tokens ?? 0,
        cost_usd:        Number((
          (response.usage.input_tokens     / 1_000_000) * 3.0 +
          (response.usage.output_tokens    / 1_000_000) * 15.0 +
          ((response.usage.cache_read_input_tokens ?? 0) / 1_000_000) * 0.30
        ).toFixed(6)),
        elapsed_ms: elapsed,
      } as never)
    } catch (e) {
      console.warn(`[strategy] usage_log failed: ${(e as Error).message}`)
    }

    return {
      task_type: 'strategy_brief' as const,
      brand_id:  input.brand_id,
      ...parsed,
    }
  },
})
