/**
 * GET /api/offers/active?slug=<client_slug>
 *
 * Returns the latest pending monthly_marketing offer for the authenticated brand.
 * Called by the dashboard on mount — the server component also queries this
 * directly for SSR, so this route is primarily for client-side refreshes.
 *
 * Auth: getCurrentUser() + getBrandForCurrentUser(slug) — same pattern as
 *       /api/posts/on-demand/route.ts.
 *
 * Query logic:
 *   SELECT ... FROM brand_performance_log
 *   WHERE brand_id = <brand_id>
 *     AND evaluation_type = 'monthly_marketing'
 *     AND offer_status = 'pending'
 *     AND offer_valid_until >= today
 *   ORDER BY evaluated_at DESC LIMIT 1
 */
import { NextResponse } from 'next/server'
import { getCurrentUser, getBrandForCurrentUser } from '@repo/auth/server'
import { adminClient } from '@repo/db/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────
  const user = await getCurrentUser()
  if (!user) return json(401, { error: 'unauthenticated' })

  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')?.trim()
  if (!slug) return json(400, { error: 'missing_slug' })

  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return json(403, { error: 'forbidden_brand' })

  // Only free-tier brands ever receive marketing offers
  if (brand.tier !== 'free') {
    return json(200, { ok: true, offer: null })
  }

  // ── Query ─────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient() as any
  const { data, error } = await db
    .from('brand_performance_log')
    .select([
      'perf_id',
      'activity_level',
      'upgrade_recommendation',
      'upgrade_recommendation_ar',
      'suggested_offer',
      'suggested_offer_ar',
      'offer_valid_until',
      'offer_status',
      'metrics',
      'evaluated_at',
    ].join(','))
    .eq('brand_id', brand.brand_id)
    .eq('evaluation_type', 'upgrade_readiness')
    .eq('offer_status', 'pending')
    .gte('offer_valid_until', today)
    .order('evaluated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[offers/active] query error:', error)
    return json(500, { error: 'query_failed', message: error.message })
  }

  return json(200, { ok: true, offer: data ?? null })
}

function json(status: number, body: unknown): Response {
  return NextResponse.json(body, { status })
}
