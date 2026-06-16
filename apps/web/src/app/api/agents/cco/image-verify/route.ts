/**
 * POST /api/agents/cco/image-verify
 *
 * Post-generation IMAGE VERIFICATION gate (second vision gate, after cco/visual-qc).
 * Called by N8N-A02 after the asset is generated, BEFORE the calendar row insert.
 *
 * Scores TWO independent dimensions with GPT-4o Vision:
 *   1. prompt_adherence  (0-100) — does the image depict what the user asked for?
 *   2. brand_consistency (0-100) — does the image fit the brand identity + visual
 *      guidelines (style descriptor + palette from visual_style_profiles)?
 *
 * Pass rule: prompt_adherence >= 70 AND (brand_consistency >= 60 when a brand
 * context was loaded). Evaluation details (missing_elements, mismatches,
 * reasoning) are returned so the admin QA UI can show WHY an asset was held.
 *
 * FAIL-OPEN by design (same policy as cco/visual-qc): missing OPENAI_API_KEY,
 * vision API failure, unparsable response, or missing image_url all return
 * pass:true + vision_failed:true — this gate adds protection, never new
 * failure modes. n8n's "Prepare calendar row" treats any non-boolean/failed
 * verdict as pass.
 */
import { z } from 'zod'
import { getOpenAIClient } from '@repo/ai'
import { makeAgentRoute } from '@/lib/agent-route'
import { adminClient } from '@repo/db/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VISION_MODEL = 'gpt-4o'
const VISION_MAX_TOKENS = 1024
// Subject must be depicted faithfully — below this the image does not show what
// the user asked for and goes to admin review.
const ADHERENCE_THRESHOLD = 70
// Same floor as cco/visual-qc's RELEVANCE_THRESHOLD — keep in lockstep.
const CONSISTENCY_THRESHOLD = 60
// Keep the vision call fast — prompts beyond this add tokens, not signal.
const MAX_PROMPT_CHARS = 2000

const RequestBody = z.object({
  flow_id:  z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    // Nullable: video fallback paths may have no asset URL yet — safe pass.
    image_url:          z.string().url().nullish(),
    user_prompt:        z.string().min(1),
    composed_prompt_en: z.string().nullish(),
    post_id:            z.string().uuid().optional(),
  }),
})

const VerifyResponse = z.object({
  prompt_adherence:  z.number().min(0).max(100),
  // Optional: the model omits it when no brand context was provided.
  brand_consistency: z.number().min(0).max(100).nullish(),
  missing_elements:  z.array(z.string()).default([]),
  mismatches:        z.array(z.string()).default([]),
  reasoning:         z.string(),
})

function buildVerifyPrompt(userPrompt: string, composedPrompt: string | null, brandContext: string | null): string {
  const composedBlock = composedPrompt
    ? `\nFINAL GENERATION PROMPT (the refined prompt actually sent to the image model — use it to understand intended styling):\n"${composedPrompt}"\n`
    : ''
  const brandBlock = brandContext
    ? `\n2. BRAND CONSISTENCY ("brand_consistency", 0-100): does the image fit this brand?\n${brandContext}\n- 80-100: clearly on-brand (subject, mood, and style fit the brand's sector and visual guidelines).\n- 60-79: plausibly on-brand (same broad sector or supporting lifestyle scene).\n- 0-59: INCONSISTENT — the image would confuse a customer about what this brand offers, or clearly violates its visual guidelines.\nJudge subject/theme/style fit only — ignore any text overlay.`
    : '\n2. BRAND CONSISTENCY: no brand context was provided — OMIT the "brand_consistency" field.'

  return `You are a meticulous QA inspector for AI-generated brand marketing images.

Evaluate the provided image on TWO independent dimensions.

1. PROMPT ADHERENCE ("prompt_adherence", 0-100): does the image depict what was requested?
USER REQUEST (authoritative — this is what was asked for):
"${userPrompt}"
${composedBlock}
- 90-100: every requested subject and element is present and correct.
- 70-89: the main subject is present; only minor elements are missing or altered.
- 40-69: the subject is only partially present, or important requested elements are wrong.
- 0-39: the image does not show the requested subject at all.
RULES:
- If the user request is vague or abstract (mood/feeling, no concrete objects), judge by theme and mood and be LENIENT — do not punish missing literal objects that were never clearly requested.
- IGNORE any text, typography, or logos overlaid on the image — text is applied separately by design and must not affect either score.
- List every requested element that is missing under "missing_elements" and every element depicted wrongly under "mismatches" (empty arrays if none).
${brandBlock}

Return ONLY this JSON (no markdown, no extra keys):
{
  "prompt_adherence": 0,${brandContext ? '\n  "brand_consistency": 0,' : ''}
  "missing_elements": [],
  "mismatches": [],
  "reasoning": "one short paragraph: what the image shows and why you scored it this way"
}`
}

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A02',
  handler: async (input) => {
    const db = adminClient()
    const apiKey = process.env.OPENAI_API_KEY

    const imageUrl = input.payload.image_url ?? null
    const userPrompt = input.payload.user_prompt.slice(0, MAX_PROMPT_CHARS)
    const composedPrompt = input.payload.composed_prompt_en?.slice(0, MAX_PROMPT_CHARS) ?? null

    const safePass = (note: string) => ({
      task_type:         'image_verify' as const,
      brand_id:          input.brand_id,
      image_url:         imageUrl,
      post_id:           input.payload.post_id ?? null,
      pass:              true,
      prompt_adherence:  null as number | null,
      brand_consistency: null as number | null,
      missing_elements:  [] as string[],
      mismatches:        [] as string[],
      reasoning:         note,
      vision_failed:     true,
      note,
    })

    if (!imageUrl) return safePass('no_image_url — verification skipped (fail-open)')
    if (!apiKey)   return safePass('vision_model_not_configured — verification skipped (fail-open)')

    // Brand context: identity (same fields visual-qc uses) + the actual visual
    // guidelines (style descriptor + palette). All loads are non-fatal — without
    // them only prompt adherence is judged.
    let brandContext: string | null = null
    try {
      const [brandRes, visualRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any)
          .from('brand_profiles')
          .select('brand_name_en, sector, sub_sector, brand_differentiator')
          .eq('brand_id', input.brand_id)
          .maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any)
          .from('visual_style_profiles')
          .select('style_descriptor, color_palette')
          .eq('brand_id', input.brand_id)
          .maybeSingle(),
      ])
      const b = brandRes.data as { brand_name_en?: string; sector?: string; sub_sector?: string; brand_differentiator?: string } | null
      const v = visualRes.data as { style_descriptor?: string; color_palette?: string[] } | null
      const parts = [
        b?.brand_name_en ? `Brand: ${b.brand_name_en}` : null,
        b?.sector ? `Sector: ${b.sector}${b.sub_sector ? ` / ${b.sub_sector}` : ''}` : null,
        b?.brand_differentiator ? `What it offers: ${b.brand_differentiator}` : null,
        v?.style_descriptor ? `Visual style guideline: ${v.style_descriptor}` : null,
        v?.color_palette?.length ? `Brand palette: ${v.color_palette.slice(0, 6).join(', ')}` : null,
      ].filter(Boolean)
      if (parts.length > 0 && (b?.sector || b?.brand_differentiator || v?.style_descriptor)) {
        brandContext = parts.join('\n')
      }
    } catch (e) {
      console.warn(`[cco/image-verify] brand context load failed brand=${input.brand_id}: ${(e as Error).message}`)
    }

    const client = getOpenAIClient()
    const t0 = Date.now()

    let parsed: z.infer<typeof VerifyResponse>
    try {
      const response = await client.chat.completions.create({
        model: VISION_MODEL,
        max_tokens: VISION_MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
              { type: 'text', text: buildVerifyPrompt(userPrompt, composedPrompt, brandContext) },
            ],
          },
        ],
      })
      const elapsed = Date.now() - t0

      // Log cost (same pricing model as cco/visual-qc).
      const tokIn  = response.usage?.prompt_tokens ?? 0
      const tokOut = response.usage?.completion_tokens ?? 0
      const costUsd = Number(((tokIn / 1_000_000) * 2.5 + (tokOut / 1_000_000) * 10.0).toFixed(6))
      try {
        await db.from('usage_logs').insert({
          brand_id:      input.brand_id,
          flow_id:       input.flow_id,
          agent:         'cco_image_verify',
          provider:      'openai',
          model:         VISION_MODEL,
          tokens_in:     tokIn,
          tokens_out:    tokOut,
          tokens_cached: 0,
          cost_usd:      costUsd,
          elapsed_ms:    elapsed,
        } as never)
      } catch { /* non-fatal */ }

      const raw = response.choices[0]?.message?.content ?? '{}'
      parsed = VerifyResponse.parse(JSON.parse(raw))
    } catch (e) {
      console.warn(`[cco/image-verify] vision call failed: ${(e as Error).message}`)
      return safePass(`vision_call_failed: ${(e as Error).message.slice(0, 200)}`)
    }

    const brandConsistency = brandContext != null ? (parsed.brand_consistency ?? null) : null
    const adherencePass   = parsed.prompt_adherence >= ADHERENCE_THRESHOLD
    // Brand consistency only gates when we had a brand context AND the model
    // returned a score — a missing score never holds (fail-open, like visual-qc).
    const consistencyPass = brandConsistency == null || brandConsistency >= CONSISTENCY_THRESHOLD
    const pass = adherencePass && consistencyPass

    return {
      task_type:         'image_verify' as const,
      brand_id:          input.brand_id,
      image_url:         imageUrl,
      post_id:           input.payload.post_id ?? null,
      pass,
      prompt_adherence:  parsed.prompt_adherence,
      brand_consistency: brandConsistency,
      missing_elements:  parsed.missing_elements,
      mismatches:        parsed.mismatches,
      reasoning:         pass
        ? parsed.reasoning
        : `${!adherencePass ? `PROMPT MISMATCH (adherence=${parsed.prompt_adherence} < ${ADHERENCE_THRESHOLD}). ` : ''}${!consistencyPass ? `BRAND MISMATCH (consistency=${brandConsistency} < ${CONSISTENCY_THRESHOLD}). ` : ''}${parsed.reasoning}`,
      vision_failed:     false,
      note:              null,
    }
  },
})
