/**
 * POST /api/vectors/invalidate
 *
 * Drops the per-brand Qdrant collection (Doc §5.4). Called by N8N-A04 after
 * BrandDNA correction so the next caption generation re-derives context
 * against fresh DNA. Also called by N8N-D02 on hard-delete.
 *
 * Body: { brand_id }
 * Response: { ok, request_id, result: { collection, deleted } }
 *
 * Security: HMAC-signed.
 */
import { z } from 'zod'
import { invalidateBrandCache, collectionFor, isVectorsConfigured } from '@repo/vectors'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  flow_id: z.string().min(1).default('vectors_invalidate'),
  brand_id: z.string().uuid(),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'vectors_invalidate',
  handler: async (input) => {
    if (!isVectorsConfigured()) {
      return { collection: null, deleted: false, skipped: true, reason: 'qdrant_not_configured' }
    }
    const result = await invalidateBrandCache(input.brand_id)
    return { collection: collectionFor(input.brand_id), ...result }
  },
})
