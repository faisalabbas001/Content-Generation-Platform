/**
 * POST /api/competitors/log-cost
 *
 * Writes Apify competitor scrape cost to usage_logs.
 * Called by N8N-A07 after each competitor scrape completes.
 * Replaces the raw Supabase node — same pattern as all other A03/A06 routes.
 *
 * Apify pricing: ~$0.50 per 1000 results scraped.
 *   light extraction = 12 posts → $0.006
 *   deep  extraction = 50 posts → $0.025
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APIFY_COST_PER_RESULT = 0.0005 // $0.50 / 1000 results

const BodySchema = z.object({
  brand_id:        z.string().uuid(),
  competitor_id:   z.string().uuid().optional(),
  handle_instagram: z.string().optional(),
  extraction_type: z.enum(['light', 'deep']).default('light'),
  posts_scraped:   z.number().int().min(0).optional(),
  flow_id:         z.string().default('N8N-A07'),
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
    return errorResponse(400, 'invalid_input', 'body did not match schema', {
      issues: parsed.error.issues.slice(0, 5).map((i) => i.message),
    })
  }

  const { brand_id, competitor_id, handle_instagram, extraction_type, flow_id } = parsed.data
  const posts_scraped = parsed.data.posts_scraped ?? (extraction_type === 'deep' ? 50 : 12)
  const cost_usd = parseFloat((posts_scraped * APIFY_COST_PER_RESULT).toFixed(6))

  const db = adminClient()
  const { error } = await db.from('usage_logs').insert({
    brand_id,
    flow_id,
    agent:    'apify_competitor',
    provider: 'apify',
    model:    'instagram-profile-scraper',
    tokens_in:     0,
    tokens_out:    0,
    tokens_cached: 0,
    cost_usd,
    payload: JSON.stringify({
      competitor_id,
      handle_instagram,
      posts_scraped,
      extraction_type,
    }),
  } as never)

  if (error) {
    // Non-fatal — cost tracking should never break the extraction pipeline
    console.warn(`[competitors/log-cost] usage_logs insert failed: ${error.message}`)
  }

  const response = {
    ok:           true,
    request_id:   verified.req.requestId,
    brand_id,
    cost_usd,
    posts_scraped,
    extraction_type,
  }
  rememberIdempotent(verified.req.idempotencyKey, 200, response)
  return jsonResponse(200, response)
}
