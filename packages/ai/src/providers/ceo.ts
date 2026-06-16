/**
 * CEO — routing intelligence wrapper.
 *
 * Doc §6.1 + prompts/OGzStudios_CEO_Prompt_v1.md.
 *
 * Provider: OpenAI (Chat Completions, JSON mode). Migrated from Claude Sonnet
 * 4.6 when the Anthropic account went over budget. Model is env-driven via
 * OPENAI_CEO_MODEL (defaults to gpt-5-nano for testing) — see openai.ts.
 *
 * Public API:
 *   - classify()        — Steps 1-6 (request classification + dispatch decision)
 *   - confidenceGate()  — Step 7 (post-CCO gate per post)
 *
 * The wrapper enforces:
 *   - System prompt loaded from env / fallback file (never hardcoded).
 *   - OpenAI JSON mode (response_format: json_object) for structured output.
 *   - Retry + backoff via withRetryAndLogging() per Doc §5.4.
 *   - Zod-validated structured JSON.
 *   - Usage + anomaly logging via withRetryAndLogging().
 */
import type { Db } from '@repo/db/client'
import { schemas } from '@repo/core'
import { loadPrompt } from '../prompts'
import { parseStructuredJson } from '../json'
import { withRetryAndLogging } from '../retry'
import {
  getOpenAIClient,
  getCeoModel,
  isReasoningModel,
  priceOpenAIChat,
} from './openai'
// CEO RoutingDecision has 13 fields including a 13-field constraint_payload,
// human_gate_reasons array, memory_nominations array, and a reasoning string.
// Empirically a clean response averages 700-1200 tokens; we leave headroom so
// the model never gets cut off mid-JSON (which the parser can't recover from).
const CEO_MAX_TOKENS = 4096
// Reasoning models (gpt-5*) burn part of max_completion_tokens on HIDDEN
// reasoning tokens BEFORE any visible output. With a large input (chain
// shortlist + trigger payload) gpt-5-nano can spend the entire 4096 budget
// reasoning and return EMPTY content with finish_reason='length' — the exact
// "No JSON object/array found in model response" 502. Reasoning models get a
// much larger completion budget plus reasoning_effort='low' (this is routing
// classification, not deep reasoning — low is faster and cheaper too).
const CEO_MAX_TOKENS_REASONING = 16384

export interface CeoCallOptions {
  flow_id: string
  brand_id: string | null
  /** Service-role client used to write usage_logs / anomaly_records. Pass null to disable logging. */
  db: Db | null
}

/**
 * Step 1-6: classify a trigger and produce a dispatch payload.
 * Pass the trigger's full payload — the CEO prompt expects structured input.
 */
export async function classify(
  input: schemas.CeoInput,
  opts: CeoCallOptions,
): Promise<schemas.RoutingDecision> {
  return callCeo(input, opts)
}

/**
 * Step 7: confidence gate. Pass `cco_results` populated; the CEO checks all
 * 11 override triggers and returns a routing decision with `human_gate_*`
 * fields set. The wrapper is identical — only the input shape differs.
 */
export async function confidenceGate(
  input: schemas.CeoInput & { cco_results: NonNullable<schemas.CeoInput['cco_results']> },
  opts: CeoCallOptions,
): Promise<schemas.RoutingDecision> {
  return callCeo(input, opts)
}

async function callCeo(
  input: schemas.CeoInput,
  opts: CeoCallOptions,
): Promise<schemas.RoutingDecision> {
  const system = loadPrompt('CEO_SYSTEM_PROMPT')
  const client = getOpenAIClient()
  const model = getCeoModel()

  return withRetryAndLogging(
    {
      flow_id: opts.flow_id,
      brand_id: opts.brand_id,
      node_name: 'ceo',
      db: opts.db,
      // Cap at 1 retry so a deterministic parse failure costs at most 2 calls
      // and surfaces a real error instead of timing out the n8n leg.
      maxRetries: 1,
    },
    async () => {
      const _t0 = Date.now()
      console.info(`[ceo] call START brand=${opts.brand_id ?? 'system'} flow=${opts.flow_id} model=${model}`)

      // gpt-5* reasoning models use max_completion_tokens; 4o uses max_tokens.
      const tokenParam = isReasoningModel(model)
        ? { max_completion_tokens: CEO_MAX_TOKENS_REASONING, reasoning_effort: 'low' as const }
        : { max_tokens: CEO_MAX_TOKENS }

      let response
      try {
        response = await client.chat.completions.create({
          model,
          ...tokenParam,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(input) },
          ],
        })
      } catch (e) {
        const elapsed = Date.now() - _t0
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(`[ceo] call FAIL brand=${opts.brand_id ?? 'system'} elapsed=${elapsed}ms err=${msg.slice(0, 200)}`)
        throw e
      }

      const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      const _elapsed = Date.now() - _t0
      console.info(`[ceo] call OK brand=${opts.brand_id ?? 'system'} elapsed=${_elapsed}ms tokens_in=${usage.prompt_tokens} tokens_out=${usage.completion_tokens}`)

      const text = response.choices[0]?.message?.content ?? ''
      // Empty content with finish_reason='length' = the reasoning-token budget
      // was exhausted before any JSON was emitted. Surface a precise error
      // (instead of the opaque "No JSON object/array found") so ops can tell
      // budget exhaustion apart from malformed output.
      if (!text.trim()) {
        const fr = response.choices[0]?.finish_reason ?? 'unknown'
        throw new Error(
          `CEO returned empty content (model=${model}, finish_reason=${fr}, ` +
          `tokens_out=${usage.completion_tokens}) — completion/reasoning budget likely exhausted`,
        )
      }
      let parsed
      try {
        parsed = parseStructuredJson(text, schemas.CeoResponse)
      } catch (parseErr) {
        // Surface what the model actually returned so we can see why Zod
        // rejected it — most common cause of CEO retry storms is a field-name
        // mismatch (snake_case vs camelCase, missing required field, etc).
        const peek = text.length > 1500 ? text.slice(0, 1500) + '…(truncated)' : text
        console.warn(`[ceo] parse FAIL brand=${opts.brand_id ?? 'system'} err=${parseErr instanceof Error ? parseErr.message : String(parseErr)}`)
        console.warn(`[ceo] parse FAIL raw_response=${peek}`)
        throw parseErr
      }

      const tokIn  = usage.prompt_tokens
      const tokOut = usage.completion_tokens
      const { costIn, costOut, cost } = priceOpenAIChat(model, {
        prompt_tokens: tokIn,
        completion_tokens: tokOut,
      })
      return {
        result:          parsed.routing_decision,
        cost_usd:        cost,
        agent:           'CEO',
        provider:        'openai',
        model,
        tokens_in:       tokIn,
        tokens_out:      tokOut,
        tokens_cached:   0,
        cost_usd_input:  costIn,
        cost_usd_output: costOut,
        cost_usd_cached: 0,
        payload: {
          model,
          tokens_in:    tokIn,
          tokens_out:   tokOut,
          finish_reason: response.choices[0]?.finish_reason ?? null,
        },
      }
    },
  )
}

import type OpenAI from 'openai'
function extractText(response: OpenAI.Chat.Completions.ChatCompletion): string {
  const text = response.choices[0]?.message?.content ?? ''
  if (!text) throw new Error('CEO response had no text content')
  return text
}
