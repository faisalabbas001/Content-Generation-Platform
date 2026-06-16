/**
 * POST /api/agents/learning
 *
 * Learning Agent (spec §9 — Phase 4).
 * Runs weekly (Sunday 02:00 Riyadh, triggered by N8N-A05) to analyze
 * brand performance data and update BrandDNA from observation.
 *
 * For each brand: reads last 4 weeks of post performance, identifies
 * patterns (chains/formulas/tones that over/underperformed vs sector
 * benchmark), and queues Memory Controller nominations to update
 * brand_content_patterns and brand_method_profiles.
 */
import { z } from 'zod'
import { getAnthropicClient } from '@repo/ai'
import { adminClient } from '@repo/db/client'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LEARNING_MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 4096

const PerformanceRecord = z.object({
  post_id:                z.string(),
  caption_ar:             z.string().optional(),
  chain_id:               z.string().nullable().optional(),
  creative_formula:       z.string().nullable().optional(),
  channel:                z.string(),
  score:                  z.number().min(0).max(100),
  engagement_rate:        z.number().min(0).optional(),
  sector_benchmark_score: z.number().min(0).max(100).optional(),
  content_type:           z.string().optional(),
  posted_at:              z.string().optional(),
})

const RequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    period_start:        z.string(),
    period_end:          z.string(),
    performance_records: z.array(PerformanceRecord).min(1).max(200),
    brand_context: z.object({
      sector:            z.string(),
      archetype_primary: z.string().nullable().optional(),
      lifecycle_stage:   z.string().nullable().optional(),
    }).optional(),
  }),
})

const PatternInsight = z.object({
  pattern_type:    z.enum(['winner', 'loser', 'neutral']),
  chain_id:        z.string().nullable(),
  creative_formula: z.string().nullable(),
  content_type:    z.string().nullable(),
  avg_score:       z.number(),
  vs_benchmark:    z.number(),
  sample_count:    z.number(),
  insight:         z.string(),
})

const LearningResponse = z.object({
  patterns:  z.array(PatternInsight),
  winners:   z.array(z.string()),
  losers:    z.array(z.string()),
  reasoning: z.string(),
})

const SYSTEM_PROMPT = `You are the OGz AI Learning Agent. You analyze brand content performance data to identify what works and what doesn't for specific Saudi brands.

Your job: find patterns in the performance data across chains, creative formulas, content types, and channels.

For each significant pattern (avg_score > 75 = winner, < 45 = loser, else neutral):
- Identify the chain_id, creative_formula, or content_type driving the pattern
- Calculate average score vs sector benchmark
- Write a 1-sentence insight explaining WHY this pattern emerged

Rules:
- Only report patterns with at least 2 posts as evidence
- Winners: content that outperformed sector benchmark by 10+ points
- Losers: content that underperformed sector benchmark by 10+ points
- Be specific about what drove performance (formula, chain type, timing, etc.)

Return ONLY a JSON object:
{
  "patterns": [
    {
      "pattern_type": "winner",
      "chain_id": "chain_id or null",
      "creative_formula": "formula or null",
      "content_type": "type or null",
      "avg_score": 82,
      "vs_benchmark": 15,
      "sample_count": 4,
      "insight": "Scene pair formula with food photography chains consistently outperforms when posted midweek"
    }
  ],
  "winners": ["chain_id_1", "formula_2"],
  "losers": ["chain_id_3"],
  "reasoning": "2-3 sentences on the key learning this cycle"
}`

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A05',
  handler: async (input) => {
    const db = adminClient()
    const client = getAnthropicClient()

    const t0 = Date.now()
    const response = await client.messages.create({
      model: LEARNING_MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: JSON.stringify({
          period: `${input.payload.period_start} to ${input.payload.period_end}`,
          brand_context: input.payload.brand_context ?? {},
          posts: input.payload.performance_records,
        }),
      }],
    })
    const elapsed = Date.now() - t0

    const raw = (response.content as Array<{type: string; text?: string}>).find((b) => b.type === 'text')?.text ?? '{}'
    let parsed: z.infer<typeof LearningResponse>
    try {
      const json = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
      parsed = LearningResponse.parse(json)
    } catch {
      parsed = { patterns: [], winners: [], losers: [], reasoning: 'Learning agent parse failed — no updates this cycle.' }
    }

    // Write winners and losers to brand_content_patterns
    const nominations: Array<Record<string, unknown>> = []
    for (const p of parsed.patterns) {
      if (p.pattern_type === 'winner' || p.pattern_type === 'loser') {
        try {
          await db.from('brand_content_patterns' as never).upsert({
            brand_id:         input.brand_id,
            pattern_type:     p.content_type ?? 'general',
            chain_id:         p.chain_id,
            creative_formula: p.creative_formula,
            avg_score:        p.avg_score,
            sample_count:     p.sample_count,
            is_winner:        p.pattern_type === 'winner',
            period_start:     input.payload.period_start,
            period_end:       input.payload.period_end,
            insight:          p.insight,
            updated_at:       new Date().toISOString(),
          } as never, { onConflict: 'brand_id,chain_id,period_start' })
          nominations.push({ type: p.pattern_type, chain_id: p.chain_id, formula: p.creative_formula })
        } catch (e) {
          console.warn(`[learning] pattern write failed: ${(e as Error).message}`)
        }
      }
    }

    // Log cost
    const tokIn     = response.usage.input_tokens
    const tokOut    = response.usage.output_tokens
    const tokCached = response.usage.cache_read_input_tokens ?? 0
    const costUsd   = Number((
      (tokIn     / 1_000_000) * 0.8 +
      (tokOut    / 1_000_000) * 4.0 +
      (tokCached / 1_000_000) * 0.08
    ).toFixed(6))

    try {
      await db.from('usage_logs').insert({
        brand_id: input.brand_id, flow_id: input.flow_id,
        agent: 'learning_agent', provider: 'anthropic', model: LEARNING_MODEL,
        tokens_in: tokIn, tokens_out: tokOut, tokens_cached: tokCached,
        cost_usd: costUsd, elapsed_ms: elapsed,
      } as never)
    } catch { /* non-fatal */ }

    return {
      task_type:         'learning_cycle' as const,
      brand_id:          input.brand_id,
      period_start:      input.payload.period_start,
      period_end:        input.payload.period_end,
      patterns_found:    parsed.patterns.length,
      winners:           parsed.winners,
      losers:            parsed.losers,
      patterns:          parsed.patterns,
      nominations_queued: nominations.length,
      reasoning:         parsed.reasoning,
      cost_usd:          costUsd,
    }
  },
})
