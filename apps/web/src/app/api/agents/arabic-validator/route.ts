/**
 * POST /api/agents/arabic-validator
 *
 * Arabic Validator (Claude Sonnet 4.6) — validates Arabic caption/headline text
 * for spelling accuracy, dialect correctness, RTL rendering, register
 * appropriateness, and cultural sensitivity.
 *
 * Called by n8n flows after Arabic copy is produced and before it is published.
 * Returns a structured validation result with a score, issues list, and an
 * optional corrected version of the text.
 *
 * Doc §6.x — Arabic Validator agent.
 */
import { adminClient } from '@repo/db/client'
import { getAnthropicClient, withRetryAndLogging, parseStructuredJson } from '@repo/ai'
import { z } from 'zod'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── Input schema ─────────────────────────────────────────────────────────────

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    text_ar: z.string().min(1),
    dialect: z.enum(['Najdi', 'Hejazi', 'Gulf', 'MSA_formal', 'MSA_accessible', 'Mixed']),
    tone_register: z.enum(['Traditional', 'Modern', 'Youth', 'Mixed']).optional(),
    context: z.string().optional(),
  }),
})

// ─── Output schema ────────────────────────────────────────────────────────────

const IssueSchema = z.object({
  type: z.enum(['spelling', 'dialect', 'register', 'cultural', 'rtl']),
  severity: z.enum(['error', 'warning']),
  description: z.string(),
  suggested_fix: z.string().optional(),
})

const ValidationResultSchema = z.object({
  task_type: z.literal('arabic_validation'),
  brand_id: z.string(),
  text_ar: z.string(),
  dialect: z.string(),
  is_valid: z.boolean(),
  score: z.number().int().min(0).max(100),
  issues: z.array(IssueSchema),
  corrected_text: z.string().optional(),
  reasoning: z.string(),
})

type ValidationResult = z.infer<typeof ValidationResultSchema>

// ─── Agent model config ───────────────────────────────────────────────────────

const ARABIC_VALIDATOR_MODEL = 'claude-sonnet-4-6' as const

const ARABIC_VALIDATOR_MAX_TOKENS = 2048

// ─── System prompt ────────────────────────────────────────────────────────────
// Kept inline — no env var prompt file exists for this agent yet (no
// ARABIC_VALIDATOR_SYSTEM_PROMPT defined). If one is added later, replace with
// loadPrompt('ARABIC_VALIDATOR_SYSTEM_PROMPT').

const SYSTEM_PROMPT = `You are an expert Arabic linguist and Saudi cultural consultant specialising in brand communication. You validate Arabic text across five dimensions:

1. **Spelling accuracy** — check for misspelled words, hallucinated lexical items, or incorrect morphological forms.
2. **Dialect correctness** — verify the text matches the requested dialect (Najdi / Hejazi / Gulf / MSA_formal / MSA_accessible / Mixed). Know the phonological, lexical, and grammatical markers that distinguish each:
   - **Najdi**: central Arabian Peninsula vocabulary; typical markers include كذا, زين, وش, ما عندهم (masculine plural -هم dominates).
   - **Hejazi**: west coast (Jeddah/Makkah/Madinah) vocabulary; lighter hamza elision, influence of Levantine/Egyptian loan words.
   - **Gulf** (Khaleeji): markers shared with Kuwait/UAE/Qatar; vocabulary like زين، كيفك، شلونك، وايد.
   - **MSA_formal**: classical Modern Standard Arabic — no colloquial contractions, full iʿrāb, formal vocabulary.
   - **MSA_accessible**: everyday written Arabic widely understood across the Arab world, not rigidly classical.
   - **Mixed**: acceptable blend of MSA and a Gulf/Saudi colloquial register.
3. **RTL rendering correctness** — flag bidirectional (bidi) issues, incorrectly placed numerals or Latin strings that would break RTL flow, or punctuation placed on the wrong side.
4. **Register appropriateness** — check that the tone matches the tone_register when provided (Traditional / Modern / Youth / Mixed).
5. **Cultural sensitivity** — flag anything that could be considered offensive, taboo, or culturally inappropriate in a Saudi Arabian context. Only flag REAL violations, not subjective style preferences.

**Rules:**
- Only report REAL linguistic or cultural issues — do NOT flag stylistic preferences.
- A score of 100 means perfect; deduct points for each issue: error = −10 to −20 pts, warning = −3 to −7 pts.
- If all issues are fixable, provide a corrected_text; otherwise omit it.
- Return ONLY a single JSON object — no markdown fences, no preamble, no trailing text.

**Output format (strict JSON — no extra keys):**
{
  "task_type": "arabic_validation",
  "brand_id": "<echoed from input>",
  "text_ar": "<original text echoed>",
  "dialect": "<dialect echoed>",
  "is_valid": true | false,
  "score": <0-100>,
  "issues": [
    {
      "type": "spelling" | "dialect" | "register" | "cultural" | "rtl",
      "severity": "error" | "warning",
      "description": "<concise description in English>",
      "suggested_fix": "<optional Arabic correction>"
    }
  ],
  "corrected_text": "<corrected Arabic — omit key if no corrections needed>",
  "reasoning": "<brief English explanation of your overall assessment>"
}`

// ─── Agent handler ────────────────────────────────────────────────────────────

async function runArabicValidator(
  input: z.infer<typeof RequestBody>,
  ctx: { requestId: string; flowId: string },
): Promise<ValidationResult> {
  const client = getAnthropicClient()

  const userContent = JSON.stringify({
    brand_id: input.brand_id,
    text_ar: input.payload.text_ar,
    dialect: input.payload.dialect,
    tone_register: input.payload.tone_register ?? null,
    context: input.payload.context ?? null,
  })

  return withRetryAndLogging(
    {
      flow_id: ctx.flowId,
      brand_id: input.brand_id,
      node_name: 'copilot_production', // closest available node_name for a standalone validator
      db: adminClient(),
    },
    async () => {
      const _t0 = Date.now()
      console.info(
        `[arabic-validator] call START brand=${input.brand_id} flow=${ctx.flowId} dialect=${input.payload.dialect}`,
      )

      let response: Awaited<ReturnType<typeof client.messages.create>>
      try {
        response = await client.messages.create({
          model: ARABIC_VALIDATOR_MODEL,
          max_tokens: ARABIC_VALIDATOR_MAX_TOKENS,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              // Cache the large system prompt — subsequent calls within the
              // 5-minute ephemeral window pay only the cache-read rate (~10%).
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: userContent }],
        })
      } catch (e) {
        const elapsed = Date.now() - _t0
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(
          `[arabic-validator] call FAIL brand=${input.brand_id} elapsed=${elapsed}ms err=${msg.slice(0, 200)}`,
        )
        throw e
      }

      const elapsed = Date.now() - _t0
      console.info(
        `[arabic-validator] call OK brand=${input.brand_id} elapsed=${elapsed}ms ` +
          `tokens_in=${response.usage.input_tokens} tokens_out=${response.usage.output_tokens}`,
      )

      // Cost tracking: sonnet-4-6 rates ($3/1M input, $15/1M output).
      // Kept as a simple inline calculation — priceClaudeUsage is an internal
      // helper not exported from the @repo/ai barrel.
      const cost =
        (response.usage.input_tokens / 1_000_000) * 3.0 +
        (response.usage.output_tokens / 1_000_000) * 15.0 +
        ((response.usage.cache_creation_input_tokens ?? 0) / 1_000_000) * 3.75 +
        ((response.usage.cache_read_input_tokens ?? 0) / 1_000_000) * 0.30

      const rawText = extractText(response.content)

      let parsed: ValidationResult
      try {
        parsed = parseStructuredJson(rawText, ValidationResultSchema)
      } catch (parseErr) {
        const peek = rawText.length > 1500 ? rawText.slice(0, 1500) + '…(truncated)' : rawText
        console.warn(
          `[arabic-validator] parse FAIL brand=${input.brand_id} err=${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        )
        console.warn(`[arabic-validator] parse FAIL raw_response=${peek}`)
        throw parseErr
      }

      return {
        result: parsed,
        cost_usd: cost,
        payload: {
          model: ARABIC_VALIDATOR_MODEL,
          tokens_in: response.usage.input_tokens,
          tokens_out: response.usage.output_tokens,
          cache_read: response.usage.cache_read_input_tokens ?? 0,
          cache_write: response.usage.cache_creation_input_tokens ?? 0,
          dialect: input.payload.dialect,
          score: parsed.score,
          is_valid: parsed.is_valid,
        },
      }
    },
  )
}

function extractText(content: { type: string; text?: string }[]): string {
  for (const block of content) {
    if (block.type === 'text' && block.text) return block.text
  }
  throw new Error('[arabic-validator] response had no text block')
}

// ─── Route export ─────────────────────────────────────────────────────────────

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-AV01',
  handler: runArabicValidator,
})
