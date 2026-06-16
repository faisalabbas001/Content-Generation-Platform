/**
 * POST /api/admin/signals/layer3
 *
 * Admin-only. Upserts a row in content_performance_patterns (Layer 3 —
 * Global Intelligence). Used when admins want to seed or correct global
 * pattern data without waiting for the A01 batch to accumulate enough
 * approved posts.
 *
 * Body shape (all optional except sector + content_type):
 *  {
 *    sector:         'F&B' | 'Retail' | 'Beauty_Wellness'
 *    dialect?:       string
 *    occasion?:      string
 *    content_type:   string     e.g. 'lifestyle', 'offer', 'emotional'
 *    objective?:     string     e.g. 'brand_awareness', 'engagement'
 *    approval_rate?: number     0–1
 *    revision_rate?: number     0–1
 *    hard_block_rate?: number   0–1
 *    sample_size?:   number
 *  }
 *
 * If a row with the same (sector, dialect, occasion, content_type, objective)
 * already exists it is updated with a weighted merge; otherwise inserted.
 *
 * Auth: requireAdmin()
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { adminClient } from '@repo/db/client'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  sector:           z.enum(['F&B', 'Retail', 'Beauty_Wellness']),
  dialect:          z.string().optional().nullable(),
  occasion:         z.string().optional().nullable(),
  content_type:     z.string().min(1),
  objective:        z.string().optional().nullable(),
  approval_rate:    z.number().min(0).max(1).optional(),
  revision_rate:    z.number().min(0).max(1).optional(),
  hard_block_rate:  z.number().min(0).max(1).optional(),
  sample_size:      z.number().int().positive().optional(),
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
    sector, dialect, occasion, content_type, objective,
    approval_rate, revision_rate, hard_block_rate, sample_size,
  } = parsed.data

  const db = adminClient()

  // Check if matching row exists
  let q = db.from('content_performance_patterns')
    .select('pattern_id, approval_rate, revision_rate, hard_block_rate, sample_size')
    .eq('sector', sector)
    .eq('content_type', content_type)
  if (dialect)   q = q.eq('dialect', dialect as never)
  else           q = q.is('dialect', null)
  if (occasion)  q = q.eq('occasion', occasion)
  else           q = q.is('occasion', null)
  if (objective) q = q.eq('objective', objective)
  else           q = q.is('objective', null)

  const { data: existing } = await q.single()

  if (existing) {
    // Weighted merge: blend new values into existing using sample sizes
    const existingSample = existing.sample_size ?? 1
    const newSample = sample_size ?? 1
    const total = existingSample + newSample

    function blend(existing: number | null, incoming: number | undefined) {
      if (incoming === undefined) return existing
      if (existing === null) return incoming
      return (existing * existingSample + incoming * newSample) / total
    }

    const { error } = await db.from('content_performance_patterns')
      .update({
        approval_rate:   blend(existing.approval_rate, approval_rate),
        revision_rate:   blend(existing.revision_rate, revision_rate),
        hard_block_rate: blend(existing.hard_block_rate, hard_block_rate),
        sample_size:     total,
        last_updated:    new Date().toISOString(),
      })
      .eq('pattern_id', existing.pattern_id)

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, action: 'updated', pattern_id: existing.pattern_id })
  }

  // Insert new pattern
  const { data: inserted, error } = await db.from('content_performance_patterns')
    .insert({
      sector: sector as never,
      dialect:          (dialect ?? null) as never,
      occasion:         occasion ?? null,
      content_type,
      objective:        objective ?? null,
      approval_rate:    approval_rate ?? null,
      revision_rate:    revision_rate ?? null,
      hard_block_rate:  hard_block_rate ?? null,
      sample_size:      sample_size ?? 1,
      last_updated:     new Date().toISOString(),
    })
    .select('pattern_id')
    .single()

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, action: 'inserted', pattern_id: inserted?.pattern_id })
}
