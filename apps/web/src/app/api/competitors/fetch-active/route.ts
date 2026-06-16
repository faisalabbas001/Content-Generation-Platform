/**
 * POST /api/competitors/fetch-active
 *
 * Called by N8N-A07 cron path to get all active competitor accounts
 * across all brands. Replaces the raw Supabase node so the flow needs
 * zero database credentials — same pattern as A03/A06.
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  extraction_type: z.enum(['light', 'deep']).default('light'),
  triggered_by:    z.string().default('cron'),
  brand_id:        z.string().uuid().optional(),
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

  const { extraction_type, triggered_by, brand_id } = parsed.data
  const db = adminClient()

  let query = db
    .from('competitor_accounts' as never)
    .select('competitor_id, brand_id, handle_instagram, display_name, tier')
    .eq('is_active' as never, true)
    .limit(100)

  // Optionally scope to a single brand (webhook override mode)
  if (brand_id) {
    query = query.eq('brand_id' as never, brand_id)
  }

  const { data, error } = await query

  if (error) return errorResponse(500, 'fetch_failed', error.message)

  const competitors = ((data ?? []) as Record<string, unknown>[]).map((c) => ({
    competitor_id:    c.competitor_id,
    brand_id:         c.brand_id,
    handle_instagram: c.handle_instagram,
    display_name:     c.display_name,
    extraction_type,
    triggered_by,
  }))

  const response = {
    ok:          true,
    request_id:  verified.req.requestId,
    competitors,
    count:       competitors.length,
  }
  rememberIdempotent(verified.req.idempotencyKey, 200, response)
  return jsonResponse(200, response)
}
