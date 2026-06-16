/**
 * GET /api/admin/brand/[brand_id]/dna
 *
 * Admin-only — returns the full BrandDNA for ANY brand by id. Bypasses RLS
 * via the service-role client. Used by:
 *   - /admin/branddna/[brand_id] debug page
 *   - Support tooling (looking up a stuck brand)
 *   - PDPL data export tooling
 *
 * Auth: requireAdmin() validates the admin cookie + allowlist before any DB
 * read. If the cookie is missing/invalid, the helper redirects to /admin-access.
 */
import { NextResponse } from 'next/server'
import { brandDnaQ, adminClient } from '@repo/db'
import { requireAdmin } from '@repo/auth/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ brand_id: string }> }) {
  await requireAdmin()
  const { brand_id } = await ctx.params

  // UUID format guard — saves a 500 from Postgres.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brand_id)) {
    return NextResponse.json({ ok: false, error: 'invalid_brand_id' }, { status: 400 })
  }

  const dna = await brandDnaQ.getBrandDna(brand_id, adminClient())
  if (!dna) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, dna })
}
