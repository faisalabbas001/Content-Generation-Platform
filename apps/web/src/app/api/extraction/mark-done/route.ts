/**
 * POST /api/extraction/mark-done
 *
 * Sets brand_profiles.onboarding_status = 'extraction_done' for the brand_id.
 * The final UPDATE in N8N-A06 — replaces the Supabase node so the workflow
 * can be imported with zero credential setup.
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  brand_id: z.string().uuid(),
})

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: unknown
  try { body = JSON.parse(verified.req.rawBody) }
  catch { return errorResponse(400, 'invalid_json', 'body is not valid JSON') }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return errorResponse(400, 'invalid_input', 'body did not match schema')

  const { brand_id } = parsed.data
  const db = adminClient()
  const { error } = await db
    .from('brand_profiles')
    .update({ onboarding_status: 'extraction_done' } as never)
    .eq('brand_id', brand_id)
  if (error) return errorResponse(500, 'update_failed', error.message)

  const response = { ok: true, request_id: verified.req.requestId, brand_id, onboarding_status: 'extraction_done' }
  rememberIdempotent(verified.req.idempotencyKey, 200, response)
  return jsonResponse(200, response)
}
