import { adminClient, isDbConfigured } from '../client'
import { listAdminRegenerationsForPosts } from './admin-regenerations'
import type {
  QaQueueItem,
  QaQueueMedia,
  QaQueueRequest,
  QaQueueBrand,
  QaQueueChain,
  Sector,
  Tier,
  PipelineTier,
  Channel,
  Dialect,
  RoutingDecision,
  AnomalyRecord,
  UsageLog,
  SectorBaseline,
  BrandMonthlySummary,
  BrandCostConfig,
  MonthlyCostBrand,
  MonthlyCostSummary,
} from '../types'

export async function getQaQueue(limit = 50): Promise<QaQueueItem[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('qa_review_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as QaQueueItem[]
}

/**
 * QA records fall into two categories surfaced as separate tabs in /admin/qa.
 *
 * A row is ON-DEMAND when it is linked to an on_demand_requests brief, which
 * happens through EITHER of two paths (see migration 0044's "exactly-one-parent"
 * invariant on calendar_posts):
 *   1. Pre-image HOLD (N8N-A02): post_id is null and `flags.request_id` carries
 *      the brief id.
 *   2. Revision/confidence-gate HOLD: post_id points to a calendar_posts row
 *      whose `on_demand_request_id` is set (no flags.request_id).
 * Everything else — calendar-linked posts, dialect holds, anomaly-routed rows,
 * and unlinked seed rows — is CALENDAR. Classifying on `flags.request_id` alone
 * silently leaked path-2 on-demand holds into the calendar tab.
 *
 * The path-2 test needs a calendar_posts lookup, so we classify in-app over the
 * QA queue (a bounded human-review backlog) rather than in a single SQL filter.
 */
export type QaQueueKind = 'calendar' | 'on_demand'

// Safety cap — the QA review backlog is small by nature; load the most recent
// rows and classify them in memory. Bump if a deployment ever approaches this.
const QA_SCAN_LIMIT = 2000

type ClassifiedQa = QaQueueItem & { qa_kind: QaQueueKind }

function classifyQa(row: QaQueueItem, onDemandPostIds: Set<string>): QaQueueKind {
  // n8n's Supabase node can double-serialize JSONB fields (JSON.stringify → stored
  // as a string). Parse defensively so both object and string-encoded flags work.
  let flags: Record<string, unknown> | null = row.flags as Record<string, unknown> | null
  if (typeof flags === 'string') {
    try { flags = JSON.parse(flags) } catch { flags = null }
  }
  const requestId = (flags as Record<string, unknown> | null)?.request_id
  if (requestId != null && requestId !== '') return 'on_demand'
  if (row.post_id && onDemandPostIds.has(row.post_id)) return 'on_demand'
  return 'calendar'
}

/**
 * Load the QA queue (most-recent first) and tag every row with its qa_kind.
 * Resolves the on-demand-origin of post-linked rows via a single calendar_posts
 * lookup scoped to the post_ids actually present in the queue.
 */
async function loadClassifiedQa(): Promise<ClassifiedQa[]> {
  const db = adminClient()
  const { data, error } = await db
    .from('qa_review_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(QA_SCAN_LIMIT)
  if (error) throw error
  const rows = (data ?? []) as QaQueueItem[]

  const postIds = [...new Set(rows.map((r) => r.post_id).filter((id): id is string => !!id))]
  let onDemandPostIds = new Set<string>()
  if (postIds.length > 0) {
    const { data: posts, error: pErr } = await db
      .from('calendar_posts')
      .select('post_id')
      .not('on_demand_request_id', 'is', null)
      .in('post_id', postIds)
    if (pErr) throw pErr
    onDemandPostIds = new Set((posts ?? []).map((p) => (p as { post_id: string }).post_id))
  }

  // Normalize flags ONCE at the load point: n8n inserts flags via JSON.stringify
  // into the JSONB column, so PostgREST stores/returns a JSON *string* for those
  // rows. Every downstream consumer (inspection page score cards, ScoreInsightPanel,
  // human_gate_triggers, raw-flag panels) assumes an object — without this parse,
  // real scores written by n8n (prompt_adherence, brand_relevance, …) render as '—'.
  return rows.map((r) => {
    let flags: unknown = r.flags
    if (typeof flags === 'string') { try { flags = JSON.parse(flags) } catch { flags = null } }
    const normalized = { ...r, flags: (flags ?? null) } as QaQueueItem
    return { ...normalized, qa_kind: classifyQa(normalized, onDemandPostIds) }
  })
}

export async function getQaQueuePaged(
  page: number,
  pageSize: number,
  kind?: QaQueueKind,
): Promise<{ rows: QaQueueItem[]; total: number }> {
  if (!isDbConfigured()) return { rows: [], total: 0 }
  const classified = await loadClassifiedQa()
  const filtered = kind ? classified.filter((r) => r.qa_kind === kind) : classified
  const offset = (page - 1) * pageSize
  const pageRows = filtered.slice(offset, offset + pageSize)
  // Enrich on-demand rows on the page slice only (not the whole backlog) so the
  // admin can preview the already-generated media + originating brief.
  const rows = await enrichOnDemandRows(pageRows)
  return { rows, total: filtered.length }
}

/** Defensive flags parse — n8n may store JSONB double-serialized as a string. */
function readRequestId(flags: unknown): string | null {
  let f: Record<string, unknown> | null = flags as Record<string, unknown> | null
  if (typeof f === 'string') { try { f = JSON.parse(f) } catch { f = null } }
  const id = (f as Record<string, unknown> | null)?.request_id
  return typeof id === 'string' && id ? id : null
}

/**
 * Attaches `media` (from calendar_posts) and `request` (from on_demand_requests)
 * to on-demand QA rows so the admin QA card can render a real preview. Calendar
 * rows pass through untouched. Resolves the post by `post_id` when present, else
 * by the newest `calendar_posts` row for the brief's `on_demand_request_id`.
 */
async function enrichOnDemandRows(rows: ClassifiedQa[]): Promise<QaQueueItem[]> {
  const onDemand = rows.filter((r) => r.qa_kind === 'on_demand')
  if (onDemand.length === 0) return rows as QaQueueItem[]

  const db = adminClient()
  const requestIdByQueue = new Map<string, string | null>()
  for (const r of onDemand) requestIdByQueue.set(r.queue_id, readRequestId(r.flags))

  const directPostIds = [...new Set(onDemand.map((r) => r.post_id).filter((id): id is string => !!id))]
  const requestIds = [...new Set([...requestIdByQueue.values()].filter((id): id is string => !!id))]

  // Posts linked directly via qa_review_queue.post_id
  const postById = new Map<string, Record<string, unknown>>()
  if (directPostIds.length > 0) {
    const { data } = await db
      .from('calendar_posts')
      .select('post_id, on_demand_request_id, media_type, storage_url, clean_storage_url, hashtags, caption_ar, confidence_score, watermark, chain_id, generation_model, image_prompt_en, route_decision')
      .in('post_id', directPostIds)
    // Cast via unknown — image_prompt_en (migration 0100) isn't in generated types yet.
    for (const p of (data ?? []) as unknown as Record<string, unknown>[]) postById.set(p.post_id as string, p)
  }

  // Posts linked via on_demand_request_id (fallback when post_id is null) + the brief itself
  const postByRequestId = new Map<string, Record<string, unknown>>()
  const requestById = new Map<string, Record<string, unknown>>()
  if (requestIds.length > 0) {
    const { data: posts } = await db
      .from('calendar_posts')
      .select('post_id, on_demand_request_id, media_type, storage_url, clean_storage_url, hashtags, caption_ar, confidence_score, watermark, created_at, chain_id, generation_model, image_prompt_en, route_decision')
      .in('on_demand_request_id', requestIds)
      .order('created_at', { ascending: false })
    // Cast via unknown — image_prompt_en (migration 0100) isn't in generated types yet.
    for (const p of (posts ?? []) as unknown as Record<string, unknown>[]) {
      const rid = p.on_demand_request_id as string
      if (rid && !postByRequestId.has(rid)) postByRequestId.set(rid, p) // newest wins (ordered desc)
    }
    const { data: reqs } = await db
      .from('on_demand_requests')
      .select('request_id, hero_concept, style_descriptor, content_type, platform, media_type, current_step, image_model_pref, negative_prompt, cultural_guidance, confidence_mode, color_palette, occasion_name')
      .in('request_id', requestIds)
    for (const q of (reqs ?? []) as Record<string, unknown>[]) requestById.set(q.request_id as string, q)
  }

  const toMedia = (p: Record<string, unknown> | undefined): QaQueueMedia | null => {
    if (!p) return null
    return {
      post_id:           p.post_id as string,
      media_type:        ((p.media_type as string) === 'video' ? 'video' : 'image'),
      storage_url:       (p.storage_url as string | null) ?? null,
      clean_storage_url: (p.clean_storage_url as string | null) ?? null,
      hashtags:          (p.hashtags as string[] | null) ?? [],
      caption_ar:        (p.caption_ar as string | null) ?? null,
      confidence_score:  p.confidence_score != null ? Number(p.confidence_score) : null,
      watermark:         Boolean(p.watermark),
      chain_id:          (p.chain_id as string | null) ?? null,
      generation_model:  (p.generation_model as string | null) ?? null,
      image_prompt_en:   (p.image_prompt_en as string | null) ?? null,
      route_decision:    (p.route_decision as string | null) ?? null,
    }
  }

  // Admin draft regenerations (admin-only "draft lane") for every resolved post.
  const resolvedPostIds = new Set<string>(directPostIds)
  for (const p of postByRequestId.values()) {
    const pid = p.post_id as string | undefined
    if (pid) resolvedPostIds.add(pid)
  }
  const regenByPost = await listAdminRegenerationsForPosts([...resolvedPostIds])

  // Selected creative chains — resolve chain_id → chain name + model so the admin
  // card can show which chain (if any) generated the image. On-demand posts use
  // standard routing (chain_id NULL) in most cases; this populates the rare ones
  // that do carry a chain, and future chain-routed on-demand flows.
  const chainIds = [...new Set(
    [...postById.values(), ...postByRequestId.values()]
      .map((p) => p.chain_id as string | null)
      .filter((id): id is string => !!id),
  )]
  const chainById = new Map<string, Record<string, unknown>>()
  if (chainIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chainRows } = await (db as any)
      .from('chains')
      .select('chain_id, name_en, name_ar, family, fal_model_primary, prompt_template, negative_prompt')
      .in('chain_id', chainIds)
    for (const ch of (chainRows ?? []) as Record<string, unknown>[]) {
      chainById.set(ch.chain_id as string, ch)
    }
  }

  const toChain = (chainId: string | null | undefined): QaQueueChain | null => {
    if (!chainId) return null
    const ch = chainById.get(chainId)
    if (!ch) return { chain_id: chainId, name_en: null, name_ar: null, family: null, fal_model_primary: null, prompt_template: null, negative_prompt: null }
    return {
      chain_id:          chainId,
      name_en:           (ch.name_en as string | null) ?? null,
      name_ar:           (ch.name_ar as string | null) ?? null,
      family:            (ch.family as string | null) ?? null,
      fal_model_primary: (ch.fal_model_primary as string | null) ?? null,
      prompt_template:   (ch.prompt_template as string | null) ?? null,
      negative_prompt:   (ch.negative_prompt as string | null) ?? null,
    }
  }

  // Brand profiles — one query for all unique brand_ids in the page slice so the
  // admin card can display brand name, sector, pipeline tier, and channel.
  const allBrandIds = [...new Set(rows.map((r) => r.brand_id).filter(Boolean))]
  const brandById = new Map<string, Record<string, unknown>>()
  if (allBrandIds.length > 0) {
    const { data: brandRows } = await db
      .from('brand_profiles')
      .select('brand_id, brand_name_ar, brand_name_en, sector, tier, pipeline_tier, primary_channel, arabic_dialect, client_slug, logo_url')
      .in('brand_id', allBrandIds)
    for (const b of (brandRows ?? []) as Record<string, unknown>[]) {
      brandById.set(b.brand_id as string, b)
    }
  }

  const toBrand = (brandId: string): QaQueueBrand | null => {
    const b = brandById.get(brandId)
    if (!b) return null
    return {
      brand_name_ar:   String(b.brand_name_ar ?? ''),
      brand_name_en:   (b.brand_name_en as string | null) ?? null,
      sector:          b.sector as Sector,
      tier:            b.tier as Tier,
      pipeline_tier:   b.pipeline_tier as PipelineTier,
      primary_channel: (b.primary_channel as Channel | null) ?? null,
      arabic_dialect:  (b.arabic_dialect as Dialect | null) ?? null,
      client_slug:     String(b.client_slug ?? ''),
      logo_url:        (b.logo_url as string | null) ?? null,
    }
  }

  return rows.map((r) => {
    if (r.qa_kind !== 'on_demand') return { ...r, brand: toBrand(r.brand_id) } as QaQueueItem
    const requestId = requestIdByQueue.get(r.queue_id) ?? null
    const post = (r.post_id ? postById.get(r.post_id) : undefined)
      ?? (requestId ? postByRequestId.get(requestId) : undefined)
    const req = requestId ? requestById.get(requestId) : undefined
    const request: QaQueueRequest | null = req
      ? {
          request_id:       req.request_id as string,
          hero_concept:     (req.hero_concept as string | null) ?? null,
          style_descriptor: (req.style_descriptor as string | null) ?? null,
          content_type:     (req.content_type as string | null) ?? null,
          platform:         (req.platform as string | null) ?? null,
          media_type:       ((req.media_type as string) === 'video' ? 'video' : 'image'),
          current_step:     (req.current_step as string | null) ?? null,
          image_model_pref: (req.image_model_pref as string | null) ?? null,
          negative_prompt:  (req.negative_prompt as string | null) ?? null,
          cultural_guidance:(req.cultural_guidance as string | null) ?? null,
          confidence_mode:  (req.confidence_mode as string | null) ?? null,
          color_palette:    (req.color_palette as string[] | null) ?? null,
          occasion_name:    (req.occasion_name as string | null) ?? null,
        }
      : null
    const resolvedPostId = (post?.post_id as string | undefined) ?? null
    const admin_regenerations = resolvedPostId ? (regenByPost.get(resolvedPostId) ?? []) : []
    const chain = toChain(post?.chain_id as string | null | undefined)
    return { ...r, media: toMedia(post), request, admin_regenerations, chain, brand: toBrand(r.brand_id) } as QaQueueItem
  })
}

/** Pending-item counts per QA category — drives the tab badges in /admin/qa. */
export async function getQaPendingCounts(): Promise<{ calendar: number; on_demand: number }> {
  if (!isDbConfigured()) return { calendar: 0, on_demand: 0 }
  const pending = (await loadClassifiedQa()).filter((r) => r.status === 'pending')
  // On-demand badge = number of brands with pending items (matches the brand-card count in the list).
  const on_demand = new Set(
    pending.filter((r) => r.qa_kind === 'on_demand').map((r) => r.brand_id).filter(Boolean),
  ).size

  // Calendar badge = number of brands that will actually appear as calendar cards.
  // A brand only appears if it has BOTH pending QA items AND an active (non-delivered,
  // non-rejected) calendar. Brands whose calendar was already delivered/rejected still
  // have pending QA rows but no card → must not be counted in the badge.
  const calBrandIds = [...new Set(
    pending.filter((r) => r.qa_kind === 'calendar').map((r) => r.brand_id).filter(Boolean),
  )]
  let calendar = 0
  if (calBrandIds.length > 0) {
    const { data } = await adminClient()
      .from('calendars')
      .select('brand_id')
      .in('brand_id', calBrandIds)
      .not('status', 'in', '("delivered","rejected")')
    calendar = new Set(
      (data ?? []).map((r: Record<string, unknown>) => r.brand_id as string),
    ).size
  }
  return { calendar, on_demand }
}

export async function getRoutingDecisions(
  limit = 100,
  filters: { flow_id?: string; brand_id?: string; outcome?: string; confidence_mode?: string } = {},
): Promise<RoutingDecision[]> {
  if (!isDbConfigured()) return []
  let q = adminClient().from('routing_decisions').select('*')
  if (filters.flow_id)         q = q.eq('flow_id', filters.flow_id)
  if (filters.brand_id)        q = q.eq('brand_id', filters.brand_id)
  if (filters.outcome)         q = q.eq('outcome', filters.outcome)
  if (filters.confidence_mode) q = q.eq('confidence_mode', filters.confidence_mode as never)
  const { data, error } = await q.order('timestamp', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as RoutingDecision[]
}

export async function getAnomalies(
  limit = 50,
  filters: { severity?: string; anomaly_type?: string; brand_id?: string; resolved?: boolean } = {},
  offset = 0,
): Promise<{ rows: AnomalyRecord[]; total: number }> {
  if (!isDbConfigured()) return { rows: [], total: 0 }
  const applyFilters = (q: ReturnType<typeof adminClient>['from']) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r = q as any
    if (filters.severity)     r = r.eq('severity', filters.severity)
    if (filters.anomaly_type) r = r.eq('anomaly_type', filters.anomaly_type)
    if (filters.brand_id)     r = r.eq('brand_id', filters.brand_id)
    if (typeof filters.resolved === 'boolean') r = r.eq('resolved', filters.resolved)
    return r
  }
  const db = adminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data, error }, { count, error: cErr }] = await Promise.all([
    applyFilters(db.from('anomaly_records').select('*') as any)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
    applyFilters(db.from('anomaly_records').select('*', { count: 'exact', head: true }) as any),
  ])
  if (error) throw error
  if (cErr) throw cErr
  return { rows: (data ?? []) as AnomalyRecord[], total: count ?? 0 }
}

export async function getRecentUsage(limit = 200): Promise<UsageLog[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('usage_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as UsageLog[]
}

export async function getSectorBaselines(): Promise<SectorBaseline[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('sector_baselines')
    .select('*')
    .order('sector', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as SectorBaseline[]
}

export interface FlowStatus {
  flow_id: string
  total_executions: number
  success: number
  retry: number
  last_seen: string | null
}

export interface AuditEvent {
  event_id: string
  brand_id: string | null
  event_type: string
  event_data: Record<string, unknown>
  created_at: string
}

export async function getAuditEvents(
  limit = 100,
  filters: { event_type?: string; brand_id?: string } = {},
): Promise<AuditEvent[]> {
  if (!isDbConfigured()) return []
  let q = adminClient().from('branddna_event_log').select('*')
  if (filters.event_type) q = q.eq('event_type', filters.event_type as never)
  if (filters.brand_id)   q = q.eq('brand_id', filters.brand_id)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as AuditEvent[]
}

export interface ContentPattern {
  pattern_id: string
  sector: string
  dialect: string | null
  occasion: string | null
  content_type: string | null
  objective: string | null
  approval_rate: number | null
  sample_size: number
  last_updated: string
}

export async function getContentPatterns(limit = 100): Promise<ContentPattern[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('content_performance_patterns')
    .select('*')
    .order('approval_rate', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as ContentPattern[]
}

export async function getFlowsStatus(): Promise<FlowStatus[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('usage_logs')
    .select('flow_id,status,created_at')
    .not('flow_id', 'is', null)
  if (error) throw error

  const map = new Map<string, FlowStatus>()
  for (const row of data as Array<{ flow_id: string; status: string | null; created_at: string }>) {
    const fid = row.flow_id
    const existing =
      map.get(fid) ??
      ({ flow_id: fid, total_executions: 0, success: 0, retry: 0, last_seen: null } satisfies FlowStatus)
    existing.total_executions += 1
    if (row.status === 'success') existing.success += 1
    else if (row.status === 'retry') existing.retry += 1
    if (!existing.last_seen || row.created_at > existing.last_seen) existing.last_seen = row.created_at
    map.set(fid, existing)
  }
  return Array.from(map.values()).sort((a, b) => a.flow_id.localeCompare(b.flow_id))
}

// ─────────────────────────────────────────────────────────────────────
// User management — admin section
//
// Joins auth.users (Supabase Auth) with brand_profiles. auth.users isn't
// queryable via the Supabase JS client's `.from()` (it's in the `auth`
// schema), so we use admin.listUsers() and stitch with a single
// brand_profiles SELECT scoped to auth_user_id.
// ─────────────────────────────────────────────────────────────────────

export interface AdminUserBrand {
  brand_id: string
  brand_name_ar: string
  brand_name_en: string | null
  client_slug: string
  sector: string
  onboarding_status: string | null
  completeness_score: number
  tier: string
  created_at: string
  logo_url: string | null
}

export interface AdminUserRow {
  user_id: string
  email: string | null
  full_name: string | null
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  created_at: string
  banned_until: string | null
  is_anonymous: boolean
  brands: AdminUserBrand[]
}

export async function listAdminUsers(
  filters: { search?: string; hasBrand?: boolean; status?: 'active' | 'banned' | 'unconfirmed' } = {},
): Promise<AdminUserRow[]> {
  if (!isDbConfigured()) return []
  const supabase = adminClient()

  // listUsers is paginated; we iterate until exhausted (cap 1000 for safety —
  // beyond that we'd add real pagination to the UI).
  const collected: Array<{
    id: string
    email?: string | null
    email_confirmed_at?: string | null
    last_sign_in_at?: string | null
    created_at: string
    banned_until?: string | null
    is_anonymous?: boolean
    user_metadata?: { full_name?: string }
  }> = []
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const users = data?.users ?? []
    if (users.length === 0) break
    collected.push(...users)
    if (users.length < 100 || collected.length >= 1000) break
    page++
  }

  // One SELECT against brand_profiles for everyone. RLS bypass via service role.
  const userIds = collected.map((u) => u.id)
  const { data: brands } = await supabase
    .from('brand_profiles')
    .select('brand_id, brand_name_ar, brand_name_en, client_slug, sector, onboarding_status, completeness_score, tier, created_at, logo_url, auth_user_id')
    .in('auth_user_id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000'])

  const brandsByUser = new Map<string, AdminUserBrand[]>()
  for (const b of (brands ?? []) as Array<AdminUserBrand & { auth_user_id: string }>) {
    const list = brandsByUser.get(b.auth_user_id) ?? []
    list.push({
      brand_id:           b.brand_id,
      brand_name_ar:      b.brand_name_ar,
      brand_name_en:      b.brand_name_en,
      client_slug:        b.client_slug,
      sector:             b.sector,
      onboarding_status:  b.onboarding_status,
      completeness_score: b.completeness_score,
      tier:               b.tier,
      created_at:         b.created_at,
      logo_url:           b.logo_url,
    })
    brandsByUser.set(b.auth_user_id, list)
  }

  let rows: AdminUserRow[] = collected.map((u) => ({
    user_id:           u.id,
    email:             u.email ?? null,
    full_name:         u.user_metadata?.full_name ?? null,
    email_confirmed_at: u.email_confirmed_at ?? null,
    last_sign_in_at:   u.last_sign_in_at ?? null,
    created_at:        u.created_at,
    banned_until:      u.banned_until ?? null,
    is_anonymous:      !!u.is_anonymous,
    brands:            brandsByUser.get(u.id) ?? [],
  }))

  // Apply filters in-memory (small dataset; Supabase Auth doesn't support server-side filters)
  if (filters.search) {
    const q = filters.search.toLowerCase()
    rows = rows.filter((u) =>
      (u.email ?? '').toLowerCase().includes(q) ||
      (u.full_name ?? '').toLowerCase().includes(q) ||
      u.user_id.toLowerCase().includes(q) ||
      u.brands.some((b) => (b.brand_name_ar ?? '').toLowerCase().includes(q) || (b.brand_name_en ?? '').toLowerCase().includes(q) || b.client_slug.toLowerCase().includes(q)),
    )
  }
  if (filters.hasBrand === true) rows = rows.filter((u) => u.brands.length > 0)
  if (filters.hasBrand === false) rows = rows.filter((u) => u.brands.length === 0)
  if (filters.status === 'banned') rows = rows.filter((u) => u.banned_until && new Date(u.banned_until) > new Date())
  if (filters.status === 'unconfirmed') rows = rows.filter((u) => !u.email_confirmed_at)
  if (filters.status === 'active') rows = rows.filter((u) => u.email_confirmed_at && (!u.banned_until || new Date(u.banned_until) <= new Date()))

  // Sort newest signup first
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return rows
}

// ─────────────────────────────────────────────────────────────────────
// Upgrade readiness — routing_decisions rows written by N8N-A05.
//
// The real brand_performance_log table is a per-post metric log
// (metric_key / metric_value). A05 writes its batch report as a JSON
// blob in routing_decisions.outcome (same pattern as D02).
// ─────────────────────────────────────────────────────────────────────

export interface UpgradeReadinessRow {
  decision_id: string
  brand_id: string | null
  outcome: string  // JSON: { brand_id, brand_name_ar, readiness_tier, total_score, metrics, batch_id, … }
  timestamp: string
  // Parsed convenience fields (populated by getUpgradeReadiness)
  brand_name_ar?: string
  brand_name_en?: string | null
  sector?: string
  readiness_tier?: string
  total_score?: number
  metrics?: Record<string, unknown>
  batch_id?: string
  evaluated_at?: string
}

export async function getUpgradeReadiness(limit = 100): Promise<UpgradeReadinessRow[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('routing_decisions')
    .select('decision_id, brand_id, outcome, timestamp')
    .eq('flow_id', 'N8N-A05')
    .eq('request_type', 'upgrade_readiness')
    .order('timestamp', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as UpgradeReadinessRow[]).map((row) => {
    let parsed: Record<string, unknown> = {}
    try { parsed = typeof row.outcome === 'string' ? JSON.parse(row.outcome) : (row.outcome as Record<string, unknown>) ?? {} } catch { /* ignore */ }
    return {
      ...row,
      brand_name_ar: parsed.brand_name_ar as string | undefined,
      brand_name_en: parsed.brand_name_en as string | null | undefined,
      sector:        parsed.sector as string | undefined,
      readiness_tier: parsed.readiness_tier as string | undefined,
      total_score:   parsed.total_score as number | undefined,
      metrics:       parsed.metrics as Record<string, unknown> | undefined,
      batch_id:      parsed.batch_id as string | undefined,
      evaluated_at:  parsed.evaluated_at as string | undefined,
    }
  })
}

export async function getLatestUpgradeBatch(): Promise<string | null> {
  if (!isDbConfigured()) return null
  const { data } = await adminClient()
    .from('routing_decisions')
    .select('outcome')
    .eq('flow_id', 'N8N-A05')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single()
  if (!data) return null
  try {
    const parsed = JSON.parse((data as { outcome: string }).outcome)
    return (parsed.batch_id as string) ?? null
  } catch { return null }
}

// ─────────────────────────────────────────────────────────────────────
// Maintenance history — routing_decisions rows written by N8N-D02
// ─────────────────────────────────────────────────────────────────────

export interface MaintenanceRun {
  decision_id: string
  flow_id: string
  outcome: string  // JSON string containing the D02 report
  timestamp: string
}

export async function getMaintenanceHistory(limit = 20): Promise<MaintenanceRun[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('routing_decisions')
    .select('decision_id, flow_id, outcome, timestamp')
    .eq('flow_id', 'N8N-D02')
    .order('timestamp', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as MaintenanceRun[]
}

// ─────────────────────────────────────────────────────────────────────
// QA queue helpers — brand + user info needed by the approve/reject actions
// ─────────────────────────────────────────────────────────────────────

export interface BrandQaInfo {
  brand_id: string
  brand_name_ar: string
  auth_user_id: string | null
  user_email: string | null
}

/**
 * Fetch the brand name + auth user email for a qa_review_queue row.
 * Used by approveQaItem / rejectQaItem to populate email notifications.
 */
export async function getBrandForQa(brandId: string): Promise<BrandQaInfo | null> {
  if (!isDbConfigured()) return null
  const supabase = adminClient()

  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('brand_id, brand_name_ar, auth_user_id')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (!brand) return null

  let userEmail: string | null = null
  const authUserId = (brand as { auth_user_id?: string | null }).auth_user_id ?? null
  if (authUserId) {
    const { data: authData } = await supabase.auth.admin.getUserById(authUserId)
    userEmail = authData.user?.email ?? null
  }

  return {
    brand_id:      (brand as { brand_id: string }).brand_id,
    brand_name_ar: (brand as { brand_name_ar: string }).brand_name_ar,
    auth_user_id:  authUserId,
    user_email:    userEmail,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase B — Internal content release gate
//
// Posts with status='generated' have passed all 11 CEO triggers but have
// NOT yet been seen by OGZ admin. They must be released to status='pending'
// before the client calendar shows them. OGZ §5.4 — "Day -7 principle":
// every piece of AI-generated content is reviewed internally before clients
// see it, regardless of CCO score.
// ─────────────────────────────────────────────────────────────────────

export interface UnreleasedPost {
  post_id: string
  brand_id: string
  brand_name_ar: string
  client_slug: string
  calendar_id: string | null
  calendar_month: string | null
  position: number
  status: string
  content_type: string | null
  storage_url: string | null
  caption_ar: string | null
  posting_time: string | null
  created_at: string
}

export async function getUnreleasedPosts(limit = 300): Promise<UnreleasedPost[]> {
  if (!isDbConfigured()) return []
  const supabase = adminClient()
  const { data, error } = await supabase
    .from('calendar_posts')
    .select(`
      post_id, brand_id, calendar_id, position, status, content_type,
      storage_url, caption_ar, posting_time, created_at,
      brand_profiles!inner(brand_name_ar, client_slug),
      calendars(month)
    `)
    .eq('status', 'generated')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const bp = (row.brand_profiles ?? {}) as Record<string, unknown>
    const cal = (row.calendars ?? {}) as Record<string, unknown>
    return {
      post_id:        row.post_id as string,
      brand_id:       row.brand_id as string,
      brand_name_ar:  (bp.brand_name_ar as string) ?? '',
      client_slug:    (bp.client_slug as string) ?? '',
      calendar_id:    (row.calendar_id as string | null) ?? null,
      calendar_month: (cal.month as string | null) ?? null,
      position:       row.position as number,
      status:         row.status as string,
      content_type:   (row.content_type as string | null) ?? null,
      storage_url:    (row.storage_url as string | null) ?? null,
      caption_ar:     (row.caption_ar as string | null) ?? null,
      posting_time:   (row.posting_time as string | null) ?? null,
      created_at:     row.created_at as string,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────
// Calendar release gate — grouped view for /admin/qa
//
// Returns calendars that have ≥1 generated post, each with their full
// list of generated posts so the admin can review and approve per-calendar.
// ─────────────────────────────────────────────────────────────────────

export interface CalendarReleasePost {
  post_id: string
  position: number
  caption_ar: string | null
  posting_time: string | null
  route_decision: string | null
  confidence_score: number | null
  watermark: boolean
  content_type: string | null
  storage_url: string | null
}

export interface CalendarForRelease {
  calendar_id: string
  brand_id: string
  brand_name_ar: string
  client_slug: string
  month: string
  generated_posts: CalendarReleasePost[]
}

export async function getCalendarsForRelease(maxCalendars = 50): Promise<CalendarForRelease[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('calendar_posts')
    .select(`
      post_id, calendar_id, brand_id, position, caption_ar, posting_time,
      route_decision, confidence_score, watermark, content_type, storage_url,
      calendars!inner(month),
      brand_profiles!inner(brand_name_ar, client_slug)
    `)
    .in('status', ['generated', 'draft'])
    .order('posting_time', { ascending: true, nullsFirst: false })
    .limit(maxCalendars * 35)
  if (error) throw error

  const calMap = new Map<string, CalendarForRelease>()
  for (const _row of (data ?? []) as unknown[]) {
    const row = _row as Record<string, unknown>
    const calId = row.calendar_id as string
    if (!calId) continue
    const cal = (row.calendars ?? {}) as Record<string, unknown>
    const bp  = (row.brand_profiles ?? {}) as Record<string, unknown>
    if (!calMap.has(calId)) {
      calMap.set(calId, {
        calendar_id:    calId,
        brand_id:       row.brand_id as string,
        brand_name_ar:  (bp.brand_name_ar as string) ?? '',
        client_slug:    (bp.client_slug as string) ?? '',
        month:          (cal.month as string) ?? '',
        generated_posts: [],
      })
    }
    calMap.get(calId)!.generated_posts.push({
      post_id:          row.post_id as string,
      position:         row.position as number,
      caption_ar:       (row.caption_ar as string | null) ?? null,
      posting_time:     (row.posting_time as string | null) ?? null,
      route_decision:   (row.route_decision as string | null) ?? null,
      confidence_score: (row.confidence_score as number | null) ?? null,
      watermark:        !!(row.watermark as boolean),
      content_type:     (row.content_type as string | null) ?? null,
      storage_url:      (row.storage_url as string | null) ?? null,
    })
  }

  return Array.from(calMap.values())
    .sort((a, b) => a.month.localeCompare(b.month) || a.brand_name_ar.localeCompare(b.brand_name_ar, 'ar'))
    .slice(0, maxCalendars)
}

export async function getAdminUser(user_id: string): Promise<AdminUserRow | null> {
  if (!isDbConfigured()) return null
  const supabase = adminClient()
  const { data, error } = await supabase.auth.admin.getUserById(user_id)
  if (error || !data?.user) return null
  const u = data.user as {
    id: string
    email?: string | null
    email_confirmed_at?: string | null
    last_sign_in_at?: string | null
    created_at: string
    banned_until?: string | null
    is_anonymous?: boolean
    user_metadata?: { full_name?: string }
  }
  const { data: brands } = await supabase
    .from('brand_profiles')
    .select('brand_id, brand_name_ar, brand_name_en, client_slug, sector, onboarding_status, completeness_score, tier, created_at, logo_url')
    .eq('auth_user_id', user_id)
  return {
    user_id:           u.id,
    email:             u.email ?? null,
    full_name:         u.user_metadata?.full_name ?? null,
    email_confirmed_at: u.email_confirmed_at ?? null,
    last_sign_in_at:   u.last_sign_in_at ?? null,
    created_at:        u.created_at,
    banned_until:      u.banned_until ?? null,
    is_anonymous:      !!u.is_anonymous,
    brands:            (brands ?? []) as AdminUserBrand[],
  }
}

// ── Cost monitoring — new functions ──────────────────────────────────────

export async function getBrandMonthlySummaries(): Promise<BrandMonthlySummary[]> {
  if (!isDbConfigured()) return []
  const db = adminClient()

  // Fetch the brand spend view (not in generated types — cast via unknown)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: spendRows, error: spendErr } = await (db as any)
    .from('v_brand_monthly_spend')
    .select('brand_id, monthly_ceiling_usd, alert_at_pct, halt_at_pct, current_month_spend_usd, spend_pct, cost_status')
  if (spendErr) throw spendErr

  if (!spendRows || spendRows.length === 0) return []

  const brandIds = (spendRows as Array<{ brand_id: string }>).map((r) => r.brand_id)

  // Fetch brand profiles for names
  const { data: profiles, error: profErr } = await db
    .from('brand_profiles')
    .select('brand_id, brand_name_ar, brand_name_en, client_slug, sector, tier')
    .in('brand_id', brandIds)
  if (profErr) throw profErr

  // Fetch call counts + last call for current month (UTC boundary — avoids local-tz drift)
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const { data: logAgg, error: logErr } = await db
    .from('usage_logs')
    .select('brand_id, created_at')
    .in('brand_id', brandIds)
    .gte('created_at', monthStart)
  if (logErr) throw logErr

  const callCountMap = new Map<string, number>()
  const lastCallMap = new Map<string, string>()
  for (const row of (logAgg ?? []) as Array<{ brand_id: string; created_at: string }>) {
    if (!row.brand_id) continue
    callCountMap.set(row.brand_id, (callCountMap.get(row.brand_id) ?? 0) + 1)
    const existing = lastCallMap.get(row.brand_id)
    if (!existing || row.created_at > existing) lastCallMap.set(row.brand_id, row.created_at)
  }

  const profileMap = new Map<string, {
    brand_name_ar: string
    brand_name_en: string | null
    client_slug: string
    sector: string
    tier: string
  }>()
  for (const p of (profiles ?? []) as Array<{ brand_id: string; brand_name_ar: string; brand_name_en: string | null; client_slug: string; sector: string; tier: string }>) {
    profileMap.set(p.brand_id, p)
  }

  const result: BrandMonthlySummary[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (spendRows as unknown) as Array<{
    brand_id: string
    monthly_ceiling_usd: number
    current_month_spend_usd: number
    spend_pct: number
    cost_status: 'normal' | 'approaching' | 'critical' | 'breached'
  }>) {
    const profile = profileMap.get(row.brand_id)
    if (!profile) continue
    result.push({
      brand_id:               row.brand_id,
      brand_name_ar:          profile.brand_name_ar,
      brand_name_en:          profile.brand_name_en,
      client_slug:            profile.client_slug,
      sector:                 profile.sector,
      tier:                   profile.tier,
      monthly_ceiling_usd:    Number(row.monthly_ceiling_usd),
      current_month_spend_usd: Number(row.current_month_spend_usd),
      spend_pct:              Number(row.spend_pct),
      cost_status:            row.cost_status,
      call_count:             callCountMap.get(row.brand_id) ?? 0,
      last_call_at:           lastCallMap.get(row.brand_id) ?? null,
    })
  }

  return result.sort((a, b) => b.current_month_spend_usd - a.current_month_spend_usd)
}

export async function getBrandUsageLogs(brandId: string, limit = 200): Promise<UsageLog[]> {
  if (!isDbConfigured()) return []
  const { data, error } = await adminClient()
    .from('usage_logs')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as UsageLog[]
}

export interface BrandAllTimeStats {
  total_spend:  number
  total_calls:  number
  month_history: Array<{
    month_key: string   // 'YYYY-MM'
    spend:     number
    calls:     number
    ai_spend:  number
    image_spend: number
    video_spend: number
  }>
}

/** Aggregate all-time brand stats directly in DB — no row cap. */
export async function getBrandAllTimeStats(brandId: string): Promise<BrandAllTimeStats> {
  const empty: BrandAllTimeStats = { total_spend: 0, total_calls: 0, month_history: [] }
  if (!isDbConfigured()) return empty
  const { data, error } = await adminClient()
    .from('usage_logs')
    .select('created_at, cost_usd, request_type')
    .eq('brand_id', brandId)
  if (error || !data) return empty

  let total_spend = 0
  const monthMap = new Map<string, { spend: number; calls: number; ai: number; image: number; video: number }>()
  for (const r of data) {
    const cost = Number(r.cost_usd ?? 0)
    total_spend += cost
    const d   = new Date(r.created_at)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const cur = monthMap.get(key) ?? { spend: 0, calls: 0, ai: 0, image: 0, video: 0 }
    cur.spend += cost
    cur.calls += 1
    if (r.request_type === 'ai_cost')    cur.ai    += cost
    if (r.request_type === 'image_cost') cur.image += cost
    if (r.request_type === 'video_cost') cur.video += cost
    monthMap.set(key, cur)
  }

  const month_history = Array.from(monthMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month_key, v]) => ({
      month_key,
      spend:       v.spend,
      calls:       v.calls,
      ai_spend:    v.ai,
      image_spend: v.image,
      video_spend: v.video,
    }))

  return { total_spend, total_calls: data.length, month_history }
}

export async function getSystemMonthlySummary(): Promise<{
  total_spend_usd: number
  total_calls: number
  brands_active: number
  brands_approaching: number
  brands_critical: number
  brands_breached: number
  by_agent: Record<string, number>
  by_flow: Record<string, number>
  by_request_type: Record<string, number>
}> {
  const empty = {
    total_spend_usd: 0, total_calls: 0, brands_active: 0,
    brands_approaching: 0, brands_critical: 0, brands_breached: 0,
    by_agent: {} as Record<string, number>,
    by_flow: {} as Record<string, number>,
    by_request_type: {} as Record<string, number>,
  }
  if (!isDbConfigured()) return empty

  // Single RPC call — all aggregation done server-side in Postgres.
  // Avoids PGRST123 (PostgREST blocks aggregate functions on tables by default).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any).rpc('get_system_monthly_summary')
  if (error || !data) {
    console.error('[getSystemMonthlySummary] RPC error:', error)
    return empty
  }

  const r = data as {
    total_spend_usd: number; total_calls: number
    brands_active: number; brands_approaching: number
    brands_critical: number; brands_breached: number
    by_agent: Record<string, number>
    by_flow: Record<string, number>
    by_request_type: Record<string, number>
  }

  return {
    total_spend_usd:    Number(r.total_spend_usd   ?? 0),
    total_calls:        Number(r.total_calls        ?? 0),
    brands_active:      Number(r.brands_active      ?? 0),
    brands_approaching: Number(r.brands_approaching ?? 0),
    brands_critical:    Number(r.brands_critical    ?? 0),
    brands_breached:    Number(r.brands_breached    ?? 0),
    by_agent:           (r.by_agent        ?? {}) as Record<string, number>,
    by_flow:            (r.by_flow         ?? {}) as Record<string, number>,
    by_request_type:    (r.by_request_type ?? {}) as Record<string, number>,
  }
}

export async function getBrandCostConfig(brandId: string): Promise<BrandCostConfig | null> {
  if (!isDbConfigured()) return null
  // brand_cost_config not in generated types yet — cast via any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any)
    .from('brand_cost_config')
    .select('*')
    .eq('brand_id', brandId)
    .maybeSingle()
  if (error) throw error
  return (data as BrandCostConfig | null) ?? null
}

export async function upsertBrandCostConfig(config: {
  brand_id: string
  monthly_ceiling_usd: number
  tier: string
  alert_at_pct: number
  halt_at_pct: number
}): Promise<void> {
  if (!isDbConfigured()) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (adminClient() as any)
    .from('brand_cost_config')
    .upsert({ ...config, updated_at: new Date().toISOString() }, { onConflict: 'brand_id' })
  if (error) throw error
}

// ── System-wide cost config ───────────────────────────────────────────────────

const SYSTEM_COST_DEFAULTS: import('../types').SystemCostConfig = {
  monthly_ceiling_usd: 200,
  alert_at_pct: 70,
  halt_at_pct: 100,
}

export async function getSystemCostConfig(): Promise<import('../types').SystemCostConfig> {
  if (!isDbConfigured()) return SYSTEM_COST_DEFAULTS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any)
    .from('system_config')
    .select('value')
    .eq('key', 'cost')
    .maybeSingle()
  if (error || !data) return SYSTEM_COST_DEFAULTS
  const v = (data as { value: Record<string, unknown> }).value
  return {
    monthly_ceiling_usd: Number(v.monthly_ceiling_usd ?? 200),
    alert_at_pct:        Number(v.alert_at_pct ?? 70),
    halt_at_pct:         Number(v.halt_at_pct ?? 100),
  }
}

export async function upsertSystemCostConfig(config: import('../types').SystemCostConfig): Promise<void> {
  if (!isDbConfigured()) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (adminClient() as any)
    .from('system_config')
    .upsert(
      { key: 'cost', value: config, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
  if (error) throw error
}

export async function getMonthlyCostSummary(month: string): Promise<MonthlyCostSummary | null> {
  const empty: MonthlyCostSummary = {
    month, total_spend: 0, total_calls: 0,
    by_request_type: {}, by_agent: {}, by_flow: {}, brands: [],
  }
  if (!isDbConfigured()) return empty
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any).rpc('get_monthly_cost_summary', { p_month: month })
  if (error || !data) { console.error('[getMonthlyCostSummary]', error); return empty }
  const r = data as MonthlyCostSummary
  return {
    month:            r.month,
    total_spend:      Number(r.total_spend   ?? 0),
    total_calls:      Number(r.total_calls   ?? 0),
    by_request_type:  (r.by_request_type ?? {}) as Record<string, number>,
    by_agent:         (r.by_agent        ?? {}) as Record<string, number>,
    by_flow:          (r.by_flow         ?? {}) as Record<string, number>,
    brands:           (r.brands          ?? []) as MonthlyCostBrand[],
  }
}

export interface CostMonthOption {
  month_iso: string  // 'YYYY-MM-DD' (first of month, UTC)
  calls: number
  total_spend: number
}

export async function getAvailableCostMonths(): Promise<CostMonthOption[]> {
  if (!isDbConfigured()) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any).rpc('get_available_cost_months')
  if (error || !data) return []
  return (data as Array<{ month_iso: string; calls: string | number; total_spend: string | number }>).map(r => ({
    month_iso:    r.month_iso,
    calls:        Number(r.calls),
    total_spend:  Number(r.total_spend),
  }))
}

// ─────────────────────────────────────────────────────────────────────
// Calendar QA — grouped view for /admin/qa Calendar tab
//
// Groups qa_review_queue 'calendar' rows by their associated calendar_id
// so the admin can review and bulk-approve per calendar, not per post.
// ─────────────────────────────────────────────────────────────────────

export interface CalendarQaPostRow {
  queue_id: string
  post_id: string
  position: number
  caption_ar: string | null
  cco_score: number | null
  trigger_reason: string | null
  flags: Record<string, unknown>
  status: string
  /** Raw calendar_posts.status (e.g. 'failed_visual', 'pending_visual', 'clean')
   *  BEFORE display remapping — lets the UI distinguish a failed generation from a
   *  post still being prepared (both map to display-status 'pending'). */
  raw_status: string | null
  created_at: string
  // Enriched from calendar_posts (null for pre-image HOLDs where post_id is absent)
  visual_brief_en: string | null
  content_type: string | null
  format_tier: string | null
  chain_id: string | null
  route_decision: string | null
  confidence_score: number | null
  watermark: boolean | null
  hashtags: string[] | null
  storage_url: string | null
  clean_storage_url: string | null
  /** Original A01/V01-generated image, written once at generation, never overwritten by regen approvals. */
  original_storage_url: string | null
  original_clean_storage_url: string | null
  posting_time: string | null
  scheduled_date: string | null
  // DeepSeek / CCO rich fields
  caption_variants: Array<{ caption_ar: string; hashtags: string[]; tone: string }> | null
  selected_variant_index: number | null
  revision_count: number
  revision_history: unknown[]
  format: string | null
  channel: string | null
  media_type: string | null
  video_status: string | null
  video_duration_s: number | null
  generation_attempt: number
  last_error: string | null
  requires_human_review: boolean
  strategic_rationale: string | null
  occasion_flags: string[]
  ai_generated: boolean
  generation_model: string | null
  c2pa_signed: boolean
  /** EXACT positive prompt sent to fal (from c2pa_metadata.final_prompt) — what actually produced the image. */
  final_prompt: string | null
  /** EXACT negative prompt sent to fal (from c2pa_metadata.final_negative_prompt). */
  final_negative_prompt: string | null
  /** GPT-4o vision score (0-100) for the generated image. NULL until visual QC runs (migration 0117). */
  visual_score: number | null
  /** Structured visual issues from the visual QC pass — {code, label, severity, detail?}[] (migration 0117). */
  visual_issues: Array<{ code: string; label: string; severity: 'high' | 'med' | 'low'; detail?: string }> | null
}

export interface CalendarQaGroup {
  calendar_id: string
  brand_id: string
  month: string
  calendar_status: string
  brand_name_ar: string
  brand_name_en: string | null
  total_calendars_generated: number
  client_slug: string
  pending_count: number
  total_qa_count: number
  /** 1-indexed ordinal position of this calendar among ALL calendars for the brand, ordered by month. */
  calendar_sequence: number
  qa_items: CalendarQaPostRow[]
  /** 3-MONTH ROLLING: aggregate across ALL of this brand's calendars (not just the
   *  one shown). The brand card shows these so a 3-month brand reads its true totals
   *  (e.g. 60 posts / 60 pending across Jun+Jul+Aug), not a single month's count. */
  all_months: {
    months: Array<{ month: string; total: number; pending: number; released: number }>
    total: number
    pending: number
    released: number
  }
  // Brand profile enrichment for the brand grid card (View 1)
  sector: string | null
  tier: string | null
  logo_url: string | null
  brand_differentiator: string | null
  religious_sensitivity: string | null
  pipeline_tier: string | null
}

export async function getQaCalendarGroups(
  page: number = 1,
  pageSize: number = 10,
): Promise<{ groups: CalendarQaGroup[]; total: number }> {
  if (!isDbConfigured()) return { groups: [], total: 0 }
  const db = adminClient()

  // ── Step 1: discover brands needing review from TWO sources ──────────
  // Source A: pending calendar-kind qa_review_queue rows (held/watermark posts
  //   AND pre-image HOLDs with no post_id yet).
  // Source B: calendar_posts in a "needs admin decision" state but with NO queue
  //   row (auto-passed clean/watermark posts). Without this, an all-clean calendar
  //   would never appear in /admin/qa even though every post awaits approval.
  const classified = await loadClassifiedQa()
  const pending = classified.filter(
    (r) => r.qa_kind === 'calendar' && r.status === 'pending',
  )
  const queueBrandIds = pending.map((r) => r.brand_id).filter(Boolean) as string[]

  // Source B: any calendar_post awaiting an admin decision (image-bearing,
  // not yet approved/rejected). clean/watermark/held/pending_visual/processing.
  const REVIEWABLE_STATUSES = ['clean', 'watermark', 'held', 'pending_visual', 'visual_processing', 'video_processing', 'failed_visual']
  const { data: reviewablePosts } = await db
    .from('calendar_posts')
    .select('brand_id')
    .in('status', REVIEWABLE_STATUSES)
  const postBrandIds = ((reviewablePosts ?? []) as Array<{ brand_id: string }>).map((p) => p.brand_id)

  const brandIds = [...new Set([...queueBrandIds, ...postBrandIds])]
  if (brandIds.length === 0) return { groups: [], total: 0 }

  // ── Step 2: fetch each brand's most-recent non-delivered calendar ─────
  const { data: calRows, error } = await db
    .from('calendars')
    .select(`
      calendar_id, brand_id, month, status,
      brand_profiles!inner(brand_name_ar, brand_name_en, total_calendars_generated, client_slug, sector, tier, logo_url, brand_differentiator, religious_sensitivity, pipeline_tier)
    `)
    .in('brand_id', brandIds)
    .not('status', 'in', '("delivered","rejected")')
    .order('created_at', { ascending: false })
  if (error) throw error

  type CalInfo = {
    calendar_id: string
    brand_id: string
    month: string
    status: string
    brand_name_ar: string
    brand_name_en: string | null
    total_calendars_generated: number
    client_slug: string
    sector: string | null
    tier: string | null
    logo_url: string | null
    brand_differentiator: string | null
    religious_sensitivity: string | null
    pipeline_tier: string | null
  }
  // brand_id → most-recent active calendar (first hit after ordering desc)
  const brandCalMap = new Map<string, CalInfo>()
  // calendar_id → full info (covers ALL months, not just the most-recent per brand)
  const calIdInfoMap = new Map<string, CalInfo>()
  for (const _row of (calRows ?? []) as unknown[]) {
    const row = _row as Record<string, unknown>
    const bid = row.brand_id as string
    const bp = (row.brand_profiles ?? {}) as Record<string, unknown>
    const info: CalInfo = {
      calendar_id:               row.calendar_id as string,
      brand_id:                  bid,
      month:                     row.month as string,
      status:                    row.status as string,
      brand_name_ar:             (bp.brand_name_ar as string) ?? '',
      brand_name_en:             (bp.brand_name_en as string | null) ?? null,
      total_calendars_generated: (bp.total_calendars_generated as number) ?? 0,
      client_slug:               (bp.client_slug as string) ?? '',
      sector:                    (bp.sector as string | null) ?? null,
      tier:                      (bp.tier as string | null) ?? null,
      logo_url:                  (bp.logo_url as string | null) ?? null,
      brand_differentiator:      (bp.brand_differentiator as string | null) ?? null,
      religious_sensitivity:     (bp.religious_sensitivity as string | null) ?? null,
      pipeline_tier:             (bp.pipeline_tier as string | null) ?? null,
    }
    calIdInfoMap.set(info.calendar_id, info)
    if (!brandCalMap.has(bid)) brandCalMap.set(bid, info)  // first = most-recent (ordered desc)
  }

  // ── Step 2a: ALL-MONTHS aggregate per brand (3-month rolling) ────────
  // The card shows ONE calendar's qa_items, but a brand may have 3 months. Fetch
  // EVERY calendar for these brands + a status tally of their posts, so the card
  // can display true cross-month totals (e.g. 60 posts / 60 pending across 3 months).
  const allMonthsByBrand = new Map<string, CalendarQaGroup['all_months']>()
  {
    // All non-delivered calendars for these brands (id → {brand, month}).
    const { data: allCals } = await db
      .from('calendars')
      .select('calendar_id, brand_id, month')
      .in('brand_id', brandIds)
      .not('status', 'in', '("rejected")')
    const calMeta = new Map<string, { brand_id: string; month: string }>()
    for (const c of (allCals ?? []) as Array<{ calendar_id: string; brand_id: string; month: string }>) {
      calMeta.set(c.calendar_id, { brand_id: c.brand_id, month: c.month })
    }
    const allCalIds = [...calMeta.keys()]
    // One pass over those calendars' posts — status only (cheap).
    const postsByCal = new Map<string, { total: number; pending: number; released: number }>()
    if (allCalIds.length > 0) {
      const { data: allPosts } = await db
        .from('calendar_posts')
        .select('calendar_id, status')
        .in('calendar_id', allCalIds)
      const RELEASED = new Set(['released', 'approved', 'pending']) // pending(db)=released-to-client
      for (const p of (allPosts ?? []) as Array<{ calendar_id: string; status: string }>) {
        const agg = postsByCal.get(p.calendar_id) ?? { total: 0, pending: 0, released: 0 }
        agg.total++
        if (RELEASED.has(p.status)) agg.released++
        else agg.pending++ // still awaiting admin (clean/pending_visual/visual_processing/held/etc.)
        postsByCal.set(p.calendar_id, agg)
      }
    }
    // Roll up per brand → per month.
    for (const bid of brandIds) {
      const months: CalendarQaGroup['all_months']['months'] = []
      let total = 0, pending = 0, released = 0
      for (const [cid, meta] of calMeta) {
        if (meta.brand_id !== bid) continue
        const a = postsByCal.get(cid) ?? { total: 0, pending: 0, released: 0 }
        months.push({ month: meta.month, total: a.total, pending: a.pending, released: a.released })
        total += a.total; pending += a.pending; released += a.released
      }
      months.sort((x, y) => x.month.localeCompare(y.month))
      allMonthsByBrand.set(bid, { months, total, pending, released })
    }
  }

  // ── Step 2b: bulk-fetch calendar_posts detail for all post_ids ───────
  // Enriches each CalendarQaPostRow with visual_brief_en, chain_id, etc.
  // Pre-image HOLDs have no post_id — those fields remain null in the UI.
  const calendarPostIds = [
    ...new Set(pending.map((r) => r.post_id).filter((id): id is string => !!id)),
  ]
  type PostDetail = {
    post_id: string
    calendar_id: string
    position: number
    image_prompt_en: string | null
    content_type: string | null
    format_tier: string | null
    chain_id: string | null
    route_decision: string | null
    confidence_score: number | null
    watermark: boolean | null
    hashtags: string[] | null
    storage_url: string | null
    clean_storage_url: string | null
    original_storage_url: string | null
    original_clean_storage_url: string | null
    posting_time: string | null
    scheduled_date: string | null
    caption_variants: unknown | null
    selected_variant_index: number | null
    revision_count: number
    revision_history: unknown
    format: string | null
    channel: string | null
    media_type: string | null
    video_status: string | null
    video_duration_s: number | null
    generation_attempt: number
    last_error: string | null
    requires_human_review: boolean
    strategic_rationale: string | null
    occasion_flags: string[]
    ai_generated: boolean
    generation_model: string | null
    c2pa_signed: boolean
    final_prompt: string | null
    final_negative_prompt: string | null
    negpat_flag: string | null
    dialect_flag: boolean
    cultural_flag: boolean
    brave_route_flag: boolean
    cco_issues: unknown[]
    method_adherence_score: number | null
    visual_score: number | null
    visual_issues: Array<{ code: string; label: string; severity: 'high' | 'med' | 'low'; detail?: string }>
    flags: Record<string, unknown> | null
  }
  const postDetailMap = new Map<string, PostDetail>()
  if (calendarPostIds.length > 0) {
    const { data: postRows } = await db
      .from('calendar_posts')
      .select([
        'post_id, calendar_id, position, image_prompt_en, content_type, format_tier, chain_id',
        'route_decision, confidence_score, watermark, hashtags, storage_url, clean_storage_url, original_storage_url, original_clean_storage_url',
        'posting_time, scheduled_date, caption_variants, selected_variant_index',
        'revision_count, revision_history, format, channel, media_type',
        'video_status, video_duration_s, generation_attempt, last_error',
        'requires_human_review, strategic_rationale, occasion_flags',
        'ai_generated, generation_model, c2pa_signed, c2pa_metadata',
        'negpat_flag, dialect_flag, cultural_flag, brave_route_flag, cco_issues, method_adherence_score',
        'visual_score, visual_issues',
        'flags',
      ].join(', '))
      .in('post_id', calendarPostIds)
    for (const _p of (postRows ?? []) as unknown[]) {
      const p = _p as Record<string, unknown>
      postDetailMap.set(p.post_id as string, {
        post_id:                p.post_id as string,
        calendar_id:            p.calendar_id as string,
        position:               (p.position as number) ?? 0,
        image_prompt_en:        (p.image_prompt_en as string | null) ?? null,
        content_type:           (p.content_type as string | null) ?? null,
        format_tier:            (p.format_tier as string | null) ?? null,
        chain_id:               (p.chain_id as string | null) ?? null,
        route_decision:         (p.route_decision as string | null) ?? null,
        confidence_score:       (p.confidence_score as number | null) ?? null,
        watermark:              (p.watermark as boolean | null) ?? null,
        hashtags:               (p.hashtags as string[] | null) ?? null,
        storage_url:                (p.storage_url as string | null) ?? null,
        clean_storage_url:          (p.clean_storage_url as string | null) ?? null,
        original_storage_url:       (p.original_storage_url as string | null) ?? null,
        original_clean_storage_url: (p.original_clean_storage_url as string | null) ?? null,
        posting_time:           (p.posting_time as string | null) ?? null,
        scheduled_date:         (p.scheduled_date as string | null) ?? null,
        caption_variants:       (p.caption_variants as unknown | null) ?? null,
        selected_variant_index: (p.selected_variant_index as number | null) ?? null,
        revision_count:         (p.revision_count as number) ?? 0,
        revision_history:       (p.revision_history as unknown[]) ?? [],
        format:                 (p.format as string | null) ?? null,
        channel:                (p.channel as string | null) ?? null,
        media_type:             (p.media_type as string | null) ?? null,
        video_status:           (p.video_status as string | null) ?? null,
        video_duration_s:       (p.video_duration_s as number | null) ?? null,
        generation_attempt:     (p.generation_attempt as number) ?? 0,
        last_error:             (p.last_error as string | null) ?? null,
        requires_human_review:  (p.requires_human_review as boolean) ?? false,
        strategic_rationale:    (p.strategic_rationale as string | null) ?? null,
        occasion_flags:         (p.occasion_flags as string[]) ?? [],
        ai_generated:           (p.ai_generated as boolean) ?? true,
        generation_model:       (p.generation_model as string | null) ?? null,
        c2pa_signed:            (p.c2pa_signed as boolean) ?? false,
        final_prompt:           ((p.c2pa_metadata as Record<string, unknown> | null)?.final_prompt as string | null) ?? null,
        final_negative_prompt:  ((p.c2pa_metadata as Record<string, unknown> | null)?.final_negative_prompt as string | null) ?? null,
        // CCO structured signals (mig 0111) for the "why this score" panel.
        negpat_flag:            (p.negpat_flag as string | null) ?? 'NONE',
        dialect_flag:           (p.dialect_flag as boolean) ?? false,
        cultural_flag:          (p.cultural_flag as boolean) ?? false,
        brave_route_flag:       (p.brave_route_flag as boolean) ?? false,
        cco_issues:             Array.isArray(p.cco_issues) ? (p.cco_issues as unknown[]) : [],
        method_adherence_score: (p.method_adherence_score as number | null) ?? null,
        // Visual scoring (mig 0117)
        visual_score:           (p.visual_score as number | null) ?? null,
        visual_issues:          Array.isArray(p.visual_issues) ? (p.visual_issues as Array<{ code: string; label: string; severity: 'high' | 'med' | 'low'; detail?: string }>) : [],
        // Pillar scores from confidence-gate (mig: written to calendar_posts.flags)
        flags:                  (p.flags as Record<string, unknown> | null) ?? null,
      })
    }
  }

  // ── Step 3: group QA items by brand (ONE card per brand, all months merged) ──
  // Key by brand_id so a 3-month rolling calendar (3 calendar rows) produces a
  // single card showing all months, not 3 duplicate brand cards.
  // calendar_id on the group = the brand's most-recent calendar (used for the
  // brand-detail page link); all months' posts are merged into qa_items.
  const calGroupMap = new Map<string, CalendarQaGroup>()
  for (const qaItem of pending) {
    const calInfo = brandCalMap.get(qaItem.brand_id)
    if (!calInfo) continue

    const bid = qaItem.brand_id
    if (!calGroupMap.has(bid)) {
      calGroupMap.set(bid, {
        calendar_id:               calInfo.calendar_id,  // latest calendar for detail-page link
        brand_id:                  bid,
        month:                     calInfo.month,
        calendar_status:           calInfo.status,
        brand_name_ar:             calInfo.brand_name_ar,
        brand_name_en:             calInfo.brand_name_en,
        total_calendars_generated: calInfo.total_calendars_generated,
        client_slug:               calInfo.client_slug,
        pending_count:             0,
        total_qa_count:            0,
        calendar_sequence:         calInfo.total_calendars_generated + 1,
        qa_items:                  [],
        all_months:                allMonthsByBrand.get(bid) ?? { months: [], total: 0, pending: 0, released: 0 },
        sector:                    calInfo.sector,
        tier:                      calInfo.tier,
        logo_url:                  calInfo.logo_url,
        brand_differentiator:      calInfo.brand_differentiator,
        religious_sensitivity:     calInfo.religious_sensitivity,
        pipeline_tier:             calInfo.pipeline_tier,
      })
    }

    const postDetail = qaItem.post_id ? (postDetailMap.get(qaItem.post_id) ?? null) : null
    const group = calGroupMap.get(bid)!
    group.total_qa_count++
    group.pending_count++
    // Parse caption_variants from DB JSON
    const rawVariants = postDetail?.caption_variants
    const parsedVariants = Array.isArray(rawVariants)
      ? (rawVariants as Array<{ caption_ar: string; hashtags: string[]; tone: string }>)
      : null

    group.qa_items.push({
      queue_id:               qaItem.queue_id,
      post_id:                qaItem.post_id ?? '',
      position:               postDetail?.position ?? 0,
      caption_ar:             qaItem.caption_ar ?? null,
      cco_score:              qaItem.cco_score ?? null,
      trigger_reason:         qaItem.trigger_reason ?? null,
      // CCO signals from calendar_posts (mig 0111) UNDER the live queue flags,
      // so the "why this score" panel has the full issues[] + flags even when
      // the queue row only stored a subset. calendar_posts.flags JSONB is spread
      // second so pillars (written by confidence-gate) flow to the UI.
      flags:                  {
        ...(postDetail ? {
          negpat_flag:      postDetail.negpat_flag,
          dialect_flag:     postDetail.dialect_flag,
          cultural_flag:    postDetail.cultural_flag,
          brave_route_flag: postDetail.brave_route_flag,
          issues:           postDetail.cco_issues,
          method_adherence_score: postDetail.method_adherence_score,
        } : {}),
        ...((postDetail?.flags as Record<string, unknown>) ?? {}),
        ...((qaItem.flags as Record<string, unknown>) ?? {}),
      },
      status:                 qaItem.status as string,
      raw_status:             (qaItem.status as string | null) ?? null,
      created_at:             qaItem.created_at,
      visual_brief_en:        postDetail?.image_prompt_en ?? null,
      content_type:           postDetail?.content_type ?? null,
      format_tier:            postDetail?.format_tier ?? null,
      chain_id:               postDetail?.chain_id ?? null,
      route_decision:         postDetail?.route_decision ?? null,
      confidence_score:       postDetail?.confidence_score ?? null,
      watermark:              postDetail?.watermark ?? null,
      hashtags:               postDetail?.hashtags ?? null,
      storage_url:                postDetail?.storage_url ?? null,
      clean_storage_url:          postDetail?.clean_storage_url ?? null,
      original_storage_url:       postDetail?.original_storage_url ?? null,
      original_clean_storage_url: postDetail?.original_clean_storage_url ?? null,
      posting_time:           postDetail?.posting_time ?? null,
      scheduled_date:         postDetail?.scheduled_date ?? null,
      caption_variants:       parsedVariants,
      selected_variant_index: postDetail?.selected_variant_index ?? null,
      revision_count:         postDetail?.revision_count ?? 0,
      revision_history:       (postDetail?.revision_history as unknown[]) ?? [],
      format:                 postDetail?.format ?? null,
      channel:                postDetail?.channel ?? null,
      media_type:             postDetail?.media_type ?? null,
      video_status:           postDetail?.video_status ?? null,
      video_duration_s:       postDetail?.video_duration_s ?? null,
      generation_attempt:     postDetail?.generation_attempt ?? 0,
      last_error:             postDetail?.last_error ?? null,
      requires_human_review:  postDetail?.requires_human_review ?? false,
      strategic_rationale:    postDetail?.strategic_rationale ?? null,
      occasion_flags:         postDetail?.occasion_flags ?? [],
      ai_generated:           postDetail?.ai_generated ?? true,
      generation_model:       postDetail?.generation_model ?? null,
      final_prompt:           postDetail?.final_prompt ?? null,
      final_negative_prompt:  postDetail?.final_negative_prompt ?? null,
      c2pa_signed:            postDetail?.c2pa_signed ?? false,
      visual_score:           postDetail?.visual_score ?? null,
      visual_issues:          postDetail?.visual_issues ?? null,
    })
  }

  // ── Step 3b: ensure every discovered brand's calendar has a group ────
  // Source-B brands (all-clean calendars with NO pending queue row) never entered
  // the loop above (it iterates queue rows). Create empty groups for them here so
  // Step 3c can fill their posts — otherwise an all-clean calendar stays invisible.
  for (const [bid, calInfo] of brandCalMap) {
    if (calGroupMap.has(bid)) continue  // already created by Step 3
    calGroupMap.set(bid, {
      calendar_id:               calInfo.calendar_id,
      brand_id:                  bid,
      month:                     calInfo.month,
      calendar_status:           calInfo.status,
      brand_name_ar:             calInfo.brand_name_ar,
      brand_name_en:             calInfo.brand_name_en,
      total_calendars_generated: calInfo.total_calendars_generated,
      client_slug:               calInfo.client_slug,
      pending_count:             0,
      total_qa_count:            0,
      calendar_sequence:         calInfo.total_calendars_generated + 1,
      qa_items:                  [],
      all_months:                allMonthsByBrand.get(bid) ?? { months: [], total: 0, pending: 0, released: 0 },
      sector:                    calInfo.sector,
      tier:                      calInfo.tier,
      logo_url:                  calInfo.logo_url,
      brand_differentiator:      calInfo.brand_differentiator,
      religious_sensitivity:     calInfo.religious_sensitivity,
      pipeline_tier:             calInfo.pipeline_tier,
    })
  }

  // ── Step 3c: merge in ALL calendar_posts so auto-passed (clean/watermark)
  // posts surface as filled slots, not empty. The QA queue only holds posts that
  // need human review (HOLD/WATERMARK); clean high-score posts have NO queue row,
  // so without this they'd show as empty slots with their generated image hidden.
  // We append one synthetic qa_item per post that isn't already represented by a
  // queue row (dedup by post_id), with a display status derived from the post.
  // groupCalIds = ALL calendar IDs for the brands in our group map (keys are brand IDs).
  const groupBrandIds = [...calGroupMap.keys()]
  const groupCalIds = [...calIdInfoMap.keys()].filter(
    (cid) => { const info = calIdInfoMap.get(cid); return info ? groupBrandIds.includes(info.brand_id) : false }
  )
  if (groupCalIds.length > 0) {
    const { data: allPosts } = await db
      .from('calendar_posts')
      .select([
        'post_id, calendar_id, position, caption_ar, hashtags, content_type',
        'route_decision, confidence_score, cco_score, watermark, status',
        'storage_url, clean_storage_url, original_storage_url, original_clean_storage_url, posting_time, scheduled_date',
        'image_prompt_en, format_tier, chain_id, format, channel, media_type',
        'video_status, video_duration_s, generation_attempt, last_error',
        'caption_variants, selected_variant_index, revision_count, revision_history',
        'requires_human_review, strategic_rationale, occasion_flags',
        'ai_generated, generation_model, c2pa_signed, c2pa_metadata',
        'negpat_flag, dialect_flag, cultural_flag, brave_route_flag, cco_issues, method_adherence_score',
        'visual_score, visual_issues',
        'flags',
      ].join(', '))
      .in('calendar_id', groupCalIds)
    // Map calendar_posts.status → QA display status.
    // CRITICAL: only an ADMIN decision shows a green/red badge. Auto-generation
    // states (clean/watermark/generated) are "awaiting review" → pending (NO tick).
    //   'approved' (admin clicked Approve)  → approved  (green ✓)
    //   'rejected' (admin clicked Reject)   → rejected  (red ✗)
    //   everything else (clean/watermark/generated/held/hard_blocked/failed/…) → pending
    const toDisplayStatus = (s: string | null): string => {
      switch (s) {
        case 'approved':     return 'approved'   // CLIENT approved → green ✓
        case 'rejected':     return 'rejected'   // admin/client rejected → red ✗
        case 'hard_blocked': return 'blocked'    // SYSTEM compliance block (not an admin decision) → distinct grey/locked
        case 'pending':      return 'released'    // admin released → awaiting CLIENT approval → blue
        default:             return 'pending'     // clean/watermark/held/etc → awaiting admin review
      }
    }
    for (const _p of (allPosts ?? []) as unknown[]) {
      const p = _p as Record<string, unknown>
      const calId = p.calendar_id as string
      const group = calGroupMap.get(calId)
      if (!group) continue
      const pid = p.post_id as string
      // Skip posts already represented by a pending queue row (they're in qa_items).
      if (group.qa_items.some((q) => q.post_id === pid)) continue
      const rawVariants = p.caption_variants
      const parsedVariants = Array.isArray(rawVariants)
        ? (rawVariants as Array<{ caption_ar: string; hashtags: string[]; tone: string }>)
        : null
      group.qa_items.push({
        // No queue row exists — route by raw post_id (the detail page matches
        // `queue_id === postId || post_id === postId`). Avoid a `post:` prefix so
        // the colon never breaks the URL path / route matching.
        queue_id:               pid,
        post_id:                pid,
        position:               (p.position as number) ?? 0,
        caption_ar:             (p.caption_ar as string | null) ?? null,
        cco_score:              (p.cco_score as number | null) ?? (p.confidence_score as number | null) ?? null,
        trigger_reason:         null,
        // CCO signals (mig 0111) so auto-passed (clean/high-score) posts ALSO
        // carry the issues[] + flags the "why this score" panel reads — this is
        // the common case the panel previously had no data for. calendar_posts.flags
        // JSONB spread last to surface pillars written by confidence-gate.
        flags:                  {
          negpat_flag:      p.negpat_flag,
          dialect_flag:     p.dialect_flag,
          cultural_flag:    p.cultural_flag,
          brave_route_flag: p.brave_route_flag,
          issues:           Array.isArray(p.cco_issues) ? p.cco_issues : [],
          method_adherence_score: (p.method_adherence_score as number | null) ?? null,
          ...((p.flags as Record<string, unknown>) ?? {}),
        },
        status:                 toDisplayStatus(p.status as string | null),
        raw_status:             (p.status as string | null) ?? null,
        created_at:             (p.posting_time as string | null) ?? '',
        visual_brief_en:        (p.image_prompt_en as string | null) ?? null,
        content_type:           (p.content_type as string | null) ?? null,
        format_tier:            (p.format_tier as string | null) ?? null,
        chain_id:               (p.chain_id as string | null) ?? null,
        route_decision:         (p.route_decision as string | null) ?? null,
        confidence_score:       (p.confidence_score as number | null) ?? null,
        watermark:              (p.watermark as boolean | null) ?? null,
        hashtags:               (p.hashtags as string[] | null) ?? null,
        storage_url:                (p.storage_url as string | null) ?? null,
        clean_storage_url:          (p.clean_storage_url as string | null) ?? null,
        original_storage_url:       (p.original_storage_url as string | null) ?? null,
        original_clean_storage_url: (p.original_clean_storage_url as string | null) ?? null,
        posting_time:           (p.posting_time as string | null) ?? null,
        scheduled_date:         (p.scheduled_date as string | null) ?? null,
        caption_variants:       parsedVariants,
        selected_variant_index: (p.selected_variant_index as number | null) ?? null,
        revision_count:         (p.revision_count as number) ?? 0,
        revision_history:       (p.revision_history as unknown[]) ?? [],
        format:                 (p.format as string | null) ?? null,
        channel:                (p.channel as string | null) ?? null,
        media_type:             (p.media_type as string | null) ?? null,
        video_status:           (p.video_status as string | null) ?? null,
        video_duration_s:       (p.video_duration_s as number | null) ?? null,
        generation_attempt:     (p.generation_attempt as number) ?? 0,
        last_error:             (p.last_error as string | null) ?? null,
        requires_human_review:  (p.requires_human_review as boolean) ?? false,
        strategic_rationale:    (p.strategic_rationale as string | null) ?? null,
        occasion_flags:         (p.occasion_flags as string[]) ?? [],
        ai_generated:           (p.ai_generated as boolean) ?? true,
        generation_model:       (p.generation_model as string | null) ?? null,
        c2pa_signed:            (p.c2pa_signed as boolean) ?? false,
        final_prompt:           ((p.c2pa_metadata as Record<string, unknown> | null)?.final_prompt as string | null) ?? null,
        final_negative_prompt:  ((p.c2pa_metadata as Record<string, unknown> | null)?.final_negative_prompt as string | null) ?? null,
        visual_score:           (p.visual_score as number | null) ?? null,
        visual_issues:          Array.isArray(p.visual_issues) ? (p.visual_issues as Array<{ code: string; label: string; severity: 'high' | 'med' | 'low'; detail?: string }>) : [],
      })
      // total_qa_count reflects all posts shown; pending_count stays queue-only.
      group.total_qa_count++
    }
  }

  // ── Step 4: drop empty groups, sort, paginate, return ─────────────────
  // A group with zero qa_items (e.g. a Source-B calendar whose only posts are
  // hard_blocked, which we don't surface for review) is noise — omit it.
  const allGroups = Array.from(calGroupMap.values())
    .filter((g) => g.qa_items.length > 0)
    .sort((a, b) => a.month.localeCompare(b.month))
  const total = allGroups.length
  const groups = allGroups.slice((page - 1) * pageSize, page * pageSize)
  return { groups, total }
}

// ─────────────────────────────────────────────────────────────────────
// On-Demand QA — grouped view for /admin/qa On-Demand tab
//
// Mirrors the Calendar tab's brand-grid UX: instead of a flat list of
// on-demand QA rows, group them by brand so the admin sees one card per
// brand (with a live pending count) and drills into a per-brand workspace.
// Each item is the SAME enriched QaQueueItem the flat cards already used —
// no information is lost, only re-organised.
// ─────────────────────────────────────────────────────────────────────

export interface OnDemandQaGroup {
  brand_id: string
  brand_name_ar: string
  brand_name_en: string | null
  sector: string | null
  pipeline_tier: string | null
  primary_channel: string | null
  arabic_dialect: string | null
  client_slug: string | null
  logo_url: string | null
  /** Items still awaiting review — drives the "new items" badge on the brand card. */
  pending_count: number
  approved_count: number
  rejected_count: number
  total_count: number
  /** Pending items that hit a HARD_BLOCK negative pattern (surfaced first). */
  hard_block_count: number
  /** Most-recent item created_at across the brand — used for group ordering. */
  latest_created_at: string
  /** All enriched on-demand QA rows for the brand, hard-block→pending→newest first. */
  items: QaQueueItem[]
}

function isOnDemandHardBlock(r: QaQueueItem): boolean {
  const f = r.flags as Record<string, unknown> | null
  return (
    r.status === 'pending' &&
    ((f?.negpat_flag === 'HARD_BLOCK') ||
      (r.trigger_reason ?? '').includes('hard_block_negative_pattern'))
  )
}

/**
 * Group all on-demand QA rows by brand. Returns one {@link OnDemandQaGroup} per
 * brand, paginated. The On-Demand backlog is bounded by {@link QA_SCAN_LIMIT},
 * so enriching every row (media + brief + chain + regenerations) is safe.
 */
export async function getQaOnDemandGroups(
  page: number = 1,
  pageSize: number = 10,
): Promise<{ groups: OnDemandQaGroup[]; total: number }> {
  if (!isDbConfigured()) return { groups: [], total: 0 }

  const classified = await loadClassifiedQa()
  const onDemand = classified.filter((r) => r.qa_kind === 'on_demand')
  if (onDemand.length === 0) return { groups: [], total: 0 }

  // Same enrichment the flat on-demand cards used — media, brief, chain, drafts.
  const enriched = await enrichOnDemandRows(onDemand)

  const map = new Map<string, OnDemandQaGroup>()
  for (const item of enriched) {
    const bid = item.brand_id
    let group = map.get(bid)
    if (!group) {
      const b = item.brand ?? null
      group = {
        brand_id:        bid,
        brand_name_ar:   b?.brand_name_ar ?? '',
        brand_name_en:   b?.brand_name_en ?? null,
        sector:          (b?.sector as string | null) ?? null,
        pipeline_tier:   (b?.pipeline_tier as string | null) ?? null,
        primary_channel: (b?.primary_channel as string | null) ?? null,
        arabic_dialect:  (b?.arabic_dialect as string | null) ?? null,
        client_slug:     b?.client_slug ?? null,
        logo_url:        b?.logo_url ?? null,
        pending_count:   0,
        approved_count:  0,
        rejected_count:  0,
        total_count:     0,
        hard_block_count: 0,
        latest_created_at: item.created_at,
        items:           [],
      }
      map.set(bid, group)
    }
    group.items.push(item)
    group.total_count++
    if (item.status === 'pending') group.pending_count++
    else if (item.status === 'approved') group.approved_count++
    else if (item.status === 'rejected') group.rejected_count++
    if (isOnDemandHardBlock(item)) group.hard_block_count++
    if (item.created_at > group.latest_created_at) group.latest_created_at = item.created_at
  }

  // Within each brand: hard-block pending → pending → newest first.
  for (const group of map.values()) {
    group.items.sort((a, b) => {
      const ah = isOnDemandHardBlock(a) ? 1 : 0
      const bh = isOnDemandHardBlock(b) ? 1 : 0
      if (ah !== bh) return bh - ah
      const ap = a.status === 'pending' ? 1 : 0
      const bp = b.status === 'pending' ? 1 : 0
      if (ap !== bp) return bp - ap
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }

  // Across brands: those with pending work first, then most-recent activity.
  const allGroups = [...map.values()].sort((a, b) => {
    const ap = a.pending_count > 0 ? 1 : 0
    const bp = b.pending_count > 0 ? 1 : 0
    if (ap !== bp) return bp - ap
    return b.latest_created_at.localeCompare(a.latest_created_at)
  })

  const total = allGroups.length
  const groups = allGroups.slice((page - 1) * pageSize, page * pageSize)
  return { groups, total }
}

/**
 * Cheap per-month review counts for a brand's month switcher (3-month rolling).
 * Returns one entry per calendar/month the brand has, with total + how many posts
 * still await an admin decision (not released/approved/rejected/hard_blocked).
 * Head-only counts — does NOT load post bodies, so it stays fast even with 3
 * months × 20 posts. Backs the count badges on every month tab.
 */
export async function getBrandMonthQaCounts(
  brandId: string,
): Promise<Array<{ month: string; total: number; pending: number }>> {
  if (!isDbConfigured()) return []
  const db = adminClient()
  const { data: cals } = await db
    .from('calendars')
    .select('calendar_id, month')
    .eq('brand_id', brandId)
    .order('month', { ascending: true })
  const rows = (cals ?? []) as Array<{ calendar_id: string; month: string }>
  if (rows.length === 0) return []

  // Decided = no longer awaiting the admin: released/approved/rejected/hard_blocked.
  const DECIDED = ['released', 'approved', 'rejected', 'hard_blocked']
  const out: Array<{ month: string; total: number; pending: number }> = []
  for (const c of rows) {
    const totalRes = await db
      .from('calendar_posts')
      .select('post_id', { count: 'exact', head: true })
      .eq('calendar_id', c.calendar_id)
    const pendingRes = await db
      .from('calendar_posts')
      .select('post_id', { count: 'exact', head: true })
      .eq('calendar_id', c.calendar_id)
      .not('status', 'in', `(${DECIDED.join(',')})`)
    out.push({ month: c.month, total: totalRes.count ?? 0, pending: pendingRes.count ?? 0 })
  }
  return out
}

/**
 * Load ALL posts for one brand+month as CalendarQaPostRow[] — backs the admin
 * brand-page month/year switcher. Unlike getQaCalendarGroups (which pivots on
 * pending queue rows and only surfaces the latest calendar), this returns every
 * post of the chosen month regardless of QA state, with pending queue rows
 * merged in so review flags/triggers still show. Returns [] if no calendar.
 */
export async function getCalendarMonthQaItems(
  brandId: string,
  month: string,
): Promise<CalendarQaPostRow[]> {
  if (!isDbConfigured()) return []
  const db = adminClient()

  const { data: cal } = await db
    .from('calendars')
    .select('calendar_id')
    .eq('brand_id', brandId)
    .eq('month', month)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const calendarId = (cal as { calendar_id?: string } | null)?.calendar_id
  if (!calendarId) return []

  const { data: postRows } = await db
    .from('calendar_posts')
    .select([
      'post_id, position, caption_ar, hashtags, content_type, image_prompt_en',
      'format_tier, chain_id, route_decision, confidence_score, cco_score, watermark',
      'storage_url, clean_storage_url, original_storage_url, original_clean_storage_url, posting_time, scheduled_date, status',
      'caption_variants, selected_variant_index, revision_count, revision_history',
      'format, channel, media_type, video_status, video_duration_s',
      'generation_attempt, last_error, requires_human_review, strategic_rationale',
      'occasion_flags, ai_generated, generation_model, c2pa_signed, c2pa_metadata',
      // CCO structured signals (migration 0111) — the "why this score" data.
      'negpat_flag, dialect_flag, cultural_flag, brave_route_flag, cco_issues, method_adherence_score',
      // Visual scoring (migration 0117) — image pillar score + issues for admin QA.
      'visual_score, visual_issues',
      // Pillar scores from confidence-gate (written to calendar_posts.flags JSONB).
      'flags',
    ].join(', '))
    .eq('calendar_id', calendarId)
    .order('position', { ascending: true })

  // Pending queue rows for this brand keyed by post_id (adds trigger/flags state).
  const { data: queueRows } = await db
    .from('qa_review_queue')
    .select('queue_id, post_id, trigger_reason, flags, status, cco_score, created_at')
    .eq('brand_id', brandId)
    .not('post_id', 'is', null)
  const queueByPost = new Map<string, Record<string, unknown>>()
  for (const _q of (queueRows ?? []) as unknown[]) {
    const q = _q as Record<string, unknown>
    queueByPost.set(q.post_id as string, q)
  }

  // Only an admin decision earns a green/red badge — auto-generation states are
  // "awaiting review" → pending. hard_blocked = compliance fail → red (can never
  // reach the client). 'pending' (raw) = admin RELEASED the post → client is now
  // reviewing it → 'released'. (See getQaCalendarGroups Step 3c for rationale.)
  const toDisplayStatus = (s: string | null): string => {
    switch (s) {
      case 'approved':     return 'approved'
      case 'rejected':     return 'rejected'
      case 'hard_blocked': return 'blocked'   // system compliance block, not admin rejection
      case 'pending':      return 'released'  // admin released → awaiting CLIENT approval
      default:             return 'pending'
    }
  }

  const items: CalendarQaPostRow[] = []
  for (const _p of (postRows ?? []) as unknown[]) {
    const p = _p as Record<string, unknown>
    const pid = p.post_id as string
    const q = queueByPost.get(pid)
    const rawVariants = p.caption_variants
    const parsedVariants = Array.isArray(rawVariants)
      ? (rawVariants as Array<{ caption_ar: string; hashtags: string[]; tone: string }>)
      : null
    // A pending queue row wins the status (needs review); else derive from post.
    const status = q && q.status === 'pending' ? 'pending' : toDisplayStatus(p.status as string | null)
    items.push({
      queue_id:               (q?.queue_id as string) ?? pid,
      post_id:                pid,
      position:               (p.position as number) ?? 0,
      caption_ar:             (p.caption_ar as string | null) ?? null,
      cco_score:              (q?.cco_score as number | null) ?? (p.cco_score as number | null) ?? (p.confidence_score as number | null) ?? null,
      trigger_reason:         (q?.trigger_reason as string | null) ?? null,
      // Merge the CCO's structured signals (now persisted on calendar_posts, mig
      // 0111) UNDER the queue flags, so EVERY post — not just held ones — carries
      // the issues[] + compliance flags the QA "why this score" panel reads.
      // calendar_posts.flags JSONB is spread second to surface pillars from
      // confidence-gate. Queue row's flags win last (live review state).
      flags:                  {
        negpat_flag:      p.negpat_flag,
        dialect_flag:     p.dialect_flag,
        cultural_flag:    p.cultural_flag,
        brave_route_flag: p.brave_route_flag,
        issues:           Array.isArray(p.cco_issues) ? p.cco_issues : [],
        method_adherence_score: (p.method_adherence_score as number | null) ?? null,
        ...((p.flags as Record<string, unknown>) ?? {}),
        ...((q?.flags as Record<string, unknown>) ?? {}),
      },
      status,
      raw_status:             (p.status as string | null) ?? null,
      created_at:             (q?.created_at as string) ?? (p.posting_time as string | null) ?? '',
      visual_brief_en:        (p.image_prompt_en as string | null) ?? null,
      content_type:           (p.content_type as string | null) ?? null,
      format_tier:            (p.format_tier as string | null) ?? null,
      chain_id:               (p.chain_id as string | null) ?? null,
      route_decision:         (p.route_decision as string | null) ?? null,
      confidence_score:       (p.confidence_score as number | null) ?? null,
      watermark:              (p.watermark as boolean | null) ?? null,
      hashtags:               (p.hashtags as string[] | null) ?? null,
      storage_url:                (p.storage_url as string | null) ?? null,
      clean_storage_url:          (p.clean_storage_url as string | null) ?? null,
      original_storage_url:       (p.original_storage_url as string | null) ?? null,
      original_clean_storage_url: (p.original_clean_storage_url as string | null) ?? null,
      posting_time:           (p.posting_time as string | null) ?? null,
      scheduled_date:         (p.scheduled_date as string | null) ?? null,
      caption_variants:       parsedVariants,
      selected_variant_index: (p.selected_variant_index as number | null) ?? null,
      revision_count:         (p.revision_count as number) ?? 0,
      revision_history:       (p.revision_history as unknown[]) ?? [],
      format:                 (p.format as string | null) ?? null,
      channel:                (p.channel as string | null) ?? null,
      media_type:             (p.media_type as string | null) ?? null,
      video_status:           (p.video_status as string | null) ?? null,
      video_duration_s:       (p.video_duration_s as number | null) ?? null,
      generation_attempt:     (p.generation_attempt as number) ?? 0,
      last_error:             (p.last_error as string | null) ?? null,
      requires_human_review:  (p.requires_human_review as boolean) ?? false,
      strategic_rationale:    (p.strategic_rationale as string | null) ?? null,
      occasion_flags:         (p.occasion_flags as string[]) ?? [],
      ai_generated:           (p.ai_generated as boolean) ?? true,
      generation_model:       (p.generation_model as string | null) ?? null,
      c2pa_signed:            (p.c2pa_signed as boolean) ?? false,
      final_prompt:           ((p.c2pa_metadata as Record<string, unknown> | null)?.final_prompt as string | null) ?? null,
      final_negative_prompt:  ((p.c2pa_metadata as Record<string, unknown> | null)?.final_negative_prompt as string | null) ?? null,
      visual_score:           (p.visual_score as number | null) ?? null,
      visual_issues:          Array.isArray(p.visual_issues) ? (p.visual_issues as Array<{ code: string; label: string; severity: 'high' | 'med' | 'low'; detail?: string }>) : null,
    })
  }
  return items
}

/**
 * Returns queue_ids of all pending calendar-kind QA items for a given brand.
 * Used by bulkApproveCalendar to resolve which rows to approve when calendar_id
 * is not stored in qa_review_queue.
 */
export async function getPendingCalendarQaIdsForBrand(brandId: string): Promise<string[]> {
  if (!isDbConfigured()) return []
  const classified = await loadClassifiedQa()
  return classified
    .filter((r) => r.brand_id === brandId && r.qa_kind === 'calendar' && r.status === 'pending')
    .map((r) => r.queue_id)
}
