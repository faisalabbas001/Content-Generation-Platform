/**
 * Visual Prompt Composer — DeepSeek V3 wrapper.
 *
 * Doc Hard Rule #3 + prompts/OGzStudios_VisualPrompt_Prompt_v1.md.
 *
 * Takes brand + post + chain metadata and returns a rich, English-only fal.ai
 * prompt as `{ visual_brief_en }`. Replaces the weak
 * `brand_name_en + " product Saudi Arabia"` fallback that n8n used to build.
 *
 * Like deepseek.ts this uses the OpenAI-compatible Chat Completions endpoint
 * with `response_format: json_object`. Cost/usage flows through
 * withRetryAndLogging → usage_logs.
 */
import type { Db } from '@repo/db/client'
import { schemas } from '@repo/core'
import { loadPrompt } from '../prompts'
import { parseStructuredJson } from '../json'
import { withRetryAndLogging } from '../retry'
import {
  getDeepSeekClient,
  priceDeepSeekUsage,
  DEEPSEEK_MODEL,
  type DeepSeekUsage,
} from './deepseek-client'

// A single visual brief is short — 1024 tokens is generous headroom.
const VISUAL_PROMPT_MAX_TOKENS = 1024

// Arabic + Arabic-supplement Unicode range. Hard Rule #3: image prompts are
// English-only — Arabic is applied later via Sharp overlay in N8N-V01.
const ARABIC_RE = /[؀-ۿݐ-ݿ]/

export interface VisualPromptCallOptions {
  flow_id: string
  brand_id: string
  db: Db | null
}

export async function compose(
  input: schemas.VisualPromptInput,
  opts: VisualPromptCallOptions,
): Promise<schemas.VisualPromptResponse> {
  const system = loadPrompt('VISUAL_PROMPT_SYSTEM_PROMPT')
  const client = getDeepSeekClient()

  return withRetryAndLogging(
    {
      flow_id: opts.flow_id,
      brand_id: opts.brand_id,
      node_name: 'visual_prompt',
      db: opts.db,
    },
    async () => {
      const response = await client.chat.completions.create({
        model: DEEPSEEK_MODEL,
        max_tokens: VISUAL_PROMPT_MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(input) },
        ],
      })

      const u = (response.usage ?? {}) as DeepSeekUsage
      const cost = priceDeepSeekUsage({
        prompt_tokens: u.prompt_tokens ?? 0,
        completion_tokens: u.completion_tokens ?? 0,
        prompt_cache_hit_tokens: u.prompt_cache_hit_tokens ?? 0,
        prompt_cache_miss_tokens: u.prompt_cache_miss_tokens ?? 0,
      })

      const raw = response.choices[0]?.message?.content ?? ''
      const parsed = parseStructuredJson(raw, schemas.VisualPromptResponse)

      // Hard Rule #3 — never let Arabic leak into an image prompt. Throwing here
      // counts as one attempt and triggers the standard retry; on final failure
      // the route surfaces the error and n8n falls back to the existing brief.
      if (ARABIC_RE.test(parsed.visual_brief_en)) {
        throw new Error('Visual Prompt Composer returned Arabic text — image prompts must be English-only (Hard Rule #3).')
      }

      return {
        result: parsed,
        cost_usd: cost,
        payload: {
          model: DEEPSEEK_MODEL,
          tokens_in: u.prompt_tokens ?? 0,
          tokens_out: u.completion_tokens ?? 0,
          cache_hit: u.prompt_cache_hit_tokens ?? 0,
        },
      }
    },
  )
}
