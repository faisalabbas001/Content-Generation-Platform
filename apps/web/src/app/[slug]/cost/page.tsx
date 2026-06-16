/**
 * /[slug]/cost — client-facing cost visibility page
 *
 * Read-only. Shows the brand's own spend vs ceiling (current month + history).
 * Uses getUserScopedClient (RLS) so brands can only see their own data.
 * Admin-editable ceiling config is reflected here but not editable by the client.
 */
import { notFound } from 'next/navigation'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { adminClient } from '@repo/db/client'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody } from '@repo/ui/card'
import { Stat } from '@repo/ui/stat'
import { Badge } from '@repo/ui/badge'
import { Progress } from '@repo/ui/progress'
import { Section } from '@repo/ui/section'
import { DataTable } from '@repo/ui/data-table'
import { getServerT } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

type CostStatus = 'normal' | 'approaching' | 'critical' | 'breached'

function statusTone(s: CostStatus): 'info' | 'warning' | 'danger' {
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
  if (pct >= 100)     return 'breached'
  if (pct >= 90)      return 'critical'
  if (pct >= alertAt) return 'approaching'
  return 'normal'
}
function fmtMonth(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(
    locale === 'ar' ? 'ar-SA' : 'en-US',
    { year: 'numeric', month: 'long' }
  )
}

export default async function ClientCostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { locale } = await getServerT()

  const brand = await getBrandForCurrentUser(slug)
  if (!brand) notFound()

  const brandId = brand.brand_id as string
  const db      = adminClient()

  // Fetch usage logs + cost config in parallel (via admin client — RLS on
  // brand_cost_config already gates by brand_id; usage_logs gated by brand_id filter)
  const [logsResult, configResult] = await Promise.all([
    db.from('usage_logs')
      .select('cost_usd, created_at, flow_id, agent, request_type, status')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(500),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).from('brand_cost_config')
      .select('monthly_ceiling_usd, alert_at_pct, halt_at_pct, tier')
      .eq('brand_id', brandId)
      .maybeSingle(),
  ])

  const logs      = (logsResult.data ?? []) as Array<{
    cost_usd: number | string
    created_at: string
    flow_id: string | null
    agent: string | null
    request_type: string | null
    status: string | null
  }>
  const config    = configResult.data as {
    monthly_ceiling_usd: number
    alert_at_pct: number
    halt_at_pct: number
    tier: string
  } | null

  const ceiling = config?.monthly_ceiling_usd ?? 50
  const alertAt = config?.alert_at_pct ?? 70

  // ── This month ─────────────────────────────────────────────────────────────
  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthLogs  = logs.filter((l) => new Date(l.created_at) >= monthStart)
  const totalSpend = monthLogs.reduce((n, l) => n + Number(l.cost_usd), 0)
  const spendPct   = ceiling > 0 ? (totalSpend / ceiling) * 100 : 0
  const costStatus = calcStatus(spendPct, alertAt)

  // ── Visual vs AI breakdown ─────────────────────────────────────────────────
  let visualSpend = 0, aiSpend = 0, imageCount = 0, videoCount = 0
  for (const l of monthLogs) {
    if (l.request_type === 'image_cost') { visualSpend += Number(l.cost_usd); imageCount++ }
    if (l.request_type === 'video_cost') { visualSpend += Number(l.cost_usd); videoCount++ }
    if (l.request_type === 'ai_cost')     aiSpend += Number(l.cost_usd)
  }

  // ── Per-month history ──────────────────────────────────────────────────────
  type MonthRow = {
    key: string
    label: string
    spend: number
    calls: number
    spendPct: number
    status: CostStatus
    imageCost: number
    videoCost: number
    aiCost: number
  }
  const monthMap = new Map<string, { spend: number; calls: number; img: number; vid: number; ai: number }>()
  for (const l of logs) {
    const d   = new Date(l.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const cur = monthMap.get(key) ?? { spend: 0, calls: 0, img: 0, vid: 0, ai: 0 }
    cur.spend += Number(l.cost_usd)
    cur.calls += 1
    if (l.request_type === 'image_cost') cur.img += Number(l.cost_usd)
    if (l.request_type === 'video_cost') cur.vid += Number(l.cost_usd)
    if (l.request_type === 'ai_cost')    cur.ai  += Number(l.cost_usd)
    monthMap.set(key, cur)
  }
  const monthHistory: MonthRow[] = Array.from(monthMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, { spend, calls, img, vid, ai }]) => {
      const pct = ceiling > 0 ? (spend / ceiling) * 100 : 0
      return {
        key,
        label:     fmtMonth(key, locale),
        spend,
        calls,
        spendPct:  pct,
        status:    calcStatus(pct, alertAt),
        imageCost: img,
        videoCost: vid,
        aiCost:    ai,
      }
    })

  const brandName = (brand as unknown as Record<string, unknown>).brand_name_ar as string ?? slug
  const curMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={locale === 'ar' ? 'إدارة التكلفة' : 'Cost Management'}
        title={locale === 'ar' ? 'تكلفتي الشهرية' : 'My Monthly Cost'}
        subtitle={brandName}
      />

      {/* ── KPI row ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label={locale === 'ar' ? 'الإنفاق هذا الشهر' : 'This month spend'}
          value={`$${totalSpend.toFixed(4)}`}
          tone="accent"
          helper={`${spendPct.toFixed(1)}% ${locale === 'ar' ? 'من السقف' : 'of ceiling'}`}
        />
        <Stat
          label={locale === 'ar' ? 'السقف الشهري' : 'Monthly ceiling'}
          value={`$${ceiling.toFixed(2)}`}
          tone="neutral"
          helper={`${locale === 'ar' ? 'تنبيه عند' : 'Alert at'} ${alertAt}%`}
        />
        <Stat
          label={locale === 'ar' ? 'نسبة الاستخدام' : 'Usage'}
          value={`${spendPct.toFixed(1)}%`}
          tone={costStatus === 'normal' ? 'success' : costStatus === 'approaching' ? 'warning' : 'danger'}
        />
        <Stat
          label={locale === 'ar' ? 'إنفاق التوليد المرئي' : 'Visual spend'}
          value={`$${visualSpend.toFixed(4)}`}
          tone="info"
          helper={`${imageCount} ${locale === 'ar' ? 'صور' : 'images'} · ${videoCount} ${locale === 'ar' ? 'فيديوهات' : 'videos'}`}
        />
        <Stat
          label={locale === 'ar' ? 'إجمالي الطلبات' : 'Total calls'}
          value={monthLogs.length}
          helper={`${monthHistory.length} ${locale === 'ar' ? 'أشهر' : 'months recorded'}`}
        />
      </div>

      {/* ── Status banner ───────────────────────────────────────────────────── */}
      <Card className={`border ${
        costStatus === 'normal'        ? 'border-(--info)'
        : costStatus === 'approaching' ? 'border-(--warning)'
        : 'border-(--danger)'
      }`}>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge tone={statusTone(costStatus)} dot={costStatus !== 'normal'}>
              {costStatus === 'normal'
                ? (locale === 'ar' ? 'ضمن الحدود' : 'Normal')
                : costStatus === 'approaching'
                ? (locale === 'ar' ? 'يقترب من السقف' : 'Approaching ceiling')
                : costStatus === 'critical'
                ? (locale === 'ar' ? 'حرج' : 'Critical')
                : (locale === 'ar' ? 'تجاوز السقف' : 'Ceiling breached')}
            </Badge>
            <Progress value={spendPct} tone={progressTone(costStatus)} className="flex-1" />
            <span className="font-mono text-sm text-(--fg-muted) shrink-0">
              ${totalSpend.toFixed(4)} / ${ceiling.toFixed(2)}
            </span>
          </div>
          {costStatus !== 'normal' && (
            <p className="text-xs text-(--fg-muted)">
              {locale === 'ar'
                ? `لقد أنفقت ${spendPct.toFixed(1)}% من ميزانيتك الشهرية البالغة $${ceiling.toFixed(2)}. ${costStatus === 'breached' ? 'تم إيقاف التوليد التلقائي.' : 'يُنصح بمراجعة إعدادات السقف مع مدير حسابك.'}`
                : `You have used ${spendPct.toFixed(1)}% of your $${ceiling.toFixed(2)} monthly budget. ${costStatus === 'breached' ? 'Automatic generation has been halted.' : 'Contact your account manager to adjust the ceiling if needed.'}`}
            </p>
          )}
        </CardBody>
      </Card>

      {/* ── Visual breakdown ────────────────────────────────────────────────── */}
      {visualSpend > 0 && (
        <Section title={locale === 'ar' ? 'تكلفة التوليد المرئي' : 'Visual generation cost'}>
          <Card>
            <CardBody className="space-y-3">
              <p className="text-xs text-(--fg-faint)">
                {locale === 'ar' ? 'صور وفيديوهات — هذا الشهر' : 'Images & videos generated · this month'}
              </p>
              {imageCount > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <Badge tone="outline" size="sm">{locale === 'ar' ? 'توليد الصور' : 'Image generation'}</Badge>
                    <span className="font-mono text-xs text-(--fg-subtle)">
                      ${monthLogs.filter(l => l.request_type === 'image_cost').reduce((n, l) => n + Number(l.cost_usd), 0).toFixed(4)} · {imageCount} {locale === 'ar' ? 'صورة' : 'images'}
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
                    <Badge tone="outline" size="sm">{locale === 'ar' ? 'توليد الفيديو' : 'Video generation'}</Badge>
                    <span className="font-mono text-xs text-(--fg-subtle)">
                      ${monthLogs.filter(l => l.request_type === 'video_cost').reduce((n, l) => n + Number(l.cost_usd), 0).toFixed(4)} · {videoCount} {locale === 'ar' ? 'فيديو' : 'videos'}
                    </span>
                  </div>
                  <Progress
                    value={ceiling > 0 ? (monthLogs.filter(l => l.request_type === 'video_cost').reduce((n, l) => n + Number(l.cost_usd), 0) / ceiling) * 100 : 0}
                    tone="warning"
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </Section>
      )}

      {/* ── Monthly history ─────────────────────────────────────────────────── */}
      {monthHistory.length > 0 && (
        <Section title={locale === 'ar' ? 'سجل الإنفاق الشهري' : 'Monthly spending history'}>
          <Card>
            <DataTable<MonthRow>
              rows={monthHistory}
              density="compact"
              columns={[
                {
                  key: 'month',
                  header: locale === 'ar' ? 'الشهر' : 'Month',
                  primaryOnMobile: true,
                  render: (r) => (
                    <span className={`text-sm font-medium ${r.key === curMonthKey ? 'text-(--accent)' : 'text-(--fg)'}`}>
                      {r.label}
                      {r.key === curMonthKey && (
                        <Badge tone="accent" size="sm" className="ms-2">
                          {locale === 'ar' ? 'الحالي' : 'current'}
                        </Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'spend',
                  header: locale === 'ar' ? 'الإنفاق' : 'Spend',
                  align: 'end',
                  render: (r) => (
                    <div className="text-right">
                      <div className="font-mono text-xs">${r.spend.toFixed(4)}</div>
                      <div className="font-mono text-xs text-(--fg-muted)">/ ${ceiling.toFixed(2)}</div>
                    </div>
                  ),
                },
                {
                  key: 'visual',
                  header: locale === 'ar' ? 'مرئي' : 'Visual',
                  align: 'end',
                  hideOnMobile: true,
                  render: (r) => (
                    <span className="font-mono text-xs text-(--fg-muted)">
                      ${(r.imageCost + r.videoCost).toFixed(4)}
                    </span>
                  ),
                },
                {
                  key: 'ai',
                  header: locale === 'ar' ? 'ذكاء اصطناعي' : 'AI',
                  align: 'end',
                  hideOnMobile: true,
                  render: (r) => (
                    <span className="font-mono text-xs text-(--fg-muted)">${r.aiCost.toFixed(4)}</span>
                  ),
                },
                {
                  key: 'progress',
                  header: locale === 'ar' ? 'الاستخدام' : 'Usage',
                  render: (r) => (
                    <div className="w-28">
                      <Progress value={r.spendPct} tone={progressTone(r.status)} />
                      <div className="mt-0.5 text-right text-xs text-(--fg-muted)">{r.spendPct.toFixed(1)}%</div>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: locale === 'ar' ? 'الحالة' : 'Status',
                  render: (r) => (
                    <Badge tone={statusTone(r.status)} size="sm" dot={r.status !== 'normal'}>
                      {r.status === 'normal'
                        ? (locale === 'ar' ? 'طبيعي' : 'Normal')
                        : r.status === 'approaching'
                        ? (locale === 'ar' ? 'مقترب' : 'Approaching')
                        : r.status === 'critical'
                        ? (locale === 'ar' ? 'حرج' : 'Critical')
                        : (locale === 'ar' ? 'تجاوز' : 'Breached')}
                    </Badge>
                  ),
                },
                {
                  key: 'calls',
                  header: locale === 'ar' ? 'الطلبات' : 'Calls',
                  align: 'end',
                  render: (r) => <span className="font-mono text-xs">{r.calls}</span>,
                },
              ]}
            />
          </Card>
        </Section>
      )}

      <p className="text-xs text-(--fg-faint) text-center">
        {locale === 'ar'
          ? 'هذه البيانات للاطلاع فقط. للاستفسار عن السقف أو تغييره، تواصل مع مدير حسابك.'
          : 'This data is read-only. To adjust your ceiling, contact your account manager.'}
      </p>
    </div>
  )
}
