/**
 * GET /api/brand/[slug]/dna
 *
 * Returns the full BrandDNA graph for the user's own brand. RLS-isolated:
 * the user-scoped Supabase client only sees brands they own.
 *
 * Used by:
 *   - Client-side admin debug consoles
 *   - The user's own "data export" feature (PDPL self-service)
 *   - Anyone who'd rather hit the API than re-do the same Promise.all in
 *     server components
 *
 * For server components on /snapshot, /profile, /dashboard, prefer calling
 * getBrandDnaBySlug() directly — saves a JSON round-trip.
 */
import { NextResponse } from 'next/server'
import { brandDnaQ } from '@repo/db'
import { requireBrandAccess, getUserScopedClient } from '@repo/auth/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params

  // requireBrandAccess auto-redirects on 401/403; if it returns we're authed.
  const { brand } = await requireBrandAccess(slug)
  const userClient = await getUserScopedClient()

  const dna = await brandDnaQ.getBrandDna(brand.brand_id, userClient)
  if (!dna) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, dna })
}
