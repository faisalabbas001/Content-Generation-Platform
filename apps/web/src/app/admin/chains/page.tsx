import Link from 'next/link'
import { PageHeader } from '@repo/ui/page-header'
import { Badge } from '@repo/ui/badge'
import { Card, CardBody } from '@repo/ui/card'
import { isDbConfigured } from '@repo/db'
import { chainsQ } from '@repo/db'
import { FilterBar } from '../admin-widgets'
import type { ChainRow } from '@repo/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 80

const OUTPUT_TYPE_TONE: Record<string, 'success' | 'info' | 'warning' | 'accent' | 'outline'> = {
  image:    'success',
  video:    'accent',
  carousel: 'info',
  audio:    'warning',
  mixed:    'outline',
}

const TIER_TONE: Record<string, 'success' | 'warning' | 'danger' | 'outline'> = {
  starter:    'success',
  growth:     'warning',
  enterprise: 'danger',
}

export default async function ChainsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const page   = Math.max(1, parseInt(sp.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  if (!isDbConfigured()) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Creative" title="Chain Library" subtitle="Manage fal.ai creative chains" />
        <p className="text-sm text-(--fg-faint)">Database not configured.</p>
      </div>
    )
  }

  const { rows, total } = await chainsQ.listChains(
    {
      family:      sp.family      ?? undefined,
      output_type: sp.output_type ?? undefined,
      is_active:   sp.is_active !== undefined ? sp.is_active === 'true' : undefined,
      search:      sp.search      ?? undefined,
    },
    { limit: PAGE_SIZE, offset },
  )

  const families = await chainsQ.getChainFamilies()

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const filterParams = [
    sp.family      ? `family=${encodeURIComponent(sp.family)}`           : '',
    sp.output_type ? `output_type=${encodeURIComponent(sp.output_type)}` : '',
    sp.is_active   ? `is_active=${sp.is_active}`                         : '',
    sp.search      ? `search=${encodeURIComponent(sp.search)}`           : '',
  ].filter(Boolean).join('&')

  // Group by family for display
  const byFamily = new Map<string, ChainRow[]>()
  for (const chain of rows) {
    const list = byFamily.get(chain.family) ?? []
    list.push(chain)
    byFamily.set(chain.family, list)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creative"
        title="Chain Library"
        subtitle={`${total} chains · fal.ai creative recipes for image and video generation`}
        action={
          <Link
            href="/admin/chains/new"
            className="inline-flex items-center gap-1.5 rounded-(--r-md) bg-(--accent) px-3.5 py-2 text-sm font-medium text-(--accent-fg) hover:bg-(--accent-strong) transition-colors"
          >
            + New Chain
          </Link>
        }
      />

      <FilterBar
        filters={[
          { key: 'search',      placeholder: 'Search name, ID, purpose…',         current: sp.search },
          { key: 'family',      placeholder: 'Family (TF01…TF23)', type: 'select', options: families, current: sp.family },
          { key: 'output_type', placeholder: 'Output type', type: 'select',        options: ['image','video','carousel','audio','mixed'], current: sp.output_type },
          { key: 'is_active',   placeholder: 'Status', type: 'select',             options: ['true','false'], current: sp.is_active },
        ]}
      />

      <div className="flex items-center justify-between text-xs text-(--fg-muted)">
        <span>{total.toLocaleString()} chains · page {page} of {totalPages}</span>
        <span className="text-(--fg-faint)">{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-sm text-(--fg-faint)">No chains match these filters.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          {[...byFamily.entries()].map(([family, chains]) => (
            <div key={family}>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-(--fg-muted) uppercase tracking-widest">{family}</span>
                <span className="text-xs text-(--fg-faint)">· {chains.length} chain{chains.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
                {chains.map((c) => <ChainRow key={c.chain_id} chain={c} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      <ChainsPagination current={page} total={totalPages} filterParams={filterParams} />
    </div>
  )
}

function ChainRow({ chain: c }: { chain: ChainRow }) {
  const isVideo  = c.output_type === 'video'
  const tiers    = (c.quality_tiers ?? []) as string[]

  return (
    <Link
      href={`/admin/chains/${c.chain_id}`}
      className="block rounded-lg border border-(--border-subtle) bg-(--surface-1) px-4 py-3 hover:bg-(--surface-2) hover:border-(--border-default) transition-colors"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Status dot */}
        <span className={`h-2 w-2 rounded-full shrink-0 ${c.is_active ? 'bg-emerald-500' : 'bg-(--fg-faint)'}`} />

        {/* Chain ID */}
        <span className="font-mono text-xs text-(--fg-muted)">{c.chain_id}</span>

        {/* Format tier + output type */}
        <Badge tone={isVideo ? 'accent' : 'success'} size="sm">
          {isVideo ? 'Tier 2 · Video' : 'Tier 1 · Image'}
        </Badge>
        {isVideo && c.fal_model_secondary && (
          <Badge tone="outline" size="sm">2-model</Badge>
        )}
        {c.requires_ref_img && (
          <Badge tone="warning" size="sm">Ref Img</Badge>
        )}

        {/* Quality tier badges */}
        {tiers.map((t) => (
          <Badge key={t} tone={TIER_TONE[t] ?? 'outline'} size="sm">{t}</Badge>
        ))}

        {/* Cost */}
        {c.cost_estimate_usd != null && (
          <span className="text-xs text-(--fg-faint) tabular-nums">${Number(c.cost_estimate_usd).toFixed(2)}</span>
        )}
        {c.latency_estimate_s != null && (
          <span className="text-xs text-(--fg-faint) tabular-nums">{c.latency_estimate_s}s</span>
        )}

        <span className="ms-auto text-xs text-(--fg-faint) shrink-0">
          {c.aspect_ratio ?? (c.output_width && c.output_height ? `${c.output_width}×${c.output_height}` : '—')}
        </span>
      </div>

      {/* Names */}
      <div className="mt-1.5 flex items-baseline gap-3">
        <span className="text-sm font-medium text-(--fg)">{c.name_en}</span>
        <span className="text-sm text-(--fg-muted)" dir="rtl">{c.name_ar}</span>
      </div>

      {/* Purpose */}
      {c.purpose && (
        <p className="mt-0.5 text-xs text-(--fg-muted) line-clamp-1">{c.purpose}</p>
      )}

      {/* Models */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-(--fg-faint) font-mono">
        <span>{c.fal_model_primary}</span>
        {c.fal_model_secondary && (
          <>
            <span className="text-(--fg-faint)">→</span>
            <span>{c.fal_model_secondary}</span>
          </>
        )}
      </div>
    </Link>
  )
}

function ChainsPagination({ current, total, filterParams }: { current: number; total: number; filterParams: string }) {
  if (total <= 1) return null
  const base = filterParams ? `?${filterParams}&` : '?'
  const prev = current > 1 ? current - 1 : null
  const next = current < total ? current + 1 : null

  const pages = new Set<number>()
  pages.add(1); pages.add(total)
  for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) pages.add(i)
  const pageList = Array.from(pages).sort((a, b) => a - b)

  return (
    <div className="flex items-center justify-between border-t border-(--border-subtle) pt-4 text-xs text-(--fg-muted)">
      <div className="flex gap-1 flex-wrap">
        {prev ? (
          <Link href={`${base}page=${prev}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 hover:bg-(--surface-2) transition-colors">← Prev</Link>
        ) : (
          <span className="cursor-not-allowed rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 opacity-40">← Prev</span>
        )}
        {pageList.map((p, idx) => {
          const gap = (pageList[idx - 1] ?? 0) !== p - 1 && idx > 0
          return (
            <span key={p} className="flex items-center gap-1">
              {gap && <span className="px-1 text-(--fg-faint)">…</span>}
              {p === current ? (
                <span className="rounded-(--r-sm) border border-(--accent) bg-(--accent)/10 px-2.5 py-1 font-medium text-(--accent)">{p}</span>
              ) : (
                <Link href={`${base}page=${p}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 hover:bg-(--surface-2) transition-colors">{p}</Link>
              )}
            </span>
          )
        })}
        {next ? (
          <Link href={`${base}page=${next}`} scroll={false} className="rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 hover:bg-(--surface-2) transition-colors">Next →</Link>
        ) : (
          <span className="cursor-not-allowed rounded-(--r-sm) border border-(--border-subtle) px-2.5 py-1 opacity-40">Next →</span>
        )}
      </div>
      <span>Page {current} of {total}</span>
    </div>
  )
}
