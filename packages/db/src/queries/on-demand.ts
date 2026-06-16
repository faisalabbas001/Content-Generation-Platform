import { adminClient, isDbConfigured, type Db } from '../client'
import type { CalendarPost } from '../types'

/**
 * On-demand single-post requests (Doc §3.2 / N8N-A02).
 *
 * The brief is captured in `on_demand_requests`; once n8n finishes the run
 * the resulting post is written to `calendar_posts` and linked back via
 * `calendar_posts.on_demand_request_id` (migration 0009).
 *
 * The generated `Database` types (packages/db/src/schema/database.types.ts)
 * have not been regenerated since migration 0009 — `pnpm db:types` will fix
 * that. Until then, both tables are accessed via a localised cast so we keep
 * the call-site shape strict.
 */

export interface OnDemandRequestRow {
  request_id: string
  brand_id: string
  content_type: string
  /** Requested output medium (migration 0075). Defaults to 'image' for every legacy request. */
  media_type: 'image' | 'video'
  objective: string
  platform: string
  posting_time: string | null
  occasion_name: string | null
  hashtags: string[]
  style_descriptor: string
  hero_concept: string
  negative_prompt: string | null
  cultural_guidance: string | null
  canvas: string
  color_palette: string[]
  status: 'queued' | 'generating' | 'delivered' | 'held' | 'failed'
  post_id: string | null
  failure_reason: string | null
  created_at: string
  delivered_at: string | null
}

export interface OnDemandRequestWithPost extends OnDemandRequestRow {
  post: CalendarPost | null
}

/**
 * Migration 0009 created `on_demand_requests`. If the dev's Supabase project
 * is on an older migration set, the SELECT errors with PGRST205 / 42P01 / "Could
 * not find the table". Treat that exactly like an empty result so the listing
 * page renders its empty state instead of crashing into error.tsx.
 */
function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code === 'PGRST205' || err.code === '42P01') return true
  const msg = err.message ?? ''
  return /could not find the table|relation .* does not exist/i.test(msg)
}

/**
 * Returns every on-demand request for a brand (newest first), each with the
 * `calendar_posts` row that was eventually produced (null while pending).
 *
 * If a `client` is passed, RLS applies (caller's session decides what they
 * can read). If omitted, falls back to service-role for admin views.
 */
export async function getOnDemandRequestsForBrand(
  brandId: string,
  client?: Db,
): Promise<OnDemandRequestWithPost[]> {
  const { items } = await getOnDemandRequestsForBrandPaged(brandId, { client })
  return items
}

export interface OnDemandPageOptions {
  client?: Db
  /** 1-based page number. Defaults to 1. */
  page?: number
  /** Page size. Defaults to 20. */
  pageSize?: number
}

export interface OnDemandPagedResult {
  items: OnDemandRequestWithPost[]
  /** Total matching rows across all pages (for pagination UI). */
  total: number
  page: number
  pageSize: number
  pageCount: number
}

/**
 * Paginated variant of {@link getOnDemandRequestsForBrand}. Returns the slice
 * for the requested page plus the overall total so the caller can render
 * pagination controls without a second round-trip.
 */
export async function getOnDemandRequestsForBrandPaged(
  brandId: string,
  options: OnDemandPageOptions = {},
): Promise<OnDemandPagedResult> {
  const { client, page: rawPage = 1, pageSize: rawPageSize = 20 } = options
  const pageSize = Math.max(1, Math.floor(rawPageSize))
  const page = Math.max(1, Math.floor(rawPage))
  const empty: OnDemandPagedResult = { items: [], total: 0, page, pageSize, pageCount: 0 }

  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return empty

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supaAny = supabase as any
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await supaAny
    .from('on_demand_requests')
    .select('*', { count: 'exact' })
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) {
    if (isMissingTable(error)) return empty
    throw error
  }

  const rows = (data ?? []) as OnDemandRequestRow[]
  const total = typeof count === 'number' ? count : rows.length
  const pageCount = total === 0 ? 0 : Math.ceil(total / pageSize)
  if (rows.length === 0) {
    return { items: [], total, page, pageSize, pageCount }
  }

  const requestIds = rows.map((r) => r.request_id)
  let postsByRequestId = new Map<string, CalendarPost>()
  if (requestIds.length > 0) {
    const { data: posts, error: postsErr } = await supaAny
      .from('calendar_posts')
      .select('*')
      .in('on_demand_request_id', requestIds)
    if (postsErr) throw postsErr
    postsByRequestId = new Map(
      (posts as CalendarPost[])
        .filter((p) => p.on_demand_request_id)
        .map((p) => [p.on_demand_request_id as string, p]),
    )
  }

  const items = rows.map((r) => ({
    ...r,
    post: postsByRequestId.get(r.request_id) ?? null,
  }))
  return { items, total, page, pageSize, pageCount }
}

export async function getOnDemandRequestById(
  requestId: string,
  client?: Db,
): Promise<OnDemandRequestWithPost | null> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supaAny = supabase as any
  const { data, error } = await supaAny
    .from('on_demand_requests')
    .select('*')
    .eq('request_id', requestId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw error
  }
  if (!data) return null

  const row = data as OnDemandRequestRow
  let post: CalendarPost | null = null
  // Use limit(1) + order instead of maybeSingle(): if N8N-QA-Approved retried and
  // created a second calendar_posts row for the same request, maybeSingle() throws
  // PGRST116 which causes the detail page to 404. Taking the newest row is safe —
  // the latest one always has the final storage_url.
  const { data: postRows, error: postErr } = await supaAny
    .from('calendar_posts')
    .select('*')
    .eq('on_demand_request_id', row.request_id)
    .order('created_at', { ascending: false })
    .limit(1)
  if (postErr) throw postErr
  post = ((postRows as CalendarPost[] | null)?.[0] ?? null)

  return { ...row, post }
}
