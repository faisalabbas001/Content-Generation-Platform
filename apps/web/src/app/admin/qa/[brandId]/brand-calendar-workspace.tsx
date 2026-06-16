'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@repo/ui/badge'
import type { CalendarQaPostRow } from '@repo/db'
import { scoreBand, scoreBandLabel } from '@repo/core'
import { triggerA01ForBrand, approveAllCalendarPosts } from './actions'

// ─── Trigger labels ───────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMonth(month: string) {
  try {
    const [y, m] = month.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  } catch { return month }
}

function ScoreBadge({ score }: { score: number | null }) {
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

// ─── Post slot card ───────────────────────────────────────────────────────────

function PostSlot({
  pos,
  item,
  onClick,
  attention,
}: {
  pos: number
  item: CalendarQaPostRow | undefined
  onClick: () => void
  attention?: { severity: 'critical' | 'warning'; reason: string } | null
}) {
  const isPending  = item?.status === 'pending'
  const isReleased = item?.status === 'released'  // admin released → awaiting CLIENT approval
  const isApproved = item?.status === 'approved'  // CLIENT approved
  const isRejected = item?.status === 'rejected'
  const isBlocked  = item?.status === 'blocked'   // system compliance block
  const isEmpty    = !item
  // Image generation genuinely failed (Worker exhausted retries) → show an explicit
  // "image not generated" state instead of a silent blank box, so the admin knows it
  // needs regeneration. We key on raw_status ('failed_visual' = terminal failure)
  // because the display `status` remaps failed_visual → 'pending'. A post still
  // being prepared (pending_visual/visual_processing) is NOT a failure.
  const rawStatus = (item as { raw_status?: string | null } | null)?.raw_status ?? null
  const isImageFailed = !!item && !item.storage_url && item.format_tier !== 'video' &&
    rawStatus === 'failed_visual'
  const isPreparing = !!item && !item.storage_url && item.format_tier !== 'video' &&
    !isImageFailed && (rawStatus === 'pending_visual' || rawStatus === 'visual_processing')

  return (
    <button
      type="button"
      disabled={isEmpty}
      onClick={onClick}
      className={[
        'group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150',
        isEmpty
          ? 'cursor-default border-dashed border-(--border-subtle) bg-(--surface-2) opacity-40'
          : 'cursor-pointer bg-(--surface-2) hover:shadow-lg hover:-translate-y-0.5',
        isPending
          ? 'border-amber-500/50 hover:border-amber-400'
          : isReleased
            ? 'border-blue-500/40 hover:border-blue-400/70'
            : isApproved
              ? 'border-emerald-500/30 hover:border-emerald-400/60'
              : isRejected
                ? 'border-red-500/30 hover:border-red-400/60'
                : isBlocked
                  ? 'border-(--border-default) hover:border-(--fg-faint)'
                  : 'border-(--border-subtle)',
      ].join(' ')}
    >
      {/* Status bar */}
      {item && (
        <div className={[
          'h-0.5 w-full',
          isPending  ? 'bg-amber-400'   :
          isReleased ? 'bg-blue-500'    :
          isApproved ? 'bg-emerald-500' :
          isRejected ? 'bg-red-500'     :
          isBlocked  ? 'bg-(--fg-faint)' : 'bg-(--border-subtle)',
        ].join(' ')} />
      )}

      {/* Image / video / placeholder. A video storage_url (.mp4) MUST render in a
          <video> — an <img src=".mp4"> shows a broken/black box (the bug). */}
      <div className="relative aspect-square w-full overflow-hidden bg-(--surface-3)">
        {item?.storage_url && (item.format_tier === 'video' || item.format === 'video' || /\.mp4(\?|$)/i.test(item.storage_url)) ? (
          <video
            src={item.storage_url}
            autoPlay
            muted
            loop
            playsInline
            className="h-full w-full object-cover"
          />
        ) : item?.storage_url ? (
          <img
            src={item.storage_url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : item?.format_tier === 'video' ? (
          /* Video post, not yet rendered → preparing, not a failure. */
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
            <span className="text-3xl text-sky-400/60">▶</span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-sky-400/70">Preparing video</span>
          </div>
        ) : isImageFailed ? (
          /* Generation failed — explicit, not a silent blank box. */
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="text-red-400/80">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008M3 3l18 18M21 12a9 9 0 01-9 9m-7.5-2.5A9 9 0 0112 3" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-wide text-red-400/80 leading-tight">
              Image not generated
            </span>
            <span className="text-[9px] text-(--fg-faint) leading-tight">Needs regeneration</span>
          </div>
        ) : isPreparing ? (
          /* Generated but image not yet produced/claimed — being prepared. */
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="text-sky-400/70">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
            <span className="text-[10px] font-bold uppercase tracking-wide text-sky-400/70 leading-tight">Preparing</span>
          </div>
        ) : (
          /* No post at all for this slot. */
          <div className="flex h-full items-center justify-center">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1} className="text-(--fg-faint)">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
          </div>
        )}

        {/* Score chip top-left: composite if available, else cco_score.
            Admin sees the real multi-pillar number, not just CCO caption score. */}
        {item && (typeof item.confidence_score === 'number' || typeof item.cco_score === 'number') && (
          <div
            className={[
              'absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[10px] font-bold tabular-nums shadow ring-1 backdrop-blur-sm',
              scoreBand(item.confidence_score ?? item.cco_score) === 'clean' ? 'bg-emerald-500/85 text-white ring-emerald-300/40' :
              scoreBand(item.confidence_score ?? item.cco_score) === 'mark'  ? 'bg-amber-500/85 text-black ring-amber-300/40' :
              'bg-red-500/90 text-white ring-red-300/40',
            ].join(' ')}
            title={`Composite: ${(item.confidence_score ?? item.cco_score ?? 0).toFixed(0)} — ${scoreBandLabel(item.confidence_score ?? item.cco_score)}`}
          >
            {(item.confidence_score ?? item.cco_score ?? 0).toFixed(0)}
          </div>
        )}

        {/* Watermark badge (bottom-left) — clearly visible so admin knows this
            post will show the "AI Draft" overlay to the client. Never hidden. */}
        {item?.watermark && (
          <div
            className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide bg-amber-400/90 text-black shadow"
            title="This post will show the AI Draft watermark to the client (score 50–74)"
          >
            AI Draft
          </div>
        )}

        {/* Status indicators */}
        {isPending && (
          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-black shadow">!</div>
        )}
        {isReleased && (
          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-white shadow" title="Released — awaiting client approval">
            <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>
          </div>
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
        {isBlocked && (
          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-(--surface-1) text-(--fg-muted) shadow ring-1 ring-(--border-default)" title="Compliance-blocked by the system">
            <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
          </div>
        )}
      </div>

      {/* Footer meta */}
      <div className="px-2 py-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold text-(--fg-faint)">#{pos}</span>
          {item?.content_type && (
            <span className="truncate text-[9px] uppercase tracking-wide text-(--fg-faint) max-w-[4rem]">
              {item.content_type}
            </span>
          )}
        </div>
        {item?.posting_time && (
          <p className="mt-0.5 text-[9px] text-(--fg-faint)">
            {new Date(item.posting_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        )}
        {/* Attention reason chip — shows WHY this post needs action */}
        {attention && (
          <div className="mt-1">
            <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-semibold leading-tight ${
              attention.severity === 'critical'
                ? 'bg-red-500/20 text-red-400'
                : 'bg-amber-500/15 text-amber-400'
            }`}>
              {attention.severity === 'critical'
                ? <span className="inline-block h-1 w-1 rounded-full bg-red-400 mr-0.5 shrink-0" />
                : <span className="inline-block h-1 w-1 rounded-full bg-amber-400 mr-0.5 shrink-0" />
              }
              {attention.reason}
            </span>
          </div>
        )}
      </div>
    </button>
  )
}

// ─── Calendar workspace ───────────────────────────────────────────────────────

export function BrandCalendarWorkspace({
  items,
  selectedMonth,
  selectedCalendarId,
  brandId,
}: {
  items: CalendarQaPostRow[]
  selectedMonth: string
  /** calendar_id of the SELECTED month (not always the primary/June calendar). */
  selectedCalendarId: string
  brandId: string
}) {
  const router = useRouter()
  const [isTriggering, startTransition] = useTransition()
  const [triggerState, setTriggerState] = useState<'idle' | 'ok' | 'error'>('idle')
  const [triggerError, setTriggerError] = useState<string | null>(null)
  const [isApprovingAll, startApproveAll] = useTransition()
  const [approveAllMsg, setApproveAllMsg] = useState<string | null>(null)
  const [confirmApproveAll, setConfirmApproveAll] = useState(false)
  const [confirmA01Open, setConfirmA01Open] = useState(false)
  const [a01ConfirmText, setA01ConfirmText] = useState('')
  const [filter, setFilter] = useState<'all' | 'attention'>('all')

  const maxPos = items.length > 0 ? Math.max(20, ...items.map((i) => i.position)) : 20

  // ── Intelligent attention engine ─────────────────────────────────────────────
  // Multi-signal, severity-ranked triage. Returns the highest-priority signal
  // for a post, or null if the post is clean and needs no action.
  //
  // Priority (first match wins):
  //   CRITICAL — visual_score=0 (Saudi cultural hard-block)
  //   CRITICAL — status=blocked (pre-gen compliance rule)
  //   CRITICAL — raw_status=failed_visual (Worker exhausted retries, no image)
  //   CRITICAL — composite score < 50 (confidence_score ?? cco_score < HOLD threshold)
  //   WARNING  — visual_score exists and < 75 (visual issues found by GPT-4o)
  //   WARNING  — CEO trigger fired (any of the 11 deterministic holds)
  //   WARNING  — watermark=true (passed but requires AI-Draft overlay)
  //   WARNING  — revision_count >= 3 (quality unstable after repeated regen)
  //   WARNING  — requires_human_review set without a specific trigger
  type AttentionLevel = { severity: 'critical' | 'warning'; reason: string } | null

  function attentionLevel(i: CalendarQaPostRow): AttentionLevel {
    const rawStatus = (i as { raw_status?: string | null }).raw_status ?? null
    const compositeScore = i.confidence_score ?? i.cco_score ?? null

    if (typeof i.visual_score === 'number' && i.visual_score === 0)
      return { severity: 'critical', reason: 'Visual hard block' }

    if (i.status === 'blocked')
      return { severity: 'critical', reason: 'Compliance blocked' }

    if (rawStatus === 'failed_visual')
      return { severity: 'critical', reason: 'Image failed' }

    if (typeof compositeScore === 'number' && compositeScore < 50)
      return { severity: 'critical', reason: `Score ${compositeScore.toFixed(0)} · HOLD` }

    if (typeof i.visual_score === 'number' && i.visual_score < 75) {
      const hasIssues = Array.isArray(i.visual_issues) && i.visual_issues.length > 0
      return { severity: 'warning', reason: hasIssues ? 'Visual issues' : `Visual ${i.visual_score.toFixed(0)}` }
    }

    if (i.trigger_reason && i.trigger_reason.trim()) {
      const firstKey = i.trigger_reason.split(/[|,]/)[0]?.trim() ?? ''
      return { severity: 'warning', reason: TRIGGER_LABELS[firstKey] ?? firstKey.replace(/_/g, ' ') }
    }

    if (i.watermark === true)
      return { severity: 'warning', reason: 'Watermark' }

    if (i.revision_count >= 3)
      return { severity: 'warning', reason: `${i.revision_count} revisions` }

    if (i.requires_human_review)
      return { severity: 'warning', reason: 'Review required' }

    return null
  }

  const attentionMap  = new Map(items.map((i) => [i.post_id, attentionLevel(i)]))
  const attentionItems = items.filter((i) => attentionMap.get(i.post_id) !== null)
  const attentionCount = attentionItems.length
  const criticalCount  = attentionItems.filter((i) => attentionMap.get(i.post_id)?.severity === 'critical').length

  const pending  = items.filter((i) => i.status === 'pending').length
  const released = items.filter((i) => i.status === 'released').length
  const approved = items.filter((i) => i.status === 'approved').length
  const rejected = items.filter((i) => i.status === 'rejected').length
  const blocked  = items.filter((i) => i.status === 'blocked').length
  const empty    = Math.max(0, maxPos - items.length)
  const pct      = items.length > 0 ? Math.round(((released + approved) / items.length) * 100) : 0
  // Posts "Approve All" will actually RELEASE: have an image + not already
  // released ('released'), client-approved ('approved'), or rejected.
  const approvableCount = items.filter(
    (i) => i.status !== 'released' && i.status !== 'approved' && i.status !== 'rejected' && !!i.storage_url,
  ).length

  function openPost(item: CalendarQaPostRow) {
    // queue_id is the canonical identifier — works for both post-linked and pre-image holds
    router.push(`/admin/qa/${brandId}/${item.queue_id}?month=${selectedMonth}`)
  }

  function handleApproveAll() {
    setApproveAllMsg(null)
    setConfirmApproveAll(false)
    startApproveAll(async () => {
      // Release the SELECTED month's calendar (Jul/Aug under 3-month rolling),
      // NOT always group.calendar_id (which is the primary/June calendar).
      const res = await approveAllCalendarPosts({ calendar_id: selectedCalendarId })
      if (res.ok) {
        setApproveAllMsg(`✓ Released ${res.approved ?? 0} post${res.approved === 1 ? '' : 's'}${res.skipped ? ` · ${res.skipped} skipped` : ''} — now on the client calendar for their approval.`)
        router.refresh()
      } else {
        setApproveAllMsg(res.error ?? 'Release all failed.')
      }
    })
  }

  // Run A01 is DESTRUCTIVE: it regenerates the whole calendar, overwriting the
  // current posts (captions, images, approvals) with a fresh pending_visual set.
  // Require the admin to type "yes" before firing — guards against accidental clicks.
  const a01Confirmed = a01ConfirmText.trim().toLowerCase() === 'yes'

  function handleTriggerA01() {
    if (!a01Confirmed) return
    setTriggerState('idle')
    setTriggerError(null)
    setConfirmA01Open(false)
    setA01ConfirmText('')
    startTransition(async () => {
      const result = await triggerA01ForBrand({ brand_id: brandId })
      if (result.ok) {
        setTriggerState('ok')
      } else {
        setTriggerState('error')
        setTriggerError(result.error)
      }
    })
  }

  return (
    <>
      {/* ── Stats + progress ────────────────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-(--border-subtle) bg-(--surface-2) p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-(--fg)">{formatMonth(selectedMonth)}</p>
            <p className="text-xs text-(--fg-muted)">Content calendar — {items.length} posts generated</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="text-right">
              <p className="text-2xl font-bold text-(--fg)">{pct}%</p>
              <p className="text-xs text-(--fg-faint)">reviewed</p>
            </div>
            {/* Release All — only when there are posts that can still be released.
                Admin release = send to client for THEIR approval (not client-approve). */}
            {approvableCount > 0 && (
              <button
                type="button"
                onClick={() => setConfirmApproveAll(true)}
                disabled={isApprovingAll}
                className={[
                  'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-150',
                  'border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20',
                  isApprovingAll ? 'cursor-wait opacity-60' : '',
                ].join(' ')}
              >
                {isApprovingAll ? (
                  <>
                    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    Releasing…
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>
                    Release All ({approvableCount})
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setConfirmA01Open(true); setA01ConfirmText('') }}
              disabled={isTriggering}
              className={[
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-150',
                triggerState === 'ok'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : triggerState === 'error'
                    ? 'border-red-500/40 bg-red-500/10 text-red-400'
                    : 'border-(--border-subtle) bg-(--surface-3) text-(--fg-muted) hover:border-(--accent)/40 hover:bg-(--accent)/10 hover:text-(--accent)',
                isTriggering ? 'cursor-wait opacity-60' : '',
              ].join(' ')}
            >
              {isTriggering ? (
                <>
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  </svg>
                  Triggering…
                </>
              ) : triggerState === 'ok' ? (
                <>
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                  Triggered
                </>
              ) : (
                <>
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                  Run A01
                </>
              )}
            </button>
          </div>
        </div>
        {triggerState === 'error' && triggerError && (
          <p className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{triggerError}</p>
        )}
        {approveAllMsg && (
          <div className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-400">
            <span>{approveAllMsg}</span>
            <button type="button" onClick={() => setApproveAllMsg(null)} className="shrink-0 text-blue-400/60 hover:text-blue-300" aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* Release All confirmation — sends posts to the client for their approval */}
        {confirmApproveAll && (
          <div className="mb-3 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3">
            <p className="text-sm font-semibold text-(--fg)">Release all {approvableCount} ready post{approvableCount === 1 ? '' : 's'} to the client?</p>
            <p className="mt-1 text-xs text-(--fg-muted)">They appear on the client&apos;s calendar for the client to Approve or Request-Revision themselves. This is not client approval. Compliance-blocked and image-less posts are skipped.</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleApproveAll}
                disabled={isApprovingAll}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>
                Yes, release {approvableCount}
              </button>
              <button
                type="button"
                onClick={() => setConfirmApproveAll(false)}
                className="rounded-lg border border-(--border-subtle) px-3 py-1.5 text-xs text-(--fg-muted) hover:bg-(--surface-3)"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Run A01 confirmation — DESTRUCTIVE regenerate. Requires typing "yes". */}
        {confirmA01Open && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <p className="text-sm font-semibold text-amber-300">⚠ Regenerate this calendar?</p>
            <p className="mt-1 text-xs text-(--fg-muted)">
              This throws away the current posts (captions, generated images, and any approvals) and
              replaces them with a fresh calendar in <span className="font-mono">pending_visual</span>,
              which the Worker then re-renders into images. This cannot be undone.
            </p>
            <p className="mt-3 text-xs font-medium text-(--fg)">
              Type <span className="font-mono font-bold text-amber-300">yes</span> to confirm:
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="text"
                value={a01ConfirmText}
                onChange={(e) => {
                  // Only accept "yes"/"no" (case-insensitive) — no other text allowed.
                  const v = e.target.value.toLowerCase()
                  if ('yes'.startsWith(v) || 'no'.startsWith(v)) setA01ConfirmText(v)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && a01Confirmed) handleTriggerA01() }}
                placeholder="yes / no"
                autoFocus
                className="w-28 rounded-lg border border-(--border-subtle) bg-(--surface-1) px-3 py-1.5 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <button
                type="button"
                disabled={!a01Confirmed || isTriggering}
                onClick={handleTriggerA01}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                Regenerate
              </button>
              <button
                type="button"
                onClick={() => { setConfirmA01Open(false); setA01ConfirmText('') }}
                className="rounded-lg border border-(--border-subtle) px-3 py-1.5 text-xs text-(--fg-muted) hover:bg-(--surface-3)"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="h-2.5 w-full overflow-hidden rounded-full bg-(--surface-3) mb-4">
          <div className="h-full rounded-full bg-(--accent) transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            { label: 'Pending',  count: pending,  color: 'text-amber-400',    dot: 'bg-amber-400' },
            { label: 'Released', count: released, color: 'text-blue-400',     dot: 'bg-blue-500' },
            { label: 'Approved', count: approved, color: 'text-emerald-400',  dot: 'bg-emerald-500' },
            { label: 'Rejected', count: rejected, color: 'text-red-400',      dot: 'bg-red-500' },
            { label: 'Blocked',  count: blocked,  color: 'text-(--fg-muted)', dot: 'bg-(--fg-faint)' },
            { label: 'Empty',    count: empty,    color: 'text-(--fg-faint)', dot: 'bg-(--surface-3) ring-1 ring-(--border-subtle)' },
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

      {/* ── Triage filter ───────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-(--border-subtle) bg-(--surface-2) p-1 overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={[
              'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
              filter === 'all' ? 'bg-(--surface-3) text-(--fg)' : 'text-(--fg-muted) hover:text-(--fg)',
            ].join(' ')}
          >
            All posts ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('attention')}
            disabled={attentionCount === 0}
            title="Collapses the grid to posts that need admin action before releasing. Critical = cannot release (hard-block, failed image, score<50). Warning = should review (trigger fired, watermark, visual issues)."
            className={[
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none',
              filter === 'attention'
                ? criticalCount > 0 ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                : 'text-(--fg-muted) hover:text-(--fg)',
            ].join(' ')}
          >
            {criticalCount > 0
              ? <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
              : <span className={`h-1.5 w-1.5 rounded-full ${attentionCount > 0 ? 'bg-amber-400' : 'bg-(--fg-faint)'}`} />
            }
            Needs attention
            {attentionCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                {criticalCount > 0 && (
                  <span className="rounded bg-red-500/20 px-1 py-0.5 text-[9px] font-bold text-red-400">
                    {criticalCount} critical
                  </span>
                )}
                {attentionCount - criticalCount > 0 && (
                  <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold text-amber-400">
                    {attentionCount - criticalCount} warn
                  </span>
                )}
              </span>
            )}
          </button>
        </div>
        {filter === 'attention' && attentionCount > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[10px] text-(--fg-faint)">
            {criticalCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/8 px-2 py-1 text-red-400/80">
                <span className="h-1 w-1 rounded-full bg-red-400" />
                Critical — cannot release without fixing
              </span>
            )}
            {attentionCount - criticalCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/20 bg-amber-500/8 px-2 py-1 text-amber-400/80">
                <span className="h-1 w-1 rounded-full bg-amber-400" />
                Warning — review before releasing
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Post grid — only renders posts that exist (no empty placeholder boxes) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {(filter === 'attention'
          // Attention view: critical first, then warning, each group sorted by position
          ? [...attentionItems].sort((a, b) => {
              const sa = attentionMap.get(a.post_id)?.severity === 'critical' ? 0 : 1
              const sb = attentionMap.get(b.post_id)?.severity === 'critical' ? 0 : 1
              return sa !== sb ? sa - sb : a.position - b.position
            })
          : items.slice().sort((a, b) => a.position - b.position)
        ).map((item) => (
          <PostSlot
            key={item.position}
            pos={item.position}
            item={item}
            attention={attentionMap.get(item.post_id)}
            onClick={() => openPost(item)}
          />
        ))}
      </div>

      {filter === 'attention' && attentionCount === 0 && (
        <div className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-500/20 bg-emerald-500/4 text-sm text-emerald-400/70">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
          All posts are clean — nothing needs attention before releasing.
        </div>
      )}

      <p className="mt-3 text-center text-[10px] text-(--fg-faint)">
        Click any post to open its full detail .
      </p>
    </>
  )
}

// Keep ScoreBadge exported so the brand detail page can use it if needed
export { ScoreBadge }
