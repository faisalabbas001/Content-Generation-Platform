import { adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { getServerT } from '@/lib/i18n-server'
import { formatDate } from '@/lib/format'
import type { TKey } from '@repo/i18n'

const FLOWS = [
  'N8N-A01','N8N-A02','N8N-A03','N8N-A04','N8N-A05','N8N-B03','N8N-V01','N8N-D02','N8N-S01','N8N-S02','N8N-S03',
] as const

export const dynamic = 'force-dynamic'

export default async function FlowsPage() {
  const { locale, t } = await getServerT()
  const stats = await adminQ.getFlowsStatus()
  const map = new Map(stats.map((s) => [s.flow_id, s]))
  const rows = FLOWS.map((id) => ({
    id,
    label: t(`adminFlows.labels.${id}` as TKey),
    stat:
      map.get(id) ??
      ({ total_executions: 0, success: 0, retry: 0, last_seen: null as string | null }),
  }))

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('adminFlows.eyebrow')} title={t('adminFlows.title')} subtitle={t('adminFlows.subtitle')} />
      <DataTable
        rows={rows}
        columns={[
          { key: 'id',      header: t('adminFlows.colId'),      render: (r) => <Badge tone="accent" size="sm">{r.id}</Badge> },
          { key: 'label',   header: t('adminFlows.colPurpose'), render: (r) => <span className="text-(--fg)">{r.label}</span> },
          { key: 'total',   header: t('adminFlows.colTotal'),   render: (r) => <span className="font-mono text-(--fg-subtle)">{r.stat.total_executions}</span>, align: 'end' },
          { key: 'success', header: t('adminFlows.colSuccess'), render: (r) => <span className="font-mono text-(--success)">{r.stat.success}</span>, align: 'end' },
          { key: 'retry',   header: t('adminFlows.colRetry'),   render: (r) => <span className="font-mono text-(--warning)">{r.stat.retry}</span>, align: 'end' },
          { key: 'last',    header: t('adminFlows.colLast'),    render: (r) => <span className="text-xs text-(--fg-muted)">{formatDate(r.stat.last_seen, locale)}</span>, align: 'end' },
          { key: 'status',  header: t('adminFlows.colState'),   render: (r) => (
            <Badge dot tone={r.stat.total_executions === 0 ? 'outline' : r.stat.retry > 0 ? 'warning' : 'success'}>
              {r.stat.total_executions === 0 ? t('adminFlows.stateNeverRan') : r.stat.retry > 0 ? t('adminFlows.stateAlert') : t('adminFlows.stateNormal')}
            </Badge>
          ) },
        ]}
      />
    </div>
  )
}
