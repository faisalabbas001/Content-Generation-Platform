'use client'

import { useEffect, useTransition, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'
import { Spinner } from '@repo/ui/spinner'
import { approveQaItem, rejectQaItem, requestRevision } from '@/app/actions/qa'
import type { CalendarQaPostRow } from '@repo/db'
import { scoreBand, scoreBandLabel } from '@repo/core'

// ─── Trigger explanations ────────────────────────────────────────────────────

const TRIGGER_EXPLANATIONS: Record<string, { label: string; detail: string }> = {
  first_ever_client_output:             { label: 'First-ever output',           detail: "Brand's first calendar — all posts are held for initial quality audit." },
  brave_route_flagged:                  { label: 'CCO brave-route flag',        detail: 'CCO agent flagged this post as culturally risky content. Requires human sign-off before publishing.' },
  healthcare_health_claim:              { label: 'Health claim',                detail: 'Healthcare content with a health claim or testimonial is held by default. Compliance check required.' },
  finance_investment_claim:             { label: 'Finance claim',               detail: 'Investment or financial benefit claim. Must be verified by compliance before publication.' },
  government_sector:                    { label: 'Government sector',           detail: 'All government sector content is held by default (defence-in-depth policy).' },
  religious_reference_high_sensitivity: { label: 'High religious sensitivity',  detail: 'Caption or visual prompt contains religious references for a brand rated High sensitivity.' },
  dialect_unconfirmed_hero:             { label: 'Dialect unconfirmed',         detail: 'COO could not confirm the Arabic dialect. Manual dialect verification required.' },
  unresolved_conflict_record:           { label: 'Conflict record',             detail: 'Brand has an unresolved conflict in its record that must be cleared before generation.' },
  revision_cycle_exceeded:              { label: 'Revision limit reached',      detail: 'This post has hit the maximum B03 revision cycles. Final human decision required.' },
  cco_low_confidence:                   { label: 'CCO low score (<50)',         detail: 'Quality score is below the 50-point threshold. Human verification required before publishing.' },
  hard_block_negative_pattern:          { label: 'Hard block',                  detail: 'Caption matched a prohibited negative-pattern rule. Cannot be auto-approved under any conditions.' },
  method_violation:                     { label: 'Method drift',                detail: 'Post deviated from the approved brand method contract.' },
  ceo_hold:                             { label: 'CEO hold',                    detail: 'Flagged by the CEO routing layer based on overall brand risk profile.' },
  human_gate_override:                  { label: 'Admin hold',                  detail: 'Post was manually placed on hold by an admin.' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMonth(month: string): string {
  try {
    const [year, mon] = month.split('-')
    return new Date(Number(year), Number(mon) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  } catch { return month }
}

function ScoreBandBadge({ score }: { score: number | null }) {
  const s = score ?? 0
  const b = scoreBand(score)
  const tone = b === 'clean' ? 'success' : b === 'mark' ? 'warning' : 'danger'
  const band = scoreBandLabel(score)
  return (
    <Badge tone={tone} size="sm">
      <span className="font-mono">{s.toFixed(0)}</span>
      <span className="ml-1 opacity-70 uppercase tracking-wider text-[9px]">{band}</span>
    </Badge>
  )
}

function RouteDecisionBadge({ route }: { route: string | null }) {
  if (!route) return <span className="text-(--fg-faint) text-xs">—</span>
  const r = route.toLowerCase()
  const tone = r === 'clean' ? 'success' : r === 'watermark' ? 'warning' : 'danger'
  return <Badge tone={tone} size="sm">{route.toUpperCase()}</Badge>
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-(--border-subtle) py-2.5 last:border-0">
      <span className="shrink-0 text-xs text-(--fg-muted)">{label}</span>
      <div className="text-right text-xs text-(--fg)">{children}</div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="shrink-0 rounded p-1 text-(--fg-faint) hover:text-(--fg) hover:bg-(--surface-3) transition-colors"
    >
      {copied ? (
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} className="text-emerald-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
    </button>
  )
}

// ─── Action types ─────────────────────────────────────────────────────────────

type ActionState = 'idle' | 'confirmed_approve' | 'confirmed_reject' | 'revision_mode' | 'submitting'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PostDetailDrawerProps {
  item: CalendarQaPostRow | null
  brandNameAr: string
  brandNameEn: string | null
  calendarMonth: string
  onClose: () => void
  onApproved: () => void
  onRejected: () => void
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export function PostDetailDrawer({
  item,
  brandNameAr,
  brandNameEn,
  calendarMonth,
  onClose,
  onApproved,
  onRejected,
}: PostDetailDrawerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [actionState, setActionState] = useState<ActionState>('idle')
  const [revisionNotes, setRevisionNotes] = useState('')
  const [resultMessage, setResultMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const isOpen = item !== null

  useEffect(() => {
    if (!isOpen) { setActionState('idle'); setRevisionNotes(''); setResultMessage(null) }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (actionState !== 'idle') { setActionState('idle'); return }
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, actionState, onClose])

  useEffect(() => { if (isOpen) drawerRef.current?.focus() }, [isOpen])

  function handleApprove() {
    if (!item) return
    setActionState('submitting')
    startTransition(async () => {
      const res = await approveQaItem(item.queue_id)
      if (res.ok) {
        setResultMessage({ type: 'success', text: 'Post approved successfully.' })
        router.refresh()
        setTimeout(() => { onApproved(); setResultMessage(null) }, 1200)
      } else {
        setResultMessage({ type: 'error', text: res.error ?? 'Approve failed.' })
        setActionState('idle')
      }
    })
  }

  function handleReject() {
    if (!item) return
    setActionState('submitting')
    startTransition(async () => {
      const res = await rejectQaItem(item.queue_id)
      if (res.ok) {
        setResultMessage({ type: 'success', text: 'Post rejected. It will not be shown to the client.' })
        router.refresh()
        setTimeout(() => { onRejected(); setResultMessage(null) }, 1200)
      } else {
        setResultMessage({ type: 'error', text: res.error ?? 'Reject failed.' })
        setActionState('idle')
      }
    })
  }

  function handleRevisionSubmit() {
    if (!item || revisionNotes.trim().length < 5) return
    setActionState('submitting')
    startTransition(async () => {
      const res = await requestRevision(item.queue_id, revisionNotes.trim())
      if (res.ok) {
        setResultMessage({ type: 'success', text: 'Revision request sent to B03 workflow.' })
        router.refresh()
        setTimeout(() => { onClose(); setResultMessage(null) }, 1400)
      } else {
        setResultMessage({ type: 'error', text: res.error ?? 'Revision request failed.' })
        setActionState('revision_mode')
      }
    })
  }

  // Full list of every fired human-override trigger (Doc §6.4). Richest source is
  // flags.human_gate_triggers (the complete array with per-post detail, written by
  // the V01 Worker); fall back to the single trigger_reason string.
  const flagTriggers = item && Array.isArray((item.flags as Record<string, unknown> | null)?.human_gate_triggers)
    ? ((item.flags as Record<string, unknown>).human_gate_triggers as Array<{ trigger?: number; reason?: string; detail?: string }>)
    : []
  const flagDetailByReason: Record<string, string> = {}
  for (const t of flagTriggers) if (t?.reason) flagDetailByReason[t.reason] = t.detail ?? ''
  const triggerKeys = !item
    ? []
    : flagTriggers.length > 0
      ? flagTriggers.map((t) => t.reason).filter((r): r is string => !!r)
      : (item.trigger_reason ?? '').split(/[|,]/).map((s) => s.trim()).filter(Boolean)
  // Raw CCO flag chips — exclude the structural keys we render above (the trigger
  // array + its detail) so they don't show as noisy raw entries.
  const flagEntries = item
    ? Object.entries(item.flags ?? {}).filter(
        ([k, v]) => v && v !== 'NONE' && k !== 'human_gate_triggers' && k !== 'held_detail',
      )
    : []
  const isHardBlock = triggerKeys.includes('hard_block_negative_pattern')

  // Parse caption_variants from flags or treat as simple array
  const captionVariants = (() => {
    if (!item) return []
    const raw = (item.flags as Record<string, unknown>)?.caption_variants
    if (Array.isArray(raw)) return raw as Array<{ caption_ar: string; tone: string; hashtags: string[] }>
    return []
  })()

  return (
    <>
      {/* Backdrop */}
      <div
        className={[
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={actionState === 'idle' ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Post inspection"
        tabIndex={-1}
        className={[
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-(--surface-1) shadow-2xl outline-none',
          'sm:w-[520px] sm:border-l sm:border-(--border-subtle)',
          'transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {item && (
          <>
            {/* ── Header ────────────────────────────────────────── */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-(--border-subtle) bg-(--surface-2) px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-(--fg)">
                  <span>{brandNameEn ?? brandNameAr}</span>
                  {brandNameEn && (
                    <span className="text-(--fg-muted) text-xs" dir="rtl">{brandNameAr}</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-(--fg-muted)">
                  Post {item.position > 0 ? `#${item.position}` : '—'}
                  {' · '}
                  {item.content_type && <span className="capitalize">{item.content_type} · </span>}
                  {formatMonth(calendarMonth)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-md p-1.5 text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) transition-colors"
                aria-label="Close"
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* ── Result message banner ──────────────────────────── */}
            {resultMessage && (
              <div className={[
                'shrink-0 border-b px-5 py-3 text-sm font-medium',
                resultMessage.type === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300',
              ].join(' ')}>
                {resultMessage.type === 'success' ? '✓ ' : '✕ '}{resultMessage.text}
              </div>
            )}

            {/* ── Scrollable body ───────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">

              {/* ── 1. Media preview ─────────────────────────────── */}
              <div className="border-b border-(--border-subtle) bg-(--surface-2) p-5">
                {item.storage_url ? (
                  item.format_tier === 'video' ? (
                    <video
                      src={item.storage_url}
                      controls
                      className="w-full rounded-(--r-lg) bg-black"
                      style={{ maxHeight: 300 }}
                    />
                  ) : (
                    <img
                      src={item.storage_url}
                      alt="Generated post visual"
                      className="w-full rounded-(--r-lg) object-cover"
                      style={{ maxHeight: 300 }}
                    />
                  )
                ) : (
                  <div className="flex h-44 w-full flex-col items-center justify-center gap-2 rounded-(--r-lg) border border-dashed border-(--border-subtle) bg-(--surface-3) text-xs text-(--fg-faint)">
                    <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    No media generated yet
                  </div>
                )}

                {/* Image prompt */}
                {item.visual_brief_en && (
                  <details className="mt-3" open>
                    <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-(--fg-faint) hover:text-(--fg-muted)">
                      Image Prompt
                    </summary>
                    <div className="mt-2 flex items-start gap-2">
                      <p className="flex-1 rounded-(--r-md) bg-(--surface-3) p-3 font-mono text-[11px] leading-relaxed text-(--fg-subtle) whitespace-pre-wrap break-all">
                        {item.visual_brief_en}
                      </p>
                      <CopyButton text={item.visual_brief_en} />
                    </div>
                  </details>
                )}
              </div>

              {/* ── 2. Post metadata ──────────────────────────────── */}
              <div className="border-b border-(--border-subtle) px-5 py-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-(--fg-faint)">Post Metadata</p>
                <MetaRow label="Content type">
                  {item.content_type
                    ? <Badge tone="neutral" size="sm">{item.content_type}</Badge>
                    : <span className="text-(--fg-faint)">—</span>}
                </MetaRow>
                <MetaRow label="Format">
                  {item.format_tier
                    ? <Badge tone="neutral" size="sm">{item.format_tier.toUpperCase()}</Badge>
                    : <span className="text-(--fg-faint)">—</span>}
                </MetaRow>
                <MetaRow label="Chain ID">
                  {item.chain_id
                    ? <code className="rounded bg-(--surface-3) px-1.5 py-0.5 text-[11px] text-(--fg-subtle)">{item.chain_id}</code>
                    : <span className="text-(--fg-faint)">—</span>}
                </MetaRow>
                <MetaRow label="Route decision">
                  <RouteDecisionBadge route={item.route_decision} />
                </MetaRow>
                <MetaRow label="CCO score">
                  <ScoreBandBadge score={item.cco_score} />
                </MetaRow>
                <MetaRow label="Confidence score">
                  {item.confidence_score !== null
                    ? <ScoreBandBadge score={item.confidence_score} />
                    : <span className="text-(--fg-faint)">—</span>}
                </MetaRow>
                <MetaRow label="Scheduled">
                  {item.posting_time
                    ? new Date(item.posting_time).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
                    : <span className="text-(--fg-faint)">—</span>}
                </MetaRow>
                <MetaRow label="Watermark">
                  {item.watermark != null
                    ? <Badge tone={item.watermark ? 'warning' : 'neutral'} size="sm">{item.watermark ? 'Yes' : 'No'}</Badge>
                    : <span className="text-(--fg-faint)">—</span>}
                </MetaRow>
              </div>

              {/* ── 3. Hold reasons ───────────────────────────────── */}
              {triggerKeys.length > 0 && (
                <div className="border-b border-(--border-subtle) px-5 py-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--fg-faint)">Hold Reasons</p>
                  <div className={[
                    'rounded-(--r-lg) border p-4 space-y-4',
                    isHardBlock
                      ? 'border-red-500/30 bg-red-500/8'
                      : 'border-amber-500/30 bg-amber-500/8',
                  ].join(' ')}>
                    {isHardBlock && (
                      <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">
                        Hard block — cannot be auto-approved
                      </p>
                    )}
                    {triggerKeys.map((key) => {
                      const exp = TRIGGER_EXPLANATIONS[key]
                      // Prefer the dynamic per-post detail from the override engine
                      // (e.g. "CCO score 42 is below 50 — held for admin review").
                      const detail = flagDetailByReason[key] || exp?.detail
                      return (
                        <div key={key} className="flex items-start gap-2">
                          <span className={`mt-0.5 text-xs ${isHardBlock ? 'text-red-400' : 'text-amber-400'}`}>▸</span>
                          <div>
                            <p className="text-sm font-semibold text-(--fg)">{exp?.label ?? key}</p>
                            {detail && <p className="mt-0.5 text-xs text-(--fg-muted)">{detail}</p>}
                          </div>
                        </div>
                      )
                    })}
                    {flagEntries.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 border-t border-(--border-subtle) pt-3">
                        {flagEntries.map(([k, v]) => (
                          <Badge
                            key={k}
                            tone={k === 'negpat_flag' && v === 'HARD_BLOCK' ? 'danger' : 'warning'}
                            size="sm"
                          >
                            {k.replace('_flag', '')}: {String(v)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── 4. Arabic caption ─────────────────────────────── */}
              {item.caption_ar && (
                <div className="border-b border-(--border-subtle) px-5 py-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-(--fg-faint)">Arabic Caption</p>
                    <CopyButton text={item.caption_ar} />
                  </div>
                  <p dir="rtl" className="rounded-(--r-lg) bg-(--surface-2) p-3 text-sm leading-relaxed text-(--fg) whitespace-pre-wrap">
                    {item.caption_ar}
                  </p>
                </div>
              )}

              {/* ── 5. Caption variants (DeepSeek multi-variant) ──── */}
              {captionVariants.length > 0 && (
                <div className="border-b border-(--border-subtle) px-5 py-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--fg-faint)">
                    Caption Variants ({captionVariants.length})
                  </p>
                  <div className="space-y-3">
                    {captionVariants.map((v, i) => (
                      <div key={i} className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium text-(--fg-muted)">Variant {i + 1}</span>
                          {v.tone && <Badge tone="neutral" size="sm">{v.tone}</Badge>}
                        </div>
                        <p dir="rtl" className="text-sm text-(--fg)">{v.caption_ar}</p>
                        {v.hashtags?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {v.hashtags.map((h) => (
                              <span key={h} className="rounded bg-(--surface-3) px-1.5 py-0.5 text-[10px] text-(--fg-muted)">
                                {h.startsWith('#') ? h : `#${h}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── 6. Hashtags ────────────────────────────────────── */}
              {item.hashtags && item.hashtags.length > 0 && (
                <div className="border-b border-(--border-subtle) px-5 py-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-(--fg-faint)">Hashtags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.hashtags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-(--surface-2) border border-(--border-subtle) px-2.5 py-0.5 text-xs text-(--fg-subtle)"
                      >
                        {tag.startsWith('#') ? tag : `#${tag}`}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ── 7. Flags debug ─────────────────────────────────── */}
              {Object.keys(item.flags ?? {}).length > 0 && (
                <div className="px-5 py-4">
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-(--fg-faint) hover:text-(--fg-muted)">
                      AI System Flags (raw)
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-(--r-lg) bg-(--surface-2) p-3">
                      {Object.entries(item.flags).map(([k, v]) => (
                        <div key={k} className="flex items-start justify-between gap-2">
                          <span className="text-[10px] font-mono text-(--fg-muted)">{k}</span>
                          <span className={[
                            'text-[10px] font-semibold font-mono',
                            String(v) === 'HARD_BLOCK' ? 'text-red-400'
                            : String(v) === 'STRONG_WARN' ? 'text-orange-400'
                            : String(v) === 'SOFT_WARN' ? 'text-yellow-400'
                            : v === true ? 'text-amber-400'
                            : 'text-(--fg-faint)',
                          ].join(' ')}>
                            {String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </div>

            {/* ── Sticky action suite ───────────────────────────── */}
            <div className="shrink-0 border-t border-(--border-subtle) bg-(--surface-2)">

              {/* Revision input panel */}
              {actionState === 'revision_mode' && (
                <div className="border-b border-(--border-subtle) px-5 py-4">
                  <p className="mb-2 text-xs font-semibold text-(--fg-muted)">
                    Revision notes for B03 workflow
                    <span className="ml-1 text-(--fg-faint)">(min 5 chars)</span>
                  </p>
                  <textarea
                    value={revisionNotes}
                    onChange={(e) => setRevisionNotes(e.target.value)}
                    placeholder="Describe what needs to change — tone, content, visual style, compliance concern…"
                    rows={3}
                    className="w-full resize-none rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-1) px-3 py-2 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-1 focus:ring-(--accent)"
                    autoFocus
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setActionState('idle')}>Cancel</Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={revisionNotes.trim().length < 5 || isPending}
                      onClick={handleRevisionSubmit}
                    >
                      {isPending ? <Spinner size={12} className="text-white" /> : 'Send to B03'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Confirm approve */}
              {actionState === 'confirmed_approve' && (
                <div className="border-b border-emerald-500/30 bg-emerald-500/8 px-5 py-3">
                  <p className="text-sm font-medium text-emerald-300">
                    Approve this post? It will be queued for client delivery.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setActionState('idle')}>Cancel</Button>
                    <Button variant="primary" size="sm" disabled={isPending} onClick={handleApprove}>
                      {isPending ? <Spinner size={12} className="text-white" /> : 'Confirm Approve'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Confirm reject */}
              {actionState === 'confirmed_reject' && (
                <div className="border-b border-red-500/30 bg-red-500/8 px-5 py-3">
                  <p className="text-sm font-medium text-red-300">
                    Reject this post? It will be hidden from the client's calendar page.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setActionState('idle')}>Cancel</Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={handleReject}
                      className="border-red-500/40 text-red-400 hover:bg-red-500/20"
                    >
                      {isPending ? <Spinner size={12} /> : 'Confirm Reject'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Main action bar */}
              <div className="px-5 py-3">
                {actionState === 'idle' ? (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose} className="mr-auto">
                      Close
                    </Button>

                    {/* Request revision */}
                    <button
                      type="button"
                      onClick={() => setActionState('revision_mode')}
                      disabled={isPending || isHardBlock}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-(--border-subtle) px-3 py-1.5 text-xs font-medium text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      title={isHardBlock ? 'Hard block — revision not permitted' : 'Request revision via B03'}
                    >
                      <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Request Revision
                    </button>

                    {/* Reject */}
                    <button
                      type="button"
                      onClick={() => setActionState('confirmed_reject')}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                    >
                      <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Reject
                    </button>

                    {/* Approve */}
                    <button
                      type="button"
                      onClick={() => setActionState('confirmed_approve')}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-(--accent) px-4 py-1.5 text-xs font-semibold text-white hover:bg-(--accent)/90 transition-colors disabled:opacity-40"
                    >
                      <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Approve
                    </button>
                  </div>
                ) : (
                  actionState === 'submitting' && (
                    <div className="flex items-center justify-center gap-2 py-1">
                      <Spinner size={16} className="text-(--accent)" />
                      <span className="text-sm text-(--fg-muted)">Processing…</span>
                    </div>
                  )
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
