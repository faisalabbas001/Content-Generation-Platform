import Link from 'next/link'
import { adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody } from '@repo/ui/card'
import { Stat } from '@repo/ui/stat'
import { Badge } from '@repo/ui/badge'
import { Progress } from '@repo/ui/progress'
import { getServerT } from '@/lib/i18n-server'
import { formatDate, sarCents } from '@/lib/format'
import { SystemCeilingEditor } from './system-ceiling-editor'
import { MonthPicker } from './month-picker'
import type { BrandMonthlySummary, UsageLog, MonthlyCostBrand, CostMonthOption } from '@repo/db/types'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

type CostStatus = 'normal' | 'approaching' | 'critical' | 'breached'

function statusTone(s: CostStatus): 'success' | 'warning' | 'danger' | 'info' {
  if (s === 'normal')      return 'success'
  if (s === 'approaching') return 'warning'
  return 'danger'
}
function progressTone(s: CostStatus): 'success' | 'warning' | 'danger' | 'accent' {
  if (s === 'normal')      return 'success'
  if (s === 'approaching') return 'warning'
  return 'danger'
}
function systemStatus(spend: number, cfg: { monthly_ceiling_usd: number; alert_at_pct: number; halt_at_pct: number }): CostStatus {
  const pct = cfg.monthly_ceiling_usd > 0 ? (spend / cfg.monthly_ceiling_usd) * 100 : 0
  if (pct >= cfg.halt_at_pct)  return 'breached'
  if (pct >= 90)               return 'critical'
  if (pct >= cfg.alert_at_pct) return 'approaching'
  return 'normal'
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function monthLabel(iso: string) {
  const [y, m] = iso.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function isCurrentMonth(iso: string) {
  const now = new Date()
  return iso.startsWith(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`)
}

/** Build all 12 months for a given year, merging with real spend data */
function buildMonthOptions(year: number, spendData: CostMonthOption[]): Array<{
  iso: string; label: string; spend: number; calls: number; isCurrent: boolean; isFuture: boolean
}> {
  const spendMap = new Map(spendData.map(m => [m.month_iso, m]))
  const now = new Date()
  return Array.from({ length: 12 }, (_, i) => {
    const iso = `${year}-${String(i + 1).padStart(2, '0')}-01`
    const d = spendMap.get(iso)
    const isCurrent = now.getUTCFullYear() === year && now.getUTCMonth() === i
    const isFuture  = year > now.getUTCFullYear() || (year === now.getUTCFullYear() && i > now.getUTCMonth())
    return { iso, label: MONTH_NAMES[i], spend: d?.total_spend ?? 0, calls: d?.calls ?? 0, isCurrent, isFuture }
  })
}

export default async function CostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const { locale, t } = await getServerT()
  const activeTab   = sp.tab ?? 'brands'
  const callsPage   = Math.max(1, parseInt(sp.page ?? '1', 10))
  const callsOffset = (callsPage - 1) * PAGE_SIZE

  // ── Month selector ──────────────────────────────────────────────────
  const now            = new Date()
  const currentMonthIso = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`
  const selectedMonth  = sp.month ?? currentMonthIso

  const [summary, brandSummaries, recentLogs, sysCfg, monthlySummary, availableMonths] = await Promise.all([
    adminQ.getSystemMonthlySummary().catch(() => ({
      total_spend_usd: 0, total_calls: 0, brands_active: 0,
      brands_approaching: 0, brands_critical: 0, brands_breached: 0,
      by_agent: {}, by_flow: {}, by_request_type: {},
    })),
    adminQ.getBrandMonthlySummaries().catch(() => [] as BrandMonthlySummary[]),
    adminQ.getRecentUsage(500).catch(() => [] as UsageLog[]),
    adminQ.getSystemCostConfig().catch(() => ({ monthly_ceiling_usd: 200, alert_at_pct: 70, halt_at_pct: 100 })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adminQ as any).getMonthlyCostSummary(selectedMonth).catch(() => null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adminQ as any).getAvailableCostMonths().catch(() => [{ month_iso: currentMonthIso, calls: 0, total_spend: 0 }]),
  ])

  // ── Selected month data ─────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ms = monthlySummary as any
  const msBrands   = (ms?.brands ?? []) as MonthlyCostBrand[]
  const msTotal    = Number(ms?.total_spend   ?? 0)
  const msCalls    = Number(ms?.total_calls   ?? 0)
  const msRt       = (ms?.by_request_type ?? {}) as Record<string, number>
  const msAgent    = (ms?.by_agent        ?? {}) as Record<string, number>
  const msFlow     = (ms?.by_flow         ?? {}) as Record<string, number>
  const msAi       = msRt['ai_cost']    ?? 0
  const msImage    = msRt['image_cost'] ?? 0
  const msVideo    = msRt['video_cost'] ?? 0
  const msOther    = Math.max(0, msTotal - msAi - msImage - msVideo)
  const msBreached = msBrands.filter(b => b.cost_status === 'breached' || b.cost_blocked)
  const msAtRisk   = msBrands.filter(b => b.cost_status !== 'normal')
  const sysCeiling = sysCfg.monthly_ceiling_usd

  // ── Footer totals summed from brand rows (not system aggregates) ────
  // This ensures the footer matches the column values above it exactly.
  // msTotal/msAi/etc. may include spend from orphan brands or NULL-brand rows
  // that don't appear in the brands table — those are shown as "unattributed" separately.
  const ftTotal  = msBrands.reduce((s, b) => s + Number(b.total_spend), 0)
  const ftAi     = msBrands.reduce((s, b) => s + Number(b.ai_spend), 0)
  const ftImage  = msBrands.reduce((s, b) => s + Number(b.image_spend), 0)
  const ftVideo  = msBrands.reduce((s, b) => s + Number(b.video_spend), 0)
  const ftCalls  = msBrands.reduce((s, b) => s + Number(b.calls), 0)
  const ftUnattr = Math.max(0, msTotal - ftTotal)

  // ── Current-month projection (only for current month) ──────────────
  const dayOfMonth  = now.getUTCDate()
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const daysLeft    = daysInMonth - dayOfMonth
  const isCurrent   = isCurrentMonth(selectedMonth)
  const dailyRate   = isCurrent && dayOfMonth > 0 ? msTotal / dayOfMonth : 0
  const projected   = isCurrent ? dailyRate * daysInMonth : null

  // ── Breached alert (current month only) ────────────────────────────
  const breachedBrands = brandSummaries.filter((b) => b.cost_status === 'breached')

  // ── Current-month system stats (for top KPI cards) ─────────────────
  const sysSpendPct = sysCeiling > 0 ? (summary.total_spend_usd / sysCeiling) * 100 : 0
  const sysStatus   = systemStatus(summary.total_spend_usd, sysCfg)

  // ── Agent/flow breakdowns for selected month ────────────────────────
  const agentBreakdown = Object.entries(msAgent).sort((a, b) => b[1] - a[1])
  const flowBreakdown  = Object.entries(msFlow).sort((a, b) => b[1] - a[1])

  // ── Calls tab (always current — raw logs don't have historical filter) ──
  const totalCalls  = recentLogs.length
  const totalPages  = Math.max(1, Math.ceil(totalCalls / PAGE_SIZE))
  const pagedLogs   = recentLogs.slice(callsOffset, callsOffset + PAGE_SIZE)

  const tabHref   = (tab: string) => `/admin/cost?month=${selectedMonth}&tab=${tab}`
  const pageHref  = (pg: number)  => `/admin/cost?month=${selectedMonth}&tab=calls&page=${pg}`

  const editorLabels = {
    ceilingEditor: t('adminCost.ceilingEditor'),
    ceilingLabel:  t('adminCost.ceilingLabel'),
    alertPctLabel: t('adminCost.alertPctLabel'),
    haltPctLabel:  t('adminCost.haltPctLabel'),
    saveCeiling:   t('adminCost.saveCeiling'),
    savingCeiling: t('adminCost.savingCeiling'),
    ceilingSaved:  t('adminCost.ceilingSaved'),
    ceilingError:  t('adminCost.ceilingError'),
  }

  // ── Build month options for picker ─────────────────────────────────
  const gridYear     = Number(selectedMonth.split('-')[0])
  const monthOptions = buildMonthOptions(gridYear, availableMonths as CostMonthOption[])

  return (
    <div className="space-y-5">
      {/* ── Header row with month picker ──────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow={t('adminCost.eyebrow')}
          title={t('adminCost.systemTitle')}
          subtitle={t('adminCost.systemSubtitle')}
        />
        <div className="shrink-0 flex flex-col items-end gap-2 pt-1">
          <MonthPicker
            options={monthOptions}
            selected={selectedMonth}
            activeTab={activeTab}
          />
          <div className="flex items-center gap-2">
            {msBreached.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg bg-red-500/12 border border-red-500/30 px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                <span className="text-[10px] font-semibold text-red-400">
                  {msBreached.length} brand{msBreached.length > 1 ? 's' : ''} over ceiling
                </span>
              </div>
            )}
            {msAtRisk.filter(b => b.cost_status === 'approaching' || b.cost_status === 'critical').length > 0 && msBreached.length === 0 && (
              <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/12 border border-amber-500/30 px-2.5 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="text-[10px] font-semibold text-amber-400">
                  {msAtRisk.filter(b => b.cost_status !== 'normal').length} brand{msAtRisk.filter(b => b.cost_status !== 'normal').length > 1 ? 's' : ''} near limit
                </span>
              </div>
            )}
            <span className="text-[10px] text-(--fg-faint)">
              {isCurrent ? 'Live' : 'Historical'} · {monthLabel(selectedMonth)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Breached brands alert strip ───────────────────────────────── */}
      {msBreached.length > 0 && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/6 px-5 py-3.5">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse shrink-0" />
            <p className="text-sm font-semibold text-red-300">
              {msBreached.length} brand{msBreached.length > 1 ? 's' : ''} exceeded ceiling in {monthLabel(selectedMonth)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {msBreached.map((b) => (
              <Link key={b.brand_id} href={`/admin/cost/${b.brand_id}`}
                className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2 hover:bg-red-500/20 transition-colors">
                <div>
                  <p className="text-xs font-semibold text-red-300 leading-tight">{b.brand_name_ar || b.brand_name_en}</p>
                  <p className="text-[9px] text-red-400/70">{b.client_slug}</p>
                </div>
                <div className="text-right ml-2">
                  <p className="text-xs font-mono font-bold text-red-300">${Number(b.total_spend).toFixed(2)}</p>
                  <p className="text-[9px] text-red-400/60">/ ${Number(b.monthly_ceiling_usd).toFixed(0)} ceiling</p>
                </div>
                <div className="ml-1">
                  <span className="text-[9px] font-bold text-red-400 bg-red-500/20 rounded px-1.5 py-0.5">
                    {Number(b.spend_pct).toFixed(0)}%
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Month KPI row ───────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="oc-mount oc-stagger-1">
          <Stat label="Total Spend" value={`$${msTotal.toFixed(4)}`} tone="accent"
            helper={sysCeiling > 0 ? `${((msTotal/sysCeiling)*100).toFixed(1)}% of ceiling` : undefined} />
        </div>
        <div className="oc-mount oc-stagger-2">
          <Stat label="AI (tokens)" value={`$${msAi.toFixed(4)}`}
            helper={msTotal > 0 ? `${((msAi/msTotal)*100).toFixed(0)}% of spend` : '—'} />
        </div>
        <div className="oc-mount oc-stagger-3">
          <Stat label="Image (FAL)" value={`$${msImage.toFixed(4)}`}
            helper={msTotal > 0 ? `${((msImage/msTotal)*100).toFixed(0)}% of spend` : '—'} />
        </div>
        <div className="oc-mount oc-stagger-4">
          <Stat label="Video (FAL)" value={`$${msVideo.toFixed(4)}`}
            helper={msTotal > 0 ? `${((msVideo/msTotal)*100).toFixed(0)}% of spend` : '—'} />
        </div>
        <div className="oc-mount oc-stagger-5">
          {projected !== null ? (
            <Stat
              label="Projected month-end"
              value={`$${projected.toFixed(2)}`}
              tone={projected > sysCeiling ? 'danger' : 'success'}
              helper={`$${dailyRate.toFixed(4)}/day · ${daysLeft}d left`}
            />
          ) : (
            <Stat label="API Calls" value={msCalls.toLocaleString()} />
          )}
        </div>
      </div>

      {/* ── Spend mix bar ──────────────────────────────────────────────── */}
      {msTotal > 0 && (
        <Card>
          <CardBody className="py-3">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-semibold text-(--fg-muted)">Spend mix</span>
              <span className="text-xs text-(--fg-faint)">{msCalls.toLocaleString()} calls · {msBrands.length} brands</span>
              {msOther > 0 && <span className="text-xs text-(--fg-faint)">+${msOther.toFixed(2)} other</span>}
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full gap-px">
              {msAi > 0    && <div style={{ width: `${(msAi/msTotal)*100}%`    }} className="bg-violet-500/80 rounded-l-full" title={`AI $${msAi.toFixed(4)}`} />}
              {msImage > 0 && <div style={{ width: `${(msImage/msTotal)*100}%` }} className="bg-blue-500/80"                  title={`Image $${msImage.toFixed(4)}`} />}
              {msVideo > 0 && <div style={{ width: `${(msVideo/msTotal)*100}%` }} className="bg-amber-500/80"                 title={`Video $${msVideo.toFixed(4)}`} />}
              {msOther > 0 && <div style={{ width: `${(msOther/msTotal)*100}%` }} className="bg-(--surface-4) rounded-r-full" title={`Other $${msOther.toFixed(4)}`} />}
            </div>
            <div className="flex gap-4 mt-2">
              {[['AI', msAi, 'bg-violet-500/80'], ['Image', msImage, 'bg-blue-500/80'], ['Video', msVideo, 'bg-amber-500/80']].map(([label, val, cls]) => (
                <div key={label as string} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-sm ${cls as string}`} />
                  <span className="text-[10px] text-(--fg-faint)">{label as string}</span>
                  <span className="text-[10px] font-semibold text-(--fg-muted)">${(val as number).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── System ceiling banner (only relevant for current month) ─────── */}
      {isCurrent && (
        <Card className={`border ${
          sysStatus === 'normal'      ? 'border-(--success)'
          : sysStatus === 'approaching' ? 'border-(--warning)'
          : 'border-(--danger)'
        }`}>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="shrink-0 text-xs font-medium text-(--fg-muted) w-28">{t('adminCost.systemCeiling')}</div>
              <Progress value={sysSpendPct} tone={progressTone(sysStatus)} className="flex-1" />
              <span className="shrink-0 font-mono text-sm text-(--fg-muted)">
                ${summary.total_spend_usd.toFixed(4)} / ${sysCeiling.toFixed(2)}
                <span className="ml-2 text-(--fg-faint)">({sysSpendPct.toFixed(1)}%)</span>
              </span>
              <Badge tone={statusTone(sysStatus)} size="sm" dot={sysStatus !== 'normal'}>
                {t(`adminCost.status${sysStatus.charAt(0).toUpperCase() + sysStatus.slice(1)}` as Parameters<typeof t>[0])}
              </Badge>
            </div>
            <div className="flex flex-col gap-2 pt-0.5">
              <p className="text-xs text-(--fg-faint)">{t('adminCost.systemCeilingDesc')}</p>
              <SystemCeilingEditor current={sysCfg} labels={editorLabels} />
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Agent + Flow breakdowns ─────────────────────────────────────── */}
      {agentBreakdown.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardBody className="space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-(--fg-faint)">By Agent</p>
              {agentBreakdown.slice(0, 6).map(([agent, cost]) => {
                const pct = msTotal > 0 ? (cost / msTotal) * 100 : 0
                return (
                  <div key={agent} className="flex items-center gap-3">
                    <Badge tone="outline" size="sm" className="shrink-0 w-24 justify-center">{agent}</Badge>
                    <Progress value={pct} tone="accent" className="flex-1" />
                    <span className="shrink-0 font-mono text-xs text-(--fg-muted) w-20 text-right">${cost.toFixed(4)}</span>
                  </div>
                )
              })}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-(--fg-faint)">By Flow</p>
              {flowBreakdown.slice(0, 6).map(([flow, cost]) => {
                const pct = msTotal > 0 ? (cost / msTotal) * 100 : 0
                return (
                  <div key={flow} className="flex items-center gap-3">
                    <Badge tone="outline" size="sm" className="shrink-0 w-24 justify-center truncate">{flow}</Badge>
                    <Progress value={pct} tone="accent" className="flex-1" />
                    <span className="shrink-0 font-mono text-xs text-(--fg-muted) w-20 text-right">${cost.toFixed(4)}</span>
                  </div>
                )
              })}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex gap-1 border-b border-(--border-subtle)">
          {(['brands', 'calls'] as const).map((tab) => {
            const isActive = activeTab === tab
            const label    = tab === 'brands' ? t('adminCost.tabBrands') : t('adminCost.tabRecentCalls')
            const count    = tab === 'brands' ? msBrands.length : msCalls
            return (
              <Link
                key={tab}
                href={tabHref(tab)}
                scroll={false}
                className={[
                  'px-4 py-2.5 text-sm font-medium rounded-t-(--r-sm) transition-colors',
                  isActive
                    ? 'bg-(--surface-2) border border-b-transparent border-(--border-subtle) text-(--fg)'
                    : 'text-(--fg-muted) hover:text-(--fg)',
                ].join(' ')}
              >
                {label}
                <span className="ml-2 rounded-full bg-(--surface-4) px-1.5 py-0.5 text-[10px] font-semibold text-(--fg-muted)">
                  {count}
                </span>
              </Link>
            )
          })}
        </div>

        {/* ── Brands tab ────────────────────────────────────────────────── */}
        {activeTab === 'brands' && (
          <Card className="rounded-t-none border-t-0">
            {msBrands.length === 0 ? (
              <CardBody>
                <p className="text-sm text-(--fg-muted) text-center py-8">No spend data for {monthLabel(selectedMonth)}</p>
              </CardBody>
            ) : (
              <div className="divide-y divide-(--border-subtle)">
                {/* Header */}
                <div className="grid grid-cols-[1fr_80px_100px_80px_80px_80px_90px_80px] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-(--fg-faint)">
                  <span>Brand</span>
                  <span className="text-right">Total</span>
                  <span>Usage</span>
                  <span className="text-right">AI</span>
                  <span className="text-right">Image</span>
                  <span className="text-right">Video</span>
                  <span>Status</span>
                  <span className="text-right">Calls</span>
                </div>
                {msBrands.map((b) => {
                  const pct = Number(b.spend_pct ?? 0)
                  const status = b.cost_status as CostStatus
                  const willBreach = isCurrent && dayOfMonth > 0
                    ? (Number(b.total_spend) / dayOfMonth) * daysInMonth > Number(b.monthly_ceiling_usd)
                    : false
                  return (
                    <div key={b.brand_id} className={`grid grid-cols-[1fr_80px_100px_80px_80px_80px_90px_80px] gap-2 px-4 py-3 items-center hover:bg-(--surface-2) transition-colors ${b.cost_blocked ? 'bg-red-500/4' : ''}`}>
                      {/* Brand name */}
                      <Link href={`/admin/cost/${b.brand_id}`} className="group min-w-0">
                        <div className="font-medium text-sm text-(--fg) group-hover:text-(--accent) truncate">{b.brand_name_ar || b.brand_name_en}</div>
                        <div className="text-[10px] text-(--fg-faint) truncate">{b.client_slug}</div>
                      </Link>
                      {/* Total */}
                      <div className="text-right">
                        <div className="font-mono text-xs font-semibold text-(--fg)">${Number(b.total_spend).toFixed(2)}</div>
                        <div className="font-mono text-[9px] text-(--fg-faint)">/ ${Number(b.monthly_ceiling_usd).toFixed(0)}</div>
                      </div>
                      {/* Progress bar */}
                      <div>
                        <Progress value={pct} tone={progressTone(status)} />
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="text-[9px] text-(--fg-faint)">{pct.toFixed(1)}%</span>
                          {willBreach && <span className="text-[9px] text-red-400 font-bold">⚠</span>}
                        </div>
                      </div>
                      {/* AI */}
                      <div className="text-right font-mono text-xs text-(--fg-muted)">${Number(b.ai_spend).toFixed(2)}</div>
                      {/* Image */}
                      <div className="text-right font-mono text-xs text-(--fg-muted)">${Number(b.image_spend).toFixed(2)}</div>
                      {/* Video */}
                      <div className="text-right font-mono text-xs text-(--fg-muted)">${Number(b.video_spend).toFixed(2)}</div>
                      {/* Status */}
                      <div>
                        <Badge tone={statusTone(status)} size="sm" dot={status !== 'normal'}>
                          {b.cost_blocked ? 'Blocked' : status.charAt(0).toUpperCase() + status.slice(1)}
                        </Badge>
                      </div>
                      {/* Calls */}
                      <div className="text-right font-mono text-xs text-(--fg-muted)">{b.calls}</div>
                    </div>
                  )
                })}
                {/* Footer totals — summed from brand rows, matching columns exactly */}
                <div className="grid grid-cols-[1fr_80px_100px_80px_80px_80px_90px_80px] gap-2 px-4 py-3 bg-(--surface-2) text-xs font-bold text-(--fg)">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-(--fg-muted)">Total — {msBrands.length} brands</span>
                    {ftUnattr > 0.001 && (
                      <span className="text-[9px] font-normal text-amber-400/80">
                        +${ftUnattr.toFixed(4)} unattributed (no brand config)
                      </span>
                    )}
                  </div>
                  <span className="text-right font-mono">${ftTotal.toFixed(2)}</span>
                  <span />
                  <span className="text-right font-mono text-(--fg-muted)">${ftAi.toFixed(2)}</span>
                  <span className="text-right font-mono text-(--fg-muted)">${ftImage.toFixed(2)}</span>
                  <span className="text-right font-mono text-(--fg-muted)">${ftVideo.toFixed(2)}</span>
                  <span />
                  <span className="text-right font-mono text-(--fg-muted)">{ftCalls.toLocaleString()}</span>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* ── Calls tab ─────────────────────────────────────────────────── */}
        {activeTab === 'calls' && (
          <Card className="rounded-t-none border-t-0">
            <div className="divide-y divide-(--border-subtle)">
              <div className="grid grid-cols-[100px_140px_80px_70px_100px_80px_70px_70px] gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-(--fg-faint)">
                <span>When</span><span>Brand</span><span>Flow</span><span>Agent</span><span>Type</span><span>Cost</span><span>Status</span><span className="text-right">Tokens</span>
              </div>
              {pagedLogs.map((r) => (
                <div key={r.log_id} className="grid grid-cols-[100px_140px_80px_70px_100px_80px_70px_70px] gap-2 px-4 py-2.5 items-center hover:bg-(--surface-2) transition-colors">
                  <span className="text-[10px] text-(--fg-faint)">{formatDate(r.created_at, locale)}</span>
                  <Link href={r.brand_id ? `/admin/cost/${r.brand_id}` : '#'} className="text-xs text-(--fg) hover:text-(--accent) truncate">{r.client_slug ?? '—'}</Link>
                  <Badge tone="outline" size="sm">{r.flow_id ?? '—'}</Badge>
                  <span className="text-xs text-(--fg-muted)">{r.agent ?? '—'}</span>
                  <span className="text-[10px] text-(--fg-faint)">{r.request_type ?? '—'}</span>
                  <span className="font-mono text-xs">{sarCents(r.cost_usd)}</span>
                  <Badge tone={r.status === 'success' ? 'success' : r.error_code ? 'danger' : 'warning'} size="sm">{r.status ?? '—'}</Badge>
                  <span className="font-mono text-[10px] text-(--fg-faint) text-right">{r.tokens_in != null ? r.tokens_in.toLocaleString() : '—'}</span>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-(--border-subtle) px-6 py-3">
                <span className="text-xs text-(--fg-muted)">{callsOffset + 1}–{Math.min(callsOffset + PAGE_SIZE, totalCalls)} / {totalCalls}</span>
                <div className="flex gap-2">
                  {callsPage > 1 && (
                    <Link href={pageHref(callsPage - 1)} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 text-xs hover:bg-(--surface-2) transition-colors">
                      {t('adminCost.paginationPrev')}
                    </Link>
                  )}
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - callsPage) <= 2)
                    .reduce<(number | '…')[]>((acc, p, i, arr) => {
                      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('…')
                      acc.push(p); return acc
                    }, [])
                    .map((p, i) => p === '…'
                      ? <span key={`e${i}`} className="px-1.5 py-1 text-xs text-(--fg-muted)">…</span>
                      : <Link key={p} href={pageHref(p as number)} scroll={false} className={['rounded-(--r-sm) border px-2.5 py-1 text-xs transition-colors', p === callsPage ? 'bg-(--accent) border-(--accent) text-(--accent-fg)' : 'border-(--border-subtle) hover:bg-(--surface-2)'].join(' ')}>{p}</Link>
                    )}
                  {callsPage < totalPages && (
                    <Link href={pageHref(callsPage + 1)} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 text-xs hover:bg-(--surface-2) transition-colors">
                      {t('adminCost.paginationNext')}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
