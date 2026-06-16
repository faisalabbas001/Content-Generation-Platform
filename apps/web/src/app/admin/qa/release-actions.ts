'use server'

import { revalidatePath } from 'next/cache'
import { adminClient } from '@repo/db/client'
import { adminQ } from '@repo/db'
import { requireAdmin } from '@repo/auth/admin'
import { notify } from '@repo/email'
import { syncCalendarDelivery } from '@/lib/calendar-status'

export interface ReleaseResult {
  ok: boolean
  count?: number
  error?: string
}

/** Release all generated posts in a calendar to status='pending' (client-visible). */
export async function releaseCalendarPosts(calendarId: string): Promise<ReleaseResult> {
  const admin = await requireAdmin()
  const supabase = adminClient()

  // Look up brand slug so we can revalidate the client calendar path.
  const { data: calRow } = await supabase
    .from('calendars')
    .select('brand_id, brand_profiles!inner(client_slug)')
    .eq('calendar_id', calendarId)
    .maybeSingle() as { data: { brand_id: string; brand_profiles: { client_slug: string } } | null }
  const clientSlug = calRow?.brand_profiles?.client_slug ?? null

  // Match the same statuses that getCalendarsForRelease() shows: ['generated','draft'].
  // Releasing only 'generated' was leaving 'draft' posts untouched → 0 rows updated
  // → button reappeared on every reload.
  // Also clear the watermark flag on release. The watermark was set because the
  // confidence gate ran in Cautious/Minimal mode (low brand completeness at
  // generation time). Once admin reviews and releases, the posts are validated —
  // clearing watermark removes the "AI Draft" amber notice on the client side.
  // Note: the image in storage_url may still have the watermark burned in visually,
  // but the UI banner and locked-post treatment are gated on this DB flag.
  const { data, error } = await supabase
    .from('calendar_posts')
    .update({ status: 'pending', watermark: false } as never)
    .eq('calendar_id', calendarId)
    .in('status', ['generated', 'draft'])
    .select('post_id')
  if (error) return { ok: false, error: error.message }

  // Resolve the calendar lifecycle → delivered (records reviewed_at/reviewed_by)
  // and fire the "calendar ready" email exactly once. Centralised so every
  // release surface stays consistent and never double-notifies.
  await syncCalendarDelivery(calendarId, { reviewedBy: admin.id }, supabase)

  // Revalidate admin page + the brand's client-facing calendar so the posts
  // appear immediately without a manual refresh.
  revalidatePath('/admin/qa')
  if (clientSlug) {
    revalidatePath(`/${clientSlug}/calendar`)
    revalidatePath(`/${clientSlug}/calendars`)
  }

  return { ok: true, count: (data ?? []).length }
}

/**
 * Put a whole calendar on hold. The client /calendar page switches to the
 * 'rejected' state and shows `reason`. Used when a batch needs rework before it
 * can be released (e.g. brand data was wrong at generation time).
 */
export async function rejectCalendar(calendarId: string, reason: string): Promise<ReleaseResult> {
  const admin = await requireAdmin()
  const supabase = adminClient()

  const { data: calRow } = await supabase
    .from('calendars')
    .select('brand_id, month, brand_profiles!inner(client_slug)')
    .eq('calendar_id', calendarId)
    .maybeSingle() as { data: { brand_id: string; month: string; brand_profiles: { client_slug: string } } | null }
  const clientSlug = calRow?.brand_profiles?.client_slug ?? null

  const { error } = await supabase
    .from('calendars')
    .update({
      status: 'rejected',
      rejection_reason: reason.trim() || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: admin.id,
    } as never)
    .eq('calendar_id', calendarId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/admin/qa')
  if (clientSlug) {
    revalidatePath(`/${clientSlug}/calendar`)
    revalidatePath(`/${clientSlug}/calendars`)
  }

  // Notify client their calendar was rejected — fire-and-forget (don't block the action)
  // Pass already-fetched brand_id + month to avoid a second DB round-trip.
  if (calRow?.brand_id && calRow?.month) {
    fireCalendarRejectedEmail(calendarId, calRow.brand_id, calRow.month, reason).catch((e) =>
      console.error('[rejectCalendar] notify error:', e),
    )
  }

  return { ok: true }
}

async function fireCalendarRejectedEmail(
  calendarId: string,
  brandId: string,
  month: string,
  reason: string,
) {
  const brandInfo = await adminQ.getBrandForQa(brandId)
  if (!brandInfo?.user_email || !brandInfo.auth_user_id) return

  await notify({
    templateKey: 'calendar_rejected',
    variables: {
      brand_name: brandInfo.brand_name_ar,
      month,
      reason: reason.trim() || 'لم يتم تحديد سبب',
    },
    brandId,
    authUserId: brandInfo.auth_user_id,
    userEmail: brandInfo.user_email,
    calendarId,
  })
}
