import { notFound } from 'next/navigation'
import Link from 'next/link'
import { adminQ, calendarsQ } from '@repo/db'
import { Badge } from '@repo/ui/badge'
import { BrandCalendarWorkspace } from './brand-calendar-workspace'

export const dynamic = 'force-dynamic'

// All 12 months a calendar could cover
const ALL_MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12'] as const
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const SECTOR_STYLES: Record<string, string> = {
  'F&B':             'bg-orange-500/10 text-orange-300 border-orange-500/20',
  'Retail':          'bg-blue-500/10 text-blue-300 border-blue-500/20',
  'Beauty_Wellness': 'bg-pink-500/10 text-pink-300 border-pink-500/20',
  'Healthcare':      'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  'Finance':         'bg-yellow-500/10 text-yellow-300 border-yellow-500/20',
  'Government':      'bg-purple-500/10 text-purple-300 border-purple-500/20',
  'Other':           'bg-neutral-500/10 text-neutral-400 border-neutral-500/20',
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

export default async function BrandQaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const { brandId } = await params
  const { month: monthParam } = await searchParams

  const { groups } = await adminQ.getQaCalendarGroups(1, 999)
  const group = groups.find((g) => g.brand_id === brandId)
  if (!group) notFound()

  // Real calendars for this brand — drives the year toggle + which months are
  // interactive. A brand may have multiple months across 2026/2027.
  const brandCalendars = await calendarsQ.getCalendarsForBrand(brandId)
  const availableMonths = new Set(brandCalendars.map((c) => c.month)) // e.g. {"2026-06","2027-01"}
  const availableYears = [...new Set([...availableMonths].map((m) => m.split('-')[0]))].sort()

  // Per-month review counts (cheap head-only) — badges EVERY month tab so the admin
  // sees the runway at a glance ("June 17 · July 20 · Aug 20") and approves one
  // month at a time. 3-Month Rolling: never load all months' posts at once.
  const monthCounts = await adminQ.getBrandMonthQaCounts(brandId)
  // Badge shows TOTAL generated posts per month (not just pending) so the admin
  // sees the true size of each calendar (e.g. Jun=12, Jul=23, Aug=21).
  const totalByMonth  = new Map(monthCounts.map((m) => [m.month, m.total]))
  const pendingByMonth = new Map(monthCounts.map((m) => [m.month, m.pending]))

  // Default to the CURRENT month (offset 0) when the brand has a calendar for it,
  // so the workspace opens on what the admin most likely needs — NOT the
  // latest-created month (which under 3-month rolling is 2 months out). Falls back
  // to the group's month if the current month wasn't generated.
  const nowMonthKey = new Date().toISOString().slice(0, 7) // 'YYYY-MM'
  const defaultMonth = availableMonths.has(nowMonthKey) ? nowMonthKey : group.month
  const selectedMonth = monthParam ?? defaultMonth  // e.g. "2026-06"
  // Year shown = selected month's year (so the picker follows the toggle).
  const calendarYear = selectedMonth.split('-')[0]

  // Items for the selected month. The latest calendar (group.month) is already
  // loaded with full queue state; any other month is loaded on demand so the
  // month/year switcher shows that month's real posts.
  const items = selectedMonth === group.month
    ? group.qa_items
    : await adminQ.getCalendarMonthQaItems(brandId, selectedMonth)

  const sector = group.sector ?? 'Other'
  const sectorCls = SECTOR_STYLES[sector] ?? SECTOR_STYLES['Other']
  const seq = group.calendar_sequence ?? 1

  // Unique trigger keys across all qa items
  const allTriggerKeys = [
    ...new Set(
      group.qa_items
        .flatMap((i) => (i.trigger_reason ?? '').split(/[|,]/).map((s) => s.trim()))
        .filter(Boolean),
    ),
  ]
  const isHardBlock = allTriggerKeys.includes('hard_block_negative_pattern')

  // Compute header stats from the ACTUAL posts shown for the selected month, not
  // the queue-only counts (which exclude auto-passed clean posts). "reviewed" =
  // posts the admin has acted on — released to the client, client-approved, or rejected.
  const totalShown = items.length
  const approved = items.filter((i) => i.status === 'released' || i.status === 'approved').length
  const decided = items.filter(
    (i) => i.status === 'released' || i.status === 'approved' || i.status === 'rejected',
  ).length
  const pendingShown = totalShown - decided
  const pct = totalShown > 0 ? Math.round((decided / totalShown) * 100) : 0

  return (
    <div className="min-h-screen bg-(--surface-1)">

      {/* ── Sticky top nav ──────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-(--border-subtle) bg-(--surface-1)/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/admin/qa"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) transition-colors"
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            QA Queue
          </Link>
          <span className="text-(--fg-faint)">/</span>

          {/* Brand identity pill */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {group.logo_url ? (
              <img src={group.logo_url} alt="" className="h-6 w-6 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-(--accent)/20 text-[10px] font-bold text-(--accent)">
                {(group.brand_name_en ?? group.brand_name_ar).charAt(0).toUpperCase()}
              </div>
            )}
            <span className="truncate text-sm font-semibold text-(--fg)">
              {group.brand_name_en ?? group.brand_name_ar}
            </span>
            {group.brand_name_en && (
              <span className="hidden text-xs text-(--fg-faint) sm:inline" dir="rtl">{group.brand_name_ar}</span>
            )}
          </div>

          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <Badge tone="warning" dot>{pendingShown} pending</Badge>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6">

        {/* ── Brand hero header ────────────────────────────────── */}
        <div className={[
          'mb-8 overflow-hidden rounded-2xl border',
          isHardBlock ? 'border-red-500/30' : 'border-(--border-subtle)',
        ].join(' ')}>
          {/* Gradient accent top */}
          <div className={[
            'h-1 w-full',
            isHardBlock ? 'bg-gradient-to-r from-red-500 to-red-400'
            : seq === 1  ? 'bg-gradient-to-r from-amber-400 to-yellow-300'
            : seq === 2  ? 'bg-gradient-to-r from-blue-400 to-indigo-400'
            :              'bg-gradient-to-r from-(--accent) to-(--accent)/60',
          ].join(' ')} />

          <div className="bg-(--surface-2) px-6 py-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              {/* Logo */}
              <div className="shrink-0">
                {group.logo_url ? (
                  <img
                    src={group.logo_url}
                    alt=""
                    className="h-16 w-16 rounded-2xl object-cover ring-2 ring-(--border-subtle)"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-(--accent)/15 text-2xl font-bold text-(--accent)">
                    {(group.brand_name_en ?? group.brand_name_ar).charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Names + tags */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1 className="text-2xl font-bold text-(--fg)">
                    {group.brand_name_en ?? group.brand_name_ar}
                  </h1>
                  {group.brand_name_en && (
                    <span className="text-base text-(--fg-muted)" dir="rtl">{group.brand_name_ar}</span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={seq === 1 ? 'warning' : seq === 2 ? 'info' : 'neutral'} size="sm">
                    {seq === 1 ? '1st' : seq === 2 ? '2nd' : seq === 3 ? '3rd' : `${seq}th`} Calendar
                  </Badge>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${sectorCls}`}>
                    {sector.replace('_', '/')}
                  </span>
                  {group.pipeline_tier && (
                    <Badge tone={group.pipeline_tier === 'Pro' ? 'info' : 'neutral'} size="sm">
                      {group.pipeline_tier}
                    </Badge>
                  )}
                  {group.religious_sensitivity === 'High' && (
                    <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-300">
                      🕌 High sensitivity
                    </span>
                  )}
                  {isHardBlock && (
                    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-bold text-red-400">
                      🔴 Hard Block
                    </span>
                  )}
                </div>

                {group.brand_differentiator && (
                  <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-(--fg-muted)">
                    {group.brand_differentiator}
                  </p>
                )}
              </div>

              {/* QA progress stats */}
              <div className="flex shrink-0 gap-3 sm:flex-col sm:items-end sm:gap-2">
                <div className="flex flex-col items-center rounded-xl bg-(--surface-1) px-4 py-2.5 text-center ring-1 ring-(--border-subtle)">
                  <span className="text-xl font-bold text-amber-400">{pendingShown}</span>
                  <span className="text-[10px] text-(--fg-faint)">pending</span>
                </div>
                <div className="flex flex-col items-center rounded-xl bg-(--surface-1) px-4 py-2.5 text-center ring-1 ring-(--border-subtle)">
                  <span className="text-xl font-bold text-emerald-400">{pct}%</span>
                  <span className="text-[10px] text-(--fg-faint)">reviewed</span>
                </div>
              </div>
            </div>

            {/* QA progress bar */}
            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-xs text-(--fg-faint)">
                <span>QA progress — {approved}/{totalShown} approved</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-(--surface-3)">
                <div
                  className="h-full rounded-full bg-(--accent) transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Hold reasons */}
            {allTriggerKeys.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                <span className="text-xs text-(--fg-faint) self-center">Hold:</span>
                {allTriggerKeys.map((k) => (
                  <Badge
                    key={k}
                    tone={k === 'hard_block_negative_pattern' ? 'danger' : 'warning'}
                    size="sm"
                  >
                    {TRIGGER_LABELS[k] ?? k}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Year + Month filter ──────────────────────────────── */}
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-(--fg-faint)">Calendar Month</p>

            {/* Year toggle — shown when the brand has calendars in 2+ years */}
            {availableYears.length > 1 && (
              <div className="inline-flex items-center gap-1 rounded-lg border border-(--border-subtle) bg-(--surface-2) p-0.5">
                {availableYears.map((yr) => {
                  // Switching year jumps to that year's first available month.
                  const firstMonthOfYear = [...availableMonths].filter((m) => m.startsWith(yr)).sort()[0]
                  const isActiveYr = yr === calendarYear
                  return (
                    <Link
                      key={yr}
                      href={`/admin/qa/${brandId}?month=${firstMonthOfYear}`}
                      className={[
                        'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                        isActiveYr
                          ? 'bg-(--accent) text-white'
                          : 'text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg)',
                      ].join(' ')}
                    >
                      {yr}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {ALL_MONTHS.map((mon) => {
              const monthKey = `${calendarYear}-${mon}`
              const hasCalendar = availableMonths.has(monthKey)  // real data for this month
              const isSelected = monthKey === selectedMonth
              // Badge shows TOTAL generated posts per month so the admin sees
              // "Jun 12 · Jul 23 · Aug 21" at a glance — not the pending subset.
              // Selected month uses freshly-computed totalShown (in-page state).
              const monthTotal = isSelected ? totalShown : (totalByMonth.get(monthKey) ?? 0)
              const hasPending = hasCalendar && monthTotal > 0

              return (
                <Link
                  key={mon}
                  href={`/admin/qa/${brandId}?month=${monthKey}`}
                  className={[
                    'relative inline-flex h-8 min-w-[2.75rem] items-center justify-center rounded-xl border px-2 sm:px-3 text-xs sm:text-sm font-medium transition-all duration-150',
                    isSelected
                      ? 'border-(--accent) bg-(--accent) text-white shadow-sm shadow-(--accent)/30'
                      : hasCalendar
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                        : 'border-(--border-subtle) text-(--fg-faint)',
                    !hasCalendar && !isSelected ? 'opacity-40 pointer-events-none' : '',
                  ].join(' ')}
                >
                  {MONTH_NAMES[Number(mon) - 1]}
                  {hasPending && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-black">
                      {monthTotal}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
          <p className="mt-2 text-[10px] text-(--fg-faint)">
            Only months with generated calendars are interactive. Grey months have no content yet.
          </p>
        </div>

        {/* ── Calendar workspace ────────────────────────────────── */}
        <BrandCalendarWorkspace
          items={items}
          selectedMonth={selectedMonth}
          /* The calendar_id for the SELECTED month — drives "Release All" so it
             releases the month the admin is viewing (Jul/Aug), not always the
             primary/June calendar (group.calendar_id). 3-month rolling fix. */
          selectedCalendarId={
            brandCalendars.find((c) => c.month === selectedMonth)?.calendar_id ?? group.calendar_id
          }
          brandId={brandId}
        />
      </div>
    </div>
  )
}
