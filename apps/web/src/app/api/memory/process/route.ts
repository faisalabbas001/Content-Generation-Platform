/**
 * POST /api/memory/process
 *
 * Drains pending memory_controller_queue rows (Doc §4.2). Called by:
 *   - N8N-A01 / N8N-A02 / N8N-A03 — at the END of each batch, after CEO has
 *     enqueued its nominations. Keeps BrandDNA up-to-date in near-real-time.
 *   - N8N-D02 maintenance flow (1st of month) — sweep stragglers.
 *   - Manually from the admin panel BrandDNA inspector ("Process now" button,
 *     sprint TBD).
 *
 * Body shape:
 *   { batch_size?: number }   // default 50 — protects long requests
 *
 * Response:
 *   { ok, request_id, result: { total, written, rejected, details: [...] } }
 *
 * Security: same HMAC scheme as /api/agents/* routes — n8n must sign the
 * request. We do not expose this without authentication.
 */
import { adminClient } from '@repo/db/client'
import { processQueue } from '@repo/memory'
import { z } from 'zod'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  flow_id: z.string().min(1).default('memory_controller'),
  batch_size: z.number().int().positive().max(500).optional(),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'memory_controller',
  handler: async (input) => {
    const db = adminClient()
    return processQueue(db, { batch_size: input.batch_size })
  },
})
