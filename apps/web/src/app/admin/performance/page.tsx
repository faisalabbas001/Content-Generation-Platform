import { adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { EmptyState } from '@repo/ui/empty-state'
import { getServerT } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

export default async function AdminPerformancePage() {
  const { t } = await getServerT()
  const rows = await adminQ.getContentPatterns(200)

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow={t('adminPerformance.eyebrow')} title={t('adminPerformance.title')} subtitle={t('adminPerformance.subtitle')} />
        <EmptyState title={t('common.noData')} description="Patterns appear after the first calendars are approved by clients." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('adminPerformance.eyebrow')} title={t('adminPerformance.title')} subtitle={t('adminPerformance.subtitle')} />
      <DataTable
        rows={rows}
        density="compact"
        columns={[
          { key: 'sector',    header: t('adminPerformance.colSector'),    render: (r) => <Badge tone="outline" size="sm">{r.sector}</Badge> },
          { key: 'dialect',   header: t('adminPerformance.colDialect'),   render: (r) => r.dialect ?? '—' },
          { key: 'type',      header: t('adminPerformance.colType'),      render: (r) => r.content_type ?? '—' },
          { key: 'objective', header: t('adminPerformance.colObjective'), render: (r) => r.objective ?? '—' },
          { key: 'approval',  header: t('adminPerformance.colApproval'),  render: (r) => (
            <span className="font-mono text-(--success)">
              {r.approval_rate !== null ? `${(r.approval_rate * 100).toFixed(0)}%` : '—'}
            </span>
          ), align: 'end' },
          { key: 'sample',    header: t('adminPerformance.colSample'),    render: (r) => <span className="font-mono text-(--fg-subtle)">{r.sample_size}</span>, align: 'end' },
        ]}
      />
    </div>
  )
}
