import { adminClient } from '@repo/db'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { DataTable } from '@repo/ui/data-table'
import { QueueRowActions, RefreshButton } from '../../admin-widgets'
import { Pagination } from './pagination'

interface QueueRow {
  nomination_id: string
  nomination_type: string
  status: string
  nominated_at: string
  processed_at: string | null
  rejection_reason: string | null
  nomination_data: Record<string, unknown>
}

const PAGE_SIZE = 50

export async function QueueSection({
  brand_id,
  nomPage,
  evtPage,
}: {
  brand_id: string
  nomPage: number
  evtPage: number
}) {
  const db = adminClient()
  const offset = (nomPage - 1) * PAGE_SIZE

  const [queueRes, countRes, statusRes] = await Promise.all([
    db.from('memory_controller_queue')
      .select('nomination_id, nomination_type, status, nominated_at, processed_at, rejection_reason, nomination_data')
      .eq('brand_id', brand_id)
      .order('nominated_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1),
    db.from('memory_controller_queue')
      .select('nomination_id', { count: 'exact', head: true })
      .eq('brand_id', brand_id),
    db.from('memory_controller_queue')
      .select('status')
      .eq('brand_id', brand_id),
  ])

  const rows = (queueRes.data ?? []) as QueueRow[]
  const total = countRes.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const counts = (statusRes.data ?? []).reduce<Record<string, number>>((acc, r) => {
    const s = (r as { status: string }).status
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Memory Controller queue</CardTitle>
          <CardDescription>
            {total} total nominations · page {nomPage} of {totalPages}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton />
          <div className="flex gap-1.5">
            {Object.entries(counts).map(([status, n]) => (
              <Badge
                key={status}
                tone={
                  status === 'written' ? 'success' :
                  status === 'rejected' ? 'danger' :
                  status === 'pending' ? 'warning' : 'info'
                }
                size="sm"
              >
                {status}: {n}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <DataTable
          rows={rows}
          density="compact"
          columns={[
            { key: 'type',   header: 'Type',      render: (r) => <span className="font-mono text-xs">{r.nomination_type}</span> },
            { key: 'status', header: 'Status',    render: (r) => <Badge tone={r.status === 'written' ? 'success' : r.status === 'rejected' ? 'danger' : r.status === 'pending' ? 'warning' : 'info'} size="sm">{r.status}</Badge> },
            { key: 'nom',    header: 'Nominated', render: (r) => <span className="font-mono text-xs text-(--fg-subtle)">{new Date(r.nominated_at).toLocaleString()}</span> },
            { key: 'reason', header: 'Reason',    render: (r) => <span className="font-mono text-xs text-(--fg-muted)">{r.rejection_reason ?? '—'}</span> },
            { key: 'data',   header: 'Data',      render: (r) => (
              <details>
                <summary className="cursor-pointer text-xs text-(--fg-muted)">view</summary>
                <pre className="mt-1 max-w-md overflow-auto rounded-(--r-sm) bg-(--surface-2) p-2 font-mono text-xs">{JSON.stringify(r.nomination_data, null, 2)}</pre>
              </details>
            )},
            { key: 'action', header: 'Action',    render: (r) => <QueueRowActions nomination_id={r.nomination_id} status={r.status} brand_id={brand_id} nomination_data={r.nomination_data} />, align: 'end' },
          ]}
          empty="No nominations have been queued for this brand."
        />
        <Pagination current={nomPage} total={totalPages} paramKey="nom_page" otherParam={`evt_page=${evtPage}`} />
      </CardBody>
    </Card>
  )
}
