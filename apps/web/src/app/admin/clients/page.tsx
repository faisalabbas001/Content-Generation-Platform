import Link from 'next/link'
import { brandsQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { getServerT } from '@/lib/i18n-server'
import { formatDate, tierLabel } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function AdminClientsPage() {
  const { locale, t } = await getServerT()
  const rows = await brandsQ.getAllBrands()

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('adminClients.eyebrow')} title={t('adminClients.title')} subtitle={t('adminClients.subtitle')} />
      <DataTable
        rows={rows}
        columns={[
          { key: 'brand', header: t('adminClients.colName'), render: (b) => {
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
                  <Link href={`/admin/clients/${b.brand_id}`} className="font-medium text-(--fg) hover:text-(--accent)">
                    {name}
                  </Link>
                  <div className="text-xs text-(--fg-faint)">{b.client_slug}</div>
                </div>
              </div>
            )
          } },
          { key: 'sector',       header: t('adminClients.colSector'),       render: (b) => <Badge tone="outline" size="sm">{b.sector}</Badge> },
          { key: 'dialect',      header: t('adminClients.colDialect'),      render: (b) => b.arabic_dialect ?? '—' },
          { key: 'tier',         header: t('adminClients.colTier'),         render: (b) => <Badge tone={b.tier === 'free' ? 'outline' : 'accent'} size="sm">{tierLabel(b.tier, t)}</Badge> },
          { key: 'completeness', header: t('adminClients.colCompleteness'), render: (b) => <span className="font-mono text-(--fg-subtle)">{b.completeness_score}%</span>, align: 'end' },
          { key: 'cal',          header: t('adminClients.colCalendars'),    render: (b) => <span className="font-mono text-(--fg-subtle)">{b.total_calendars_generated}</span>, align: 'end' },
          { key: 'created',      header: t('adminClients.colCreated'),      render: (b) => <span className="text-xs text-(--fg-muted)">{formatDate(b.created_at, locale)}</span>, align: 'end' },
          { key: 'open',         header: '',                                  render: (b) => (
            <Link href={`/admin/clients/${b.brand_id}`} className="text-xs text-(--accent) hover:underline">
              {t('adminClients.open')}
            </Link>
          ), align: 'end' },
        ]}
      />
    </div>
  )
}
