import { redirect } from 'next/navigation'
import { adminQ } from '@repo/db'
import { scoreBand } from '@repo/core'
import { PageHeader } from '@repo/ui/page-header'
import { Badge } from '@repo/ui/badge'
import { getServerT } from '@/lib/i18n-server'
import { QaTableWrapper } from './qa-table-wrapper'
import { CalendarQaList } from './calendar-qa-list'
import { OnDemandQaList } from './on-demand-qa-list'
import type { QaTabKey } from './qa-tabs'

export const dynamic = 'force-dynamic'

// Both QA tabs now render a paginated brand-card grid. Cards are tall, so a
// modest page size keeps each page comfortable.
const CARD_PAGE_SIZE = 10

function parseTab(raw: string | string[] | undefined): QaTabKey {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === 'on_demand' ? 'on_demand' : 'calendar'
}

const TRIGGER_LABELS: Record<string, string> = {
  first_ever_client_output:             'First-ever output',
  brave_route_flagged:                  'CCO brave-route flag',
  healthcare_health_claim:              'Health claim',
  finance_investment_claim:             'Finance claim',
  government_sector:                    'Government sector',
  religious_reference_high_sensitivity: 'High religious sensitivity',
  dialect_unconfirmed_hero:             'Dialect unconfirmed',
  unresolved_conflict_record:           'Conflict record',
  revision_cycle_exceeded:              'Revision limit reached',
  cco_low_confidence:                   'CCO low score (<50)',
  hard_block_negative_pattern:          'Hard block',
  method_violation:                     'Method drift',
  ceo_hold:                             'CEO hold',
  human_gate_override:                  'Admin hold',
}

function TriggerReasonBadges({ reason }: { reason: string | null | undefined }) {
  if (!reason) return <span className="text-xs text-(--fg-faint)">—</span>
  const parts = reason.split(/[|,]/).map((s) => s.trim()).filter(Boolean)
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((part) => {
        const label = TRIGGER_LABELS[part] ?? part
        const tone = part === 'hard_block_negative_pattern' ? 'danger' : 'neutral'
        return (
          <Badge key={part} tone={tone} size="sm">
            {label}
          </Badge>
        )
      })}
    </div>
  )
}

function ScoreBandBadge({ score }: { score: number | null | undefined }) {
  const s = score ?? 0
  const band = scoreBand(score)
  const tone = band === 'clean' ? 'success' : band === 'mark' ? 'warning' : 'danger'
  return (
    <Badge tone={tone} size="sm">
      <span className="font-mono">{s.toFixed(0)}</span>
      <span className="ml-1 opacity-70 uppercase tracking-wider text-[9px]">{band}</span>
    </Badge>
  )
}

function RouteDecisionBadge({ route }: { route: string | null | undefined }) {
  if (!route) return <span className="text-(--fg-faint) text-xs">—</span>
  const r = route.toLowerCase()
  const tone = r === 'clean' ? 'success' : r === 'watermark' ? 'warning' : 'danger'
  return <Badge tone={tone} size="sm">{route.toUpperCase()}</Badge>
}

function compareQueueRows(
  a: { status: string; created_at: string; flags?: Record<string, unknown> | null; trigger_reason?: string | null },
  b: { status: string; created_at: string; flags?: Record<string, unknown> | null; trigger_reason?: string | null },
): number {
  const isHardBlock = (r: typeof a) =>
    r.status === 'pending' && (
      (r.flags && (r.flags as Record<string, unknown>).negpat_flag === 'HARD_BLOCK') ||
      (r.trigger_reason ?? '').includes('hard_block_negative_pattern')
    )
  const aHard = isHardBlock(a) ? 1 : 0
  const bHard = isHardBlock(b) ? 1 : 0
  if (aHard !== bHard) return bHard - aHard

  const aPending = a.status === 'pending' ? 1 : 0
  const bPending = b.status === 'pending' ? 1 : 0
  if (aPending !== bPending) return bPending - aPending

  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw
  const n = Number(v)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

function qaHref(tab: QaTabKey, page: number): string {
  const params = new URLSearchParams()
  if (tab !== 'calendar') params.set('tab', tab)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs ? `/admin/qa?${qs}` : '/admin/qa'
}

export default async function QaQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; tab?: string | string[] }>
}) {
  const { page: pageParam, tab: tabParam } = await searchParams
  const activeTab = parseTab(tabParam)
  const { locale, t } = await getServerT()

  const pendingCounts = await adminQ.getQaPendingCounts()
  const totalPending = pendingCounts.calendar + pendingCounts.on_demand

  const tabsDef = [
    { key: 'calendar' as QaTabKey, label: t('adminQa.tabs.calendar'), count: pendingCounts.calendar },
    { key: 'on_demand' as QaTabKey, label: t('adminQa.tabs.onDemand'), count: pendingCounts.on_demand },
  ]

  const header = (
    <PageHeader
      eyebrow={t('adminQa.eyebrow')}
      title={t('adminQa.title')}
      subtitle={t('adminQa.subtitle')}
      action={
        totalPending > 0 ? (
          <Badge tone="warning" dot>
            {totalPending} pending
          </Badge>
        ) : undefined
      }
    />
  )

  const requestedPage = parsePage(pageParam)

  // ── Calendar tab: paginated brand grid ───────────────────────────────
  if (activeTab === 'calendar') {
    const { groups, total } = await adminQ.getQaCalendarGroups(requestedPage, CARD_PAGE_SIZE)
    const pageCount = Math.max(Math.ceil(total / CARD_PAGE_SIZE), 1)
    if (requestedPage > pageCount && total > 0) redirect(qaHref(activeTab, pageCount))
    const currentPage = Math.min(Math.max(requestedPage, 1), pageCount)
    const from = total === 0 ? 0 : (currentPage - 1) * CARD_PAGE_SIZE + 1
    const to = Math.min(currentPage * CARD_PAGE_SIZE, total)

    const calendarLegend = total > 0 ? (
      <div className="flex flex-wrap items-center gap-2 rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) px-4 py-2.5 text-xs text-(--fg-muted) sm:gap-3">
        <span>
          {total === 1 ? '1 calendar' : `${total} calendars`} pending review
          {pageCount > 1 && (
            <span className="ml-1 text-(--fg-faint)">
              · page {currentPage} of {pageCount}
            </span>
          )}
        </span>
        <span className="hidden text-(--fg-faint) sm:inline">·</span>
        <span className="hidden sm:inline">Showing {from}–{to}</span>
      </div>
    ) : undefined

    return (
      <div className="space-y-10">
        {header}
        <QaTableWrapper
          tab={activeTab}
          tabs={tabsDef}
          legend={calendarLegend}
          loadingLabel={t('common.loading')}
          pagination={pageCount > 1 ? {
            page:          currentPage,
            pageCount,
            summary:       `Showing ${from}–${to} of ${total} calendars`,
            pageLabel:     `Page ${currentPage} of ${pageCount}`,
            previousLabel: t('adminQa.pagination.previous'),
            nextLabel:     t('adminQa.pagination.next'),
            locale,
          } : null}
        >
          <CalendarQaList groups={groups} />
        </QaTableWrapper>
      </div>
    )
  }

  // ── On-Demand tab: paginated brand grid ──────────────────────────────
  const { groups, total } = await adminQ.getQaOnDemandGroups(requestedPage, CARD_PAGE_SIZE)
  const pageCount = Math.max(Math.ceil(total / CARD_PAGE_SIZE), 1)
  if (requestedPage > pageCount && total > 0) redirect(qaHref(activeTab, pageCount))
  const currentPage = Math.min(Math.max(requestedPage, 1), pageCount)
  const from = total === 0 ? 0 : (currentPage - 1) * CARD_PAGE_SIZE + 1
  const to = Math.min(currentPage * CARD_PAGE_SIZE, total)

  const onDemandLegend = total > 0 ? (
    <div className="flex flex-wrap items-center gap-2 rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) px-4 py-2.5 text-xs text-(--fg-muted) sm:gap-3">
      <span>
        {total === 1 ? '1 brand' : `${total} brands`} with on-demand activity
        {pageCount > 1 && (
          <span className="ml-1 text-(--fg-faint)">
            · page {currentPage} of {pageCount}
          </span>
        )}
      </span>
      <span className="hidden text-(--fg-faint) sm:inline">·</span>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex h-4 items-center rounded-full bg-amber-400 px-1.5 text-[9px] font-bold text-black">new</span>
        <span className="text-(--fg-faint)">counts grow as new posts arrive</span>
      </span>
    </div>
  ) : undefined

  return (
    <div className="space-y-10">
      {header}
      <QaTableWrapper
        tab={activeTab}
        tabs={tabsDef}
        legend={onDemandLegend}
        loadingLabel={t('common.loading')}
        pagination={pageCount > 1 ? {
          page:          currentPage,
          pageCount,
          summary:       `Showing ${from}–${to} of ${total} brands`,
          pageLabel:     `Page ${currentPage} of ${pageCount}`,
          previousLabel: t('adminQa.pagination.previous'),
          nextLabel:     t('adminQa.pagination.next'),
          locale,
        } : null}
      >
        <OnDemandQaList groups={groups} />
      </QaTableWrapper>
    </div>
  )
}
