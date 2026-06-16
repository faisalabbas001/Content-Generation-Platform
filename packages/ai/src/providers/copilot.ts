/**
 * Copilot — Claude Sonnet 4.6 wrapper for the 3 admin copilots
 * (Management / Tech / Production). Doc §8.5.
 *
 * Distinct from CEO/COO in two ways:
 *
 *   1. Multi-turn — copilots maintain a persistent conversation history
 *      (stored in `copilot_messages`). The caller is responsible for loading
 *      the history; this wrapper just accepts a `messages: ClaudeMessage[]`
 *      array and posts it to Anthropic.
 *
 *   2. No structured-JSON parsing — copilot replies are free-form markdown
 *      meant for direct render in the chat UI. We don't validate the shape.
 *
 * Same as CEO/COO:
 *   - Uses `withRetryAndLogging` so every call lands in usage_logs and
 *     anomaly_records on final failure.
 *   - System prompt is cached via `cache_control: { type: 'ephemeral' }` so
 *     repeated turns within ~5 minutes pay 0.1× input cost.
 */
import type { Db } from '@repo/db/client'
import type Anthropic from '@anthropic-ai/sdk'
import { loadPrompt, type PromptKey } from '../prompts'
import { withRetryAndLogging } from '../retry'
import {
  getAnthropicClient,
  priceClaudeUsage,
  type ClaudeModel,
} from './anthropic'

const COPILOT_MODEL: ClaudeModel = 'claude-sonnet-4-6'
const COPILOT_MAX_TOKENS = 1000 // Doc §8.5

export type CopilotRole = 'management' | 'tech' | 'production'

const ROLE_PROMPT: Record<CopilotRole, PromptKey> = {
  management: 'COPILOT_MANAGEMENT_PROMPT',
  tech:       'COPILOT_TECH_PROMPT',
  production: 'COPILOT_PRODUCTION_PROMPT',
}

/** A single conversation turn — same shape we persist in copilot_messages. */
export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CopilotCallInput {
  role: CopilotRole
  /**
   * Full prior conversation IN ORDER. Caller is responsible for trimming
   * (we recommend last 20 turns or ≤ 16k tokens). The wrapper does NOT trim.
   */
  history: ClaudeMessage[]
  /**
   * The new user message — sent as the LAST `user` turn.
   * Must NOT already be in `history`.
   */
  user_message: string
  /**
   * Pre-fetched, role-scoped context payload. The API has already pulled
   * this via fetchCopilotContext() under the right RLS GUC. Embedded as a
   * system-message segment so Claude can use it without losing the cached
   * primary system prompt.
   */
  context: Record<string, unknown>
}

export interface CopilotCallOptions {
  /** Admin user id — used for usage_logs only. brand_id is null for copilots. */
  admin_user_id: string
  /** Logical flow tag — e.g. 'copilot_management'. */
  flow_id: string
  db: Db | null
}

export interface CopilotResult {
  reply: string
  cost_usd: number
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
}

/**
 * Send a turn to the role's copilot. Returns the assistant's free-form reply.
 * Throws AiCallFailedError after 2 retries (handled by withRetryAndLogging).
 */
export async function ask(input: CopilotCallInput, opts: CopilotCallOptions): Promise<CopilotResult> {
  const promptKey = ROLE_PROMPT[input.role]
  const systemPrompt = loadPrompt(promptKey)
  const client = getAnthropicClient()

  // We send TWO system blocks:
  //   1. The role prompt — cached (large, identical across calls).
  //   2. The per-turn context — NOT cached (changes every call).
  // Anthropic's caching is positional: the cached block must come first
  // and be byte-identical across calls. The context block sits AFTER it,
  // so the cache hit on (1) survives no matter what (2) contains.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text:
        '## Live context (fetched server-side via RLS just now)\n\n' +
        '```json\n' +
        JSON.stringify(input.context, null, 2) +
        '\n```',
    },
  ]

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.user_message },
  ]

  return withRetryAndLogging(
    {
      flow_id: opts.flow_id,
      brand_id: null,
      node_name: `copilot_${input.role}`,
      db: opts.db,
    },
    async () => {
      const response = await client.messages.create({
        model: COPILOT_MODEL,
        max_tokens: COPILOT_MAX_TOKENS,
        system: systemBlocks,
        messages,
      })

      const usage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      }
      const cost = priceClaudeUsage(COPILOT_MODEL, usage)
      const reply = extractText(response.content)

      return {
        result: { reply, cost_usd: cost, usage },
        cost_usd: cost,
        payload: {
          model: COPILOT_MODEL,
          role: input.role,
          admin_user_id: opts.admin_user_id,
          history_turns: input.history.length,
          context_bytes: JSON.stringify(input.context).length,
          tokens_in: usage.input_tokens,
          tokens_out: usage.output_tokens,
          cache_read: usage.cache_read_input_tokens,
        },
      }
    },
  )
}

function extractText(content: Anthropic.ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
  }
  if (parts.length === 0) {
    throw new Error('Copilot response had no text block')
  }
  return parts.join('\n\n')
}

// ─── Streaming variant ────────────────────────────────────────────────────────

async function writeUsageLog(
  db: Db | null,
  row: {
    flow_id: string
    brand_id: null
    node_name: string
    duration_ms: number
    cost_usd: number
    payload: Record<string, unknown>
  },
): Promise<void> {
  if (!db) return
  try {
    await db.from('usage_logs').insert(row as never)
  } catch { /* never let logging break the response */ }
}

/**
 * Streaming variant of ask(). Calls onChunk for each text delta so the
 * caller can forward tokens to the client in real time. Returns the same
 * CopilotResult as ask() once the stream is complete.
 *
 * Does NOT use withRetryAndLogging (streaming can't retry mid-stream).
 * Writes one usage_logs row after the stream ends, same as ask().
 */
export async function askStream(
  input: CopilotCallInput,
  opts: CopilotCallOptions,
  onChunk: (text: string) => void,
): Promise<CopilotResult> {
  const promptKey = ROLE_PROMPT[input.role]
  const systemPrompt = loadPrompt(promptKey)
  const client = getAnthropicClient()

  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text:
        '## Live context (fetched server-side via RLS just now)\n\n' +
        '```json\n' +
        JSON.stringify(input.context, null, 2) +
        '\n```',
    },
  ]

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.user_message },
  ]

  const start = Date.now()
  let fullText = ''

  const stream = client.messages.stream({
    model: COPILOT_MODEL,
    max_tokens: COPILOT_MAX_TOKENS,
    system: systemBlocks,
    messages,
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text
      onChunk(event.delta.text)
    }
  }

  const finalMsg = await stream.finalMessage()
  const usage = {
    input_tokens:                  finalMsg.usage.input_tokens,
    output_tokens:                 finalMsg.usage.output_tokens,
    cache_creation_input_tokens:   finalMsg.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens:       finalMsg.usage.cache_read_input_tokens     ?? 0,
  }
  const cost_usd = priceClaudeUsage(COPILOT_MODEL, usage)

  if (!fullText) throw new Error('Copilot stream produced no text')

  await writeUsageLog(opts.db, {
    flow_id:      opts.flow_id,
    brand_id:     null,
    node_name:    `copilot_${input.role}`,
    duration_ms:  Date.now() - start,
    cost_usd,
    payload: {
      model:         COPILOT_MODEL,
      streaming:     true,
      role:          input.role,
      admin_user_id: opts.admin_user_id,
      history_turns: input.history.length,
      context_bytes: JSON.stringify(input.context).length,
      tokens_in:     usage.input_tokens,
      tokens_out:    usage.output_tokens,
      cache_read:    usage.cache_read_input_tokens,
    },
  })

  return { reply: fullText, cost_usd, usage }
}
