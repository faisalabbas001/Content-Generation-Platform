import Link from 'next/link'
import { adminClient, adminQ } from '@repo/db'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { getServerT } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

export default async function BaselinesPage() {
  const { t } = await getServerT()
  const rows = await adminQ.getSectorBaselines()

  // Per-baseline brand counts so admins see which baselines are actually in use.
  const db = adminClient()
  const { data: usage } = await db
    .from('brand_profiles')
    .select('sector_baseline_id, brand_id, brand_name_en, brand_name_ar')
    .not('sector_baseline_id', 'is', null)
  const usageByBaseline = new Map<string, Array<{ brand_id: string; name: string }>>()
  for (const r of (usage ?? []) as Array<{ sector_baseline_id: string; brand_id: string; brand_name_en: string | null; brand_name_ar: string }>) {
    const list = usageByBaseline.get(r.sector_baseline_id) ?? []
    list.push({ brand_id: r.brand_id, name: r.brand_name_en ?? r.brand_name_ar })
    usageByBaseline.set(r.sector_baseline_id, list)
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('adminBaselines.eyebrow')} title={t('adminBaselines.title')} subtitle={t('adminBaselines.subtitle')} />
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((b) => (
          <Card key={b.baseline_id}>
            <CardHeader>
              <div><CardTitle>{b.sector}</CardTitle></div>
              <Badge tone="outline">{b.dialect}</Badge>
            </CardHeader>
            <CardBody className="space-y-5 text-sm">
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-(--fg-muted)">{t('adminBaselines.mixTitle')}</div>
                <div className="space-y-2">
                  {Object.entries(b.recommended_content_mix ?? {}).map(([k, v]) => (
                    <div key={k}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-(--fg-subtle)">{k}</span>
                        <span className="font-mono text-(--fg-muted)">{(Number(v) * 100).toFixed(0)}%</span>
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-(--surface-4)">
                        <div className="h-full rounded-full bg-(--accent)" style={{ width: `${Number(v) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-(--fg-muted)">{t('adminBaselines.topTonesTitle')}</div>
                <ul className="space-y-1.5">
                  {(b.top_performing_tones ?? []).map((tone) => (
                    <li key={tone.tone_id} className="flex items-center justify-between">
                      <span className="text-(--fg)">{tone.tone_id}</span>
                      <span className="font-mono text-xs text-(--success)">{(tone.approval_rate * 100).toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center justify-between border-t border-(--border-subtle) pt-3">
                <span className="text-xs text-(--fg-muted)">{t('adminBaselines.sampleSize')}</span>
                <span className="font-mono text-(--fg)">{b.sample_size}</span>
              </div>
              {/* Linked brands — admins click through to inspect */}
              <div className="border-t border-(--border-subtle) pt-3">
                <div className="mb-1 text-xs uppercase tracking-wide text-(--fg-muted)">
                  Linked brands ({(usageByBaseline.get(b.baseline_id) ?? []).length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {(usageByBaseline.get(b.baseline_id) ?? []).slice(0, 12).map((u) => (
                    <Link
                      key={u.brand_id}
                      href={`/admin/branddna/${u.brand_id}`}
                      className="rounded-(--r-sm) border border-(--border-subtle) px-2 py-0.5 text-xs text-(--fg) hover:text-(--accent)"
                    >
                      {u.name}
                    </Link>
                  ))}
                  {(usageByBaseline.get(b.baseline_id) ?? []).length === 0 && (
                    <span className="text-xs text-(--fg-faint)">None.</span>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
