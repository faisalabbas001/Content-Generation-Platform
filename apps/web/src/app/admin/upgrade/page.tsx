import { adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { Stat } from '@repo/ui/stat'
import { EmptyState } from '@repo/ui/empty-state'
import { TriggerFlowButton } from './trigger-button'

export const dynamic = 'force-dynamic'

const TIER_TONE: Record<string, 'success' | 'accent' | 'warning' | 'outline'> = {
  highly_ready: 'success',
  ready:        'accent',
  potential:    'warning',
  not_ready:    'outline',
}

const TIER_LABELS: Record<string, string> = {
  highly_ready: 'Highly Ready',
  ready:        'Ready',
  potential:    'Potential',
  not_ready:    'Not Ready',
}

export default async function AdminUpgradePage() {
  const [latestBatch, rows] = await Promise.all([
    adminQ.getLatestUpgradeBatch(),
    adminQ.getUpgradeReadiness(200),
  ])

  const highlyReady = rows.filter((r) => r.readiness_tier === 'highly_ready').length
  const ready       = rows.filter((r) => r.readiness_tier === 'ready').length
  const potential   = rows.filter((r) => r.readiness_tier === 'potential').length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Growth"
        title="Upgrade Readiness"
        subtitle="Monthly scoring of free-tier brands by N8N-A05. Run manually or wait for the 1st-of-month cron."
        action={<TriggerFlowButton flow="A05" label="Run A05 Now" />}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No readiness data yet"
          description="A05 hasn't run yet. Click 'Run A05 Now' or wait for the 1st-of-month cron at 06:00 AST."
        />
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Brands Scored"    value={rows.length}   tone="neutral" helper={latestBatch ?? undefined} />
            <Stat label="Highly Ready"     value={highlyReady}   tone="success" helper="Score ≥ 80" />
            <Stat label="Ready"            value={ready}         tone="accent"  helper="Score 65–79" />
            <Stat label="Potential"        value={potential}     tone="warning" helper="Score 50–64" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Brand Scores</CardTitle>
              {latestBatch && <span className="text-xs text-(--fg-muted)">{latestBatch}</span>}
            </CardHeader>
            <CardBody className="p-0">
              <DataTable
                rows={rows}
                density="compact"
                columns={[
                  {
                    key: 'brand',
                    header: 'Brand',
                    render: (r) => (
                      <div>
                        <div className="font-medium text-(--fg)">{r.brand_name_ar ?? (r.brand_id ?? r.decision_id).slice(0, 8)}</div>
                        {r.brand_name_en && <div className="text-xs text-(--fg-faint)">{r.brand_name_en}</div>}
                      </div>
                    ),
                  },
                  { key: 'sector',    header: 'Sector',   render: (r) => <Badge tone="outline" size="sm">{r.sector ?? '—'}</Badge> },
                  {
                    key: 'tier',
                    header: 'Readiness',
                    render: (r) => {
                      const tier = r.readiness_tier ?? 'unknown'
                      return (
                        <Badge tone={TIER_TONE[tier] ?? 'outline'} size="sm">
                          {TIER_LABELS[tier] ?? tier}
                        </Badge>
                      )
                    },
                  },
                  {
                    key: 'score',
                    header: 'Score',
                    render: (r) => <span className="font-mono text-(--fg)">{r.total_score}</span>,
                    align: 'end',
                  },
                  {
                    key: 'completeness',
                    header: 'DNA%',
                    render: (r) => (
                      <span className="font-mono text-(--fg-subtle)">
                        {(r.metrics as Record<string, number>)?.completeness_score ?? '—'}%
                      </span>
                    ),
                    align: 'end',
                  },
                  {
                    key: 'calendars',
                    header: 'Calendars',
                    render: (r) => (
                      <span className="font-mono text-(--fg-subtle)">
                        {(r.metrics as Record<string, number>)?.total_calendars ?? '—'}
                      </span>
                    ),
                    align: 'end',
                  },
                  {
                    key: 'evaluated',
                    header: 'Evaluated',
                    render: (r) => (
                      <span className="text-xs text-(--fg-muted)">
                        {r.evaluated_at ? new Date(r.evaluated_at).toLocaleDateString() : '—'}
                      </span>
                    ),
                    align: 'end',
                  },
                ]}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
