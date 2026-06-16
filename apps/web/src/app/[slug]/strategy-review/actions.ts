'use server'

import { adminClient } from '@repo/db'
import { requireBrandAccess } from '@repo/auth/server'
import { triggerN8nA01BatchCalendarAdmin } from '@/lib/n8n-outbound'

export async function approveStrategy(brandId: string, slug: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireBrandAccess(slug)
  } catch {
    return { ok: false, error: 'Not authorised' }
  }

  // 1. Mark strategy as approved in DB
  const { error } = await adminClient()
    .from('brand_profiles')
    .update({
      onboarding_status: 'complete',
      strategy_version:  1,
    } as never)
    .eq('brand_id', brandId)

  if (error) return { ok: false, error: error.message }

  // 2. Trigger N8N-A01 ONCE with rolling:'initial'. A01 builds the FULL 3-month
  //    rolling runway in a SINGLE run, processing months 0→1→2 SEQUENTIALLY: it
  //    fully builds + commits one month's calendar to the DB, then moves to the next
  //    month (full, not partial) — so the three calendars never conflict. The user
  //    clicks "Approve & Generate" once; A01 owns the per-month sequencing internally.
  //    AWAITED so generation is under way before this action returns. off_days /
  //    posts_per_week come from .env.local (n8n cloud can't read the app env).
  const offDays = (process.env.OFF_DAYS ?? '0,6')
    .split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n))
  const r = await triggerN8nA01BatchCalendarAdmin({
    brand_id: brandId,
    source: 'strategy-approval',
    rolling: 'initial',
    off_days: offDays,
    ...(process.env.POSTS_PER_WEEK ? { posts_per_week: Number(process.env.POSTS_PER_WEEK) } : {}),
  })
  if (!r.ok) {
    console.warn(`[approveStrategy] A01 trigger failed brand=${brandId}: ${r.error}`)
    return { ok: false, error: 'Calendar generation could not start. Please try again.' }
  }
  console.info(`[approveStrategy] A01 3-month run triggered brand=${brandId} request_id=${r.request_id}`)

  return { ok: true }
}
