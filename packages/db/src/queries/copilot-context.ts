/**
 * Copilot context fetchers (Doc §8.5 — `fetchCopilotContext(role, admin.id)`).
 *
 * Each fetcher runs UNDER the role's RLS scope (set via `app.copilot_role`
 * GUC by the openCopilotClient factory). This means:
 *
 *   - The Tech Copilot's fetcher can include `select * from brand_profiles`
 *     and Postgres will return ZERO rows. The application code can't leak
 *     what RLS won't return.
 *   - We deliberately keep the fetchers small (≤ 5 queries each, ≤ 8KB
 *     payload) so the entire snapshot fits comfortably in Claude's prompt
 *     budget and the marginal token cost per turn is bounded.
 *
 * Each fetcher returns a JSON-shaped object that's embedded verbatim into
 * the system context block of the Anthropic call.
 */
import { withCopilotClient, type CopilotRole } from '../copilot-pg'

export interface ManagementContext {
  generated_at: string
  brand_count_by_tier: Array<{ tier: string; count: number }>
  brands_by_onboarding_status: Array<{ onboarding_status: string; count: number }>
  spend_current_month: {
    total_usd: number
    by_provider: Array<{ provider: string; usd: number; calls: number }>
    monthly_ceiling_usd: number
  }
  top_brands_by_activity: Array<{ slug: string; sector: string; total_calendars_generated: number; created_at: string }>
  stuck_brands: Array<{ slug: string; sector: string; onboarding_status: string; days_stuck: number }>
}

export interface TechContext {
  generated_at: string
  window: { hours: number; start: string; end: string }
  recent_anomalies: Array<{
    anomaly_id: string
    created_at: string
    anomaly_type: string | null
    severity: string | null
    source_flow: string | null
    brand_id_short: string | null
    message: string | null
  }>
  flow_health_24h: Array<{ flow_id: string; calls: number; failures: number; p95_ms: number }>
  cost_by_provider_24h: Array<{ provider: string; usd: number; calls: number }>
  routing_decisions_24h: { total: number; blocked: number; cautious: number; anomaly_flagged: number }
}

export interface ProductionContext {
  generated_at: string
  queue_summary: { pending: number; approved_today: number; rejected_today: number; escalated: number }
  oldest_pending: Array<{
    queue_id: string
    brand_slug: string
    brand_dialect: string | null
    created_at: string
    age_hours: number
    held_reason: string | null
  }>
  brands_with_high_rejection_rate_7d: Array<{
    slug: string
    rejected: number
    total: number
    rate: number
  }>
  recent_cco_failures: Array<{ post_id: string | null; reason_code: string | null; created_at: string }>
}

// ─────────────────────────────────────────────────────────────────────
// Management
// ─────────────────────────────────────────────────────────────────────
export async function getManagementContext(): Promise<ManagementContext> {
  return withCopilotClient('management', async (c) => {
    const monthlyCeiling = Number(process.env.OPENCLAW_MONTHLY_CEILING_USD ?? 50)

    const tier = await c.query<{ tier: string; count: string }>(
      `select tier, count(*)::text as count
         from brand_profiles
        group by tier
        order by count(*) desc`,
    )
    const status = await c.query<{ onboarding_status: string; count: string }>(
      `select coalesce(onboarding_status, 'unknown') as onboarding_status,
              count(*)::text as count
         from brand_profiles
        group by onboarding_status
        order by count(*) desc`,
    )
    const spend = await c.query<{ provider: string; usd: string; calls: string }>(
      `select coalesce(provider, 'unknown') as provider,
              sum(cost_usd)::text          as usd,
              count(*)::text               as calls
         from usage_logs
        where created_at >= date_trunc('month', now())
        group by provider
        order by sum(cost_usd) desc nulls last`,
    )
    const top = await c.query<{ slug: string; sector: string; total_calendars_generated: number; created_at: string }>(
      `select client_slug as slug, sector::text as sector,
              total_calendars_generated, created_at
         from brand_profiles
        order by total_calendars_generated desc nulls last, created_at desc
        limit 5`,
    )
    const stuck = await c.query<{ slug: string; sector: string; onboarding_status: string; days_stuck: string }>(
      `select client_slug as slug, sector::text as sector,
              onboarding_status,
              extract(day from now() - created_at)::text as days_stuck
         from brand_profiles
        where onboarding_status in ('submitted','scraping','dna_building','memory_writing','failed','blocked')
          and created_at < now() - interval '1 day'
        order by created_at asc
        limit 10`,
    )

    const totalSpend = spend.rows.reduce((s, r) => s + Number(r.usd ?? 0), 0)

    return {
      generated_at: new Date().toISOString(),
      brand_count_by_tier: tier.rows.map((r) => ({ tier: r.tier, count: Number(r.count) })),
      brands_by_onboarding_status: status.rows.map((r) => ({
        onboarding_status: r.onboarding_status,
        count: Number(r.count),
      })),
      spend_current_month: {
        total_usd: Number(totalSpend.toFixed(4)),
        by_provider: spend.rows.map((r) => ({
          provider: r.provider,
          usd: Number(Number(r.usd ?? 0).toFixed(4)),
          calls: Number(r.calls),
        })),
        monthly_ceiling_usd: monthlyCeiling,
      },
      top_brands_by_activity: top.rows,
      stuck_brands: stuck.rows.map((r) => ({
        slug: r.slug,
        sector: r.sector,
        onboarding_status: r.onboarding_status,
        days_stuck: Number(r.days_stuck),
      })),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────
// Tech
// ─────────────────────────────────────────────────────────────────────
export async function getTechContext(opts: { window_hours?: number } = {}): Promise<TechContext> {
  const hours = opts.window_hours ?? 24
  return withCopilotClient('tech', async (c) => {
    const start = new Date(Date.now() - hours * 3600 * 1000)
    const end = new Date()

    const anomalies = await c.query<{
      anomaly_id: string
      created_at: string
      anomaly_type: string | null
      severity: string | null
      source_flow: string | null
      brand_id: string | null
      message: string | null
    }>(
      `select anomaly_id::text, created_at, anomaly_type, severity::text as severity,
              source_flow, brand_id::text, message
         from anomaly_records
        where created_at >= $1
        order by created_at desc
        limit 25`,
      [start.toISOString()],
    )
    const flow = await c.query<{ flow_id: string; calls: string; failures: string; p95_ms: string }>(
      `with flow_rows as (
         select flow_id,
                duration_ms,
                case when status = 'failure' then 1 else 0 end as failed
           from usage_logs
          where created_at >= $1 and flow_id is not null
       )
       select flow_id,
              count(*)::text    as calls,
              sum(failed)::text as failures,
              coalesce(percentile_disc(0.95) within group (order by duration_ms), 0)::text as p95_ms
         from flow_rows
        group by flow_id
        order by sum(failed) desc, count(*) desc
        limit 10`,
      [start.toISOString()],
    )
    const provCost = await c.query<{ provider: string; usd: string; calls: string }>(
      `select coalesce(provider, 'unknown') as provider,
              sum(cost_usd)::text as usd,
              count(*)::text     as calls
         from usage_logs
        where created_at >= $1
        group by provider
        order by sum(cost_usd) desc nulls last`,
      [start.toISOString()],
    )
    const routing = await c.query<{ total: string; blocked: string; cautious: string; anomaly: string }>(
      `select count(*)::text as total,
              count(*) filter (where confidence_mode = 'Blocked')::text as blocked,
              count(*) filter (where confidence_mode = 'Cautious')::text as cautious,
              count(*) filter (where outcome ~ 'anomaly')::text as anomaly
         from routing_decisions
        where "timestamp" >= $1`,
      [start.toISOString()],
    )

    return {
      generated_at: end.toISOString(),
      window: { hours, start: start.toISOString(), end: end.toISOString() },
      recent_anomalies: anomalies.rows.map((r) => ({
        anomaly_id: r.anomaly_id,
        created_at: r.created_at,
        anomaly_type: r.anomaly_type,
        severity: r.severity,
        source_flow: r.source_flow,
        brand_id_short: r.brand_id ? r.brand_id.slice(0, 8) : null,
        message: redactSecrets(r.message),
      })),
      flow_health_24h: flow.rows.map((r) => ({
        flow_id: r.flow_id,
        calls: Number(r.calls),
        failures: Number(r.failures),
        p95_ms: Math.round(Number(r.p95_ms)),
      })),
      cost_by_provider_24h: provCost.rows.map((r) => ({
        provider: r.provider,
        usd: Number(Number(r.usd ?? 0).toFixed(4)),
        calls: Number(r.calls),
      })),
      routing_decisions_24h: {
        total: Number(routing.rows[0]?.total ?? 0),
        blocked: Number(routing.rows[0]?.blocked ?? 0),
        cautious: Number(routing.rows[0]?.cautious ?? 0),
        anomaly_flagged: Number(routing.rows[0]?.anomaly ?? 0),
      },
    }
  })
}

// ─────────────────────────────────────────────────────────────────────
// Production
// ─────────────────────────────────────────────────────────────────────
export async function getProductionContext(): Promise<ProductionContext> {
  return withCopilotClient('production', async (c) => {
    const summary = await c.query<{ pending: string; approved_today: string; rejected_today: string; escalated: string }>(
      `select
         count(*) filter (where status = 'pending')::text                                              as pending,
         count(*) filter (where status = 'approved' and reviewed_at::date = current_date)::text       as approved_today,
         count(*) filter (where status = 'rejected' and reviewed_at::date = current_date)::text       as rejected_today,
         count(*) filter (where status = 'escalated')::text                                           as escalated
       from qa_review_queue`,
    )
    const oldest = await c.query<{
      queue_id: string
      brand_id: string
      created_at: string
      held_reason: string | null
      brand_slug: string | null
      brand_dialect: string | null
    }>(
      `select q.queue_id::text, q.brand_id::text, q.created_at, q.held_reason,
              p.client_slug as brand_slug, p.arabic_dialect::text as brand_dialect
         from qa_review_queue q
         left join brand_profiles p on p.brand_id = q.brand_id
        where q.status = 'pending'
        order by q.created_at asc
        limit 5`,
    )
    const high = await c.query<{ slug: string; rejected: string; total: string; rate: string }>(
      `select p.client_slug as slug,
              count(*) filter (where q.status = 'rejected')::text                          as rejected,
              count(*)::text                                                                as total,
              (count(*) filter (where q.status = 'rejected')::float / nullif(count(*),0))::text as rate
         from qa_review_queue q
         join brand_profiles p on p.brand_id = q.brand_id
        where q.created_at >= now() - interval '7 days'
        group by p.client_slug
       having count(*) >= 3 and (count(*) filter (where q.status = 'rejected')::float / nullif(count(*),0)) > 0.25
        order by rate desc
        limit 5`,
    )
    const cco = await c.query<{ post_id: string | null; held_reason: string | null; created_at: string }>(
      `select post_id::text, held_reason, created_at
         from qa_review_queue
        where held_reason ilike 'cco_%'
        order by created_at desc
        limit 10`,
    )

    const now = Date.now()
    return {
      generated_at: new Date().toISOString(),
      queue_summary: {
        pending: Number(summary.rows[0]?.pending ?? 0),
        approved_today: Number(summary.rows[0]?.approved_today ?? 0),
        rejected_today: Number(summary.rows[0]?.rejected_today ?? 0),
        escalated: Number(summary.rows[0]?.escalated ?? 0),
      },
      oldest_pending: oldest.rows.map((r) => ({
        queue_id: r.queue_id,
        brand_slug: r.brand_slug ?? r.brand_id.slice(0, 8),
        brand_dialect: r.brand_dialect,
        created_at: r.created_at,
        age_hours: Math.round((now - new Date(r.created_at).getTime()) / 3600 / 1000),
        held_reason: r.held_reason,
      })),
      brands_with_high_rejection_rate_7d: high.rows.map((r) => ({
        slug: r.slug,
        rejected: Number(r.rejected),
        total: Number(r.total),
        rate: Number(Number(r.rate).toFixed(2)),
      })),
      recent_cco_failures: cco.rows.map((r) => ({
        post_id: r.post_id,
        reason_code: r.held_reason,
        created_at: r.created_at,
      })),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────
export async function fetchCopilotContext(
  role: CopilotRole,
): Promise<ManagementContext | TechContext | ProductionContext> {
  switch (role) {
    case 'management': return getManagementContext()
    case 'tech':       return getTechContext()
    case 'production': return getProductionContext()
  }
}

/**
 * Defense in depth — strip anything that LOOKS like an API key or env-var
 * value before letting it into the Tech Copilot context. The aggregator
 * shouldn't surface these in the first place, but if a stack trace ever
 * leaks one we don't want it reaching the LLM.
 */
function redactSecrets(text: string | null | undefined): string | null {
  if (!text) return null
  return text
    .replace(/sk-[A-Za-z0-9_\-]{20,}/g, '[redacted-api-key]')
    .replace(/eyJ[A-Za-z0-9._\-]{40,}/g, '[redacted-jwt]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]{20,}/gi, 'Bearer [redacted]')
}
