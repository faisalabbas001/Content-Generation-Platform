import Link from 'next/link'
import { adminClient, brandsQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { DataTable } from '@repo/ui/data-table'
import { Badge } from '@repo/ui/badge'
import { getServerT } from '@/lib/i18n-server'
import { tierLabel } from '@/lib/format'
import { FilterBar } from '../admin-widgets'

export const dynamic = 'force-dynamic'

export default async function BrandDnaListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { locale, t } = await getServerT()
  const sp = await searchParams
  const minCompleteness = sp.min ? parseInt(sp.min, 10) : 0
  const sectorFilter = sp.sector || ''

  const allRows = await brandsQ.getAllBrands()
  const rows = allRows.filter((r) =>
    (sectorFilter ? r.sector === sectorFilter : true) &&
    (Number.isFinite(minCompleteness) ? (r.completeness_score ?? 0) >= minCompleteness : true) &&
    (sp.unlinked === '1' ? !(r as { sector_baseline_id?: string | null }).sector_baseline_id : true)
  )

  // Fetch queue-pending counts per brand (one SQL round-trip)
  const db = adminClient()
  const { data: pendingData } = await db
    .from('memory_controller_queue')
    .select('brand_id')
    .eq('status', 'pending')
  const pendingByBrand = new Map<string, number>()
  for (const r of (pendingData ?? []) as Array<{ brand_id: string | null }>) {
    if (!r.brand_id) continue
    pendingByBrand.set(r.brand_id, (pendingByBrand.get(r.brand_id) ?? 0) + 1)
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('adminBrandDna.eyebrow')} title={t('adminBrandDna.title')} subtitle={t('adminBrandDna.subtitle')} />

      <FilterBar
        filters={[
          { key: 'sector',   placeholder: 'Sector', type: 'select', options: ['F&B','Retail','Beauty_Wellness','Healthcare','Finance','Government','Other'], current: sp.sector },
          { key: 'min',      placeholder: 'Min completeness (e.g. 40)', current: sp.min },
          { key: 'unlinked', placeholder: 'Unlinked baseline?', type: 'select', options: ['1'], current: sp.unlinked },
        ]}
      />

      <DataTable
        rows={rows}
        columns={[
          { key: 'name', header: t('adminBrandDna.colBrand'), render: (r) => (
            <Link href={`/admin/branddna/${r.brand_id}`} className="font-medium text-(--fg) hover:text-(--accent)">
              {locale === 'en' && r.brand_name_en ? r.brand_name_en : r.brand_name_ar}
            </Link>
          ) },
          { key: 'sector',  header: t('adminBrandDna.colSector'),  render: (r) => <Badge tone="outline" size="sm">{r.sector}</Badge> },
          { key: 'dialect', header: t('adminBrandDna.colDialect'), render: (r) => r.arabic_dialect ?? '—' },
          { key: 'arch',    header: 'Archetype',                   render: (r) => (
            r.archetype_primary
              ? <Badge tone="accent" size="sm">{r.archetype_primary}{r.archetype_secondary ? ` + ${r.archetype_secondary}` : ''}</Badge>
              : <span className="text-(--fg-faint)">—</span>
          ) },
          { key: 'lc',      header: 'Lifecycle', render: (r) => r.lifecycle_stage ?? <span className="text-(--fg-faint)">—</span> },
          { key: 'intent',  header: 'Intent',    render: (r) => r.intent_state ?? <span className="text-(--fg-faint)">—</span> },
          { key: 'tier',    header: t('adminBrandDna.colTier'), render: (r) => <Badge tone={r.tier === 'free' ? 'outline' : 'accent'} size="sm">{tierLabel(r.tier, t)}</Badge> },
          { key: 'completeness', header: t('adminBrandDna.colCompleteness'), render: (r) => {
            const pct = r.completeness_score ?? 0
            const tone = pct >= 70 ? 'success' : pct >= 40 ? 'warning' : 'danger'
            return <Badge tone={tone} size="sm">{pct}%</Badge>
          }, align: 'end' },
          { key: 'health',  header: 'Health', render: (r) => {
            const pending = pendingByBrand.get(r.brand_id) ?? 0
            if (pending > 0) return <Badge tone="warning" size="sm">{pending} pending</Badge>
            const hasLinks = (r as { sector_baseline_id?: string | null }).sector_baseline_id
            return hasLinks ? <Badge tone="success" size="sm">ok</Badge> : <Badge tone="outline" size="sm">unlinked</Badge>
          }, align: 'end' },
          { key: 'inspect', header: '', render: (r) => (
            <Link href={`/admin/branddna/${r.brand_id}`} className="text-xs text-(--accent) hover:underline">{t('adminBrandDna.inspect')}</Link>
          ), align: 'end' },
        ]}
      />
    </div>
  )
}
