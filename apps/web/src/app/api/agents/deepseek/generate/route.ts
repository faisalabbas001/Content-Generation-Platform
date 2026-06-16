/**
 * POST /api/agents/deepseek/generate
 *
 * DeepSeek V3 — 20 (or 8) Arabic captions per call (Doc §6). Called by
 * N8N-A01 / N8N-A02 AFTER COO compile-caption-context, BEFORE CCO.
 *
 * Hard Rule #3: visual_brief_en MUST be English-only. Arabic in the brief
 * destroys image generation. Sharp applies brand_name_ar post-generation.
 */
import { adminClient } from '@repo/db/client'
import { deepseek } from '@repo/ai'
import { loadComplianceRules, checkCaption, checkVisualBrief } from '@repo/compliance'
import { z } from 'zod'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180 // 19-post batches take 60-90s; 180s gives headroom for cold starts

const ScheduleDateSchema = z.object({
  date: z.string(),
  posting_time: z.string(),
  hour: z.number().int(),
})

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    caption_context: z.string().min(1),
    post_count: z.number().int().min(1).max(20),
    // Optional for on-demand (A02) single-post flows; required for batch (A01)
    schedule_dates: z.array(ScheduleDateSchema).optional().default([]),
    start_date: z.string().optional().default(''),
    off_days: z.array(z.number().int()).optional().default([]),
    occasion_context: z
      .object({
        name: z.string(),
        lead_weeks: z.number().int().optional().default(0),
        priority: z.string().optional().default('Medium'),
      })
      .optional(),
    intended_format: z.string().optional().default('image'),
    // Accepted for backward compat but no longer used — format is now self-decided by DeepSeek
    // per-post based on visual_brief_en content. Each post returns a `format` field.
    per_slot_formats: z.array(z.enum(['image', 'video'])).optional().default([]),
    watermark_required: z.boolean(),
  }),
})

const rank = { NONE: 0, SOFT_WARN: 1, STRONG_WARN: 2, HARD_BLOCK: 3 } as const

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input, ctx) => {
    const result = await deepseek.generate(
      { brand_id: input.brand_id, ...input.payload },
      { flow_id: ctx.flowId, brand_id: input.brand_id, db: adminClient() },
    )

    // Deterministic Compliance Gate — scan each generated caption + brief
    // before the (expensive) CCO/image steps. Additive fields: n8n routes
    // compliance_route === 'HOLD' posts straight to qa_review_queue.
    const occasion = input.payload.occasion_context?.name ?? null
    const rules = await loadComplianceRules(input.brand_id)
    const posts = (result.posts ?? []).map((p) => {
      const c = { occasion, posting_time: p.posting_time, sector: rules.sector }
      const cap = checkCaption(p.caption_ar ?? '', rules, c)
      const vis = checkVisualBrief(p.visual_brief_en ?? '', rules, c)
      const matched = [...cap.matched, ...vis.matched]
      const top = matched.reduce<keyof typeof rank>(
        (acc, m) => (rank[m.severity] > rank[acc] ? m.severity : acc),
        'NONE',
      )
      // Doc §11.4: religious content always routes to human review — unconditional
      // HOLD regardless of negpat severity or CCO score.
      const religious = cap.religious_content_detected || vis.religious_content_detected
      const compliance_route =
        top === 'HARD_BLOCK' || religious ? 'HOLD' : top === 'NONE' ? 'CLEAN' : 'WATERMARK'
      const compliance_reason = religious && top !== 'HARD_BLOCK' ? 'religious_content' : undefined
      return { ...p, compliance_route, compliance_severity: top, compliance_matched: matched, compliance_reason }
    })

    return {
      ...result,
      posts,
      compliance_blocked_post_ids: posts.filter((p) => p.compliance_route === 'HOLD').map((p) => p.post_id),
    }
  },
})
