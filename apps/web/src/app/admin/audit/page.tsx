import Link from 'next/link'
import { adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { Code } from '@repo/ui/code'
import { getServerT } from '@/lib/i18n-server'
import { formatDate } from '@/lib/format'
import { FilterBar } from '../admin-widgets'

export const dynamic = 'force-dynamic'

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { locale, t } = await getServerT()
  const sp = await searchParams
  const rows = await adminQ.getAuditEvents(300, {
    event_type: sp.event_type || undefined,
    brand_id:   sp.brand_id || undefined,
  })

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('adminAudit.eyebrow')} title={t('adminAudit.title')} subtitle={t('adminAudit.subtitle')} />

      <FilterBar
        filters={[
          { key: 'event_type', placeholder: 'Event type (e.g. confidence_upgraded)', current: sp.event_type },
          { key: 'brand_id',   placeholder: 'Brand ID', current: sp.brand_id },
        ]}
      />

      <DataTable
        rows={rows}
        density="compact"
        columns={[
          { key: 'when',  header: t('adminAudit.colWhen'),  render: (r) => <span className="text-xs text-(--fg-muted)">{formatDate(r.created_at, locale)}</span> },
          { key: 'brand', header: t('adminAudit.colBrand'), render: (r) => (
            r.brand_id
              ? <Link href={`/admin/branddna/${r.brand_id}`} className="font-mono text-xs text-(--accent-fg) underline">{r.brand_id.slice(0, 8)}…</Link>
              : <Badge tone="outline" size="sm">anonymised</Badge>
          ) },
          { key: 'type',  header: t('adminAudit.colType'),  render: (r) => <Badge tone="info" size="sm">{r.event_type}</Badge> },
          { key: 'data',  header: t('adminAudit.colData'),  render: (r) => (
            <details>
              <summary className="cursor-pointer text-xs text-(--fg-muted)"><Code className="inline-block max-w-md truncate text-xs">{JSON.stringify(r.event_data).slice(0, 80)}…</Code></summary>
              <pre className="mt-1 max-w-2xl overflow-auto rounded-(--r-sm) bg-(--surface-2) p-2 font-mono text-xs">{JSON.stringify(r.event_data, null, 2)}</pre>
            </details>
          ) },
        ]}
      />
    </div>
  )
}
