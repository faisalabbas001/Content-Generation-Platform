/**
 * /admin/notifications/logs — Resend delivery log viewer.
 *
 * Shows all sent / failed / queued notification rows with filters, free-text
 * search (subject / template), accurate status totals, page-size control,
 * clamped pagination, recipient email, and a per-row Retry button for failures.
 */
import Link from 'next/link'
import { adminClient } from '@repo/db/client'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { DeliveryLogTable } from './delivery-log-table'

export const dynamic = 'force-dynamic'

interface SearchParams {
  template?: string
  status?: string
  q?: string
  page?: string
  size?: string
}

const PAGE_SIZES = [25, 50, 100] as const
const DEFAULT_SIZE = 50
const VALID_STATUSES = ['sent', 'failed', 'queued', 'bounced'] as const

/** Parse a positive integer, falling back when missing / NaN / ≤ 0. */
function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export default async function NotificationLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams

  // ── Normalise inputs ────────────────────────────────────────────────────────
  const templateFilter = sp.template ?? ''
  const statusFilter   = VALID_STATUSES.includes(sp.status as (typeof VALID_STATUSES)[number]) ? sp.status! : ''
  const rawSearch      = (sp.q ?? '').trim().slice(0, 100)
  // Sanitise for the PostgREST `.or()` grammar (`,` `(` `)` are delimiters; `%` is a wildcard).
  const safeSearch     = rawSearch.replace(/[,()%]/g, ' ').trim()
  const pageSize       = (PAGE_SIZES as readonly number[]).includes(toPositiveInt(sp.size, DEFAULT_SIZE))
    ? toPositiveInt(sp.size, DEFAULT_SIZE)
    : DEFAULT_SIZE
  const requestedPage  = toPositiveInt(sp.page, 1)
  const filtersActive  = Boolean(templateFilter || statusFilter || safeSearch)

  const db = adminClient()

  // Applies the active filters to any notifications query builder.
  const applyFilters = <Q extends { eq(c: string, v: string): Q; or(f: string): Q }>(q: Q): Q => {
    let out = q
    if (templateFilter) out = out.eq('template_key', templateFilter)
    if (statusFilter)   out = out.eq('resend_status', statusFilter)
    if (safeSearch)     out = out.or(`rendered_subject.ilike.%${safeSearch}%,template_key.ilike.%${safeSearch}%`)
    return out
  }

  // Accurate per-status totals (head:true → server-side COUNT, no 1000-row cap).
  const statusCount = async (status?: string): Promise<number> => {
    let q = db.from('notifications').select('notification_id', { count: 'exact', head: true })
    if (status) q = q.eq('resend_status', status)
    const { count } = await q
    return count ?? 0
  }

  // ── Phase 1: filtered count + global summary + template keys (parallel) ──────
  const [
    filteredCount,
    cSent, cFailed, cQueued, cBounced, cTotal,
    templateKeyRes,
  ] = await Promise.all([
    applyFilters(db.from('notifications').select('notification_id', { count: 'exact', head: true }))
      .then((r) => r.count ?? 0),
    statusCount('sent'),
    statusCount('failed'),
    statusCount('queued'),
    statusCount('bounced'),
    statusCount(),
    db.from('notification_templates').select('template_key').order('template_key'),
  ])

  const total      = filteredCount
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  // Clamp so an out-of-range ?page never shows a false-empty table.
  const page       = Math.min(Math.max(1, requestedPage), totalPages)
  const offset     = (page - 1) * pageSize

  // ── Phase 2: the page of rows ───────────────────────────────────────────────
  const { data: rows, error } = await applyFilters(
    db
      .from('notifications')
      .select(
        'notification_id, template_key, lang, auth_user_id, rendered_subject, resend_status, resend_error, resend_message_id, retry_count, sent_at, created_at',
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1),
  )

  // Resolve recipient emails in one parallel batch.
  const userIds = [...new Set((rows ?? []).map((r) => r.auth_user_id))]
  const emailMap: Record<string, string> = {}
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const { data: u } = await db.auth.admin.getUserById(uid)
        if (u.user?.email) emailMap[uid] = u.user.email
      } catch { /* skip — row still renders with a — placeholder */ }
    }),
  )

  const enrichedRows = (rows ?? []).map((r) => ({
    ...r,
    user_email:  emailMap[r.auth_user_id] ?? null,
    retry_count: r.retry_count ?? 0,
  }))

  const uniqueKeys = [...new Set((templateKeyRes.data ?? []).map((t) => t.template_key))]

  const counts    = { sent: cSent, failed: cFailed, queued: cQueued, bounced: cBounced }
  const rangeFrom = total === 0 ? 0 : offset + 1
  const rangeTo   = offset + enrichedRows.length

  // Build a query string that preserves the current view while overriding keys.
  const hrefWith = (overrides: Record<string, string>) => {
    const p = new URLSearchParams()
    if (templateFilter)        p.set('template', templateFilter)
    if (statusFilter)          p.set('status', statusFilter)
    if (rawSearch)             p.set('q', rawSearch)
    if (pageSize !== DEFAULT_SIZE) p.set('size', String(pageSize))
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    p.delete('page') // overriding any filter resets to page 1
    const s = p.toString()
    return s ? `?${s}` : '?'
  }

  const SUMMARY = [
    { key: 'sent',    label: 'Sent',    tone: 'success' as const },
    { key: 'failed',  label: 'Failed',  tone: 'danger'  as const },
    { key: 'queued',  label: 'Queued',  tone: 'warning' as const },
    { key: 'bounced', label: 'Bounced', tone: 'outline' as const },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Notifications"
        title="Delivery Log"
        subtitle="Full audit trail of every notification sent — filter, search, retry failures, and track Resend status."
      />

      {/* Summary cards — each is a one-click status filter (click again to clear). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SUMMARY.map(({ key, label, tone }) => {
          const active = statusFilter === key
          return (
            <Link
              key={key}
              href={hrefWith({ status: active ? '' : key })}
              aria-pressed={active}
              className={[
                'block rounded-(--r-lg) transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)',
                active ? 'ring-2 ring-(--accent)' : 'hover:ring-1 hover:ring-(--border-strong)',
              ].join(' ')}
            >
              <Card className="h-full">
                <CardBody className="py-4 text-center">
                  <p className="text-2xl font-bold text-(--fg)">{counts[key as keyof typeof counts]}</p>
                  <p className="mt-0.5 text-xs text-(--fg-muted)">{label}</p>
                  <div className="mt-1.5 flex justify-center">
                    <Badge tone={tone} size="sm">{label}</Badge>
                  </div>
                </CardBody>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              {total === 0
                ? 'No matching notifications'
                : `Showing ${rangeFrom}–${rangeTo} of ${total} · page ${page} of ${totalPages}`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-medium text-(--danger)">Failed to load delivery log</p>
              <p className="mt-1 text-xs text-(--fg-muted)">{error.message}</p>
            </div>
          ) : (
            <DeliveryLogTable
              rows={enrichedRows}
              templateKeys={uniqueKeys}
              currentTemplate={templateFilter}
              currentStatus={statusFilter}
              currentSearch={rawSearch}
              page={page}
              totalPages={totalPages}
              total={total}
              grandTotal={cTotal}
              pageSize={pageSize}
              pageSizes={[...PAGE_SIZES]}
              rangeFrom={rangeFrom}
              rangeTo={rangeTo}
              filtersActive={filtersActive}
            />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
