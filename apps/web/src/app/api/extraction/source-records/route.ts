/**
 * POST /api/extraction/source-records
 *
 * Returns the consolidated extractions object for a brand. Replaces the
 * Supabase LOAD node in N8N-A03 so n8n needs zero DB credentials.
 *
 * Reads source_records for the brand, picks the most-recent row per branch,
 * and returns the COO-shaped payload:
 *   { instagram: <normalised>, website: <normalised>, places: <normalised> }
 *
 * Reads from migration 0028's `normalised` column first, falls back to
 * `raw_payload.normalised` (post-migration unwritten rows) and finally to
 * `raw_payload.data` (pre-migration v1 rows). Skipped lanes return null.
 *
 * Auth: HMAC-signed by n8n via the same scheme as /api/extraction/run.
 * Idempotent (read-only).
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, errorResponse, jsonResponse } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  brand_id: z.string().uuid(),
})

interface SourceRow {
  source_type: string
  raw_payload: Record<string, unknown> | null
  branch:     string | null
  raw:        unknown | null
  normalised: unknown | null
  captured_at: string
}

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: unknown
  try { body = JSON.parse(verified.req.rawBody) }
  catch { return errorResponse(400, 'invalid_json', 'body is not valid JSON') }

  const parsed = Body.safeParse(body)
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'brand_id required')
  }

  const db = adminClient()
  const { data, error } = await db
    .from('source_records')
    .select('source_type, raw_payload, branch, raw, normalised, captured_at')
    .eq('brand_id', parsed.data.brand_id)
    .in('source_type', ['instagram', 'website', 'google_places'])
    .order('captured_at', { ascending: false })
  if (error) return errorResponse(500, 'db_error', error.message)

  const seen = new Set<string>()
  const extractions: Record<string, unknown> = {
    instagram: null,
    website:   null,
    places:    null,
  }
  // Also expose the raw blobs for COO when it needs to do deeper inference
  // than the normalised summary supports (e.g. axis_inference from full posts).
  const raw: Record<string, unknown> = {
    instagram: null,
    website:   null,
    places:    null,
  }
  for (const row of (data ?? []) as SourceRow[]) {
    const payload = (row.raw_payload as { branch?: string; data?: unknown; normalised?: unknown; skipped?: boolean } | null) ?? {}
    const branchRaw = row.branch ?? payload.branch ?? (
      row.source_type === 'instagram' ? 'instagram'
      : row.source_type === 'website' ? 'website'
      : row.source_type === 'google_places' ? 'places' : null
    )
    if (!branchRaw) continue
    if (seen.has(branchRaw)) continue   // keep most-recent only
    seen.add(branchRaw)
    if (payload.skipped) continue
    // Prefer the explicit `normalised` column (mig 0028), fall back to the
    // legacy nested location in raw_payload, then to the v1 `data` shape.
    extractions[branchRaw] = row.normalised ?? payload.normalised ?? payload.data ?? null
    raw[branchRaw] = row.raw ?? null
  }

  return jsonResponse(200, {
    ok: true,
    brand_id: parsed.data.brand_id,
    extractions,
    raw,
    sources_count: seen.size,
  })
}
