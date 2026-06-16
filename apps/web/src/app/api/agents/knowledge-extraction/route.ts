/**
 * POST /api/agents/knowledge-extraction
 *
 * Knowledge Extraction Agent (spec §9 — Phase 4).
 * Builds the ogz-knowledge corpus by promoting validated brand patterns
 * into sector-level knowledge. Called weekly after Learning Agent completes.
 *
 * Extracts: what worked for brands in this sector → generalises patterns
 * into sector baseline updates and gold pattern records.
 */
import { z } from 'zod'
import { getAnthropicClient } from '@repo/ai'
import { adminClient } from '@repo/db/client'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 3000

const RequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    sector:   z.string().min(1),
    dialect:  z.string().min(1),
    winners:  z.array(z.object({
      chain_id:         z.string().nullable(),
      creative_formula: z.string().nullable(),
      content_type:     z.string().nullable(),
      avg_score:        z.number(),
      vs_benchmark:     z.number(),
      insight:          z.string(),
    })),
    losers: z.array(z.object({
      chain_id:         z.string().nullable(),
      creative_formula: z.string().nullable(),
      content_type:     z.string().nullable(),
      avg_score:        z.number(),
      vs_benchmark:     z.number(),
      insight:          z.string(),
    })),
  }),
})

const ExtractionResponse = z.object({
  sector_pattern_updates: z.array(z.object({
    content_type:   z.string(),
    direction:      z.enum(['increase', 'decrease', 'maintain']),
    delta_pct:      z.number(),
    evidence:       z.string(),
  })),
  gold_patterns: z.array(z.object({
    pattern_key:   z.string(),
    description:   z.string(),
    chain_id:      z.string().nullable(),
    formula:       z.string().nullable(),
    confidence:    z.number().min(0).max(1),
  })),
  anti_patterns: z.array(z.object({
    pattern_key:  z.string(),
    description:  z.string(),
    chain_id:     z.string().nullable(),
    confidence:   z.number().min(0).max(1),
  })),
  summary: z.string(),
})

const SYSTEM_PROMPT = `You are the OGz AI Knowledge Extraction Agent. You generalise validated brand performance patterns into sector-level knowledge.

Your job: take winners and losers from a brand's learning cycle and extract what's broadly applicable to OTHER brands in the same sector.

Rules:
- Only extract patterns that are likely sector-general, not brand-specific quirks
- sector_pattern_updates: suggest content mix adjustments (e.g., "increase educational content by 5% in F&B sector")
- gold_patterns: content approaches that consistently outperform (confidence 0.7+ only)
- anti_patterns: approaches that consistently underperform (confidence 0.7+ only)
- Be conservative — false positives pollute the knowledge base

Return ONLY JSON:
{
  "sector_pattern_updates": [
    { "content_type": "educational", "direction": "increase", "delta_pct": 5, "evidence": "why" }
  ],
  "gold_patterns": [
    { "pattern_key": "unique_key", "description": "what works", "chain_id": "or null", "formula": "or null", "confidence": 0.75 }
  ],
  "anti_patterns": [
    { "pattern_key": "unique_key", "description": "what fails", "chain_id": "or null", "confidence": 0.8 }
  ],
  "summary": "1-2 sentence summary of knowledge added this cycle"
}`

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A05',
  handler: async (input) => {
    const db = adminClient()
    const client = getAnthropicClient()

    const t0 = Date.now()
    const response = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: JSON.stringify({
          sector:  input.payload.sector,
          dialect: input.payload.dialect,
          winners: input.payload.winners,
          losers:  input.payload.losers,
        }),
      }],
    })
    const elapsed = Date.now() - t0

    const raw = (response.content as Array<{type: string; text?: string}>).find((b) => b.type === 'text')?.text ?? '{}'
    let parsed: z.infer<typeof ExtractionResponse>
    try {
      const json = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
      parsed = ExtractionResponse.parse(json)
    } catch {
      parsed = { sector_pattern_updates: [], gold_patterns: [], anti_patterns: [], summary: 'Extraction parse failed — no knowledge updates this cycle.' }
    }

    // Write gold patterns to global_negative_patterns table (anti-patterns)
    // and sector_baselines adjustments (gold patterns)
    let patternsWritten = 0
    for (const ap of parsed.anti_patterns) {
      if (ap.confidence >= 0.7) {
        try {
          await db.from('global_negative_patterns' as never).insert({
            pattern_code:    ap.pattern_key,
            pattern_text:    ap.description,
            severity:        'SOFT_BLOCK',
            scope:           `sector:${input.payload.sector}`,
            chain_id:        ap.chain_id,
            source:          'knowledge_extraction',
            confidence:      ap.confidence,
          } as never)
          patternsWritten++
        } catch { /* duplicate or schema mismatch — non-fatal */ }
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
        agent: 'knowledge_extraction', provider: 'anthropic', model: EXTRACTION_MODEL,
        tokens_in: tokIn, tokens_out: tokOut, tokens_cached: tokCached,
        cost_usd: costUsd, elapsed_ms: elapsed,
      } as never)
    } catch { /* non-fatal */ }

    return {
      task_type:               'knowledge_extraction' as const,
      brand_id:                input.brand_id,
      sector:                  input.payload.sector,
      sector_pattern_updates:  parsed.sector_pattern_updates.length,
      gold_patterns:           parsed.gold_patterns.length,
      anti_patterns_added:     patternsWritten,
      patterns:                parsed.gold_patterns,
      anti_patterns:           parsed.anti_patterns,
      sector_updates:          parsed.sector_pattern_updates,
      summary:                 parsed.summary,
      cost_usd:                costUsd,
    }
  },
})
