/**
 * POST /api/agents/coo/upgrade-readiness
 *
 * COO Job 4 — called by N8N-A05 monthly (1st of month, 06:00 AST).
 *
 * COO (Claude Haiku 4.5) receives brand metrics + evidence_bundles and returns:
 *   - recommendation_score (0-100)  — feeds the 10% COO weight in A05's composite
 *   - readiness_tier                — highly_ready / ready / potential / not_ready
 *   - signals[]                     — structured positive/negative upgrade signals
 *   - upgrade_offer_suggestion      — e.g. "20% off first 3 months"
 *   - reasoning                     — for admin audit trail
 *
 * Body shape (sent by N8N-A05 node "HTTP: COO Upgrade Analysis"):
 * {
 *   flow_id:    'N8N-A05',
 *   brand_id:   UUID,
 *   payload: {
 *     analysis_type:    'upgrade_readiness',
 *     metrics: {
 *       total_calendars:    number,
 *       completeness_score: number (0-100),
 *       days_since_signup:  number,
 *       posts_count:        number,
 *       sector:             string,
 *     },
 *     evidence_bundles:   object   (full bundles for COO context)
 *   }
 * }
 *
 * Auth: HMAC x-n8n-signature (same scheme as all /api/agents/* routes).
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
    analysis_type: z.literal('upgrade_readiness'),
    metrics: z.object({
      total_calendars:    z.number().int().nonnegative(),
      completeness_score: z.number().min(0).max(100),
      days_since_signup:  z.number().int().nonnegative(),
      posts_count:        z.number().int().nonnegative(),
      sector:             z.string(),
    }),
    evidence_bundles: z.record(z.unknown()).optional(),
  }),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A05',
  handler: async (input, ctx) =>
    coo.scoreUpgradeReadiness(
      {
        analysis_type:    input.payload.analysis_type,
        metrics:          input.payload.metrics,
        evidence_bundles: input.payload.evidence_bundles ?? {},
      },
      {
        flow_id:  ctx.flowId,
        brand_id: input.brand_id,
        db:       adminClient(),
      },
    ),
})
