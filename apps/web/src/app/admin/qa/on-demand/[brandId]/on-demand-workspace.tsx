'use client'

import { useRouter } from 'next/navigation'
import type { QaQueueItem } from '@repo/db'

// ─── Trigger labels (mirror the On-Demand card) ───────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  first_ever_client_output:             'First output',
  brave_route_flagged:                  'Brave route',
  healthcare_health_claim:              'Health claim',
  finance_investment_claim:             'Finance claim',
  government_sector:                    'Government',
  religious_reference_high_sensitivity: 'Religious ref',
  dialect_unconfirmed_hero:             'Dialect gap',
  unresolved_conflict_record:           'Conflict record',
  revision_cycle_exceeded:              'Revision limit',
  cco_low_confidence:                   'Low CCO score',
  hard_block_negative_pattern:          'Hard block',
  method_violation:                     'Method drift',
  ceo_hold:                             'CEO hold',
}

function firstTrigger(reason: string | null | undefined): string | null {
  if (!reason) return null
  const part = reason.split(/[|,]/).map((s) => s.trim()).filter(Boolean)[0]
  return part ?? null
}

function isHardBlock(item: QaQueueItem): boolean {
  const f = item.flags as Record<string, unknown> | null
  return f?.negpat_flag === 'HARD_BLOCK' || (item.trigger_reason ?? '').includes('hard_block_negative_pattern')
}

// ─── Single post slot ─────────────────────────────────────────────────────────

function PostSlot({ item, onClick }: { item: QaQueueItem; onClick: () => void }) {
  const isPending  = item.status === 'pending'
  const isApproved = item.status === 'approved'
  const isRejected = item.status === 'rejected'

  const media       = item.media ?? null
  const isVideo     = media?.media_type === 'video'
  const imageSrc    = !isVideo ? (media?.storage_url ?? media?.clean_storage_url ?? null) : null
  const hardBlock   = isPending && isHardBlock(item)
  const trigger     = isPending ? firstTrigger(item.trigger_reason) : null
  const shortId     = item.queue_id.slice(0, 8)

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150',
        'cursor-pointer bg-(--surface-2) hover:shadow-lg hover:-translate-y-0.5',
        hardBlock
          ? 'border-red-500/50 hover:border-red-400'
          : isPending
            ? 'border-amber-500/50 hover:border-amber-400'
            : isApproved
              ? 'border-emerald-500/30 hover:border-emerald-400/60'
              : isRejected
                ? 'border-red-500/30 hover:border-red-400/60'
                : 'border-(--border-subtle)',
      ].join(' ')}
    >
      {/* Status bar */}
      <div className={[
        'h-0.5 w-full',
        isPending  ? 'bg-amber-400'   :
        isApproved ? 'bg-emerald-500' :
        isRejected ? 'bg-red-500'     : 'bg-sky-500',
      ].join(' ')} />

      {/* Media or placeholder */}
      <div className="relative aspect-square w-full overflow-hidden bg-(--surface-3)">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : isVideo ? (
          <div className="flex h-full items-center justify-center text-3xl text-(--fg-faint)">▶</div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1} className="text-(--fg-faint)">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
          </div>
        )}

        {/* Status indicator */}
        {isPending && (
          <div className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold shadow ${hardBlock ? 'bg-red-500 text-white' : 'bg-amber-400 text-black'}`}>!</div>
        )}
        {isApproved && (
          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
            <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
          </div>
        )}
        {isRejected && (
          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow">
            <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </div>
        )}
      </div>

      {/* Footer meta */}
      <div className="px-2 py-2">
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] font-bold text-(--fg-faint)">#{shortId}</span>
        </div>
        <p className="mt-0.5 text-[9px] text-(--fg-faint)">
          {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>
        {trigger && (
          <div className="mt-1 flex flex-wrap gap-0.5">
            <span
              className={`rounded px-1 py-0.5 text-[8px] font-semibold ${
                trigger === 'hard_block_negative_pattern' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
              }`}
            >
              {TRIGGER_LABELS[trigger] ?? trigger}
            </span>
          </div>
        )}
      </div>
    </button>
  )
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export function OnDemandWorkspace({
  items,
  brandId,
  stats,
}: {
  /** Items for the CURRENT page only — what the grid renders. */
  items: QaQueueItem[]
  brandId: string
  /** Whole-brand counts (independent of pagination) for the summary block. */
  stats: { pending: number; approved: number; rejected: number; total: number }
}) {
  const router = useRouter()

  const { pending, approved, rejected, total } = stats
  const reviewed = total - pending
  const pct      = total > 0 ? Math.round((reviewed / total) * 100) : 0

  function openPost(item: QaQueueItem) {
    router.push(`/admin/qa/on-demand/${brandId}/${item.queue_id}`)
  }

  return (
    <>
      {/* ── Stats + progress ────────────────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-(--border-subtle) bg-(--surface-2) p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-base font-semibold text-(--fg)">On-Demand Requests</p>
            <p className="text-xs text-(--fg-muted)">{total} item{total === 1 ? '' : 's'} in QA for this brand</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-(--fg)">{pct}%</p>
            <p className="text-xs text-(--fg-faint)">reviewed</p>
          </div>
        </div>

        <div className="h-2.5 w-full overflow-hidden rounded-full bg-(--surface-3) mb-4">
          <div className="h-full rounded-full bg-(--accent) transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Pending',  count: pending,  color: 'text-amber-400',   dot: 'bg-amber-400' },
            { label: 'Approved', count: approved, color: 'text-emerald-400', dot: 'bg-emerald-500' },
            { label: 'Rejected', count: rejected, color: 'text-red-400',     dot: 'bg-red-500' },
          ].map(({ label, count, color, dot }) => (
            <div key={label} className="flex flex-col items-center rounded-xl bg-(--surface-1) py-3 ring-1 ring-(--border-subtle)">
              <span className={`text-xl font-bold ${color}`}>{count}</span>
              <div className="mt-1 flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                <span className="text-[10px] text-(--fg-faint)">{label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Image grid ──────────────────────────────────────────── */}
      {total === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-(--border-subtle) bg-(--surface-2) px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 text-2xl">✓</div>
          <p className="text-sm text-(--fg-muted)">No on-demand items for this brand.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <PostSlot key={item.queue_id} item={item} onClick={() => openPost(item)} />
          ))}
        </div>
      )}

      <p className="mt-3 text-center text-[10px] text-(--fg-faint)">
        Click any item to open its full inspection page — media, prompts, generation data, regeneration history, and actions.
      </p>
    </>
  )
}
