import { occasionsQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { getServerT } from '@/lib/i18n-server'
import { formatDateOnly } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function OccasionsPage() {
  const { locale, t } = await getServerT()
  const rows = await occasionsQ.getAllOccasions()
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('adminOccasions.eyebrow')} title={t('adminOccasions.title')} subtitle={t('adminOccasions.subtitle')} />
      <DataTable
        rows={rows}
        density="compact"
        columns={[
          { key: 'name', header: t('adminOccasions.colOccasion'), render: (r) => (
            <div>
              <div className="font-medium text-(--fg)">{locale === 'en' && r.occasion_name_en ? r.occasion_name_en : r.occasion_name_ar}</div>
              <div className="text-[11px] text-(--fg-muted)">{locale === 'en' ? r.occasion_name_ar : r.occasion_name_en}</div>
            </div>
          ) },
          { key: 'date',     header: t('adminOccasions.colDate'),       render: (r) => <span className="font-mono text-(--fg-subtle)">{formatDateOnly(r.gregorian_date, locale)}</span> },
          { key: 'year',     header: t('adminOccasions.colYear'),       render: (r) => <span className="font-mono text-(--fg-subtle)">{r.year}</span>, align: 'end' },
          { key: 'lead',     header: t('adminOccasions.colLeadWeeks'),  render: (r) => <span className="font-mono text-(--fg-subtle)">{r.lead_weeks}</span>, align: 'end' },
          { key: 'priority', header: t('adminOccasions.colPriority'),   render: (r) => (
            <Badge dot size="sm" tone={r.priority === 'Critical' ? 'danger' : r.priority === 'High' ? 'warning' : 'outline'}>{r.priority}</Badge>
          ) },
        ]}
      />
    </div>
  )
}
