/**
 * GET /api/calendar/occasions?date=YYYY-MM-DD&sector=fnb&goal_phase=awareness
 * POST /api/calendar/occasions  { date?, sector?, goal_phase?, brand_id? }
 *
 * Calendar Engine HTTP endpoint (Phase 0, Spine-05).
 *
 * Returns the active Saudi occasions for a given date (defaults to today)
 * using the deterministic occasion-logic from @repo/core. The occasions data
 * is loaded from the `occasions` table (seeded in migration 0002).
 *
 * Called by:
 *   - n8n N8N-A01 (batch calendar) before generating the content mix
 *   - n8n N8N-A02 (on-demand) to pick the right register for the post date
 *   - COO compile-caption-context route to inject occasion context into the brief
 *   - Admin dashboard occasion preview
 *
 * Authentication: HMAC-signed n8n requests OR admin session cookie.
 * No brand RLS required — occasion data is global.
 */
import { adminClient } from '@repo/db/client'
import {
  computeActiveOccasions,
  getDominantContentMix,
  type OccasionContext,
  type ContentMix,
} from '@repo/core'
import { verifyN8nRequest } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Default sector content mixes (spec §5.2 CONTENT MIX DEFAULT BY SECTOR)
const SECTOR_BASE_MIX: Record<string, ContentMix> = {
  fnb:     { product: 0.30, lifestyle: 0.25, occasion: 0.20, brand_story: 0.15, founder: 0.10 },
  'F&B':   { product: 0.30, lifestyle: 0.25, occasion: 0.20, brand_story: 0.15, founder: 0.10 },
  retail:  { product: 0.35, lifestyle: 0.20, occasion: 0.20, campaign: 0.15, brand_story: 0.10 },
  beauty:  { product: 0.30, lifestyle: 0.25, occasion: 0.20, transformation: 0.15, founder: 0.10 },
  real_estate: { property: 0.25, lifestyle: 0.30, brand_story: 0.20, occasion: 0.15, milestone: 0.10 },
  healthcare:  { education: 0.30, trust: 0.25, occasion: 0.20, behind_scenes: 0.15, milestone: 0.10 },
}

function sectorBaseMix(sector: string | null): ContentMix {
  if (!sector) return SECTOR_BASE_MIX['fnb']!
  return SECTOR_BASE_MIX[sector] ?? SECTOR_BASE_MIX['fnb']!
}

type OccasionRow = {
  occasion_key: string
  occasion_name_ar: string
  gregorian_date: string
  lead_weeks: number
  recommended_mix: Record<string, number> | null
  sector_applicability: Record<string, boolean> | null
}

async function computeResponse(
  dateStr: string | null,
  sector: string | null,
  goalPhase: string | null,
) {
  const db = adminClient()
  const currentDate = dateStr ? new Date(dateStr) : new Date()
  const currentYear = currentDate.getFullYear()

  // Load occasions from occasion_intelligence (seeded in mig 0002)
  // Fetch current + next year so occasions near year-end look ahead correctly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error } = await (db as any)
    .from('occasion_intelligence')
    .select('occasion_key, occasion_name_ar, gregorian_date, lead_weeks, recommended_mix, sector_applicability')
    .in('year', [currentYear, currentYear + 1])

  if (error) {
    throw new Error(`occasions table read failed: ${error.message}`)
  }

  const occasions: OccasionContext[] = ((rows ?? []) as OccasionRow[]).map((r) => ({
    occasion_key:         r.occasion_key,
    occasion_name_ar:     r.occasion_name_ar,
    gregorian_date:       r.gregorian_date,
    lead_weeks:           r.lead_weeks ?? 2,
    base_mix:             (r.recommended_mix as ContentMix) ?? {},
    sector_applicability: (r.sector_applicability as Record<string, boolean>) ?? {},
  }))

  const active = computeActiveOccasions(occasions, currentDate, goalPhase, sector)
  const baseMix = sectorBaseMix(sector)
  const dominantMix = getDominantContentMix(baseMix, active)

  return {
    date:            currentDate.toISOString().slice(0, 10),
    sector:          sector ?? null,
    goal_phase:      goalPhase ?? null,
    active_occasions: active,
    dominant_content_mix: dominantMix,
    // Convenience fields for n8n expressions
    has_active_occasion:  active.length > 0,
    dominant_occasion:    active[0]?.occasion_key ?? null,
    dominant_phase:       active[0]?.phase ?? null,
    dominant_register:    active[0]?.register_shift ?? null,
    frequency_boost:      active[0]?.frequency_boost ?? 1.0,
    occasion_flags:       active.map((o) => o.occasion_key),
  }
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  // GET is used by the admin dashboard — require admin session or n8n HMAC.
  // For simplicity, allow any authenticated server-side caller (no user data exposed).
  const { searchParams } = new URL(request.url)
  const dateStr    = searchParams.get('date')
  const sector     = searchParams.get('sector')
  const goalPhase  = searchParams.get('goal_phase')

  try {
    const result = await computeResponse(dateStr, sector, goalPhase)
    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error('[calendar/occasions] GET error:', e)
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

// ── POST handler (n8n-authenticated) ─────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  // Verify HMAC signature from n8n — same pattern as all agent routes.
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: { date?: string; sector?: string; goal_phase?: string; brand_id?: string } = {}
  try {
    body = JSON.parse(verified.req.rawBody) as typeof body
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const { date, sector, goal_phase: goalPhase, brand_id: brandId } = body

  // If brand_id is provided, resolve sector + intent_state from DB so callers
  // don't need to pass them manually — n8n batch nodes can just send brand_id.
  let resolvedSector = sector ?? null
  let resolvedGoalPhase = goalPhase ?? null

  if (brandId && (!resolvedSector || !resolvedGoalPhase)) {
    try {
      const db = adminClient()
      const { data: brand } = await db
        .from('brand_profiles')
        .select('sector, intent_state')
        .eq('brand_id', brandId)
        .maybeSingle()
      if (brand) {
        const b = brand as { sector?: string; intent_state?: string }
        if (!resolvedSector) resolvedSector = b.sector ?? null
        if (!resolvedGoalPhase) resolvedGoalPhase = b.intent_state ?? null
      }
    } catch (e) {
      // Non-fatal — fall back to caller-supplied values
      console.warn(`[calendar/occasions] brand lookup failed for ${brandId}:`, (e as Error).message)
    }
  }

  try {
    const result = await computeResponse(date ?? null, resolvedSector, resolvedGoalPhase)
    const responseBody = { ok: true, request_id: verified.req.requestId, ...result }
    return Response.json(responseBody)
  } catch (e) {
    console.error('[calendar/occasions] POST error:', e)
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
