'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@repo/ui/badge'
import type { CalendarQaGroup } from '@repo/db'
import { scoreBand, scoreBandLabel } from '@repo/core'

// ─── Label / style maps ───────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  first_ever_client_output:             'First-ever output',
  brave_route_flagged:                  'CCO brave-route flag',
  healthcare_health_claim:              'Health claim',
  finance_investment_claim:             'Finance claim',
  government_sector:                    'Government sector',
  religious_reference_high_sensitivity: 'High religious sensitivity',
  dialect_unconfirmed_hero:             'Dialect unconfirmed',
  unresolved_conflict_record:           'Conflict record',
  revision_cycle_exceeded:              'Revision limit reached',
  cco_low_confidence:                   'CCO low score (<50)',
  hard_block_negative_pattern:          'Hard block',
  method_violation:                     'Method drift',
  ceo_hold:                             'CEO hold',
  human_gate_override:                  'Admin hold',
}

const TRIGGER_DETAILS: Record<string, string> = {
  first_ever_client_output:             "Brand's first calendar — all posts held for audit.",
  brave_route_flagged:                  'CCO flagged culturally risky content.',
  healthcare_health_claim:              'Health claim requires compliance check.',
  finance_investment_claim:             'Investment claim requires compliance check.',
  government_sector:                    'Government sector: all content held by policy.',
  religious_reference_high_sensitivity: 'Religious reference on high-sensitivity brand.',
  dialect_unconfirmed_hero:             'Arabic dialect not yet confirmed by COO.',
  unresolved_conflict_record:           'Unresolved brand conflict — must be cleared first.',
  revision_cycle_exceeded:              'Max revision cycles reached. Final human decision needed.',
  cco_low_confidence:                   'CCO score < 50 — quality below threshold.',
  hard_block_negative_pattern:          'Prohibited negative-pattern — cannot auto-approve.',
  method_violation:                     'Post deviated from approved brand method.',
  ceo_hold:                             'CEO routing layer flagged for human review.',
  human_gate_override:                  'Manually placed on hold by an admin.',
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

const ORDINAL: Record<number, string> = {
  1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th',
}
function ordinal(n: number) { return (ORDINAL[n] ?? `${n}th`) + ' Calendar' }

function formatMonth(m: string) {
  try {
    const [y, mo] = m.split('-')
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  } catch { return m }
}

// ─── Score ring helper ────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number | null }) {
  const s = score ?? 0
  const b = scoreBand(score)
  const tone = b === 'clean' ? 'success' : b === 'mark' ? 'warning' : 'danger'
  const band = scoreBandLabel(score)
  return (
    <Badge tone={tone} size="sm">
      <span className="font-mono">{s.toFixed(0)}</span>
      <span className="ml-1 opacity-60 text-[9px] uppercase tracking-widest">{band}</span>
    </Badge>
  )
}

// ─── Triage derivation (shared by card + list sort/filter) ────────────────────

// Every fired human-override trigger for an item — full array from
// flags.human_gate_triggers (Doc §6.4) with trigger_reason as the fallback.
function itemReasons(i: { trigger_reason: string | null; flags: Record<string, unknown> }): string[] {
  const arr = Array.isArray(i.flags?.human_gate_triggers)
    ? (i.flags.human_gate_triggers as Array<{ reason?: string }>).map((t) => t?.reason).filter((r): r is string => !!r)
    : []
  if (arr.length > 0) return arr
  return (i.trigger_reason ?? '').split(/[|,]/).map((s) => s.trim()).filter(Boolean)
}

interface GroupTriage {
  isHardBlock: boolean
  triggerKeys: string[]
  worstScore: number | null
  /** The single most-important reason to surface in the card header. */
  primaryReason: string | null
  /** Sort weight — higher = more urgent. */
  urgency: number
  /** True when nothing is held and there's nothing pending to review. */
  isClean: boolean
}

function deriveGroupTriage(group: CalendarQaGroup): GroupTriage {
  const isHardBlock = group.qa_items.some((i) => itemReasons(i).includes('hard_block_negative_pattern'))
  const triggerKeys = [...new Set(group.qa_items.flatMap(itemReasons))]
  const minScore = group.qa_items.reduce(
    (min, i) => (i.cco_score !== null ? Math.min(min, i.cco_score) : min),
    Infinity,
  )
  const worstScore = isFinite(minScore) ? minScore : null

  // Priority order for the surfaced header reason: hard block first, then the
  // first non-hard-block trigger present.
  const primaryReason = isHardBlock
    ? 'hard_block_negative_pattern'
    : (triggerKeys[0] ?? null)

  const pendingCount = group.all_months.months.length > 0
    ? group.all_months.pending
    : group.qa_items.filter((i) => i.status === 'pending').length

  // Urgency: hard blocks dominate, then any trigger, then low worst-score, then
  // raw pending volume. Keeps the most actionable brands at the top of the page.
  let urgency = 0
  if (isHardBlock) urgency += 10_000
  if (triggerKeys.length > 0) urgency += 1_000 + triggerKeys.length
  if (worstScore !== null && worstScore < 50) urgency += 500
  urgency += Math.min(pendingCount, 99)

  const isClean = triggerKeys.length === 0 && pendingCount === 0
  return { isHardBlock, triggerKeys, worstScore, primaryReason, urgency, isClean }
}

// ─── Single brand card ────────────────────────────────────────────────────────

function BrandQaCard({ group, triage }: { group: CalendarQaGroup; triage: GroupTriage }) {
  const seq      = group.calendar_sequence ?? 1
  const sector   = group.sector ?? 'Other'
  const sectorCls = SECTOR_STYLES[sector] ?? SECTOR_STYLES['Other']

  const { isHardBlock, triggerKeys, worstScore, primaryReason } = triage

  // 3-MONTH ROLLING: a brand has up to 3 calendars (current + next 2). The card must
  // report TRUE cross-month totals, not the single calendar this group represents —
  // otherwise "25 / August" hides the other two months. group.all_months is the
  // per-brand roll-up over every calendar_posts row across all the brand's calendars.
  const am = group.all_months
  const hasAllMonths = am.months.length > 0
  // Aggregate across all months when available; fall back to this calendar's items.
  const total    = hasAllMonths ? am.total    : group.qa_items.length
  // "approved" = admin moved the post forward (released to client / client-approved).
  const approved = hasAllMonths ? am.released : group.qa_items.filter((i) => i.status === 'released' || i.status === 'approved').length
  const pending  = hasAllMonths ? am.pending  : group.qa_items.filter((i) => i.status === 'pending').length
  const pct = total > 0 ? Math.round((approved / total) * 100) : 0

  return (
    <Link
      href={`/admin/qa/${group.brand_id}`}
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
        isHardBlock ? 'bg-gradient-to-r from-red-500 to-red-400'
        : seq === 1    ? 'bg-gradient-to-r from-amber-400 to-yellow-300'
        : seq === 2    ? 'bg-gradient-to-r from-blue-400 to-indigo-400'
        :                'bg-gradient-to-r from-(--accent) to-(--accent)/60',
      ].join(' ')} />

      {/* ── Header area ────────────────────────────────────────── */}
      <div className="flex items-start gap-3 px-5 pt-5 pb-4">
        {/* Logo / avatar */}
        <div className="shrink-0">
          {group.logo_url ? (
            <img
              src={group.logo_url}
              alt=""
              className="h-11 w-11 rounded-xl object-cover ring-1 ring-(--border-subtle)"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-(--accent)/15 text-lg font-bold text-(--accent)">
              {(group.brand_name_en ?? group.brand_name_ar).charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Name + meta — min-w-0 so it can shrink when right col is wide */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-base font-semibold text-(--fg) group-hover:text-(--accent) transition-colors leading-tight">
              {group.brand_name_en ?? group.brand_name_ar}
            </span>
            {group.brand_name_en && (
              <span className="truncate text-xs text-(--fg-muted)" dir="rtl">{group.brand_name_ar}</span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge tone={seq === 1 ? 'warning' : seq === 2 ? 'info' : 'neutral'} size="sm">
              {ordinal(seq)}
            </Badge>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${sectorCls}`}>
              {sector.replace('_', '/')}
            </span>
            {group.pipeline_tier && (
              <Badge tone={group.pipeline_tier === 'Pro' ? 'info' : 'neutral'} size="sm">
                {group.pipeline_tier}
              </Badge>
            )}
          </div>
        </div>

        {/* Score only — primary reason moved below to avoid breaking header layout */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {worstScore !== null && <ScoreRing score={worstScore} />}
          {primaryReason && (
            <div className={`max-w-[110px] rounded-md px-1.5 py-0.5 text-[9px] font-semibold leading-tight text-center truncate ${isHardBlock ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}
              title={TRIGGER_LABELS[primaryReason] ?? primaryReason}
            >
              {isHardBlock ? '🔴 ' : '⚠ '}{TRIGGER_LABELS[primaryReason] ?? primaryReason}
            </div>
          )}
        </div>
      </div>

      {/* Brand differentiator */}
      {group.brand_differentiator && (
        <p className="mx-5 mb-3 text-xs leading-relaxed text-(--fg-muted) line-clamp-1">
          {group.brand_differentiator}
        </p>
      )}

      {/* ── Stats row ──────────────────────────────────────────── */}
      <div className="mx-5 mb-4 grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center rounded-xl bg-(--surface-2) px-2 py-2.5 text-center">
          <span className="text-lg font-bold leading-none text-amber-400">{pending}</span>
          <span className="mt-1 text-[10px] text-(--fg-faint)">Pending</span>
        </div>
        <div className="flex flex-col items-center rounded-xl bg-(--surface-2) px-2 py-2.5 text-center">
          <span className="text-lg font-bold leading-none text-emerald-400">{approved}</span>
          <span className="mt-1 text-[10px] text-(--fg-faint)">{hasAllMonths ? 'Released' : 'Approved'}</span>
        </div>
        <div className="flex flex-col items-center rounded-xl bg-(--surface-2) px-2 py-2.5 text-center">
          <span className="text-lg font-bold leading-none text-(--fg-subtle)">{total}</span>
          <span className="mt-1 text-[10px] text-(--fg-faint)">{hasAllMonths ? 'Total posts' : 'Total in QA'}</span>
        </div>
      </div>

      {/* ── Per-month breakdown (3-month rolling) ──────────────── */}
      {hasAllMonths && am.months.length > 1 && (
        <div className="mx-5 mb-4 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${am.months.length}, minmax(0, 1fr))` }}>
          {am.months.map((m) => (
            <div key={m.month} className="flex flex-col items-center rounded-lg border border-(--border-subtle) bg-(--surface-2) px-1.5 py-1.5 text-center">
              <span className="text-[10px] font-semibold text-(--fg-muted)">{formatMonth(m.month)}</span>
              <span className="mt-0.5 text-xs font-bold text-(--fg)">
                <span className="text-emerald-400">{m.released}</span>
                <span className="text-(--fg-faint)">/{m.total}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Progress bar ───────────────────────────────────────── */}
      <div className="mx-5 mb-4">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-(--fg-faint)">
          <span className="truncate">{hasAllMonths ? `${am.months.length} month${am.months.length > 1 ? 's' : ''} · ${approved}/${total} released` : formatMonth(group.month)}</span>
          <span className="shrink-0">{pct}% released</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--surface-3)">
          <div
            className="h-full rounded-full bg-(--accent) transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* ── Hold reasons ───────────────────────────────────────── */}
      {triggerKeys.length > 0 && (
        <div className={[
          'mx-5 mb-4 rounded-xl border p-3',
          isHardBlock
            ? 'border-red-500/25 bg-red-500/8'
            : 'border-amber-500/20 bg-amber-500/8',
        ].join(' ')}>
          <p className={`mb-2 text-[10px] font-semibold uppercase tracking-widest ${isHardBlock ? 'text-red-400' : 'text-amber-400'}`}>
            {isHardBlock ? '🔴 Hard block' : '⚠ Hold reasons'}
          </p>
          <div className="space-y-2">
            {triggerKeys.slice(0, 3).map((k) => (
              <div key={k}>
                <p className="text-xs font-semibold text-(--fg) line-clamp-1">{TRIGGER_LABELS[k] ?? k}</p>
                <p className="text-[10px] text-(--fg-muted) line-clamp-2">{TRIGGER_DETAILS[k] ?? ''}</p>
              </div>
            ))}
            {triggerKeys.length > 3 && (
              <p className="text-[10px] text-(--fg-faint)">+{triggerKeys.length - 3} more reasons</p>
            )}
          </div>
        </div>
      )}

      {/* ── Religious sensitivity warning ──────────────────────── */}
      {group.religious_sensitivity === 'High' && (
        <div className="mx-5 mb-4 flex items-center gap-2 rounded-xl border border-purple-500/20 bg-purple-500/8 px-3 py-2 text-[10px] text-purple-300">
          <span>🕌</span>
          <span>High religious sensitivity — extra care required</span>
        </div>
      )}

      {/* ── Footer: month range + open link ─────────────────────── */}
      <div className="mt-auto flex items-center justify-between border-t border-(--border-subtle) px-5 py-3">
        <span className="text-xs text-(--fg-faint)">
          {hasAllMonths && am.months.length > 1
            ? `${formatMonth(am.months[0]!.month)} – ${formatMonth(am.months[am.months.length - 1]!.month)}`
            : formatMonth(group.month)}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-(--accent) opacity-0 group-hover:opacity-100 transition-opacity">
          Open workspace
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </Link>
  )
}

// ─── List ─────────────────────────────────────────────────────────────────────

type TriageFilter = 'all' | 'needs_me' | 'hard_blocks'

export function CalendarQaList({ groups }: { groups: CalendarQaGroup[] }) {
  const [filter, setFilter] = useState<TriageFilter>('all')

  // Derive triage once, sort by urgency (most actionable first). This sorts
  // within the current page — server-side pagination already surfaces hard
  // blocks first across pages.
  const enriched = useMemo(() => {
    return groups
      .map((group) => ({ group, triage: deriveGroupTriage(group) }))
      .sort((a, b) => b.triage.urgency - a.triage.urgency)
  }, [groups])

  const counts = useMemo(() => ({
    all: enriched.length,
    needs_me: enriched.filter((e) => e.triage.triggerKeys.length > 0).length,
    hard_blocks: enriched.filter((e) => e.triage.isHardBlock).length,
  }), [enriched])

  const visible = useMemo(() => {
    if (filter === 'needs_me') return enriched.filter((e) => e.triage.triggerKeys.length > 0)
    if (filter === 'hard_blocks') return enriched.filter((e) => e.triage.isHardBlock)
    return enriched
  }, [enriched, filter])

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-(--border-subtle) bg-(--surface-2) px-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-3xl">✓</div>
        <p className="text-lg font-semibold text-(--fg)">All caught up</p>
        <p className="text-sm text-(--fg-muted)">No calendars are waiting for review.</p>
      </div>
    )
  }

  const FILTERS: Array<{ key: TriageFilter; label: string; count: number; tone: string }> = [
    { key: 'all',         label: 'All',           count: counts.all,         tone: 'bg-(--surface-3) text-(--fg)' },
    { key: 'needs_me',    label: 'Needs me',      count: counts.needs_me,    tone: 'bg-amber-500/15 text-amber-400' },
    { key: 'hard_blocks', label: 'Hard blocks',   count: counts.hard_blocks, tone: 'bg-red-500/15 text-red-400' },
  ]

  return (
    <>
      {/* Triage filter bar — sorted by urgency, filterable to what needs action. */}
      <div className="mb-4 flex overflow-x-auto pb-0.5">
      <div className="inline-flex items-center gap-1 rounded-xl border border-(--border-subtle) bg-(--surface-2) p-1 shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            disabled={f.count === 0 && f.key !== 'all'}
            className={[
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none',
              filter === f.key ? f.tone : 'text-(--fg-muted) hover:text-(--fg)',
            ].join(' ')}
          >
            {f.label}
            <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${filter === f.key ? 'bg-black/20' : 'bg-(--surface-3) text-(--fg-faint)'}`}>{f.count}</span>
          </button>
        ))}
      </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-(--border-subtle) bg-(--surface-2) px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-2xl">✓</div>
          <p className="text-sm font-semibold text-(--fg)">Nothing in this filter</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map(({ group, triage }) => (
            <BrandQaCard key={group.calendar_id} group={group} triage={triage} />
          ))}
        </div>
      )}
    </>
  )
}
