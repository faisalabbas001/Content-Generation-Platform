/**
 * POST /api/admin/signals/layer2
 *
 * Admin-only. Updates approval_rate on an existing sector_baselines row
 * (Layer 2 — Sector Intelligence). Used to manually calibrate a baseline
 * before enough real brand data has accumulated.
 *
 * Body:
 *  {
 *    baseline_id: string   UUID of the sector_baselines row
 *    approval_rate_delta?: number   signed float added to current approval_rate
 *    recommended_content_mix?: Record<string, number>   full replacement
 *    top_performing_tones?:    Array<{ tone_id: string; approval_rate: number; sample: number }>
 *    worst_performing_tones?:  Array<{ tone_id: string; ... }>
 *    occasion_insights?:       Record<string, unknown>
 *  }
 *
 * Auth: requireAdmin()
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { adminClient } from '@repo/db/client'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ToneEntry = z.object({
  tone_id:      z.string(),
  approval_rate: z.number().min(0).max(1),
  sample:       z.number().int().nonnegative().optional(),
})

const Body = z.object({
  baseline_id:              z.string().regex(UUID_RE, 'must be a valid UUID'),
  recommended_content_mix:  z.record(z.number()).optional(),
  top_performing_tones:     z.array(ToneEntry).optional(),
  worst_performing_tones:   z.array(ToneEntry).optional(),
  occasion_insights:        z.record(z.unknown()).optional(),
  sample_size_delta:        z.number().int().optional(),
})

export async function POST(req: Request) {
  await requireAdmin()

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = Body.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'validation_failed', issues: parsed.error.issues }, { status: 400 })
  }

  const {
    baseline_id,
    recommended_content_mix,
    top_performing_tones,
    worst_performing_tones,
    occasion_insights,
    sample_size_delta,
  } = parsed.data

  const db = adminClient()

  // Fetch current row first so we can merge
  const { data: current, error: fetchErr } = await db
    .from('sector_baselines')
    .select('baseline_id, sample_size, recommended_content_mix, top_performing_tones, worst_performing_tones, occasion_insights')
    .eq('baseline_id', baseline_id)
    .single()

  if (fetchErr || !current) {
    return NextResponse.json({ ok: false, error: 'baseline_not_found' }, { status: 404 })
  }

  const patch: Record<string, unknown> = { last_updated: new Date().toISOString() }

  if (recommended_content_mix !== undefined) patch.recommended_content_mix = recommended_content_mix
  if (top_performing_tones !== undefined)    patch.top_performing_tones    = top_performing_tones
  if (worst_performing_tones !== undefined)  patch.worst_performing_tones  = worst_performing_tones
  if (occasion_insights !== undefined)       patch.occasion_insights        = occasion_insights
  if (sample_size_delta !== undefined) {
    patch.sample_size = Math.max(0, (current.sample_size ?? 0) + sample_size_delta)
  }

  const { error } = await db
    .from('sector_baselines')
    .update(patch as never)
    .eq('baseline_id', baseline_id)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, baseline_id, updated_fields: Object.keys(patch).filter((k) => k !== 'last_updated') })
}
