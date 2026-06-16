/**
 * POST /api/agents/ceo/nominate
 *
 * CEO nomination endpoint (Doc §4.3 Hard Rule #2).
 * n8n calls this to queue BrandDNA change nominations into
 * memory_controller_queue. The Memory Controller processes them
 * asynchronously — it is the sole writer to Layer 1 tables.
 *
 * Each nomination is inserted with status='pending'. The Memory
 * Controller picks them up, validates, and writes (or rejects).
 */
import { z } from 'zod'
import { adminClient } from '@repo/db/client'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NominationTypeEnum = z.enum([
  'field_update',
  'confidence_upgrade',
  'negative_pattern_add',
  'override_rule_add',
  'sector_signal',
  'global_signal',
  'method_profile_update',
])

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    // An empty array is a valid no-op: n8n sends `nominations: []` on healthy
    // posts (only visual-QC failures nominate a negative pattern). The handler
    // short-circuits below so this returns 200, not 400.
    nominations: z.array(
      z.object({
        nomination_type: NominationTypeEnum,
        nomination_data: z.record(z.unknown()).optional(),
      }),
    ),
  }),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A02',
  handler: async (input, ctx) => {
    // No-op: nothing to nominate (the common case on a healthy post). Return
    // 200 without touching the queue so the n8n success path continues to the
    // final delivered callback instead of diverting to the error branch.
    if (input.payload.nominations.length === 0) {
      return {
        task_type:   'nominate' as const,
        brand_id:    input.brand_id,
        queued:      0,
        nominations: [],
      }
    }

    const db = adminClient()

    const rows = input.payload.nominations.map((n) => ({
      brand_id:        input.brand_id,
      nomination_type: n.nomination_type,
      nomination_data: (n.nomination_data ?? {}) as Record<string, unknown>,
      nominated_by:    ctx.flowId,
      status:          'pending' as const,
    }))

    const { data, error } = await db
      .from('memory_controller_queue')
      .insert(rows as never[])
      .select('nomination_id, nomination_type, status')

    if (error) throw new Error(`memory_controller_queue insert failed: ${error.message}`)

    return {
      task_type:   'nominate' as const,
      brand_id:    input.brand_id,
      queued:      data?.length ?? rows.length,
      nominations: data ?? [],
    }
  },
})
