/**
 * COO — operations engine wrapper.
 *
 * Doc §6.2 + prompts/OGzStudios_COO_Prompt_v1.md.
 *
 * Provider: OpenAI (Chat Completions + function calling + JSON mode). Migrated
 * from Claude Haiku 4.5 when the Anthropic account went over budget. Model is
 * env-driven via OPENAI_COO_MODEL (defaults to gpt-5-nano for testing).
 *
 * Three jobs, one wrapper. The COO prompt expects a `task_type` discriminator
 * and routes internally. The wrapper exposes one thin function per job for
 * type-safety on the call site:
 *
 *   buildBrandDna()         — Job 1 — onboarding (15-Q + scrapers → field nominations)
 *   compileCaptionContext() — Job 2 — assembles the 800-1200 token brief for DeepSeek
 *   scoreConfidence()       — Job 3 — final 0-100 score per post after CCO QC
 */
import type { Db } from '@repo/db/client'
import OpenAI from 'openai'
import { schemas } from '@repo/core'
import { loadPrompt } from '../prompts'
import { parseStructuredJson } from '../json'
import { withRetryAndLogging } from '../retry'
import {
  getOpenAIClient,
  getCooModel,
  isReasoningModel,
  priceOpenAIChat,
} from './openai'
import { getDeepSeekClient, DEEPSEEK_MODEL, priceDeepSeekUsage } from './deepseek-client'

// COO provider switch. OpenAI Tier-1 caps the org at 30k TPM, but COO's request
// (large system prompt + full schedule_dates payload + output) runs ~33k → 429.
// DeepSeek uses the same OpenAI-compatible Chat Completions API (tools, JSON mode)
// with no such per-minute ceiling, so we route COO there by default. Set
// COO_PROVIDER=openai to switch back once on a higher OpenAI tier.
function useDeepSeekForCoo(): boolean {
  return (process.env.COO_PROVIDER?.trim().toLowerCase() || 'deepseek') === 'deepseek'
}

// Token budget per job type:
//   build_branddna:         12-17 nominations + method_profile creative_direction_text (up to 4000 chars)
//                           + axis_inference + reasoning → up to ~4500 output tokens
//   compile_caption_context: 1200-2000 token context string + JSON envelope → up to ~2500 output tokens
//   score_confidence:        batch of post scores → up to ~1500 output tokens
// Largest job (build_branddna) needs ~4500 output tokens; compile_caption_context ~2500.
// Capped at 5000 (not 12000) because OpenAI counts prompt + max output reservation against
// the org's TPM limit: ~11.6k system prompt + 12k reservation = ~40k > 30k Tier-1 TPM → 429.
// 5000 keeps the request near ~18k, safely under 30k, with headroom over the ~4500 real need.
// NOTE on latency: the COO compile must finish inside the n8n Code-node 60s hard cap
// (A01's 'Call: COO Build CaptionContext3'). The lever is the MODEL, not this cap —
// OPENAI_COO_MODEL is set to gpt-4o-mini (3–5× faster than gpt-4o) so even a cold,
// multi-round tool-use compile completes well under 60s. Warm brands hit the Qdrant
// cache (<1s) regardless. Do NOT lower this token cap — the compiled context genuinely
// needs ~4500 tokens; truncating it would silently degrade brand grounding.
const COO_MAX_TOKENS = 5000

// OpenAI function-tool definitions — same two tools the COO had under Claude,
// converted to the Chat Completions `tools` shape.
const COO_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'query_composition_matrix',
      description:
        'Query the composition_matrix table to get method scores for a specific archetype, lifecycle stage, and intent state. Returns the wide-format row including recommended_method.',
      parameters: {
        type: 'object',
        properties: {
          archetype: { type: 'string' },
          lifecycle_stage: { type: 'string' },
          intent_state: { type: 'string' },
        },
        required: ['archetype', 'lifecycle_stage', 'intent_state'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_creative_methods',
      description: 'Get the full definitions and rules for all 6 creative methods from the database.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

export interface CooCallOptions {
  flow_id: string
  brand_id: string
  db: Db | null
}

/**
 * Trim the instagram_extraction payload before sending to COO.
 * COO needs voice/pattern signals — not every post verbatim.
 * Strategy:
 *   - Keep full profile metadata (followers, bio, business_category etc.)
 *   - Keep up to 12 posts (enough for pattern analysis), sorted by engagement desc
 *   - Truncate each caption to 280 chars (enough for dialect + voice detection)
 *   - Aggregate remaining posts as summary stats (total_posts, avg_likes, etc.)
 * This keeps the IG input under ~1,500 tokens regardless of how many posts scraped.
 */
function trimIgForCoo(ig: Record<string, unknown>): Record<string, unknown> {
  const MAX_POSTS = 12
  const MAX_CAPTION_CHARS = 280

  const posts = Array.isArray(ig.posts) ? ig.posts as Record<string, unknown>[] : []
  const total = posts.length

  // Sort by engagement (likes + comments) descending — best signal first
  const sorted = [...posts].sort((a, b) => {
    const ea = Number(a.likes ?? 0) + Number(a.comments ?? 0)
    const eb = Number(b.likes ?? 0) + Number(b.comments ?? 0)
    return eb - ea
  })

  const sample = sorted.slice(0, MAX_POSTS).map((p) => ({
    type:     p.type ?? p.post_type ?? 'Image',
    caption:  typeof p.caption === 'string' ? p.caption.slice(0, MAX_CAPTION_CHARS) : null,
    hashtags: Array.isArray(p.hashtags) ? (p.hashtags as string[]).slice(0, 5) : [],
    likes:    p.likes ?? p.likes_count ?? 0,
    comments: p.comments ?? p.comments_count ?? 0,
    timestamp: p.timestamp ?? p.posted_at ?? null,
  }))

  // Aggregate the full set as summary stats for COO context
  const avgLikes = total > 0
    ? Math.round(posts.reduce((s, p) => s + Number(p.likes ?? p.likes_count ?? 0), 0) / total)
    : 0
  const arabicCaptions = posts.filter((p) =>
    typeof p.caption === 'string' && /[؀-ۿ]/.test(p.caption)
  ).length

  return {
    ...ig,
    posts: sample,
    _posts_summary: {
      total_scraped:   total,
      shown_to_coo:    sample.length,
      avg_likes:       avgLikes,
      arabic_caption_pct: total > 0 ? Math.round((arabicCaptions / total) * 100) : 0,
    },
  }
}

export async function buildBrandDna(
  payload: Record<string, unknown>,
  opts: CooCallOptions,
): Promise<schemas.BuildBrandDnaResponse> {
  // Trim instagram_extraction before sending to model — keeps input under
  // ~1,500 tokens regardless of posts scraped (5 or 50).
  // The model gets 12 top-engagement posts + aggregate stats on the rest.
  const trimmedPayload = { ...payload }
  if (trimmedPayload.instagram_extraction && typeof trimmedPayload.instagram_extraction === 'object') {
    trimmedPayload.instagram_extraction = trimIgForCoo(
      trimmedPayload.instagram_extraction as Record<string, unknown>
    )
  }

  const r = await callCoo(
    { task_type: 'build_branddna', brand_id: opts.brand_id, payload: trimmedPayload },
    opts,
  )
  return schemas.BuildBrandDnaResponse.parse(r)
}

export async function compileCaptionContext(
  payload: Record<string, unknown>,
  opts: CooCallOptions,
): Promise<schemas.CompileCaptionContextResponse> {
  const r = await callCoo(
    { task_type: 'compile_caption_context', brand_id: opts.brand_id, payload },
    opts,
  )
  return schemas.CompileCaptionContextResponse.parse(r)
}

export async function scoreConfidence(
  payload: Record<string, unknown>,
  opts: CooCallOptions,
): Promise<schemas.ScoreConfidenceResponse> {
  const r = await callCoo(
    { task_type: 'score_confidence', brand_id: opts.brand_id, payload },
    opts,
  )
  return schemas.ScoreConfidenceResponse.parse(r)
}

export async function scoreUpgradeReadiness(
  payload: Record<string, unknown>,
  opts: CooCallOptions,
): Promise<schemas.UpgradeReadinessResponse> {
  const r = await callCoo(
    { task_type: 'upgrade_readiness', brand_id: opts.brand_id, payload },
    opts,
  )
  return schemas.UpgradeReadinessResponse.parse(r)
}

/** Execute a COO tool call against the DB and return the JSON-string result. */
async function runCooTool(
  name: string,
  args: Record<string, unknown>,
  db: Db | null,
): Promise<string> {
  if (!db) return JSON.stringify({ error: 'DB not connected' })

  if (name === 'query_composition_matrix') {
    const { archetype, lifecycle_stage, intent_state } = args as Record<string, string>
    const { data, error } = await db
      .from('composition_matrix')
      .select('*')
      .eq('archetype', archetype as never)
      .eq('lifecycle_stage', lifecycle_stage as never)
      .eq('intent_state', intent_state as never)
      .maybeSingle()
    return JSON.stringify(error ? { error: error.message } : data || { error: 'No row found' })
  }

  if (name === 'query_creative_methods') {
    const { data, error } = await db.from('creative_methods').select('*')
    return JSON.stringify(error ? { error: error.message } : data)
  }

  return JSON.stringify({ error: 'Unknown tool' })
}

async function callCoo(
  input: schemas.CooInput,
  opts: CooCallOptions,
): Promise<schemas.CooResponse> {
  const system = loadPrompt('COO_SYSTEM_PROMPT')
  const onDeepSeek = useDeepSeekForCoo()
  const client = onDeepSeek ? getDeepSeekClient() : getOpenAIClient()
  const model = onDeepSeek ? DEEPSEEK_MODEL : getCooModel()

  return withRetryAndLogging(
    {
      flow_id: opts.flow_id,
      brand_id: opts.brand_id,
      node_name: 'coo',
      db: opts.db,
    },
    async () => {
      // gpt-5* reasoning models use max_completion_tokens; 4o uses max_tokens.
      const tokenParam = isReasoningModel(model)
        ? { max_completion_tokens: COO_MAX_TOKENS }
        : { max_tokens: COO_MAX_TOKENS }

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(input) },
      ]
      let tokens_in = 0
      let tokens_out = 0
      let finalContent = ''
      let finalFinishReason = ''

      // Tool-use loop: keep responding to tool calls until the model returns a
      // plain message (no tool_calls), which carries the final JSON answer.
      while (true) {
        const response = await client.chat.completions.create({
          model,
          ...tokenParam,
          response_format: { type: 'json_object' },
          tools: COO_TOOLS,
          messages,
        })

        const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        tokens_in  += usage.prompt_tokens
        tokens_out += usage.completion_tokens

        const choice = response.choices[0]
        const msg = choice?.message
        const toolCalls = msg?.tool_calls ?? []

        if (toolCalls.length > 0) {
          // Echo the assistant turn (with its tool_calls) back, then append one
          // tool-result message per call — OpenAI requires both.
          messages.push(msg as OpenAI.Chat.Completions.ChatCompletionMessageParam)
          for (const call of toolCalls) {
            if (call.type !== 'function') continue
            let args: Record<string, unknown> = {}
            try { args = JSON.parse(call.function.arguments || '{}') } catch (_) { /* malformed args → empty */ }
            const content = await runCooTool(call.function.name, args, opts.db)
            messages.push({ role: 'tool', tool_call_id: call.id, content })
          }
          continue
        }

        finalContent = msg?.content ?? ''
        finalFinishReason = choice?.finish_reason ?? 'stop'
        break
      }

      // JSON parser strips any ```json fences the model might emit.
      try {
        const parsed = parseStructuredJson(finalContent, schemas.CooResponse)
        const cost = onDeepSeek
          ? priceDeepSeekUsage({ prompt_tokens: tokens_in, completion_tokens: tokens_out })
          : priceOpenAIChat(model, { prompt_tokens: tokens_in, completion_tokens: tokens_out }).cost
        const { costIn, costOut } = onDeepSeek
          ? { costIn: 0, costOut: 0 }
          : priceOpenAIChat(model, { prompt_tokens: tokens_in, completion_tokens: tokens_out })
        return {
          result:          parsed,
          cost_usd:        cost,
          agent:           'COO',
          provider:        onDeepSeek ? 'deepseek' : 'openai',
          model,
          tokens_in,
          tokens_out,
          tokens_cached:   0,
          cost_usd_input:  costIn,
          cost_usd_output: costOut,
          cost_usd_cached: 0,
          payload: {
            model,
            task_type: input.task_type,
            tokens_in,
            tokens_out,
            stop_reason: finalFinishReason as never,
          },
        }
      } catch (e) {
        const tail = finalContent.slice(-400)
        const head = finalContent.slice(0, 200)
        console.warn(
          `[coo] parse FAIL task=${input.task_type} finish_reason=${finalFinishReason} ` +
            `tokens_out=${tokens_out} text_len=${finalContent.length} ` +
            `head="${head.replace(/\s+/g, ' ')}" tail="${tail.replace(/\s+/g, ' ')}"`,
        )
        throw e
      }
    },
  )
}
