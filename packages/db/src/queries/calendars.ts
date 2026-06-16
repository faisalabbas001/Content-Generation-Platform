import { adminClient, isDbConfigured, type Db } from '../client'
import type { Calendar, CalendarPost } from '../types'

/**
 * If a `client` is passed, RLS applies (the caller's session decides what
 * they can read). If omitted, falls back to service-role (admin views).
 */
export async function getCalendarsForBrand(brandId: string, client?: Db): Promise<Calendar[]> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return []
  const { data, error } = await supabase
    .from('calendars')
    .select('*')
    .eq('brand_id', brandId)
    .order('month', { ascending: false })
  if (error) throw error
  return (data ?? []) as Calendar[]
}

export async function getLatestCalendarForBrand(brandId: string, client?: Db): Promise<Calendar | null> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return null
  const { data, error } = await supabase
    .from('calendars')
    .select('*')
    .eq('brand_id', brandId)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as Calendar | null
}

/**
 * Cheap total-post count for a calendar (head-only, no rows). Used by the client
 * /calendar page to size the "under review" coming-soon teaser grid — counts ALL
 * posts (any status), unlike getPostsForCalendar which is client-visible only.
 */
export async function countPostsForCalendar(calendarId: string, client?: Db): Promise<number> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return 0
  const { count, error } = await supabase
    .from('calendar_posts')
    .select('post_id', { count: 'exact', head: true })
    .eq('calendar_id', calendarId)
  if (error) return 0
  return count ?? 0
}

export async function getPostsForCalendar(calendarId: string, client?: Db): Promise<CalendarPost[]> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return []
  const { data, error } = await supabase
    .from('calendar_posts')
    .select('*')
    .eq('calendar_id', calendarId)
    .in('status', ['pending', 'approved'])
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as CalendarPost[]
}

/**
 * Returns the set of post_ids currently held in the QA queue (status='pending')
 * for a brand. Used by the client calendar to show "Under Review" badges.
 * Uses service-role client — qa_review_queue is not readable by brand users.
 */
export async function getHeldPostIds(brandId: string): Promise<Set<string>> {
  if (!isDbConfigured()) return new Set()
  const { data } = await adminClient()
    .from('qa_review_queue')
    .select('post_id')
    .eq('brand_id', brandId)
    .eq('status', 'pending')
    .not('post_id', 'is', null)
  return new Set(((data ?? []) as Array<{ post_id: string }>).map((r) => r.post_id))
}

/**
 * Fetches only the intent_override for a calendar — used by plan-slots to
 * compute effectiveIntent = intent_override ?? brand.intent_state.
 * Uses service-role so it works from API routes (no session needed).
 */
export async function getCalendarIntentOverride(calendarId: string): Promise<string | null> {
  if (!isDbConfigured()) return null
  const { data } = await adminClient()
    .from('calendars')
    .select('intent_override')
    .eq('calendar_id', calendarId)
    .maybeSingle()
  return (data as { intent_override?: string | null } | null)?.intent_override ?? null
}

export async function updatePostStatus(
  postId: string,
  status: 'approved' | 'pending' | 'draft',
  client: Db,
): Promise<void> {
  const update: Record<string, unknown> = { status }
  if (status === 'approved') update.approved_at = new Date().toISOString()
  const { error } = await client
    .from('calendar_posts')
    .update(update as never)
    .eq('post_id', postId)
  if (error) throw error
}
