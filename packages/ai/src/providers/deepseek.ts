/**
 * DeepSeek V3 — Arabic caption generator wrapper.
 *
 * Doc §6 + prompts/OGzStudios_DeepSeek_Prompt_v1.md.
 *
 * The DeepSeek API is OpenAI-compatible and supports `response_format: json_object`.
 * Prompt caching is automatic on their side — we report cache hit/miss counts
 * via priceDeepSeekUsage().
 */
import type { Db } from '@repo/db/client'
import { schemas } from '@repo/core'
import { loadPrompt } from '../prompts'
import { parseStructuredJson, StructuredJsonError } from '../json'
import { withRetryAndLogging } from '../retry'
import {
  priceDeepSeekUsage,
  DEEPSEEK_MODEL,
  type DeepSeekUsage,
} from './deepseek-client'

// Each post carries ~500–700 output tokens (Arabic caption + hashtags +
// visual_brief_en + sharp_text_gravity/font/rationale fields), NOT ~300. At 8192
// a full-month batch was cut off mid-string → JSON truncation ("Expected ',' or
// '}'") → 502. The model behind `deepseek-chat` (now deepseek-v4-flash) allows
// up to 384K output, so 16384 is safe headroom for any single chunk.
const DEEPSEEK_MAX_TOKENS = 16384

export interface DeepSeekCallOptions {
  flow_id: string
  brand_id: string
  db: Db | null
}

export async function generate(
  input: schemas.DeepSeekInput,
  opts: DeepSeekCallOptions,
): Promise<schemas.DeepSeekResponse> {
  const videoInstruction = input.intended_format === 'video'
    ? '\n\nFOR VIDEO POSTS: Start caption with a dynamic action verb. Avoid static visual descriptors. End with one CTA: شاهد الآن | تابعنا | اكتشف المزيد. The caption should feel like a teaser, not a product description.'
    : ''
  // The calendar slot planner decides each post's content_type deterministically.
  // Tell DeepSeek to honor it so captions match the planned mix (n8n also enforces).
  const contentTypeInstruction = input.content_type_plan && input.content_type_plan.length > 0
    ? `\n\nCONTENT TYPE PLAN: posts[i].content_type MUST equal content_type_plan[i] exactly — write each caption to fit that type. Do not invent your own distribution.`
    : ''
  const system = loadPrompt('DEEPSEEK_SYSTEM_PROMPT') + videoInstruction + contentTypeInstruction

  return withRetryAndLogging(
    {
      flow_id:    opts.flow_id,
      brand_id:   opts.brand_id,
      node_name:  'deepseek',
      db:         opts.db,
      maxRetries: 0, // 1 attempt only — retrying a slow reasoning model triples latency
    },
    async () => {
      // Use raw fetch instead of the OpenAI SDK client so we can control
      // the exact body shape and avoid the SDK stripping unknown params.
      const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
      const body = JSON.stringify({
        model:           DEEPSEEK_MODEL,
        max_tokens:      DEEPSEEK_MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: JSON.stringify(input) },
        ],
      })

      // One DeepSeek call: fetch → parse. Returns the raw text too so a bad
      // response can be logged for diagnosis.
      const callOnce = async () => {
        const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body,
          signal: AbortSignal.timeout(160_000), // 19-post batches can take 60-90s; route allows 180s
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 300)}`)
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await res.json() as any
        const raw = response.choices[0]?.message?.content ?? ''
        const parsed = parseStructuredJson(raw, schemas.DeepSeekResponse)
        return { response, raw, parsed }
      }

      // DeepSeek V3 in json_object mode occasionally returns an empty/short
      // posts array (a fast, empty reply), or one post fewer/more than requested.
      // Strategy:
      //   Attempt 1 — require exact count (ideal case).
      //   Attempt 2 — accept any non-empty result (≥1 post) to avoid failing the
      //               whole batch over a ±1 count variance. Log a warning so the
      //               discrepancy is visible in usage_logs.
      type Attempt = Awaited<ReturnType<typeof callOnce>>
      let okResult: Attempt | null = null
      let lastErr: unknown = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const r = await callOnce()
          const got = r.parsed.posts.length
          if (got === input.post_count) {
            okResult = r; lastErr = null; break
          }
          if (attempt === 2 && got > 0) {
            console.warn(`[deepseek] accepting ${got}/${input.post_count} posts after 2 attempts — count variance`)
            okResult = r; lastErr = null; break
          }
          lastErr = new Error(`DeepSeek returned ${got} posts but ${input.post_count} were requested.`)
          console.warn(
            `[deepseek] attempt ${attempt}/2 — got ${got} posts, expected ${input.post_count}. Raw head: ${String(r.raw).slice(0, 400)}`,
          )
        } catch (err) {
          lastErr = err
          // StructuredJsonError carries the model's raw text — log its head so a
          // recurring "No JSON object found" / parse failure can be diagnosed
          // (refusal? prose-only? new malformed shape?) instead of being opaque.
          const rawHead = err instanceof StructuredJsonError ? ` Raw head: ${String(err.raw).slice(0, 400)}` : ''
          console.warn(`[deepseek] attempt ${attempt}/2 failed: ${(err as Error).message}.${rawHead}`)
        }
      }
      if (lastErr) throw lastErr
      if (!okResult) throw new Error('DeepSeek returned no usable response.')

      const { response, parsed } = okResult
      const u = (response.usage ?? {}) as DeepSeekUsage
      priceDeepSeekUsage({
        prompt_tokens: u.prompt_tokens ?? 0,
        completion_tokens: u.completion_tokens ?? 0,
        prompt_cache_hit_tokens: u.prompt_cache_hit_tokens ?? 0,
        prompt_cache_miss_tokens: u.prompt_cache_miss_tokens ?? 0,
      })

      const tokIn     = u.prompt_tokens     ?? 0
      const tokOut    = u.completion_tokens ?? 0
      const tokCached = u.prompt_cache_hit_tokens ?? 0
      const freshIn   = Math.max(0, tokIn - tokCached) // guard against API field overlap
      const p = { input: 0.27, output: 1.10, cacheRead: 0.07 }
      const costIn     = Number(((freshIn   / 1_000_000) * p.input).toFixed(6))
      const costOut    = Number(((tokOut    / 1_000_000) * p.output).toFixed(6))
      const costCached = Number(((tokCached / 1_000_000) * p.cacheRead).toFixed(6))
      return {
        result:          parsed,
        cost_usd:        Number((costIn + costOut + costCached).toFixed(6)),
        agent:           'DeepSeek',
        provider:        'deepseek',
        model:           DEEPSEEK_MODEL,
        tokens_in:       tokIn,
        tokens_out:      tokOut,
        tokens_cached:   tokCached,
        cost_usd_input:  costIn,
        cost_usd_output: costOut,
        cost_usd_cached: costCached,
        payload: {
          model: DEEPSEEK_MODEL,
          tokens_in:  tokIn,
          tokens_out: tokOut,
          cache_hit:  tokCached,
        },
      }
    },
  )
}
