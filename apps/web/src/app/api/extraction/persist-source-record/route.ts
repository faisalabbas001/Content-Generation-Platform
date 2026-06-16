/**
 * POST /api/extraction/persist-source-record
 *
 * Writes ONE source_records row. Called by N8N-A06 (one HTTP call per branch).
 *
 * Exists so n8n doesn't need a Supabase credential bound — the webhook is
 * HMAC-signed and the server-side adminClient() does the actual write.
 * This means a clean import-and-run of A06 with zero credential juggling.
 *
 * recency_score is hardcoded 1.0 here (the column is "as-captured", with
 * live decay computed via the source_records_with_recency view per
 * migration 0025).
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  brand_id:    z.string().uuid(),
  source_type: z.enum(['form', 'correction', 'scrape', 'instagram', 'website', 'google_places']),
  raw_payload: z.unknown(),
  // Explicit split (migration 0028). Optional for back-compat — the route
  // also derives from raw_payload.{raw,normalised,branch,skipped} when omitted.
  branch:     z.string().nullable().optional(),
  skipped:    z.boolean().optional(),
  raw:        z.unknown().optional(),
  normalised: z.unknown().optional(),
})

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: unknown
  try { body = JSON.parse(verified.req.rawBody) }
  catch { return errorResponse(400, 'invalid_json', 'body is not valid JSON') }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'body did not match schema')
  }
  const { brand_id, source_type, raw_payload } = parsed.data

  // Derive split columns. Prefer explicit body fields; fall back to fields
  // inside raw_payload so older n8n flow versions still work.
  const rp = (raw_payload ?? {}) as Record<string, unknown>
  const branch     = parsed.data.branch     ?? (typeof rp.branch === 'string' ? rp.branch : null)
  const skipped    = parsed.data.skipped    ?? (typeof rp.skipped === 'boolean' ? rp.skipped : false)
  const raw        = parsed.data.raw        ?? rp.raw  ?? rp.data  ?? null
  const normalised = parsed.data.normalised ?? rp.normalised ?? null

  const db = adminClient()

  // Idempotency on (brand_id, source_type) — A06 retries shouldn't pile up
  // duplicate rows. If one already exists, refresh its payload columns +
  // recency_score (treat it as the latest scrape result for that lane).
  // The unique constraint is implicit by intent, not schema, so we lookup-
  // then-upsert manually.
  const { data: existing, error: existingErr } = await db
    .from('source_records')
    .select('source_id')
    .eq('brand_id', brand_id)
    .eq('source_type', source_type)
    .order('captured_at', { ascending: false })
    .limit(1)
  if (existingErr) {
    return errorResponse(500, 'lookup_failed', existingErr.message)
  }

  let source_id: string
  if (existing && existing.length > 0) {
    const existingId = (existing[0] as { source_id: string }).source_id
    const { error: updErr } = await db
      .from('source_records')
      .update({
        raw_payload: (raw_payload ?? {}) as never,
        recency_score: 1.0,
        branch,
        skipped,
        raw,
        normalised,
        captured_at: new Date().toISOString(),
      } as never)
      .eq('source_id', existingId)
    if (updErr) return errorResponse(500, 'update_failed', updErr.message)
    source_id = existingId
  } else {
    const { data, error } = await db
      .from('source_records')
      .insert({
        brand_id,
        source_type,
        raw_payload: (raw_payload ?? {}) as never,
        recency_score: 1.0,
        branch,
        skipped,
        raw,
        normalised,
      } as never)
      .select('source_id')
      .single()
    if (error) return errorResponse(500, 'insert_failed', error.message)
    source_id = (data as { source_id: string }).source_id
  }

  // ── Gap #7: persist place_id to brand_profiles when the places lane lands.
  // The form server action sets place_id from the user-pasted Google Maps URL
  // (if any), but if A06 finds a candidate via place_search, that's the
  // authoritative ID — write it through. Idempotent: only update if the
  // brand_profiles row is currently NULL or differs.
  if (source_type === 'google_places' && !skipped) {
    const candidate = (normalised as { place_id?: string; placeId?: string } | null) ?? null
    const rawC = (raw as { candidate?: { place_id?: string; placeId?: string } } | null) ?? null
    const scrapedPlaceId =
      candidate?.place_id ?? candidate?.placeId ?? rawC?.candidate?.place_id ?? rawC?.candidate?.placeId ?? null
    if (scrapedPlaceId && typeof scrapedPlaceId === 'string') {
      // Only overwrite when the current row has no place_id — the form
      // value is user-confirmed and should win against scraper guesses.
      const { data: bp } = await db
        .from('brand_profiles')
        .select('place_id')
        .eq('brand_id', brand_id)
        .single()
      const current = (bp as { place_id?: string | null } | null)?.place_id
      if (!current) {
        const { error: pidErr } = await db
          .from('brand_profiles')
          .update({ place_id: scrapedPlaceId } as never)
          .eq('brand_id', brand_id)
        if (pidErr) console.warn('[persist-source-record] place_id update failed:', pidErr.message)
      }
    }
  }

  const response = {
    ok: true,
    request_id: verified.req.requestId,
    brand_id,
    source_type,
    source_id,
  }
  rememberIdempotent(verified.req.idempotencyKey, 200, response)
  return jsonResponse(200, response)
}
