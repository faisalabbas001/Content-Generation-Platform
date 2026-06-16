/**
 * POST /api/admin/maintenance/branddna-backfill
 *
 * Admin-only endpoint to backfill Layer 2 + Layer 4 BrandDNA fields for
 * existing brands that were onboarded before migration 0043. Accepts an
 * optional brand_id to backfill a single brand, or omit for all brands.
 *
 * What it does:
 *   1. Fetches brand(s) missing Layer 4 strategy fields (permission_level IS NULL).
 *   2. For each brand, sets sensible defaults derived from existing data
 *      (sector → permission_level heuristic, intent_state → goal_phase mapping).
 *   3. Bumps strategy_version to 1 so downstream agents know a baseline exists.
 *
 * Auth: requireAdmin()
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { adminClient, isDbConfigured } from '@repo/db'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  brand_id: z.string().uuid().optional(),
})

// Heuristic: map sector to a default permission_level for brands with no data.
const SECTOR_PERMISSION: Record<string, string> = {
  'Healthcare':    'institutional',
  'Finance':       'institutional',
  'Government':    'institutional',
  'F&B':           'sme_local',
  'Retail':        'challenger',
  'Beauty_Wellness': 'challenger',
  'Other':         'sme_local',
}

// intent_state → goal_phase fallback mapping
const INTENT_TO_GOAL: Record<string, string> = {
  launch:  'launch',
  grow:    'awareness',
  defend:  'retention',
  harvest: 'conversion',
  recover: 'retention',
}

export async function POST(req: Request) {
  // requireAdmin() redirects if not authenticated — if we reach here, user is an admin
  await requireAdmin()

  if (!isDbConfigured()) {
    return NextResponse.json({ error: 'DB not configured' }, { status: 503 })
  }

  const body = Body.safeParse(await req.json().catch(() => ({})))
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues }, { status: 400 })
  }

  const db = adminClient()

  // Fetch brands to backfill — those missing permission_level (Layer 4 not yet set)
  let query = db
    .from('brand_profiles')
    .select('brand_id, sector, intent_state, permission_level')
    .is('permission_level', null)

  if (body.data.brand_id) {
    query = query.eq('brand_id', body.data.brand_id)
  } else {
    query = query.limit(500)
  }

  const { data: brands, error: fetchErr } = await query
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  if (!brands || brands.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, message: 'No brands require backfill' })
  }

  let updated = 0
  let failed = 0

  for (const b of (brands as unknown) as Array<{ brand_id: string; sector: string; intent_state: string | null; permission_level: string | null }>) {
    const permission_level = SECTOR_PERMISSION[b.sector] ?? 'sme_local'
    const goal_phase       = b.intent_state ? (INTENT_TO_GOAL[b.intent_state] ?? 'awareness') : 'awareness'

    const { error: upErr } = await db
      .from('brand_profiles')
      .update({
        permission_level: permission_level as never,
        goal_phase:       goal_phase as never,
        brave_safe_default: false,
        strategy_version: 1,
      } as never)
      .eq('brand_id', b.brand_id)

    if (upErr) {
      console.error(`[branddna-backfill] brand=${b.brand_id} failed:`, upErr.message)
      failed++
    } else {
      updated++
    }
  }

  return NextResponse.json({ ok: true, updated, failed, total: brands.length })
}
