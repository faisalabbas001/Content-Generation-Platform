import Link from 'next/link'
import { adminQ, adminClient } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody } from '@repo/ui/card'
import { Stat } from '@repo/ui/stat'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { Section } from '@repo/ui/section'
import { Progress } from '@repo/ui/progress'
import { getServerT } from '@/lib/i18n-server'
import { formatDate, sarCents } from '@/lib/format'
import { CeilingEditor } from '../ceiling-editor'
import type { UsageLog } from '@repo/db/types'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

type CostStatus = 'normal' | 'approaching' | 'critical' | 'breached'

function costStatusTone(s: CostStatus): 'info' | 'warning' | 'danger' {
  if (s === 'normal')      return 'info'
  if (s === 'approaching') return 'warning'
  return 'danger'
}
function progressTone(s: CostStatus): 'success' | 'warning' | 'danger' | 'accent' {
  if (s === 'normal')      return 'success'
  if (s === 'approaching') return 'warning'
  return 'danger'
}
function calcStatus(pct: number, alertAt: number): CostStatus {
  if (pct >= 100)    return 'breached'
  if (pct >= 90)     return 'critical'
  if (pct >= alertAt) return 'approaching'
  return 'normal'
}

// Format "2025-06" → "Jun 2025"
function fmtMonth(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(
    locale === 'ar' ? 'ar-SA' : 'en-US',
    { year: 'numeric', month: 'long' }
  )
}

export default async function BrandCostPage({
  params,
  searchParams,
}: {
  params:       Promise<{ brand_id: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { brand_id } = await params
  const sp = await searchParams
  const { locale, t } = await getServerT()

  const page   = Math.max(1, parseInt(sp.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const [logs, allTimeStats, config, profileResult] = await Promise.all([
    // Recent 500 rows for the paginated call log — display only
    adminQ.getBrandUsageLogs(brand_id, 500),
    // All-time aggregates from DB — no row cap, accurate totals
    adminQ.getBrandAllTimeStats(brand_id),
    adminQ.getBrandCostConfig(brand_id),
    adminClient()
      .from('brand_profiles')
      .select('brand_id, brand_name_ar, brand_name_en, client_slug, sector, tier')
      .eq('brand_id', brand_id)
      .single(),
  ])
  interface MonthStat { month_key: string; spend: number; calls: number; ai_spend: number; image_spend: number; video_spend: number }
  const stats = allTimeStats as { total_spend: number; total_calls: number; month_history: MonthStat[] }

  const profile = profileResult.data as {
    brand_id:      string
    brand_name_ar: string
    brand_name_en: string | null
    client_slug:   string
    sector:        string
    tier:          string
  } | null

  const ceiling  = config?.monthly_ceiling_usd ?? 50
  const alertAt  = config?.alert_at_pct ?? 70

  // ── This month — from recent logs (bounded to current month only) ─────────
  const now        = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const monthLogs  = logs.filter((l) => new Date(l.created_at) >= monthStart)

  // Current-month totals come from getBrandAllTimeStats month_history (DB-aggregated, no cap)
  const curMonthKey  = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const curMonthRow  = stats.month_history.find(r => r.month_key === curMonthKey)
  const totalSpend   = curMonthRow?.spend   ?? 0
  const aiSpend      = curMonthRow?.ai_spend   ?? 0
  const imageSpendM  = curMonthRow?.image_spend ?? 0
  const videoSpendM  = curMonthRow?.video_spend ?? 0
  const visualSpend  = imageSpendM + videoSpendM
  const spendPct     = ceiling > 0 ? (totalSpend / ceiling) * 100 : 0
  const costStatus   = calcStatus(spendPct, alertAt)

  // ── Agent + flow breakdown — from recent month logs (for breakdowns only) ─
  const byAgent = new Map<string, number>()
  const byFlow  = new Map<string, number>()
  let   imageCount  = 0
  let   videoCount  = 0
  for (const l of monthLogs) {
    if (l.agent)   byAgent.set(l.agent,   (byAgent.get(l.agent)   ?? 0) + Number(l.cost_usd))
    if (l.flow_id) byFlow.set(l.flow_id,  (byFlow.get(l.flow_id)  ?? 0) + Number(l.cost_usd))
    if (l.request_type === 'image_cost') imageCount++
    if (l.request_type === 'video_cost') videoCount++
  }
  const agentBreakdown = Array.from(byAgent.entries()).sort((a, b) => b[1] - a[1])
  const flowBreakdown  = Array.from(byFlow.entries()).sort((a, b) => b[1] - a[1])

  // ── All-time totals — from DB aggregate, no row cap ───────────────────────
  const allTimeSpend = stats.total_spend
  const allTimeCalls = stats.total_calls

  // ── Per-month history — from DB aggregate, covers all months ─────────────
  type MonthRow = {
    key: string
    label: string
    spend: number
    calls: number
    ai_spend: number
    image_spend: number
    video_spend: number
    spendPct: number
    status: CostStatus
  }
  const monthHistory: MonthRow[] = stats.month_history.map(r => {
    const pct = ceiling > 0 ? (r.spend / ceiling) * 100 : 0
    return {
      key:         r.month_key,
      label:       fmtMonth(r.month_key, locale),
      spend:       r.spend,
      calls:       r.calls,
      ai_spend:    r.ai_spend,
      image_spend: r.image_spend,
      video_spend: r.video_spend,
      spendPct:    pct,
      status:      calcStatus(pct, alertAt),
    }
  })

  // ── Logs table — most recent 500 rows (display only, not used for totals) ─
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
  const totalLogs  = sortedLogs.length
  const totalPages = Math.max(1, Math.ceil(totalLogs / PAGE_SIZE))
  const pagedLogs  = sortedLogs.slice(offset, offset + PAGE_SIZE)

  const displayName   = profile?.brand_name_ar ?? brand_id
  const displayNameEn = profile?.brand_name_en
  const clientSlug    = profile?.client_slug ?? ''
  const sector        = profile?.sector ?? ''

  const pageHref = (pg: number) => `/admin/cost/${brand_id}?page=${pg}`

  const ceilingEditorLabels = {
    ceilingEditor: t('adminCost.ceilingEditor'),
    ceilingLabel:  t('adminCost.ceilingLabel'),
    tierLabel:     t('adminCost.tierLabel'),
    alertPctLabel: t('adminCost.alertPctLabel'),
    haltPctLabel:  t('adminCost.haltPctLabel'),
    saveCeiling:   t('adminCost.saveCeiling'),
    savingCeiling: t('adminCost.savingCeiling'),
    ceilingSaved:  t('adminCost.ceilingSaved'),
    ceilingError:  t('adminCost.ceilingError'),
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow={`${sector} · ${clientSlug}`}
          title={displayName}
          subtitle={displayNameEn ?? t('adminCost.brandDrilldown')}
        />
        <Link
          href="/admin/cost"
          className="mt-1 shrink-0 text-xs text-(--fg-muted) hover:text-(--fg) transition-colors"
        >
          ← Back to system
        </Link>
      </div>

      {/* ── Stats row — 7 cards ──────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="oc-mount oc-stagger-1">
          <Stat
            label={t('adminCost.thisMonthSpend')}
            value={`$${totalSpend.toFixed(4)}`}
            tone="accent"
            helper={`${spendPct.toFixed(1)}% of ceiling`}
          />
        </div>
        <div className="oc-mount oc-stagger-2">
          <Stat
            label={t('adminCost.colSpend')}
            value={`$${ceiling.toFixed(2)}`}
            tone="neutral"
            helper={`Alert at ${alertAt}%`}
          />
        </div>
        <div className="oc-mount oc-stagger-3">
          <Stat
            label={t('adminCost.colProgress')}
            value={`${spendPct.toFixed(1)}%`}
            tone={costStatus === 'normal' ? 'success' : costStatus === 'approaching' ? 'warning' : 'danger'}
          />
        </div>
        <div className="oc-mount oc-stagger-4">
          <Stat
            label="Visual spend"
            value={`$${visualSpend.toFixed(4)}`}
            tone="info"
            helper={`${imageCount} images · ${videoCount} videos`}
          />
        </div>
        <div className="oc-mount oc-stagger-5">
          <Stat
            label="AI spend"
            value={`$${aiSpend.toFixed(4)}`}
            tone="neutral"
            helper={`${((aiSpend / (totalSpend || 1)) * 100).toFixed(1)}% of total`}
          />
        </div>
        <div className="oc-mount oc-stagger-6">
          <Stat
            label="All-time spend"
            value={`$${allTimeSpend.toFixed(4)}`}
            tone="info"
            helper={`${allTimeCalls} calls total`}
          />
        </div>
        <div className="oc-mount oc-stagger-7">
          <Stat
            label={t('adminCost.thisMonthCalls')}
            value={monthLogs.length}
            helper={`${monthHistory.length} months recorded`}
          />
        </div>
      </div>

      {/* ── Cost status banner + ceiling editor (column layout) ─────────────── */}
      <Card className={`border ${
        costStatus === 'normal'        ? 'border-(--info)'
        : costStatus === 'approaching' ? 'border-(--warning)'
        : 'border-(--danger)'
      }`}>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge tone={costStatusTone(costStatus)} dot={costStatus !== 'normal'}>
              {t(`adminCost.status${costStatus.charAt(0).toUpperCase() + costStatus.slice(1)}` as Parameters<typeof t>[0])}
            </Badge>
            <Progress value={spendPct} tone={progressTone(costStatus)} className="flex-1" />
            <span className="font-mono text-sm text-(--fg-muted) shrink-0">
              ${totalSpend.toFixed(4)} / ${ceiling.toFixed(2)}
            </span>
          </div>
          {/* Editor stacked below, full width */}
          <div className="flex flex-col gap-2 pt-0.5">
            <CeilingEditor
              brandId={brand_id}
              current={{
                monthly_ceiling_usd: config?.monthly_ceiling_usd ?? 50,
                tier:                config?.tier ?? 'standard',
                alert_at_pct:        alertAt,
                halt_at_pct:         config?.halt_at_pct ?? 100,
              }}
              labels={ceilingEditorLabels}
            />
          </div>
        </CardBody>
      </Card>

      {/* ── Per-month spending history ────────────────────────────────────── */}
      {monthHistory.length > 0 && (
        <Section title="Monthly spending history">
          <Card>
            <DataTable<MonthRow>
              rows={monthHistory}
              density="compact"
              columns={[
                {
                  key: 'month',
                  header: 'Month',
                  primaryOnMobile: true,
                  render: (r) => (
                    <span className={`text-sm font-medium ${
                      r.key === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
                        ? 'text-(--accent)'
                        : 'text-(--fg)'
                    }`}>
                      {r.label}
                      {r.key === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` && (
                        <Badge tone="accent" size="sm" className="ms-2">current</Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'spend',
                  header: 'Spend',
                  align: 'end',
                  render: (r) => (
                    <div className="text-right">
                      <div className="font-mono text-xs text-(--fg)">${r.spend.toFixed(4)}</div>
                      <div className="font-mono text-xs text-(--fg-muted)">/ ${ceiling.toFixed(2)}</div>
                    </div>
                  ),
                },
                {
                  key: 'progress',
                  header: 'Usage',
                  render: (r) => (
                    <div className="w-32">
                      <Progress value={r.spendPct} tone={progressTone(r.status)} />
                      <div className="mt-0.5 text-right text-xs text-(--fg-muted)">{r.spendPct.toFixed(1)}%</div>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (r) => (
                    <Badge tone={costStatusTone(r.status)} size="sm" dot={r.status !== 'normal'}>
                      {t(`adminCost.status${r.status.charAt(0).toUpperCase() + r.status.slice(1)}` as Parameters<typeof t>[0])}
                    </Badge>
                  ),
                },
                {
                  key: 'calls',
                  header: 'API calls',
                  align: 'end',
                  render: (r) => <span className="font-mono text-xs">{r.calls}</span>,
                },
                {
                  key: 'ai',
                  header: 'AI',
                  align: 'end',
                  hideOnMobile: true,
                  render: (r) => (
                    <span className="font-mono text-xs text-(--fg-muted)">
                      {r.ai_spend > 0 ? `$${r.ai_spend.toFixed(4)}` : '—'}
                    </span>
                  ),
                },
                {
                  key: 'image',
                  header: 'Image',
                  align: 'end',
                  hideOnMobile: true,
                  render: (r) => (
                    <span className="font-mono text-xs text-(--fg-muted)">
                      {r.image_spend > 0 ? `$${r.image_spend.toFixed(4)}` : '—'}
                    </span>
                  ),
                },
                {
                  key: 'video',
                  header: 'Video',
                  align: 'end',
                  hideOnMobile: true,
                  render: (r) => (
                    <span className="font-mono text-xs text-(--fg-muted)">
                      {r.video_spend > 0 ? `$${r.video_spend.toFixed(4)}` : '—'}
                    </span>
                  ),
                },
                {
                  key: 'avg',
                  header: 'Avg / call',
                  align: 'end',
                  hideOnMobile: true,
                  render: (r) => (
                    <span className="font-mono text-xs text-(--fg-muted)">
                      {r.calls > 0 ? `$${(r.spend / r.calls).toFixed(6)}` : '—'}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </Section>
      )}

      {/* ── Agent + Flow breakdowns — full width, % of brand ceiling ──────── */}
      {agentBreakdown.length > 0 && (
        <Section title={t('adminCost.agentBreakdown')}>
          <Card>
            <CardBody className="space-y-3">
              <p className="text-xs text-(--fg-faint)">
                Bar = % of ${ceiling.toFixed(2)} brand ceiling · this month
              </p>
              {agentBreakdown.map(([agent, cost]) => {
                const pct  = ceiling > 0 ? (cost / ceiling) * 100 : 0
                const tone = pct >= 90 ? 'danger' : pct >= alertAt ? 'warning' : 'accent'
                return (
                  <div key={agent}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <Badge tone="outline" size="sm">{agent}</Badge>
                      <span className="font-mono text-(--fg-subtle)">{sarCents(cost)} · {pct.toFixed(1)}%</span>
                    </div>
                    <Progress value={pct} tone={tone} />
                  </div>
                )
              })}
            </CardBody>
          </Card>
        </Section>
      )}

      {flowBreakdown.length > 0 && (
        <Section title={t('adminCost.flowBreakdown')}>
          <Card>
            <CardBody className="space-y-3">
              <p className="text-xs text-(--fg-faint)">
                Bar = % of ${ceiling.toFixed(2)} brand ceiling · this month
              </p>
              {flowBreakdown.map(([flow, cost]) => {
                const pct  = ceiling > 0 ? (cost / ceiling) * 100 : 0
                const tone = pct >= 90 ? 'danger' : pct >= alertAt ? 'warning' : 'accent'
                return (
                  <div key={flow}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <Badge tone="outline" size="sm">{flow}</Badge>
                      <span className="font-mono text-(--fg-subtle)">{sarCents(cost)} · {pct.toFixed(1)}%</span>
                    </div>
                    <Progress value={pct} tone={tone} />
                  </div>
                )
              })}
            </CardBody>
          </Card>
        </Section>
      )}

      {/* ── Visual cost breakdown — image vs video ───────────────────────── */}
      {visualSpend > 0 && (
        <Section title="Visual generation breakdown">
          <Card>
            <CardBody className="space-y-3">
              <p className="text-xs text-(--fg-faint)">
                Image &amp; video generation costs (FAL) · this month
              </p>
              {imageCount > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <Badge tone="outline" size="sm">Image generation</Badge>
                    <span className="font-mono text-(--fg-subtle)">
                      ${monthLogs.filter(l => l.request_type === 'image_cost').reduce((n, l) => n + Number(l.cost_usd), 0).toFixed(4)} · {imageCount} images
                    </span>
                  </div>
                  <Progress
                    value={ceiling > 0 ? (monthLogs.filter(l => l.request_type === 'image_cost').reduce((n, l) => n + Number(l.cost_usd), 0) / ceiling) * 100 : 0}
                    tone="accent"
                  />
                </div>
              )}
              {videoCount > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <Badge tone="outline" size="sm">Video generation</Badge>
                    <span className="font-mono text-(--fg-subtle)">
                      ${monthLogs.filter(l => l.request_type === 'video_cost').reduce((n, l) => n + Number(l.cost_usd), 0).toFixed(4)} · {videoCount} videos
                    </span>
                  </div>
                  <Progress
                    value={ceiling > 0 ? (monthLogs.filter(l => l.request_type === 'video_cost').reduce((n, l) => n + Number(l.cost_usd), 0) / ceiling) * 100 : 0}
                    tone="warning"
                  />
                </div>
              )}
              <div className="border-t border-(--border-subtle) pt-2 flex items-center justify-between text-xs text-(--fg-muted)">
                <span>Total visual</span>
                <span className="font-mono">${visualSpend.toFixed(4)} · {((visualSpend / (totalSpend || 1)) * 100).toFixed(1)}% of month spend</span>
              </div>
            </CardBody>
          </Card>
        </Section>
      )}

      {/* ── Recent API calls — paginated (most recent 500, for display only) ── */}
      <Section title={`${t('adminCost.allCalls')} — recent ${totalLogs} calls`}>
        <Card>
          <DataTable<UsageLog>
            rows={pagedLogs}
            density="compact"
            empty={<span className="text-sm text-(--fg-muted)">{t('adminCost.noSpendYet')}</span>}
            columns={[
              {
                key: 'when',
                header: t('adminCost.colWhen'),
                primaryOnMobile: true,
                render: (r) => <span className="text-xs text-(--fg-muted)">{formatDate(r.created_at, locale)}</span>,
              },
              {
                key: 'flow',
                header: t('adminCost.colFlow'),
                render: (r) => <Badge tone="outline" size="sm">{r.flow_id ?? '—'}</Badge>,
              },
              {
                key: 'agent',
                header: t('adminCost.colAgent'),
                render: (r) => <span className="text-xs">{r.agent ?? '—'}</span>,
              },
              {
                key: 'request_type',
                header: t('adminCost.colRequestType'),
                hideOnMobile: true,
                render: (r) => <span className="text-xs text-(--fg-muted)">{r.request_type ?? '—'}</span>,
              },
              {
                key: 'model',
                header: t('adminCost.colModel'),
                hideOnMobile: true,
                render: (r) => <span className="text-xs text-(--fg-muted)">{r.model ?? '—'}</span>,
              },
              {
                key: 'tokens',
                header: t('adminCost.colTokens'),
                align: 'end',
                hideOnMobile: true,
                render: (r) => (
                  <span className="font-mono text-xs text-(--fg-muted)">
                    {r.tokens_in != null ? r.tokens_in.toLocaleString() : '—'} / {r.tokens_out != null ? r.tokens_out.toLocaleString() : '—'}
                  </span>
                ),
              },
              {
                key: 'cost',
                header: t('adminCost.colCost'),
                align: 'end',
                render: (r) => <span className="font-mono text-xs">{sarCents(r.cost_usd)}</span>,
              },
              {
                key: 'status',
                header: t('adminCost.colStatus'),
                render: (r) => (
                  <Badge tone={r.status === 'success' ? 'success' : r.error_code ? 'danger' : 'warning'} size="sm">
                    {r.status ?? '—'}
                  </Badge>
                ),
              },
              {
                key: 'error',
                header: t('adminCost.colErrorCode'),
                hideOnMobile: true,
                render: (r) =>
                  r.error_code
                    ? <Badge tone="danger" size="sm">{r.error_code}</Badge>
                    : <span className="text-xs text-(--fg-muted)">—</span>,
              },
            ]}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-(--border-subtle) px-6 py-3">
              <span className="text-xs text-(--fg-muted)">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, totalLogs)} / {totalLogs}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={pageHref(page - 1)} scroll={false}
                    className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 text-xs hover:bg-(--surface-2) transition-colors">
                    {t('adminCost.paginationPrev')}
                  </Link>
                )}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                  .reduce<(number | '…')[]>((acc, p, i, arr) => {
                    if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('…')
                    acc.push(p)
                    return acc
                  }, [])
                  .map((p, i) =>
                    p === '…' ? (
                      <span key={`e${i}`} className="px-1.5 py-1 text-xs text-(--fg-muted)">…</span>
                    ) : (
                      <Link key={p} href={pageHref(p as number)} scroll={false}
                        className={[
                          'rounded-(--r-sm) border px-2.5 py-1 text-xs transition-colors',
                          p === page
                            ? 'bg-(--accent) border-(--accent) text-(--accent-fg)'
                            : 'border-(--border-subtle) hover:bg-(--surface-2)',
                        ].join(' ')}>
                        {p}
                      </Link>
                    )
                  )}
                {page < totalPages && (
                  <Link href={pageHref(page + 1)} scroll={false}
                    className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 text-xs hover:bg-(--surface-2) transition-colors">
                    {t('adminCost.paginationNext')}
                  </Link>
                )}
              </div>
            </div>
          )}
        </Card>
      </Section>
    </div>
  )
}
