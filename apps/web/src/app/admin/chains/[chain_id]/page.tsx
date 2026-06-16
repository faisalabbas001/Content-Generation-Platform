import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@repo/ui/page-header'
import { Badge } from '@repo/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { isDbConfigured } from '@repo/db'
import { chainsQ } from '@repo/db'
import { ChainEditForm } from './chain-edit-form'
import { BrandOverridesPanel } from './brand-overrides-panel'

export const dynamic = 'force-dynamic'

export default async function ChainDetailPage({
  params,
}: {
  params: Promise<{ chain_id: string }>
}) {
  const { chain_id } = await params

  if (!isDbConfigured()) {
    return <p className="text-sm text-(--fg-faint)">Database not configured.</p>
  }

  const chain = await chainsQ.getChain(chain_id)
  if (!chain) notFound()

  const overrides = await chainsQ.listBrandOverrides(chain_id)

  const isVideo = chain.output_type === 'video' || !!chain.fal_model_secondary

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`${chain.family} · Chain Library`}
        title={chain.name_en}
        subtitle={chain.name_ar}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={chain.is_active ? 'success' : 'outline'} dot={chain.is_active}>
              {chain.is_active ? 'Active' : 'Inactive'}
            </Badge>
            <Badge tone={isVideo ? 'accent' : 'success'}>{chain.output_type}{isVideo && chain.fal_model_secondary ? ' · 2-model' : ''}</Badge>
            <Link href="/admin/chains" className="text-xs text-(--fg-muted) hover:text-(--fg)">← Library</Link>
          </div>
        }
      />

      {/* Quick stats strip */}
      <div className="flex flex-wrap gap-6 rounded-lg border border-(--border-subtle) bg-(--surface-1) px-5 py-4">
        <Stat label="Primary model"  value={chain.fal_model_primary} mono />
        {chain.fal_model_secondary && <Stat label="Secondary model" value={chain.fal_model_secondary} mono />}
        <Stat label="Cost estimate"  value={chain.cost_estimate_usd != null ? `$${Number(chain.cost_estimate_usd).toFixed(2)}` : '—'} />
        <Stat label="Latency"        value={chain.latency_estimate_s != null ? `${chain.latency_estimate_s}s` : '—'} />
        <Stat label="Dimensions"     value={chain.output_width && chain.output_height ? `${chain.output_width}×${chain.output_height}` : '—'} />
        <Stat label="Aspect ratio"   value={chain.aspect_ratio ?? '—'} />
        {chain.output_duration_s && <Stat label="Duration" value={`${chain.output_duration_s}s`} />}
        <Stat label="Min maturity"   value={`${chain.min_maturity_days}d`} />
        <Stat label="Provenance"     value={chain.provenance_confidence ?? '—'} />
      </div>

      {/* Eligibility & cultural constraints info cards (read-only display) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Eligibility</CardTitle></CardHeader>
          <CardBody className="space-y-3 text-sm">
            <InfoRow label="Quality tiers" value={((chain.quality_tiers ?? []) as string[]).join(', ')} />
            <InfoRow label="Sectors" value={chain.eligible_sectors?.join(', ') ?? 'All sectors'} />
            {chain.excluded_sectors?.length ? <InfoRow label="Excluded sectors" value={chain.excluded_sectors.join(', ')} danger /> : null}
            <InfoRow label="Occasions" value={chain.eligible_occasions?.join(', ') ?? 'All occasions'} />
            {chain.excluded_occasions?.length ? <InfoRow label="Excluded occasions" value={chain.excluded_occasions.join(', ')} danger /> : null}
            <InfoRow label="CD brains" value={chain.best_for_cd_brains?.join(', ') ?? '—'} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cultural Constraints</CardTitle></CardHeader>
          <CardBody className="space-y-2">
            {Object.entries((chain.cultural_constraints ?? {}) as Record<string, unknown>).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="text-(--fg-muted)">{k.replace(/_/g, ' ')}</span>
                <Badge tone={v === true ? 'warning' : 'outline'} size="sm">{String(v)}</Badge>
              </div>
            ))}
            {Object.keys(chain.cultural_constraints ?? {}).length === 0 && (
              <p className="text-xs text-(--fg-faint)">No constraints defined.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Anti-patterns */}
      {chain.anti_patterns && chain.anti_patterns.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Anti-Patterns</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-1.5">
              {chain.anti_patterns.map((ap, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-(--fg-muted)">
                  <span className="mt-0.5 text-(--fg-faint) shrink-0">✗</span>
                  <span>{ap}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Prompt template (read-only preview) */}
      <Card>
        <CardHeader>
          <CardTitle>Prompt Template</CardTitle>
          <p className="text-xs text-(--fg-faint) mt-1">Variables in {'{{double_braces}}'} are replaced at generation time. Edit below.</p>
        </CardHeader>
        <CardBody>
          <pre className="rounded-md bg-(--surface-3) p-3 font-mono text-xs text-(--fg-muted) whitespace-pre-wrap break-all max-h-56 overflow-auto">
            {chain.prompt_template}
          </pre>
          {chain.negative_prompt && (
            <>
              <p className="mt-3 mb-1 text-xs font-medium text-(--fg-muted)">Negative prompt:</p>
              <pre className="rounded-md bg-(--surface-3) p-3 font-mono text-xs text-(--fg-faint) whitespace-pre-wrap break-all max-h-32 overflow-auto">
                {chain.negative_prompt}
              </pre>
            </>
          )}
          {chain.video_motion_prompt && (
            <>
              <p className="mt-3 mb-1 text-xs font-medium text-(--fg-muted)">Video motion prompt <span className="font-normal text-(--fg-faint)">(image→video animation)</span>:</p>
              <pre className="rounded-md bg-(--surface-3) p-3 font-mono text-xs text-(--fg-faint) whitespace-pre-wrap break-all max-h-32 overflow-auto">
                {chain.video_motion_prompt}
              </pre>
            </>
          )}
        </CardBody>
      </Card>

      {/* Input schema */}
      <Card>
        <CardHeader><CardTitle>Input Schema</CardTitle></CardHeader>
        <CardBody>
          <pre className="rounded-md bg-(--surface-3) p-3 font-mono text-xs text-(--fg-muted) whitespace-pre-wrap break-all max-h-64 overflow-auto">
            {JSON.stringify(chain.input_schema, null, 2)}
          </pre>
        </CardBody>
      </Card>

      {/* Edit form */}
      <Card>
        <CardHeader><CardTitle>Edit Chain</CardTitle></CardHeader>
        <CardBody>
          <ChainEditForm chain={chain} />
        </CardBody>
      </Card>

      {/* Brand overrides */}
      <Card>
        <CardHeader>
          <CardTitle>Brand Overrides</CardTitle>
          <p className="text-xs text-(--fg-faint) mt-1">Per-brand prompt suffix, negative prompt, or model override. Added automatically when this chain is customised for a specific client.</p>
        </CardHeader>
        <CardBody>
          <BrandOverridesPanel chainId={chain_id} initialOverrides={overrides} />
        </CardBody>
      </Card>
    </div>
  )
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-(--fg-faint)">{label}</p>
      <p className={`mt-0.5 text-sm text-(--fg) ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
    </div>
  )
}

function InfoRow({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-36 shrink-0 text-xs text-(--fg-faint)">{label}</span>
      <span className={`text-xs ${danger ? 'text-red-500' : 'text-(--fg-muted)'}`}>{value}</span>
    </div>
  )
}
