'use server'

import { revalidatePath } from 'next/cache'
import { adminClient } from '@repo/db/client'
import { requireAdmin } from '@repo/auth/admin'
import { syncCalendarDelivery } from '@/lib/calendar-status'

export interface ReleaseResult {
  ok: boolean
  count?: number
  error?: string
}

/** Release a single generated post to client-visible status='pending'. */
export async function releasePost(postId: string): Promise<ReleaseResult> {
  const admin = await requireAdmin()
  const supabase = adminClient()
  const { data, error } = await supabase
    .from('calendar_posts')
    .update({ status: 'pending' } as never)
    .eq('post_id', postId)
    .eq('status', 'generated')
    .select('calendar_id')
  if (error) return { ok: false, error: error.message }
  // Resolve the owning calendar's lifecycle (delivers + emails only once the
  // last generated post is released; otherwise stays pending_review).
  const calendarId = (data?.[0] as { calendar_id: string } | undefined)?.calendar_id
  if (calendarId) await syncCalendarDelivery(calendarId, { reviewedBy: admin.id }, supabase)
  revalidatePath('/admin/content-release')
  return { ok: true, count: 1 }
}

/** Release all unreleased posts for a brand at once. */
export async function releaseAllForBrand(brandId: string): Promise<ReleaseResult> {
  const admin = await requireAdmin()
  const supabase = adminClient()
  const { data, error } = await supabase
    .from('calendar_posts')
    .update({ status: 'pending' } as never)
    .eq('brand_id', brandId)
    .eq('status', 'generated')
    .select('post_id, calendar_id')
  if (error) return { ok: false, count: 0, error: error.message }
  // Sync every affected calendar (a brand can have more than one).
  const calendarIds = Array.from(
    new Set((data ?? []).map((r) => (r as { calendar_id: string }).calendar_id).filter(Boolean)),
  )
  for (const cid of calendarIds) {
    await syncCalendarDelivery(cid, { reviewedBy: admin.id }, supabase)
  }
  revalidatePath('/admin/content-release')
  return { ok: true, count: (data ?? []).length }
}
