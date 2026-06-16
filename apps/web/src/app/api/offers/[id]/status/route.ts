/**
 * PATCH /api/offers/:id/status
 *
 * Updates the offer_status of a brand_performance_log row.
 * Called client-side when the user accepts or dismisses the upgrade banner.
 *
 * Body: { status: "accepted" | "skipped", slug: string }
 *
 * Ownership guard: we verify the row's brand_id matches the brand owned by
 * the current user (getBrandForCurrentUser). The UPDATE is scoped with
 * .eq('brand_id', brand.brand_id) so a user cannot mutate another tenant's row
 * even if they know the perf_id.
 *
 * Accepted  → frontend redirects to /<slug>/upgrade (Stripe checkout).
 * Skipped   → frontend hides the banner for this month.
 * Converted → set by the Stripe webhook after a successful payment (not here).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser, getBrandForCurrentUser } from '@repo/auth/server'
import { adminClient } from '@repo/db/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  status: z.enum(['accepted', 'skipped']),
  slug:   z.string().min(1),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────
  const user = await getCurrentUser()
  if (!user) return json(401, { error: 'unauthenticated' })

  // ── Parse body ────────────────────────────────────────────────────
  let raw: unknown
  try { raw = await request.json() } catch { return json(400, { error: 'invalid_json' }) }

  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_input',
      issues: parsed.error.issues.slice(0, 3).map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }
  const { status, slug } = parsed.data

  // ── Ownership check ───────────────────────────────────────────────
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return json(403, { error: 'forbidden_brand' })

  const { id: perfId } = await params

  // ── Update — brand_id guard prevents cross-tenant mutation ────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient() as any
  const { error, count } = await db
    .from('brand_performance_log')
    .update({ offer_status: status })
    .eq('perf_id', perfId)
    .eq('brand_id', brand.brand_id)
    .eq('evaluation_type', 'upgrade_readiness')

  if (error) {
    console.error('[offers/status] update error:', error)
    return json(500, { error: 'update_failed', message: error.message })
  }

  if (count === 0) {
    return json(404, { error: 'offer_not_found' })
  }

  return json(200, { ok: true, status })
}

function json(status: number, body: unknown): Response {
  return NextResponse.json(body, { status })
}
