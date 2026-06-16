/**
 * POST /api/processing/stage
 *
 * Emits a partial brand_snapshots row marking a single stage transition.
 * Called by:
 *   - The onboarding server action (initial 'form_submitted' write)
 *   - Each stage-transition node in N8N-A03 (HMAC-signed)
 *   - /api/onboarding/retry when re-triggering a stuck onboarding
 *
 * Why a dedicated endpoint:
 *   - Centralises the snapshot-row shape (stage name + optional metadata)
 *   - Avoids duplicating Supabase inserts across 6 different n8n nodes
 *   - Realtime listeners on /processing get a fresh INSERT per stage
 *   - HMAC-verified — n8n can't be impersonated
 *
 * Body shape:
 *   { brand_id: uuid, stage: string, metadata?: object, mark_complete?: boolean }
 *
 * `mark_complete` flips is_partial=false → triggers /processing → /snapshot
 * redirect on the client. Use ONLY at the very end of the pipeline.
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KNOWN_STAGES = z.enum([
  // v2 onboarding markers (Step 1 → A06 extraction)
  'section_1_submitted',
  'section_2_submitted',
  'extraction_started',
  'extraction.instagram_complete',
  'extraction.website_complete',
  'extraction.places_complete',
  'extraction_complete',
  // A03 main pipeline (post-Step-3)
  'form_submitted',
  'ceo_classified',
  'scraping',
  'scraping_complete',
  'coo_branddna_built',
  'ceo_confidence_refined',
  'memory_drained',
  'snapshot_ready',
  // Doc §5.3 step 9 — emitted by A03 when completeness < 40% or
  // dialect_unconfirmed, instead of triggering A01. UI reads metadata.gap_questions[]
  // and asks the user to fill in the top 3 missing fields.
  'gap_notification',
  'failed',
])

const Schema = z.object({
  brand_id: z.string().uuid(),
  stage: KNOWN_STAGES,
  metadata: z.record(z.unknown()).optional(),
  mark_complete: z.boolean().optional(),
})

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: unknown
  try { body = JSON.parse(verified.req.rawBody) }
  catch { return errorResponse(400, 'invalid_json', 'body is not valid JSON') }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'body did not match schema', {
      issues: parsed.error.issues.slice(0, 5).map((i) => i.message),
    })
  }
  const { brand_id, stage, metadata, mark_complete } = parsed.data
  const isPartial = !mark_complete

  const db = adminClient()
  const { error } = await db.from('brand_snapshots').insert({
    brand_id,
    is_partial: isPartial,
    snapshot_data: {
      stage,
      ...(metadata ?? {}),
      stage_at: new Date().toISOString(),
    },
  } as never)

  if (error) {
    return errorResponse(500, 'db_error', `brand_snapshots insert failed: ${error.message}`)
  }

  // When the pipeline is fully done, also flip onboarding_status. This makes
  // it easy for cron janitors to find stuck brands (status != complete after 15 min).
  if (mark_complete) {
    const { error: updErr } = await db
      .from('brand_profiles')
      .update({
        onboarding_status: 'complete',
        onboarding_completed_at: new Date().toISOString(),
      } as never)
      .eq('brand_id', brand_id)
    if (updErr) console.warn('[stage] onboarding_status update failed:', updErr.message)
  }

  // Marking the brand as failed is also worth recording on the brand row,
  // and on the append-only anomaly_records table (doc §5.4 — every flow
  // failure that reaches the S03 alert path must leave an audit row so the
  // /admin/anomalies dashboard and oncall can triage. Best-effort: log + carry on.
  if (stage === 'failed') {
    const { error: failErr } = await db
      .from('brand_profiles')
      .update({ onboarding_status: 'failed' } as never)
      .eq('brand_id', brand_id)
    if (failErr) console.warn('[stage] onboarding_status=failed update failed:', failErr.message)

    const { error: anomErr } = await db.from('anomaly_records').insert({
      brand_id,
      anomaly_type: 'onboarding_failed',
      severity: 'critical',
      details: {
        flow_id: 'N8N-A03',
        request_id: verified.req.requestId,
        failed_node: (metadata as { failed_node?: unknown } | undefined)?.failed_node ?? null,
        error_message: (metadata as { error?: unknown } | undefined)?.error ?? null,
        captured_at: new Date().toISOString(),
      },
    } as never)
    if (anomErr) console.warn('[stage] anomaly_records insert failed:', anomErr.message)
  }

  const response = { ok: true, request_id: verified.req.requestId, stage, brand_id }
  rememberIdempotent(verified.req.idempotencyKey, 200, response)
  return jsonResponse(200, response)
}
