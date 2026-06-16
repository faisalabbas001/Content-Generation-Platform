'use client'

import Link from 'next/link'
import { Badge } from '@repo/ui/badge'
import type { OnDemandQaGroup } from '@repo/db'

// ─── Style maps (shared visual language with the Calendar tab) ────────────────

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

// ─── Single brand card ────────────────────────────────────────────────────────

function OnDemandBrandCard({ group }: { group: OnDemandQaGroup }) {
  const sector    = group.sector ?? 'Other'
  const sectorCls = SECTOR_STYLES[sector] ?? SECTOR_STYLES['Other']
  const isHardBlock = group.hard_block_count > 0

  const reviewed = group.total_count - group.pending_count
  const pct = group.total_count > 0 ? Math.round((reviewed / group.total_count) * 100) : 0

  const displayName = group.brand_name_en || group.brand_name_ar || group.brand_id

  return (
    <Link
      href={`/admin/qa/on-demand/${group.brand_id}`}
      className={[
        'group relative flex flex-col overflow-hidden rounded-2xl border bg-(--surface-1)',
        'shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/20',
        isHardBlock
          ? 'border-red-500/40 hover:border-red-500/60'
          : 'border-(--border-subtle) hover:border-(--accent)/40',
      ].join(' ')}
    >
      {/* Top accent bar */}
      <div className={[
        'h-0.5 w-full',
        isHardBlock
          ? 'bg-gradient-to-r from-red-500 to-red-400'
          : group.pending_count > 0
            ? 'bg-gradient-to-r from-amber-400 to-yellow-300'
            : 'bg-gradient-to-r from-(--accent) to-(--accent)/60',
      ].join(' ')} />

      {/* ── Header area ────────────────────────────────────────── */}
      <div className="flex items-start gap-4 px-5 pt-5 pb-4">
        {/* Logo / avatar */}
        <div className="shrink-0">
          {group.logo_url ? (
            <img
              src={group.logo_url}
              alt=""
              className="h-12 w-12 rounded-xl object-cover ring-1 ring-(--border-subtle)"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-(--accent)/15 text-lg font-bold text-(--accent)">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-base font-semibold text-(--fg) group-hover:text-(--accent) transition-colors">
              {displayName}
            </span>
            {group.brand_name_en && group.brand_name_ar && (
              <span className="text-sm text-(--fg-muted)" dir="rtl">{group.brand_name_ar}</span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${sectorCls}`}>
              {sector.replace('_', '/')}
            </span>
            {group.pipeline_tier && (
              <Badge tone={group.pipeline_tier === 'Pro' ? 'info' : 'neutral'} size="sm">
                {group.pipeline_tier}
              </Badge>
            )}
            {group.primary_channel && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${CHANNEL_STYLES[group.primary_channel] ?? 'bg-(--surface-4) text-(--fg-muted) border-(--border-default)'}`}>
                {group.primary_channel}
              </span>
            )}
          </div>
        </div>

        {/* "New items" indicator — pending count that grows as new posts arrive */}
        {group.pending_count > 0 && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-black shadow"
            title={`${group.pending_count} item${group.pending_count > 1 ? 's' : ''} awaiting review`}
          >
            {group.pending_count} new
          </span>
        )}
      </div>

      {/* ── Stats row ──────────────────────────────────────────── */}
      <div className="mx-5 mb-4 grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center rounded-xl bg-(--surface-2) px-2 py-2.5 text-center">
          <span className="text-lg font-bold leading-none text-amber-400">{group.pending_count}</span>
          <span className="mt-1 text-[10px] text-(--fg-faint)">Pending</span>
        </div>
        <div className="flex flex-col items-center rounded-xl bg-(--surface-2) px-2 py-2.5 text-center">
          <span className="text-lg font-bold leading-none text-emerald-400">{group.approved_count}</span>
          <span className="mt-1 text-[10px] text-(--fg-faint)">Approved</span>
        </div>
        <div className="flex flex-col items-center rounded-xl bg-(--surface-2) px-2 py-2.5 text-center">
          <span className="text-lg font-bold leading-none text-(--fg-subtle)">{group.total_count}</span>
          <span className="mt-1 text-[10px] text-(--fg-faint)">Total in QA</span>
        </div>
      </div>

      {/* ── Progress bar ───────────────────────────────────────── */}
      <div className="mx-5 mb-4">
        <div className="mb-1.5 flex items-center justify-between text-[10px] text-(--fg-faint)">
          <span>On-demand requests</span>
          <span>{pct}% reviewed</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--surface-3)">
          <div
            className="h-full rounded-full bg-(--accent) transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* ── Hard-block warning ─────────────────────────────────── */}
      {isHardBlock && (
        <div className="mx-5 mb-4 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/8 px-3 py-2 text-[10px] text-red-300">
          <span>🔴</span>
          <span>
            {group.hard_block_count} hard-block item{group.hard_block_count > 1 ? 's' : ''} — immediate review
          </span>
        </div>
      )}

      {/* ── Footer: client slug + open link ────────────────────── */}
      <div className="mt-auto flex items-center justify-between border-t border-(--border-subtle) px-5 py-3">
        <span className="text-xs text-(--fg-faint)">
          {group.client_slug ? `/${group.client_slug}` : 'On-Demand QA'}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-(--accent) opacity-0 group-hover:opacity-100 transition-opacity">
          Open queue
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </Link>
  )
}

// ─── List ─────────────────────────────────────────────────────────────────────

export function OnDemandQaList({ groups }: { groups: OnDemandQaGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-(--border-subtle) bg-(--surface-2) px-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-3xl">✓</div>
        <p className="text-lg font-semibold text-(--fg)">All caught up</p>
        <p className="text-sm text-(--fg-muted)">No on-demand requests are waiting for review.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => (
        <OnDemandBrandCard key={group.brand_id} group={group} />
      ))}
    </div>
  )
}
