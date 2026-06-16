/**
 * Shared Anthropic client + cost calculator (Claude Sonnet 4.6 + Haiku 4.5).
 *
 * Prompt caching strategy (Doc §6.1 + Anthropic best practice):
 *   - The system prompt is large (200-300 lines). We mark it with
 *     `cache_control: { type: 'ephemeral' }` so subsequent calls pay only the
 *     `cache_read` rate (~10% of input cost) for the first ~5 minutes.
 *   - Per-call user content is NOT cached.
 *
 * Pricing snapshot (USD per 1M tokens, as of 2026-04, Anthropic public rates):
 *   sonnet-4-6  input $3.00, output $15.00, cache write $3.75, cache read $0.30
 *   haiku-4-5   input $0.80, output $4.00,  cache write $1.00, cache read $0.08
 */
import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — required for CEO + COO calls.')
  }
  const config = {
    apiKey,
    // Disable the SDK's silent retries — withRetryAndLogging() in retry.ts
    // already handles retries with explicit backoff + observability. The SDK
    // default is 2 retries with exponential backoff which compounds on flaky
    // calls (30s+ per attempt) and pushes us past the n8n HTTP node timeout.
    maxRetries: 0,
    // Per-request timeout. Sonnet 4.6 cold-start can take 20-30s on the
    // CEO/COO build-branddna prompts (large system prompt + 1-2K output
    // tokens). 25s was too aggressive — we saw "Request timed out" on
    // legitimate 24-30s calls. 60s gives Sonnet headroom and is still
    // well under n8n's bumped 120s HTTP timeout.
    timeout: 60_000,
  }
  console.info(
    `[anthropic] init client maxRetries=${config.maxRetries} timeout=${config.timeout}ms ` +
    `key=${apiKey.slice(0, 12)}…${apiKey.slice(-4)}`,
  )
  _client = new Anthropic(config)
  return _client
}

export type ClaudeModel = 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'

interface PriceTable {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

const PRICING: Record<ClaudeModel, PriceTable> = {
  'claude-sonnet-4-6':           { input: 3.0,  output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  'claude-haiku-4-5-20251001':   { input: 0.8,  output: 4.0,  cacheWrite: 1.0,  cacheRead: 0.08 },
}

export interface ClaudeUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function priceClaudeUsage(model: ClaudeModel, usage: ClaudeUsage): number {
  const p = PRICING[model]
  const dollars =
    (usage.input_tokens / 1_000_000) * p.input +
    (usage.output_tokens / 1_000_000) * p.output +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * p.cacheWrite +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * p.cacheRead
  return Number(dollars.toFixed(6))
}

/** Test-only — clear the singleton so a fresh API key is picked up. */
export function __resetAnthropicClientForTests(): void {
  _client = null
}
