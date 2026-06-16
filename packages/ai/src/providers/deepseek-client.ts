/**
 * DeepSeek client — uses the OpenAI-compatible Chat Completions endpoint
 * exposed at https://api.deepseek.com/v1.
 *
 * Pricing (USD per 1M tokens, Apr 2026 list rates):
 *   deepseek-v4-flash   input $0.27, output $1.10  (with prompt caching, cache-read $0.07)
 */
import OpenAI from 'openai'

let _client: OpenAI | null = null

export function getDeepSeekClient(): OpenAI {
  if (_client) return _client
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set — required for caption generation.')
  }
  _client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1', timeout: 55_000, maxRetries: 0 })
  return _client
}

export const DEEPSEEK_MODEL = 'deepseek-chat'

interface PriceTable {
  input: number
  output: number
  cacheRead: number
}

const PRICING: PriceTable = { input: 0.27, output: 1.10, cacheRead: 0.07 }

export interface DeepSeekUsage {
  prompt_tokens: number
  completion_tokens: number
  // DeepSeek includes this when prompt caching kicks in.
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
}

export function priceDeepSeekUsage(usage: DeepSeekUsage): number {
  const cacheHits = usage.prompt_cache_hit_tokens ?? 0
  const fresh = usage.prompt_tokens - cacheHits
  const dollars =
    (fresh / 1_000_000) * PRICING.input +
    (cacheHits / 1_000_000) * PRICING.cacheRead +
    (usage.completion_tokens / 1_000_000) * PRICING.output
  return Number(dollars.toFixed(6))
}

export function __resetDeepSeekClientForTests(): void {
  _client = null
}
