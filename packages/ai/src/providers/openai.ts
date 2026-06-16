/**
 * Shared OpenAI client for the CCO agent.
 *
 * Model selection (Doc §13.1):
 *   - Default: GPT-5 (Tier 4 required — $250+ historical spend on the OpenAI
 *     account). Set `OPENAI_CCO_MODEL=gpt-5` once Tier 4 is confirmed.
 *   - Fallback: gpt-4o — comparable Arabic quality per the spec; works on Tier 1.
 *
 * Pricing (USD per 1M tokens, Apr 2026 list rates — update when the team rotates models):
 *   gpt-5     input $2.00, output $10.00
 *   gpt-4o    input $2.50, output $10.00
 */
import OpenAI from 'openai'

let _client: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set — required for CCO calls.')
  }
  _client = new OpenAI({ apiKey })
  return _client
}

// Known model ids we have list pricing for. The resolver functions accept any
// string from env (so the team can point an agent at a new model without a code
// change), but pricing for an unknown model falls back to the gpt-4o rate.
export type OpenAIModel = 'gpt-5' | 'gpt-5-mini' | 'gpt-5-nano' | 'gpt-4o' | 'gpt-4o-mini'

export function getCcoModel(): OpenAIModel {
  const m = process.env.OPENAI_CCO_MODEL?.trim()
  if (m === 'gpt-5' || m === 'gpt-4o') return m
  return 'gpt-4o' // Safe default until Tier 4 confirmed (Doc §13.1).
}

/**
 * CEO/COO were Claude (Sonnet/Haiku); migrated to OpenAI when the Anthropic
 * account went over budget. Model is env-driven so it can be swapped without a
 * deploy. Defaults to gpt-5-nano (cheap, for testing) — set OPENAI_CEO_MODEL /
 * OPENAI_COO_MODEL to a production model (e.g. gpt-4o) when ready.
 */
export function getCeoModel(): string {
  return process.env.OPENAI_CEO_MODEL?.trim() || 'gpt-5-nano'
}

export function getCooModel(): string {
  return process.env.OPENAI_COO_MODEL?.trim() || 'gpt-5-nano'
}

/**
 * gpt-5 reasoning models (gpt-5, gpt-5-mini, gpt-5-nano) use the newer Chat
 * Completions conventions: the output cap is `max_completion_tokens` (NOT
 * `max_tokens`) and `temperature` is fixed at 1. The 4o family uses `max_tokens`.
 * This lets each wrapper build the right params for whatever model env selects.
 */
export function isReasoningModel(model: string): boolean {
  return model.startsWith('gpt-5')
}

interface PriceTable {
  input: number
  output: number
}

// USD per 1M tokens, list rates (update when the team rotates models).
const PRICING: Record<string, PriceTable> = {
  'gpt-5':       { input: 2.0,  output: 10.0 },
  'gpt-5-mini':  { input: 0.25, output: 2.0 },
  'gpt-5-nano':  { input: 0.05, output: 0.4 },
  'gpt-4o':      { input: 2.5,  output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
}

// Guaranteed fallback rate for any model id not in PRICING (gpt-4o list rate).
const DEFAULT_PRICE: PriceTable = { input: 2.5, output: 10.0 }

/** Price a completion by model id, falling back to the gpt-4o rate if unknown. */
export function priceOpenAIChat(
  model: string,
  usage: { prompt_tokens: number; completion_tokens: number },
): { costIn: number; costOut: number; cost: number } {
  const p = PRICING[model] ?? DEFAULT_PRICE
  const costIn  = Number(((usage.prompt_tokens     / 1_000_000) * p.input).toFixed(6))
  const costOut = Number(((usage.completion_tokens / 1_000_000) * p.output).toFixed(6))
  return { costIn, costOut, cost: Number((costIn + costOut).toFixed(6)) }
}

export interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
}

export function priceOpenAIUsage(model: OpenAIModel, usage: OpenAIUsage): number {
  const p = PRICING[model] ?? DEFAULT_PRICE
  const dollars =
    (usage.prompt_tokens / 1_000_000) * p.input +
    (usage.completion_tokens / 1_000_000) * p.output
  return Number(dollars.toFixed(6))
}

export function __resetOpenAIClientForTests(): void {
  _client = null
}
