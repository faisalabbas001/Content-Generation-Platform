import { adminClient, isDbConfigured } from '@repo/db'
import { notFound } from 'next/navigation'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { DataTable } from '@repo/ui/data-table'
import { GestureBlockToggle } from './gesture-actions'

export const dynamic = 'force-dynamic'

interface GestureRow {
  gesture_key: string
  description_en: string
  description_ar: string | null
  severity: 'SOFT_WARN' | 'STRONG_WARN' | 'HARD_BLOCK'
  detection_keywords: string[]
  applies_to_register: string | null
  applies_to_sector: string | null
  occasion_scope: string | null
  is_active: boolean
  updated_at: string
}

const SEVERITY_TONE = {
  HARD_BLOCK:  'danger',
  STRONG_WARN: 'warning',
  SOFT_WARN:   'outline',
} as const

export default async function CompliancePage() {
  if (!isDbConfigured()) notFound()

  const db = adminClient()
  const { data, error } = await db
    .from('cultural_gesture_blocks')
    .select('*')
    .order('severity')
    .order('gesture_key')

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as GestureRow[]
  const activeCount = rows.filter((r) => r.is_active).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Content Policy"
        title="Cultural Gesture Blocks"
        subtitle="Deterministic hard-blocks applied to every visual brief before image/video generation (gate §9.2). Changes flush the in-process rule cache immediately — no redeploy needed."
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Rules" value={rows.length} />
        <StatCard label="Active" value={activeCount} accent />
        <StatCard label="Inactive" value={rows.length - activeCount} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Gesture Blocks</CardTitle>
            <CardDescription>
              Each rule is matched against the English visual brief using keyword detection.
              HARD_BLOCK rules abort generation completely.
            </CardDescription>
          </div>
          <div className="flex gap-1.5">
            <Badge tone="danger" size="sm">{rows.filter((r) => r.severity === 'HARD_BLOCK').length} hard-block</Badge>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <DataTable
            rows={rows}
            density="compact"
            columns={[
              {
                key: 'key',
                header: 'Gesture',
                render: (r) => (
                  <span className={`font-mono text-xs ${r.is_active ? 'text-(--fg)' : 'text-(--fg-faint) line-through'}`}>
                    {r.gesture_key}
                  </span>
                ),
              },
              {
                key: 'desc',
                header: 'Description',
                render: (r) => (
                  <div className="space-y-0.5">
                    <p className="text-xs text-(--fg)">{r.description_en}</p>
                    {r.description_ar && (
                      <p className="text-xs text-(--fg-muted)" dir="rtl">{r.description_ar}</p>
                    )}
                  </div>
                ),
              },
              {
                key: 'severity',
                header: 'Severity',
                render: (r) => (
                  <Badge tone={SEVERITY_TONE[r.severity]} size="sm">{r.severity}</Badge>
                ),
              },
              {
                key: 'keywords',
                header: 'Detection keywords',
                render: (r) => (
                  <div className="flex flex-wrap gap-1">
                    {r.detection_keywords.slice(0, 3).map((k) => (
                      <span key={k} className="rounded bg-(--surface-2) px-1.5 py-0.5 font-mono text-[10px] text-(--fg-muted)">
                        {k}
                      </span>
                    ))}
                    {r.detection_keywords.length > 3 && (
                      <span className="text-[10px] text-(--fg-faint)">+{r.detection_keywords.length - 3} more</span>
                    )}
                  </div>
                ),
              },
              {
                key: 'scope',
                header: 'Scope',
                render: (r) => (
                  <div className="space-y-0.5 text-[10px] text-(--fg-muted)">
                    {r.occasion_scope && <div>occasion: {r.occasion_scope}</div>}
                    {r.applies_to_sector && <div>sector: {r.applies_to_sector}</div>}
                    {r.applies_to_register && <div>register: {r.applies_to_register}</div>}
                    {!r.occasion_scope && !r.applies_to_sector && !r.applies_to_register && (
                      <span className="text-(--fg-faint)">all</span>
                    )}
                  </div>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (r) => (
                  <GestureBlockToggle gesture_key={r.gesture_key} is_active={r.is_active} />
                ),
                align: 'end' as const,
              },
            ]}
            empty="No gesture blocks found."
          />
        </CardBody>
      </Card>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={`rounded-(--r-md) border p-4 text-center ${
        accent ? 'border-(--accent) bg-(--accent)/5' : 'border-(--border-subtle) bg-(--surface-1)'
      }`}
    >
      <div className={`font-display text-2xl font-bold ${accent ? 'text-(--accent)' : 'text-(--fg)'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-(--fg-muted)">{label}</div>
    </div>
  )
}
