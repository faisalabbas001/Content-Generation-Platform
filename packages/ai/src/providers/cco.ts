/**
 * CCO (GPT-5 / GPT-4o fallback) — Arabic QC wrapper.
 *
 * Doc §6.3 + prompts/OGzStudios_CCO_Prompt_v1.md.
 *
 * Returns a JSON ARRAY (one entry per post). We use OpenAI's
 * `response_format: { type: 'json_object' }` and wrap the output in
 * `{ "evaluations": [...] }` because Chat Completions only supports
 * top-level objects in JSON mode — we extract the array on the way out.
 */
import type { Db } from '@repo/db/client'
import { schemas } from '@repo/core'
import { z } from 'zod'
import { loadPrompt } from '../prompts'
import { parseStructuredJson } from '../json'
import { withRetryAndLogging } from '../retry'
import { getOpenAIClient, getCcoModel, priceOpenAIChat } from './openai'

const CCO_MAX_TOKENS = 4096

export interface CcoCallOptions {
  flow_id: string
  brand_id: string
  db: Db | null
}

/** Top-level wrapper schema — see comment above. */
const CcoEnvelope = z.object({ evaluations: schemas.CcoResponse })

export async function qcCaptions(
  input: schemas.CcoInput,
  opts: CcoCallOptions,
): Promise<schemas.CcoResponse> {
  const system = loadPrompt('CCO_SYSTEM_PROMPT')
  const client = getOpenAIClient()
  const model = getCcoModel()

  return withRetryAndLogging(
    {
      flow_id: opts.flow_id,
      brand_id: opts.brand_id,
      node_name: 'cco',
      db: opts.db,
    },
    async () => {
      const response = await client.chat.completions.create({
        model,
        max_tokens: CCO_MAX_TOKENS,
        response_format: { type: 'json_object' },
        // The CCO prompt instructs a top-level JSON array. To work with
        // OpenAI JSON mode, we re-instruct the model to return an
        // `{ "evaluations": [...] }` envelope; the underlying contract is
        // unchanged.
        messages: [
          {
            role: 'system',
            content:
              system +
              '\n\nIMPORTANT — RUNTIME WRAPPER:\n' +
              'Return a JSON OBJECT with one field `evaluations` whose value is the JSON array described above.\n' +
              'Example: `{ "evaluations": [ { "post_id": "...", "score": 82, ... } ] }`',
          },
          { role: 'user', content: JSON.stringify(input) },
        ],
      })

      const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }

      const raw = response.choices[0]?.message?.content ?? ''
      const envelope = parseStructuredJson(raw, CcoEnvelope)

      const tokIn  = usage.prompt_tokens
      const tokOut = usage.completion_tokens
      const { costIn, costOut, cost } = priceOpenAIChat(model, {
        prompt_tokens: tokIn,
        completion_tokens: tokOut,
      })
      return {
        result:          envelope.evaluations,
        cost_usd:        cost,
        agent:           'CCO',
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
