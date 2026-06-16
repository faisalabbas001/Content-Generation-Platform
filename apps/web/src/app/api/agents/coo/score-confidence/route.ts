/**
 * POST /api/agents/coo/score-confidence
 *
 * COO Job 3 (Doc §6.2). Called by N8N-A01 / N8N-A02 AFTER CCO. Computes the
 * final 0-100 confidence per post via the fixed formula:
 *   field_floor*0.40 + arabic_qc*0.30 + occasion*0.15 + policy*0.15
 * Floors to 0 on HARD_BLOCK or missing critical field.
 */
import { adminClient } from '@repo/db/client'
import { coo } from '@repo/ai'
import { z } from 'zod'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    posts: z
      .array(
        z.object({
          post_id: z.string(),
          caption_ar: z.string(),
          cco_qc_score: z.number().min(0).max(1),
          cco_flags: z.record(z.unknown()),
        }),
      )
      .min(1),
    field_confidence_floor: z.number().min(0).max(1),
    occasion_flags: z.array(z.string()),
  }),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input, ctx) =>
    coo.scoreConfidence(input.payload, {
      flow_id: ctx.flowId,
      brand_id: input.brand_id,
      db: adminClient(),
    }),
})
