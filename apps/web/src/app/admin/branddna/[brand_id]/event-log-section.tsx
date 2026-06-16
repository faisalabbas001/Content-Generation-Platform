import { adminClient } from '@repo/db'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { DataTable } from '@repo/ui/data-table'
import { Pagination } from './pagination'

interface EventRow {
  event_id: string
  event_type: string
  event_data: Record<string, unknown>
  created_at: string
}

const PAGE_SIZE = 50

const EVENT_TYPE_LABELS: Record<string, string> = {
  field_written:          'Field Written',
  confidence_upgraded:    'Confidence Upgraded',
  negative_pattern_added: 'Negative Pattern Added',
  override_rule_added:    'Override Rule Added',
  method_profile_written: 'Method Profile Written',
  // legacy / alternate spellings
  field_update:           'Field Updated',
  override_added:         'Override Rule Added',
  negative_pattern_add:   'Negative Pattern Added',
  method_profile_update:  'Method Profile Written',
  confidence_upgrade:     'Confidence Upgraded',
}

function eventTypeLabel(raw: string): string {
  return EVENT_TYPE_LABELS[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function summariseEvent(data: Record<string, unknown>): string {
  if (!data || typeof data !== 'object') return '—'
  const fieldPath = (data.field_path ?? data.applied_to) as string | undefined
  if (fieldPath) {
    const val = data.value ?? data.new_value
    return val !== undefined ? `${fieldPath} → ${String(val).slice(0, 50)}` : fieldPath
  }
  const pattern = data.pattern_text as string | undefined
  if (pattern) return pattern.slice(0, 80)
  const ruleKey = data.rule_key as string | undefined
  if (ruleKey) {
    const ruleVal = data.rule_value as string | undefined
    return ruleVal ? `${ruleKey}: ${ruleVal.slice(0, 50)}` : ruleKey
  }
  const component = data.component as string | undefined
  if (component) return component
  const bundle = data.bundle_id ?? data.field ?? data.nomination_type
  if (bundle) return String(bundle)
  const str = JSON.stringify(data)
  return str.length > 80 ? `${str.slice(0, 77)}…` : str
}

export async function EventLogSection({
  brand_id,
  evtPage,
  nomPage,
}: {
  brand_id: string
  evtPage: number
  nomPage: number
}) {
  const db = adminClient()
  const offset = (evtPage - 1) * PAGE_SIZE

  const [eventsRes, countRes] = await Promise.all([
    db.from('branddna_event_log')
      .select('event_id, event_type, event_data, created_at')
      .eq('brand_id', brand_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1),
    db.from('branddna_event_log')
      .select('event_id', { count: 'exact', head: true })
      .eq('brand_id', brand_id),
  ])

  const events = (eventsRes.data ?? []) as EventRow[]
  const total = countRes.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>BrandDNA event log</CardTitle>
          <CardDescription>
            {total} total events · page {evtPage} of {totalPages}
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <DataTable
          rows={events}
          density="compact"
          columns={[
            { key: 'type', header: 'Event',  render: (e) => <Badge tone="accent" size="sm">{eventTypeLabel(e.event_type)}</Badge> },
            { key: 'data', header: 'Detail', render: (e) => <span className="font-mono text-xs text-(--fg-muted)">{summariseEvent(e.event_data)}</span> },
            { key: 'ts',   header: 'When',   render: (e) => <span className="font-mono text-xs text-(--fg-subtle)">{new Date(e.created_at).toLocaleString()}</span>, align: 'end' },
          ]}
          empty="No events have been recorded for this brand yet."
        />
        <Pagination current={evtPage} total={totalPages} paramKey="evt_page" otherParam={`nom_page=${nomPage}`} />
      </CardBody>
    </Card>
  )
}
