/**
 * POST /api/correction/stage
 *
 * Emits a progress event into branddna_event_log so the correction form's
 * Realtime channel can show live step updates while A04 runs.
 * Called by n8n A04 nodes.
 *
 * Body (batch mode):  { brand_id, stage, fields: string[], metadata? }
 * Body (legacy mode): { brand_id, stage, field_name?: string, metadata? }
 *
 * The client watches branddna_event_log INSERTs filtered by brand_id and picks
 * up any event_type starting with 'correction_progress_' to update step labels.
 * When fields[] is present and field_name is absent, the UI applies the stage
 * update to ALL pending fields simultaneously.
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, errorResponse, jsonResponse } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STAGES = z.enum([
  'correction_received',
  'ceo_classifying',
  'ceo_approved',
  'memory_writing',
  'vectors_invalidated',
  'correction_applied',
  'correction_rejected',
])

const Schema = z.object({
  brand_id:   z.string().uuid(),
  stage:      STAGES,
  field_name: z.string().optional(),
  fields:     z.array(z.string()).optional(),
  metadata:   z.record(z.unknown()).optional(),
})

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response

  let body: unknown
  try { body = JSON.parse(verified.req.rawBody) }
  catch { return errorResponse(400, 'invalid_json', 'body is not valid JSON') }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'body did not match schema', {
      issues: parsed.error.issues.slice(0, 5).map((i) => i.message),
    })
  }

  const { brand_id, stage, field_name, fields, metadata } = parsed.data
  const db = adminClient()

  const { error } = await db.from('branddna_event_log').insert({
    brand_id,
    event_type: `correction_progress_${stage}`,
    event_data: {
      stage,
      // fields[] for batch mode — null when single-field legacy path
      fields:     fields ?? null,
      field_name: field_name ?? null,
      stage_at:   new Date().toISOString(),
      ...(metadata ?? {}),
    },
  } as never)

  if (error) return errorResponse(500, 'db_error', `branddna_event_log insert failed: ${error.message}`)

  return jsonResponse(200, { ok: true, stage, brand_id })
}
