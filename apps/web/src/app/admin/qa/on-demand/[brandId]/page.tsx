import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { adminQ } from '@repo/db'
import { Badge } from '@repo/ui/badge'
import { OnDemandWorkspace } from './on-demand-workspace'
import { OnDemandPager } from './pager'

export const dynamic = 'force-dynamic'

// On-demand items per workspace page. Brands with more than this paginate.
const ITEMS_PER_PAGE = 20

function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw
  const n = Number(v)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

const SECTOR_STYLES: Record<string, string> = {
  'F&B':             'bg-orange-500/10 text-orange-300 border-orange-500/20',
  'Retail':          'bg-blue-500/10 text-blue-300 border-blue-500/20',
  'Beauty_Wellness': 'bg-pink-500/10 text-pink-300 border-pink-500/20',
  'Healthcare':      'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  'Finance':         'bg-yellow-500/10 text-yellow-300 border-yellow-500/20',
  'Government':      'bg-purple-500/10 text-purple-300 border-purple-500/20',
  'Other':           'bg-neutral-500/10 text-neutral-400 border-neutral-500/20',
}

const CHANNEL_STYLES: Record<string, string> = {
  Instagram: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  TikTok:    'bg-white/5 text-(--fg-subtle) border-(--border-default)',
  Snapchat:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  Twitter:   'bg-sky-500/10 text-sky-400 border-sky-500/20',
}

export default async function OnDemandBrandDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const { brandId } = await params
  const { page: pageParam } = await searchParams

  // Pull every brand group (page size 999) and locate this brand — mirrors the
  // Calendar tab's brand-detail fetch.
  const { groups } = await adminQ.getQaOnDemandGroups(1, 999)
  const group = groups.find((g) => g.brand_id === brandId)
  if (!group) notFound()

  // ── Paginate this brand's items (20 per page) ──────────────────────
  const basePath = `/admin/qa/on-demand/${brandId}`
  const requestedPage = parsePage(pageParam)
  const totalItems = group.items.length
  const pageCount = Math.max(Math.ceil(totalItems / ITEMS_PER_PAGE), 1)
  if (requestedPage > pageCount && totalItems > 0) redirect(basePath)
  const currentPage = Math.min(Math.max(requestedPage, 1), pageCount)
  const pageItems = group.items.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  )
  const from = totalItems === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1
  const to = Math.min(currentPage * ITEMS_PER_PAGE, totalItems)

  const sector = group.sector ?? 'Other'
  const sectorCls = SECTOR_STYLES[sector] ?? SECTOR_STYLES['Other']
  const isHardBlock = group.hard_block_count > 0

  const reviewed = group.total_count - group.pending_count
  const pct = group.total_count > 0 ? Math.round((reviewed / group.total_count) * 100) : 0

  const displayName = group.brand_name_en || group.brand_name_ar || group.brand_id

  return (
    <div className="min-h-screen bg-(--surface-1)">

      {/* ── Sticky top nav ──────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-(--border-subtle) bg-(--surface-1)/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/admin/qa?tab=on_demand"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) transition-colors"
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            On-Demand QA
          </Link>
          <span className="text-(--fg-faint)">/</span>

          {/* Brand identity pill */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {group.logo_url ? (
              <img src={group.logo_url} alt="" className="h-6 w-6 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-(--accent)/20 text-[10px] font-bold text-(--accent)">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="truncate text-sm font-semibold text-(--fg)">{displayName}</span>
            {group.brand_name_en && group.brand_name_ar && (
              <span className="hidden text-xs text-(--fg-faint) sm:inline" dir="rtl">{group.brand_name_ar}</span>
            )}
          </div>

          {group.pending_count > 0 && (
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <Badge tone="warning" dot>{group.pending_count} pending</Badge>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6">

        {/* ── Brand hero header ────────────────────────────────── */}
        <div className={[
          'mb-8 overflow-hidden rounded-2xl border',
          isHardBlock ? 'border-red-500/30' : 'border-(--border-subtle)',
        ].join(' ')}>
          {/* Gradient accent top */}
          <div className={[
            'h-1 w-full',
            isHardBlock
              ? 'bg-gradient-to-r from-red-500 to-red-400'
              : group.pending_count > 0
                ? 'bg-gradient-to-r from-amber-400 to-yellow-300'
                : 'bg-gradient-to-r from-(--accent) to-(--accent)/60',
          ].join(' ')} />

          <div className="bg-(--surface-2) px-6 py-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              {/* Logo */}
              <div className="shrink-0">
                {group.logo_url ? (
                  <img
                    src={group.logo_url}
                    alt=""
                    className="h-16 w-16 rounded-2xl object-cover ring-2 ring-(--border-subtle)"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-(--accent)/15 text-2xl font-bold text-(--accent)">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Names + tags */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1 className="text-2xl font-bold text-(--fg)">{displayName}</h1>
                  {group.brand_name_en && group.brand_name_ar && (
                    <span className="text-base text-(--fg-muted)" dir="rtl">{group.brand_name_ar}</span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-(--accent)/30 bg-(--accent)/10 px-2.5 py-0.5 text-xs font-medium text-(--accent)">
                    On-Demand
                  </span>
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${sectorCls}`}>
                    {sector.replace('_', '/')}
                  </span>
                  {group.pipeline_tier && (
                    <Badge tone={group.pipeline_tier === 'Pro' ? 'info' : 'neutral'} size="sm">
                      {group.pipeline_tier}
                    </Badge>
                  )}
                  {group.primary_channel && (
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHANNEL_STYLES[group.primary_channel] ?? 'bg-(--surface-4) text-(--fg-muted) border-(--border-default)'}`}>
                      {group.primary_channel}
                    </span>
                  )}
                  {group.arabic_dialect && (
                    <Badge tone="neutral" size="sm">{group.arabic_dialect.replace(/_/g, ' ')}</Badge>
                  )}
                  {isHardBlock && (
                    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-bold text-red-400">
                      🔴 {group.hard_block_count} Hard Block{group.hard_block_count > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {group.client_slug && (
                  <p className="mt-2.5 font-mono text-xs text-(--fg-faint)">/{group.client_slug}</p>
                )}
              </div>

              {/* QA progress stats */}
              <div className="flex shrink-0 gap-3 sm:flex-col sm:items-end sm:gap-2">
                <div className="flex flex-col items-center rounded-xl bg-(--surface-1) px-4 py-2.5 text-center ring-1 ring-(--border-subtle)">
                  <span className="text-xl font-bold text-amber-400">{group.pending_count}</span>
                  <span className="text-[10px] text-(--fg-faint)">pending</span>
                </div>
                <div className="flex flex-col items-center rounded-xl bg-(--surface-1) px-4 py-2.5 text-center ring-1 ring-(--border-subtle)">
                  <span className="text-xl font-bold text-emerald-400">{pct}%</span>
                  <span className="text-[10px] text-(--fg-faint)">reviewed</span>
                </div>
              </div>
            </div>

            {/* QA progress bar */}
            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-xs text-(--fg-faint)">
                <span>QA progress — {reviewed}/{group.total_count} reviewed</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-(--surface-3)">
                <div
                  className="h-full rounded-full bg-(--accent) transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── On-Demand workspace ───────────────────────────────── */}
        <OnDemandWorkspace
          items={pageItems}
          brandId={brandId}
          stats={{
            pending:  group.pending_count,
            approved: group.approved_count,
            rejected: group.rejected_count,
            total:    group.total_count,
          }}
        />

        {/* ── Pagination (only when the brand has more than one page) ── */}
        <OnDemandPager
          basePath={basePath}
          page={currentPage}
          pageCount={pageCount}
          from={from}
          to={to}
          total={totalItems}
          unit="items"
        />
      </div>
    </div>
  )
}
