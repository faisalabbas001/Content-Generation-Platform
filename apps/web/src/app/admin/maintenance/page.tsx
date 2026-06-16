import { adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { EmptyState } from '@repo/ui/empty-state'
import { TriggerFlowButton } from '../upgrade/trigger-button'

export const dynamic = 'force-dynamic'

export default async function AdminMaintenancePage() {
  const runs = await adminQ.getMaintenanceHistory(30)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="BrandDNA Maintenance"
        subtitle="N8N-D02 sweeps stale evidence_bundles monthly (1st of month, 04:00 AST) and downgrades confidence on aged fields. Run manually if needed."
        action={<TriggerFlowButton flow="D02" label="Run D02 Now" />}
      />

      {runs.length === 0 ? (
        <EmptyState
          title="No maintenance runs yet"
          description="D02 hasn't run yet. Click 'Run D02 Now' or wait for the 1st-of-month cron at 04:00 AST."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Run History</CardTitle>
            <span className="text-xs text-(--fg-muted)">Last {runs.length} runs</span>
          </CardHeader>
          <CardBody className="p-0">
            <DataTable
              rows={runs}
              density="compact"
              columns={[
                {
                  key: 'when',
                  header: 'When',
                  render: (r) => (
                    <span className="text-xs text-(--fg-muted)">
                      {new Date(r.timestamp).toLocaleString()}
                    </span>
                  ),
                },
                {
                  key: 'flow',
                  header: 'Flow',
                  render: (r) => <Badge tone="accent" size="sm">{r.flow_id}</Badge>,
                },
                {
                  key: 'bundles',
                  header: 'Evaluated',
                  render: (r) => {
                    const outcome = safeParseOutcome(r.outcome)
                    return (
                      <span className="font-mono text-(--fg-subtle)">
                        {outcome?.bundles_evaluated ?? '—'}
                      </span>
                    )
                  },
                  align: 'end',
                },
                {
                  key: 'enqueued',
                  header: 'Nominated',
                  render: (r) => {
                    const outcome = safeParseOutcome(r.outcome)
                    return (
                      <span className="font-mono text-(--fg-subtle)">
                        {outcome?.nominations_enqueued ?? '—'}
                      </span>
                    )
                  },
                  align: 'end',
                },
                {
                  key: 'written',
                  header: 'Written',
                  render: (r) => {
                    const outcome = safeParseOutcome(r.outcome)
                    return (
                      <span className="font-mono text-(--success)">
                        {outcome?.drained_written ?? '—'}
                      </span>
                    )
                  },
                  align: 'end',
                },
                {
                  key: 'rejected',
                  header: 'Rejected',
                  render: (r) => {
                    const outcome = safeParseOutcome(r.outcome)
                    const n = outcome?.drained_rejected ?? 0
                    return (
                      <span className={`font-mono ${n > 0 ? 'text-(--warning)' : 'text-(--fg-subtle)'}`}>
                        {n}
                      </span>
                    )
                  },
                  align: 'end',
                },
                {
                  key: 'batch',
                  header: 'Batch',
                  render: (r) => {
                    const outcome = safeParseOutcome(r.outcome)
                    return (
                      <span className="font-mono text-xs text-(--fg-faint)">
                        {outcome?.batch_id ?? '—'}
                      </span>
                    )
                  },
                },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </div>
  )
}

interface D02Report {
  bundles_evaluated?: number
  nominations_enqueued?: number
  drained_written?: number
  drained_rejected?: number
  batch_id?: string
}

function safeParseOutcome(raw: string): D02Report | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return typeof parsed === 'object' && parsed !== null ? parsed as D02Report : null
  } catch {
    return null
  }
}
