/**
 * POST /api/agents/visual-prompt/compose
 *
 * DEPRECATED — no longer called by N8N-A01.
 *
 * DeepSeek now writes the full rich visual_brief_en in a single pass during
 * caption generation (Sign: DeepSeek Generate1). The n8n composer nodes
 * (Sign: Visual Prompt Compose1, HTTP: Visual Prompt Compose1) are bypassed.
 * Apply Visual Brief1 uses DeepSeek's brief directly.
 *
 * This route is kept in place so old n8n flows or on-demand routes that still
 * reference it don't 404. The kill-switch (VISUAL_PROMPT_COMPOSER_ENABLED)
 * defaults to disabled — any call returns an empty brief immediately at zero cost.
 *
 * To fully remove: delete this file and the visual-prompt provider once all
 * callers (prompt-composer route, on-demand route) are confirmed migrated.
 *
 * Hard Rule #3: visual_brief_en MUST be English-only (enforced in DeepSeek prompt).
 */
import { adminClient } from '@repo/db/client'
import { visualPrompt } from '@repo/ai'
import { z } from 'zod'
import { schemas } from '@repo/core'
import { loadComplianceRules, checkVisualBrief, renderVisualProhibitions } from '@repo/compliance'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: schemas.VisualPromptInput,
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'unknown_flow',
  handler: async (input, ctx) => {
    // Kill-switch: disabled → passthrough empty brief; n8n keeps its existing one.
    if (process.env.VISUAL_PROMPT_COMPOSER_ENABLED !== 'true') {
      return { visual_brief_en: '', disabled: true }
    }
    // PREVENTION: inject gesture/occasion prohibitions into cultural_constraints
    // so the composer writes a compliant brief in the first place (F4). One
    // rules load is reused for the post-compose gate below.
    const rules = await loadComplianceRules(input.brand_id)
    const gateCtx = { occasion: input.payload.occasion ?? null, sector: input.payload.sector }
    const prohibitions = renderVisualProhibitions(rules, gateCtx)
    const payload = prohibitions
      ? {
          ...input.payload,
          cultural_constraints: [input.payload.cultural_constraints, prohibitions]
            .filter(Boolean)
            .join(' '),
        }
      : input.payload

    const composed = await visualPrompt.compose(payload, {
      flow_id: ctx.flowId,
      brand_id: input.brand_id,
      db: adminClient(),
    })

    // ENFORCEMENT: never return a HARD_BLOCK brief to the image model. On block:
    // empty brief + flag so n8n holds the post instead of paying for a
    // non-compliant render.
    // Doc §11.4: religious visual content also forces compliance_block so that
    // the image model is never invoked for religious imagery.
    const verdict = checkVisualBrief(composed.visual_brief_en, rules, gateCtx)
    if (verdict.action === 'block' || verdict.religious_content_detected) {
      return {
        visual_brief_en: '',
        disabled: false,
        compliance_block: true,
        compliance_reason: verdict.religious_content_detected ? 'religious_content' : 'hard_block',
        matched: verdict.matched,
      }
    }
    return { ...composed, compliance_block: false }
  },
})
