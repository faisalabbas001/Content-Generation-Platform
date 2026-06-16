import 'server-only'

import { adminClient } from '@repo/db/client'
import { notify } from '@repo/email'

type Db = ReturnType<typeof adminClient>

/**
 * Calendar lifecycle helper (migration 0076).
 *
 * Recomputes a calendar's status from its posts and, on the first transition to
 * `delivered`, fires the "calendar ready" email exactly once.
 *
 * State machine: draft → generating → pending_review → delivered (or → rejected).
 *  - Any post still in 'generated' / 'draft'  → posts await OGZ release → pending_review.
 *  - Otherwise (all posts 'pending' / 'approved') → delivered.
 *
 * Idempotent: safe to call from every release surface (n8n brand_complete,
 * /admin/qa release, /admin/content-release). The email only fires on the
 * pending_review → delivered edge, so repeated calls never double-notify.
 *
 * @returns the resolved logical status, or null when the calendar has no posts yet.
 */
export async function syncCalendarDelivery(
  calendarId: string,
  opts: { reviewedBy?: string | null } = {},
  db: Db = adminClient(),
): Promise<'pending_review' | 'delivered' | null> {
  const { data: posts } = await db
    .from('calendar_posts')
    .select('status')
    .eq('calendar_id', calendarId)

  if (!posts || posts.length === 0) return null

  const hasUnreleased = posts.some(
    (p) => (p as { status: string }).status === 'generated' || (p as { status: string }).status === 'draft',
  )
  const hasVisible = posts.some(
    (p) => (p as { status: string }).status === 'pending' || (p as { status: string }).status === 'approved',
  )

  const { data: cal } = await db
    .from('calendars')
    .select('calendar_id, brand_id, status, delivered_at')
    .eq('calendar_id', calendarId)
    .maybeSingle()
  if (!cal) return null

  const current = (cal as { status: string }).status

  // Still awaiting OGZ review, or nothing client-visible yet.
  if (hasUnreleased || !hasVisible) {
    // Advance pre-review states forward, but never downgrade a terminal one.
    if (current === 'draft' || current === 'generating') {
      await db
        .from('calendars')
        .update({ status: 'pending_review' } as never)
        .eq('calendar_id', calendarId)
    }
    return 'pending_review'
  }

  // All posts client-visible → delivered.
  const wasDelivered = current === 'delivered'
  await db
    .from('calendars')
    .update({
      status: 'delivered',
      delivered_at: (cal as { delivered_at: string | null }).delivered_at ?? new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      ...(opts.reviewedBy ? { reviewed_by: opts.reviewedBy } : {}),
    } as never)
    .eq('calendar_id', calendarId)

  if (!wasDelivered) {
    const visibleCount = posts.filter(
      (p) => (p as { status: string }).status === 'pending' || (p as { status: string }).status === 'approved',
    ).length
    fireCalendarReadyEmail(db, (cal as { brand_id: string }).brand_id, calendarId, visibleCount).catch((e) =>
      console.error('[calendar-status] calendar_delivered notify error:', e),
    )
  }

  return 'delivered'
}

/**
 * Sends the "Your [Month] calendar is ready" email. Mirrors the helper that
 * previously lived in /api/webhooks/n8n; centralised here so delivery and the
 * email always fire together at the single authoritative release moment.
 */
async function fireCalendarReadyEmail(
  db: Db,
  brandId: string,
  calendarId: string,
  postCount: number,
) {
  const [{ data: brand }, { data: calendar }] = await Promise.all([
    db.from('brand_profiles').select('auth_user_id, brand_name_ar').eq('brand_id', brandId).maybeSingle(),
    db.from('calendars').select('month').eq('calendar_id', calendarId).maybeSingle(),
  ])

  if (!brand?.auth_user_id || !calendar) return

  const { data: authData } = await db.auth.admin.getUserById(brand.auth_user_id)
  const userEmail = authData.user?.email
  if (!userEmail) return

  await notify({
    templateKey: 'calendar_delivered',
    variables: {
      brand_name: brand.brand_name_ar,
      month: calendar.month,
      post_count: postCount,
    },
    brandId,
    authUserId: brand.auth_user_id,
    userEmail,
    calendarId,
  })
}
