import Link from 'next/link'
import { brandsQ, adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { Stat } from '@repo/ui/stat'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { Section } from '@repo/ui/section'
import { getServerT } from '@/lib/i18n-server'
import { formatDate, tierLabel } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function AdminHome() {
  const { locale, t } = await getServerT()
  const [brands, qa, anomalies, usage] = await Promise.all([
    brandsQ.getAllBrands(),
    adminQ.getQaQueue(10),
    adminQ.getAnomalies(10),
    adminQ.getRecentUsage(100),
  ])
  const totalCost = usage.reduce((n, u) => n + Number(u.cost_usd ?? 0), 0)
  const pendingQa = qa.filter((q) => q.status === 'pending').length
  const unresolved = anomalies.rows.filter((a) => !a.resolved).length

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t('adminOverview.eyebrow')} title={t('adminOverview.title')} subtitle={t('adminOverview.subtitle')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="oc-mount oc-stagger-1"><Stat label={t('adminOverview.kpiBrands')} value={brands.length} helper={t('adminOverview.kpiBrandsHelper')} tone="accent" /></div>
        <div className="oc-mount oc-stagger-2"><Stat label={t('adminOverview.kpiPendingQa')} value={pendingQa} helper={pendingQa ? t('adminOverview.kpiPendingQaActionable') : t('adminOverview.kpiPendingQaHealthy')} tone={pendingQa ? 'warning' : 'success'} /></div>
        <div className="oc-mount oc-stagger-3"><Stat label={t('adminOverview.kpiOpenAnomalies')} value={unresolved} helper={t('adminOverview.kpiOpenAnomaliesHelper')} tone={unresolved ? 'danger' : 'neutral'} /></div>
        <div className="oc-mount oc-stagger-4"><Stat label={t('adminOverview.kpiSpend')} value={`$${totalCost.toFixed(2)}`} helper={t('adminOverview.kpiSpendHelper')} tone="info" /></div>
      </div>

      <Section
        title={t('adminOverview.brandsTitle')}
        description={t('adminOverview.brandsSubtitle')}
        action={<Link href="/admin/branddna" className="text-xs text-(--accent) hover:underline">{t('adminOverview.brandDnaInspectorLink')}</Link>}
      >
        <DataTable
          rows={brands}
          columns={[
            { key: 'brand', header: t('adminOverview.colBrand'), render: (b) => {
              const name = locale === 'en' && b.brand_name_en ? b.brand_name_en : b.brand_name_ar
              return (
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-(--r-md) text-xs font-semibold text-white"
                    style={{ background: `linear-gradient(135deg, ${b.primary_color_hex ?? '#10b981'}, ${b.primary_color_hex ?? '#10b981'}aa)` }}
                  >
                    {name.slice(0, 1)}
                  </div>
                  <div>
                    <Link className="font-medium text-(--fg) hover:text-(--accent)" href={`/${b.client_slug}/snapshot`}>{name}</Link>
                    <div className="text-xs text-(--fg-faint)">{locale === 'en' ? b.brand_name_ar : b.brand_name_en}</div>
                  </div>
                </div>
              )
            } },
            { key: 'sector',       header: t('adminOverview.colSector'),       render: (b) => <Badge tone="outline" size="sm">{b.sector}</Badge> },
            { key: 'dialect',      header: t('adminOverview.colDialect'),      render: (b) => b.arabic_dialect ?? '—' },
            { key: 'tier',         header: t('adminOverview.colTier'),         render: (b) => <Badge tone={b.tier === 'free' ? 'outline' : 'accent'} size="sm">{tierLabel(b.tier, t)}</Badge> },
            { key: 'completeness', header: t('adminOverview.colCompleteness'), render: (b) => <span className="font-mono text-(--fg-subtle)">{b.completeness_score}%</span>, align: 'end' },
            { key: 'cal',          header: t('adminOverview.colCalendars'),    render: (b) => <span className="font-mono text-(--fg-subtle)">{b.total_calendars_generated}</span>, align: 'end' },
            { key: 'created',      header: t('adminOverview.colSince'),        render: (b) => <span className="text-xs text-(--fg-muted)">{formatDate(b.created_at, locale)}</span>, align: 'end' },
            { key: 'inspect',      header: '',                                  render: (b) => (
              <Link className="text-xs text-(--accent) hover:underline" href={`/admin/branddna/${b.brand_id}`}>{t('adminOverview.inspect')}</Link>
            ), align: 'end' },
          ]}
          empty={t('adminOverview.emptyHint')}
        />
      </Section>
    </div>
  )
}
