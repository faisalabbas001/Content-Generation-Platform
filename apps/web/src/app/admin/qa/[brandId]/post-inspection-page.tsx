'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@repo/ui/badge'
import { Spinner } from '@repo/ui/spinner'
import { approveQaItem, rejectQaItem, requestRevision } from '@/app/actions/qa'
import { runVisualQcForPost } from './actions'
import type { CalendarQaPostRow, CalendarQaGroup, AdminRegenerationSummary } from '@repo/db'
import { scoreBand } from '@repo/core'
import { AlertTriangle, AlertCircle, RefreshCw } from '@repo/ui/icons'
import { ScoreInsightPanel, ScoreRing, BAND_META, normaliseComposite } from '../score-insight'
import { AdminRegenerateButton } from '../admin-regenerate-button'
import { AdminRegenHistory } from '../admin-regen-history'
import { InstagramPhoneMockup } from '../instagram-phone-mockup'

// Hard Rule #3 (CLAUDE.md): Arabic text NEVER appears in image prompts.
const ARABIC_RE = /[؀-ۿ]/

// ─── Label / detail maps ──────────────────────────────────────────────────────

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
  first_ever_client_output:             "Brand's first calendar — all posts held for initial quality audit.",
  brave_route_flagged:                  'CCO agent flagged content as culturally risky. Human sign-off required.',
  healthcare_health_claim:              'Healthcare post with health/testimonial claim. Compliance hold.',
  finance_investment_claim:             'Financial benefit claim. Must be verified before publication.',
  government_sector:                    'All government sector content held by policy (defence-in-depth).',
  religious_reference_high_sensitivity: 'Religious reference for a High-sensitivity brand.',
  dialect_unconfirmed_hero:             'COO could not confirm Arabic dialect. Manual check needed.',
  unresolved_conflict_record:           'Brand has an unresolved conflict record.',
  revision_cycle_exceeded:              'Max B03 revision cycles reached. Final human decision required.',
  cco_low_confidence:                   'CCO score < 50 — quality below threshold.',
  hard_block_negative_pattern:          'Matches a prohibited negative-pattern rule. Cannot auto-approve.',
  method_violation:                     'Post deviated from the approved brand method contract.',
  ceo_hold:                             'CEO routing layer flagged based on brand risk profile.',
  human_gate_override:                  'Manually placed on hold by an admin.',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1500) }}
      className="shrink-0 rounded-md p-1.5 text-(--fg-faint) hover:bg-(--surface-3) hover:text-(--fg) transition-colors"
      title={ok ? 'Copied!' : 'Copy'}
    >
      {ok
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="text-emerald-400"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      }
    </button>
  )
}

// Small inline score badge used in the right-col meta strip
function ScorePip({ label, score, isVisual }: { label: string; score: number | null | undefined; isVisual?: boolean }) {
  const b = scoreBand(score)
  const colors = {
    clean: 'text-emerald-400',
    mark:  'text-amber-400',
    hold:  'text-red-400',
  }
  const borderColors = {
    clean: 'border-emerald-500/25 bg-emerald-500/8',
    mark:  'border-amber-500/25 bg-amber-500/8',
    hold:  'border-red-500/25 bg-red-500/8',
  }
  const visualOverride = isVisual && score === 0 ? 'border-red-500/40 bg-red-500/12' : null
  return (
    <div className={`flex flex-col items-center rounded-xl border px-3 py-3 ${visualOverride ?? borderColors[b]}`}>
      <span className={`text-xl font-bold tabular-nums ${colors[b]}`}>
        {score != null ? score.toFixed(0) : '—'}
      </span>
      <span className="mt-0.5 text-[9px] uppercase tracking-widest text-(--fg-faint)">{label}</span>
    </div>
  )
}

// ─── Action phase ─────────────────────────────────────────────────────────────

type Phase = 'idle' | 'confirm_approve' | 'confirm_reject' | 'revision' | 'submitting'

// ─── Main component ───────────────────────────────────────────────────────────

export function PostInspectionPage({
  item,
  group,
  backHref,
  regens,
}: {
  item: CalendarQaPostRow
  group: CalendarQaGroup
  backHref: string
  regens: AdminRegenerationSummary[]
}) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [notes, setNotes] = useState('')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const [vqcRunning, setVqcRunning] = useState(false)
  const [vqcResult, setVqcResult] = useState<{ ok: boolean; msg: string } | null>(null)
  // 'preview' is default — admin sees the iPhone mockup immediately on open
  const [activeTab, setActiveTab] = useState<'preview' | 'qa' | 'generation' | 'history'>('preview')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxClean, setLightboxClean] = useState(false)

  useEffect(() => {
    function h(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (lightboxOpen) { setLightboxOpen(false); return }
        if (phase !== 'idle') { setPhase('idle'); return }
        router.push(backHref)
      }
      if ((e.key === 'f' || e.key === 'F') && !lightboxOpen && activeTab === 'preview' && item.storage_url) {
        setLightboxClean(false)
        setLightboxOpen(true)
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [phase, lightboxOpen, activeTab, item.storage_url, backHref, router])

  // Human-override triggers
  const flagTriggers = Array.isArray((item.flags as Record<string, unknown> | null)?.human_gate_triggers)
    ? ((item.flags as Record<string, unknown>).human_gate_triggers as Array<{ trigger?: number; reason?: string; detail?: string }>)
    : []
  const flagDetailByReason: Record<string, string> = {}
  for (const t of flagTriggers) if (t?.reason) flagDetailByReason[t.reason] = t.detail ?? ''
  const triggerKeys = flagTriggers.length > 0
    ? flagTriggers.map((t) => t.reason).filter((r): r is string => !!r)
    : (item.trigger_reason ?? '').split(/[|,]/).map((s) => s.trim()).filter(Boolean)
  const isHardBlock = triggerKeys.includes('hard_block_negative_pattern')
  const isVisualHardBlock = item.visual_score === 0

  const isReleased = item.status === 'released'
  const isDecided = item.status === 'released' || item.status === 'approved' || item.status === 'rejected'
  const isBlockedStatus = item.status === 'blocked'
  const flagEntries = Object.entries(item.flags ?? {}).filter(([, v]) => v && v !== 'NONE')
  const variants = Array.isArray(item.caption_variants) ? item.caption_variants : []
  const isVideo =
    item.format_tier === 'video' ||
    item.media_type === 'video' ||
    item.format === 'video' ||
    /\.mp4(\?|$)/i.test(item.storage_url ?? '')

  // Composite score for the band calculation
  // Normalise confidence_score: may be stored as basis-points (×100) — see confidence-gate/route.ts
  const displayScore = normaliseComposite(item.confidence_score) ?? item.cco_score
  const band = scoreBand(displayScore)
  const bandMeta = BAND_META[band]

  function doApprove() {
    setPhase('submitting')
    startTransition(async () => {
      const res = await approveQaItem(item.queue_id)
      if (res.ok) {
        setResult({ ok: true, msg: 'Post released to client calendar.' })
        setTimeout(() => router.push(backHref), 1400)
      } else {
        setResult({ ok: false, msg: res.error ?? 'Release failed.' })
        setPhase('idle')
      }
    })
  }

  function doReject() {
    setPhase('submitting')
    startTransition(async () => {
      const res = await rejectQaItem(item.queue_id)
      if (res.ok) {
        setResult({ ok: true, msg: 'Post rejected — not shown to client.' })
        setTimeout(() => router.push(backHref), 1400)
      } else {
        setResult({ ok: false, msg: res.error ?? 'Reject failed.' })
        setPhase('idle')
      }
    })
  }

  function doRevision() {
    if (notes.trim().length < 5) return
    setPhase('submitting')
    startTransition(async () => {
      const res = await requestRevision(item.queue_id, notes.trim())
      if (res.ok) {
        setResult({ ok: true, msg: 'Revision request sent to B03 workflow.' })
        setTimeout(() => router.push(backHref), 1600)
      } else {
        setResult({ ok: false, msg: res.error ?? 'Request failed.' })
        setPhase('revision')
      }
    })
  }

  return (
    <div className="min-h-screen bg-(--surface-1)">

      {/* ── Sticky top nav ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-(--border-subtle) bg-(--surface-1)/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href={backHref}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) transition-colors"
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {group.brand_name_en ?? group.brand_name_ar}
          </Link>
          <span className="text-(--fg-faint)">/</span>
          <span className="text-sm font-semibold text-(--fg)">
            Post #{item.position > 0 ? item.position : '—'}
            {item.content_type && (
              <span className="ml-2 font-normal text-(--fg-muted) capitalize">{item.content_type}</span>
            )}
          </span>
          {item.format_tier && (
            <span className="hidden rounded bg-(--surface-3) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-(--fg-faint) sm:inline">
              {item.format_tier}
            </span>
          )}

          {/* Score pills in nav */}
          <div className="hidden sm:flex items-center gap-2 ml-2">
            {item.visual_score != null && (
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                item.visual_score === 0 ? 'bg-red-500/15 text-red-400' :
                item.visual_score >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
                'bg-amber-500/15 text-amber-400'
              }`}>
                Visual {item.visual_score.toFixed(0)}
              </span>
            )}
            {displayScore != null && (
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${bandMeta.text} bg-(--surface-3)`}>
                {displayScore.toFixed(1)} composite
              </span>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {(isHardBlock || isVisualHardBlock) && (
              <Badge tone="danger" size="sm">
                {isVisualHardBlock && isHardBlock ? 'Dual Block' : isVisualHardBlock ? 'Visual Block' : 'Hard Block'}
              </Badge>
            )}
            {triggerKeys.length > 0 && !isHardBlock && (
              <Badge tone="warning" size="sm">{triggerKeys.length} hold reason{triggerKeys.length > 1 ? 's' : ''}</Badge>
            )}
            {item.status === 'pending'  && <Badge tone="warning" dot>Pending review</Badge>}
            {item.status === 'released' && <Badge tone="info" dot>Released</Badge>}
            {item.status === 'approved' && <Badge tone="success" dot>Client approved</Badge>}
            {item.status === 'rejected' && <Badge tone="danger" dot>Rejected</Badge>}
            {item.status === 'blocked'  && <Badge tone="neutral" dot>Blocked</Badge>}
          </div>
        </div>
      </div>

      {/* ── Result banner ─────────────────────────────────────────── */}
      {result && (
        <div className={`border-b px-6 py-3 text-sm font-medium text-center ${
          result.ok
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/30 bg-red-500/10 text-red-300'
        }`}>
          {result.ok ? '✓ ' : '✕ '}{result.msg}
        </div>
      )}

      {/* ── Block banners ──────────────────────────────────────────── */}
      {isVisualHardBlock && (
        <div className="border-b border-red-500/40 bg-red-500/12 px-6 py-2.5 flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse shrink-0" />
          <span className="text-xs font-bold text-red-300">Visual Hard Block</span>
          <span className="text-xs text-red-300/70">Image scored 0 — contains a Saudi cultural violation detected by visual QC. Admin must review before any decision.</span>
        </div>
      )}
      {isHardBlock && !isVisualHardBlock && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-6 py-2.5 flex items-center gap-2.5">
          <span className="text-xs font-bold text-red-400">Caption Hard Block</span>
          <span className="text-xs text-red-300/70">Matched a prohibited negative pattern — cannot be auto-approved.</span>
        </div>
      )}

      {/* ── Main content ──────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">

          {/* ── LEFT COL: tabbed content ──────────────────────────── */}
          <div className="lg:col-span-3 space-y-0 rounded-2xl border border-(--border-subtle) bg-(--surface-1) overflow-hidden">

            {/* Tab nav */}
            <div className="flex border-b border-(--border-subtle) bg-(--surface-2) px-1 pt-1">
              {([
                ['qa',         'QA & Scores'],
                ['preview',    'Preview'],
                ['generation', 'Generation Data'],
                ['history',    'History'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={[
                    'px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
                    activeTab === key
                      ? 'border-(--accent) text-(--accent)'
                      : 'border-transparent text-(--fg-muted) hover:text-(--fg)',
                  ].join(' ')}
                >
                  {label}
                  {key === 'qa' && triggerKeys.length > 0 && (
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${isHardBlock || isVisualHardBlock ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {triggerKeys.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ── Tab: QA & Scores ─────────────────────────────────── */}
            {activeTab === 'qa' && (
              <div className="p-6 space-y-6">

                {/* ── Score hero ──────────────────────────────────────── */}
                <div className={`rounded-2xl border p-5 ${bandMeta.border} ${bandMeta.bg}`}>
                  <div className="flex items-center gap-5">
                    {/* Big composite ring */}
                    <div className="shrink-0 flex flex-col items-center">
                      <ScoreRing score={displayScore} size={84} />
                      <p className="mt-1 text-[9px] uppercase tracking-widest text-(--fg-faint)">
                        {item.confidence_score != null ? 'Composite' : 'Caption'}
                      </p>
                    </div>

                    {/* Right: band + verdict + scored pillars only */}
                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-lg font-bold tracking-wide ${bandMeta.text}`}>{bandMeta.label}</span>
                        {isHardBlock && <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold text-red-400">Caption block</span>}
                        {isVisualHardBlock && <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold text-red-400">Visual block</span>}
                      </div>

                      {/* Only render pillars that have real scores — no — placeholders in the hero */}
                      <div className="flex items-stretch gap-2 flex-wrap">
                        {item.visual_score != null && (
                          <div className={`flex flex-col items-center rounded-xl px-3 py-2 min-w-[56px] border ${
                            item.visual_score === 0  ? 'border-red-500/30 bg-red-500/10'
                            : item.visual_score >= 80 ? 'border-emerald-500/20 bg-emerald-500/8'
                            : 'border-amber-500/20 bg-amber-500/8'
                          }`}>
                            <span className={`text-2xl font-bold tabular-nums ${
                              item.visual_score === 0  ? 'text-red-400'
                              : item.visual_score >= 80 ? 'text-emerald-400'
                              : 'text-amber-400'
                            }`}>{item.visual_score.toFixed(0)}</span>
                            <span className="text-[9px] text-(--fg-faint) uppercase tracking-wide mt-0.5">Visual</span>
                          </div>
                        )}
                        {item.cco_score != null && (
                          <div className={`flex flex-col items-center rounded-xl px-3 py-2 min-w-[56px] border ${
                            (item.cco_score ?? 0) >= 75 ? 'border-emerald-500/20 bg-emerald-500/8'
                            : (item.cco_score ?? 0) >= 50 ? 'border-amber-500/20 bg-amber-500/8'
                            : 'border-red-500/25 bg-red-500/8'
                          }`}>
                            <span className={`text-2xl font-bold tabular-nums ${
                              scoreBand(item.cco_score) === 'clean' ? 'text-emerald-400'
                              : scoreBand(item.cco_score) === 'mark' ? 'text-amber-400'
                              : 'text-red-400'
                            }`}>{item.cco_score.toFixed(0)}</span>
                            <span className="text-[9px] text-(--fg-faint) uppercase tracking-wide mt-0.5">Caption</span>
                          </div>
                        )}
                        {/* Visual QC — show score if run, or a button to trigger it */}
                        {item.visual_score == null && item.storage_url && !isVideo && (
                          <button
                            type="button"
                            disabled={vqcRunning}
                            onClick={async () => {
                              setVqcRunning(true)
                              setVqcResult(null)
                              const res = await runVisualQcForPost({ post_id: item.post_id!, brand_id: group.brand_id })
                              setVqcRunning(false)
                              if (res.ok) {
                                setVqcResult({ ok: true, msg: `Visual score: ${res.visual_score ?? '—'}` })
                                router.refresh()
                              } else {
                                setVqcResult({ ok: false, msg: res.error ?? 'Visual QC failed' })
                              }
                            }}
                            className="flex flex-col items-center justify-center rounded-xl px-3 py-2 min-w-[56px] border border-dashed border-amber-500/40 bg-amber-500/6 hover:bg-amber-500/12 hover:border-amber-500/60 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                            title="Run GPT-4o visual QC scorer"
                          >
                            {vqcRunning
                              ? <svg className="animate-spin text-amber-400/80 mb-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-amber-400/70 mb-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                            }
                            <span className="text-[9px] text-amber-500/80 uppercase tracking-wide leading-tight text-center">
                              {vqcRunning ? 'Scoring…' : 'Run Visual\nQC'}
                            </span>
                          </button>
                        )}
                        {item.visual_score == null && (!item.storage_url || isVideo) && (
                          <div className="flex flex-col items-center justify-center rounded-xl px-3 py-2 min-w-[56px] border border-dashed border-(--border-subtle) opacity-40">
                            <span className="text-[9px] text-(--fg-faint) uppercase tracking-wide leading-tight text-center">Visual<br/>N/A</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Visual QC run result banner */}
                {vqcResult && (
                  <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${vqcResult.ok ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border border-red-500/30 bg-red-500/10 text-red-400'}`}>
                    {vqcResult.ok
                      ? <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                      : <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 8v4m0 4h.01"/></svg>
                    }
                    {vqcResult.msg}
                    <button type="button" onClick={() => setVqcResult(null)} className="ml-auto opacity-50 hover:opacity-100">✕</button>
                  </div>
                )}

                {/* Hold reasons — most important, shown prominently when present */}
                {triggerKeys.length > 0 && (
                  <div>
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-(--fg-faint)">
                      Why this post is held
                    </p>
                    <div className={`rounded-2xl border divide-y ${isHardBlock || isVisualHardBlock ? 'border-red-500/30 divide-red-500/15' : 'border-amber-500/25 divide-amber-500/15'}`}>
                      {triggerKeys.map((k) => (
                        <div key={k} className={`flex items-start gap-3 px-4 py-3.5 ${isHardBlock || isVisualHardBlock ? 'bg-red-500/6' : 'bg-amber-500/6'}`}>
                          <div className={`mt-0.5 h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold ${isHardBlock || isVisualHardBlock ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                            !
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-(--fg)">{TRIGGER_LABELS[k] ?? k}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-(--fg-muted)">
                              {flagDetailByReason[k] || TRIGGER_DETAILS[k] || ''}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full ScoreInsightPanel — all pillars, visual issues, caption issues, compliance */}
                <ScoreInsightPanel
                  src={{
                    cco_score: item.cco_score,
                    confidence_score: item.confidence_score,
                    visual_score: item.visual_score,
                    visual_issues: item.visual_issues,
                    route_decision: item.route_decision,
                    flags: item.flags,
                    trigger_reason: item.trigger_reason,
                    strategic_rationale: item.strategic_rationale,
                  }}
                />

                {/* Raw flag values — collapsible audit trail */}
                {flagEntries.length > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-wider text-(--fg-faint) hover:text-(--fg-muted) flex items-center gap-1.5">
                      <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                      Raw flag values ({flagEntries.length})
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-(--surface-2) border border-(--border-subtle) p-4">
                      {flagEntries.map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-(--fg-muted)">{k}</span>
                          <span className={`font-mono text-[10px] font-bold ${
                            String(v) === 'HARD_BLOCK' ? 'text-red-400' :
                            String(v) === 'STRONG_WARN' ? 'text-orange-400' :
                            String(v) === 'SOFT_WARN' ? 'text-yellow-400' :
                            v === true ? 'text-amber-400' : 'text-(--fg-faint)'
                          }`}>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Revision count — only client-triggered B03 cycles count toward the limit */}
                <div className="flex items-center gap-4 rounded-xl bg-(--surface-2) border border-(--border-subtle) p-4">
                  <div>
                    <p className="text-2xl font-bold text-(--fg)">{item.revision_count ?? 0}</p>
                    <p className="text-[10px] text-(--fg-faint)">Client revisions (max 3)</p>
                  </div>
                  {regens.length > 0 && (
                    <div className="text-right">
                      <p className="text-lg font-bold text-(--fg)">{regens.length}</p>
                      <p className="text-[10px] text-(--fg-faint)">Admin regens</p>
                    </div>
                  )}
                  {item.requires_human_review && (
                    <Badge tone="warning" size="sm">Requires human review</Badge>
                  )}
                  {regens.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('history')}
                      className="ml-auto text-[10px] font-semibold text-(--accent) hover:underline"
                    >
                      View in History →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab: Preview ──────────────────────────────────────── */}
            {activeTab === 'preview' && (
              <div className="p-6 space-y-5">
                {item.storage_url ? (
                  <div className="flex justify-center py-2">
                    <InstagramPhoneMockup
                      storageUrl={item.storage_url}
                      cleanUrl={item.clean_storage_url}
                      isVideo={isVideo}
                      captionAr={item.caption_ar}
                      hashtags={item.hashtags}
                      brandName={group.brand_name_en ?? group.brand_name_ar}
                      brandLogoUrl={group.logo_url}
                      contentType={item.content_type}
                      scheduledDate={item.scheduled_date}
                      onFullscreen={(clean) => { setLightboxClean(clean); setLightboxOpen(true) }}
                    />
                  </div>
                ) : (
                  <div className="flex h-56 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-(--border-subtle) bg-(--surface-2) text-sm text-(--fg-faint)">
                    <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                    No image generated yet
                  </div>
                )}

                {isVideo && item.video_status && (
                  <div className="flex items-center gap-2 text-xs text-(--fg-muted)">
                    <Badge tone={item.video_status === 'completed' ? 'success' : item.video_status === 'failed' ? 'danger' : 'warning'} size="sm">
                      Video: {item.video_status}
                    </Badge>
                    {item.video_duration_s && <span>{item.video_duration_s}s</span>}
                  </div>
                )}

                {item.caption_ar && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">Arabic Caption</p>
                      <CopyBtn text={item.caption_ar} />
                    </div>
                    <div className="rounded-xl bg-(--surface-2) border border-(--border-subtle) p-4">
                      <p dir="rtl" className="text-sm leading-relaxed text-(--fg) whitespace-pre-wrap">{item.caption_ar}</p>
                    </div>
                  </div>
                )}

                {variants.length > 0 && (
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">
                      Caption Variants ({variants.length})
                      {item.selected_variant_index !== null && (
                        <span className="ml-2 text-emerald-400">· Variant {item.selected_variant_index + 1} selected</span>
                      )}
                    </p>
                    <div className="space-y-2">
                      {variants.map((v, i) => (
                        <div key={i} className={`rounded-xl border p-3 ${item.selected_variant_index === i ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-(--border-subtle) bg-(--surface-2)'}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-medium text-(--fg-muted)">Variant {i + 1}</span>
                            <div className="flex items-center gap-1.5">
                              {v.tone && <Badge tone="neutral" size="sm">{v.tone}</Badge>}
                              {item.selected_variant_index === i && <Badge tone="success" size="sm">Selected</Badge>}
                            </div>
                          </div>
                          <p dir="rtl" className="text-sm text-(--fg)">{v.caption_ar}</p>
                          {v.hashtags?.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {v.hashtags.map((h) => (
                                <span key={h} className="rounded-full bg-(--surface-3) px-2 py-0.5 text-[9px] text-(--fg-muted)">{h.startsWith('#') ? h : `#${h}`}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {item.hashtags && item.hashtags.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">Hashtags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {item.hashtags.map((tag) => (
                        <span key={tag} className="rounded-full border border-(--border-subtle) bg-(--surface-2) px-2.5 py-0.5 text-xs text-(--fg-muted)">
                          {tag.startsWith('#') ? tag : `#${tag}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Generation Data ──────────────────────────────── */}
            {activeTab === 'generation' && (
              <div className="divide-y divide-(--border-subtle) p-6">
                <p className="pb-4 text-xs text-(--fg-muted)">All fields produced by the DeepSeek generation agent for this post.</p>

                <div className="py-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-(--fg)">Image Prompt</p>
                      {item.visual_brief_en && (
                        ARABIC_RE.test(item.visual_brief_en) ? (
                          <Badge tone="danger" size="sm" title="Rule #3 violation: Arabic must never appear in image prompts">⚠ Arabic in prompt</Badge>
                        ) : (
                          <Badge tone="success" size="sm" title="Rule #3 satisfied: no Arabic in the image prompt">✓ Arabic-clean</Badge>
                        )
                      )}
                    </div>
                    {item.visual_brief_en && <CopyBtn text={item.visual_brief_en} />}
                  </div>
                  <p className="mb-1 text-[10px] text-(--fg-faint)">visual_brief_en — the positive English prompt sent to the image model</p>
                  {item.visual_brief_en ? (
                    <div className="rounded-xl border border-(--accent)/30 bg-(--accent)/5 p-4">
                      <p className="font-mono text-xs leading-relaxed text-(--fg) whitespace-pre-wrap break-all">{item.visual_brief_en}</p>
                    </div>
                  ) : (
                    <p className="rounded-xl bg-(--surface-2) border border-(--border-subtle) p-3 text-xs italic text-(--fg-faint)">
                      No image prompt stored for this post.
                    </p>
                  )}
                </div>

                {item.final_prompt && (
                  <div className="py-5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-bold text-(--fg)">Final Generation Prompt</p>
                      <CopyBtn text={item.final_prompt} />
                    </div>
                    <p className="mb-1 text-[10px] text-(--fg-faint)">
                      Exact string sent to {item.generation_model ?? 'fal.ai'}
                    </p>
                    <div className="rounded-xl border border-(--border-subtle) bg-(--surface-2) p-4">
                      <p className="font-mono text-xs leading-relaxed text-(--fg) whitespace-pre-wrap break-words">{item.final_prompt}</p>
                    </div>
                    {item.final_negative_prompt && (
                      <>
                        <p className="mt-3 mb-1 text-[10px] text-(--fg-faint)">Negative prompt</p>
                        <div className="rounded-xl border border-(--border-subtle) bg-(--surface-2) p-3">
                          <p className="font-mono text-[11px] leading-relaxed text-(--fg-muted) whitespace-pre-wrap break-words">{item.final_negative_prompt}</p>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="py-5 grid grid-cols-2 gap-x-8 gap-y-4">
                  {[
                    ['Content Type',    item.content_type],
                    ['Format',          item.format_tier ?? item.format],
                    ['Platform',        item.channel],
                    ['Chain ID',        item.chain_id],
                    ['Route Decision',  item.route_decision],
                    ['Watermark',       item.watermark !== null ? (item.watermark ? 'Yes' : 'No') : null],
                    ['AI Generated',    item.ai_generated ? 'Yes' : 'No'],
                    ['Model',           item.generation_model],
                    ['C2PA Signed',     item.c2pa_signed ? 'Yes' : 'No'],
                    ['Occasion Flags',  item.occasion_flags?.join(', ') || null],
                    ['Human Review',    item.requires_human_review ? 'Required' : 'Not required'],
                  ].map(([label, value]) => value ? (
                    <div key={String(label)}>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-(--fg-faint)">{label}</p>
                      <p className="mt-0.5 text-xs font-mono text-(--fg)">{String(value)}</p>
                    </div>
                  ) : null)}
                </div>

                {item.strategic_rationale && (
                  <div className="py-5">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-(--fg-faint)">Strategic Rationale</p>
                    <p className="text-sm leading-relaxed text-(--fg-muted)">{item.strategic_rationale}</p>
                  </div>
                )}

                <div className="py-5 grid grid-cols-2 gap-x-8 gap-y-4">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-(--fg-faint)">Posting Time</p>
                    <p className="mt-0.5 text-xs font-mono text-(--fg)">
                      {item.posting_time ? new Date(item.posting_time).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-(--fg-faint)">Scheduled Date</p>
                    <p className="mt-0.5 text-xs font-mono text-(--fg)">{item.scheduled_date ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-(--fg-faint)">Calendar Position</p>
                    <p className="mt-0.5 text-xs font-mono text-(--fg)">#{item.position || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-(--fg-faint)">Generation Attempts</p>
                    <p className="mt-0.5 text-xs font-mono text-(--fg)">{item.generation_attempt}</p>
                  </div>
                </div>

                {item.last_error && (
                  <div className="py-5">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-red-400">Last Generation Error</p>
                    <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 font-mono text-xs text-red-300 break-all">{item.last_error}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: History ──────────────────────────────────────── */}
            {activeTab === 'history' && (() => {
              // Build timeline oldest→newest.
              // regens from DB are newest-first; reverse so history reads top=oldest.
              //
              // TRUE ORIGINAL IMAGE resolution (in priority order):
              //   1. item.original_storage_url — written once at A01/V01 time (mig 0121), never overwritten
              //   2. revision_history[0].old_image_url — B03 saves the pre-revision URL in the history array
              //   3. item.storage_url — only safe to use when NO admin regen has ever been approved
              //      (i.e. storage_url still holds the original, not a promoted regen)
              const approvedRegen = regens.find(r => r.status === 'approved')
              // original_storage_url = set once at A01/V01 generation (mig 0121), never overwritten by regen approvals.
              // Fallback chain for posts generated before mig 0121:
              //   revision_history[0].old_image_url (B03 saves pre-revision URL) → storage_url only if no regen approved yet
              const revHistory = Array.isArray(item.revision_history) ? (item.revision_history as Array<Record<string, unknown>>) : []
              const originalImgUrl: string | null =
                item.original_storage_url
                ?? (revHistory[0]?.old_image_url as string | null ?? null)
                ?? (!approvedRegen ? item.storage_url : null)
              const originalCleanUrl: string | null =
                item.original_clean_storage_url
                ?? (revHistory[0]?.old_clean_image_url as string | null ?? null)
                ?? (!approvedRegen ? item.clean_storage_url : null)
              const timelineRegens = [...regens].reverse() // oldest first
              const fmtDate = (iso: string | null | undefined) =>
                iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
              const ScoreChip = ({ val, label }: { val: number | null | undefined; label: string }) => {
                if (val == null) return null
                const color = val === 0 ? 'border-red-500/30 bg-red-500/10 text-red-400' : val >= 75 ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-400' : val >= 50 ? 'border-amber-500/20 bg-amber-500/8 text-amber-400' : 'border-red-500/25 bg-red-500/8 text-red-400'
                return (
                  <div className={`flex flex-col items-center rounded-xl border px-3 py-2 min-w-[56px] ${color}`}>
                    <span className="text-base font-bold tabular-nums">{val.toFixed(val % 1 === 0 ? 0 : 1)}</span>
                    <span className="text-[9px] uppercase tracking-wide text-(--fg-faint) mt-0.5">{label}</span>
                  </div>
                )
              }
              const ImgBlock = ({ url, cleanUrl, vidSrc, label }: { url: string | null; cleanUrl?: string | null; vidSrc?: string | null; label?: string }) => (
                <div className="space-y-1.5">
                  {label && <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint)">{label}</p>}
                  <div className="rounded-xl overflow-hidden bg-[#0a0a0a] aspect-square">
                    {vidSrc ? (
                      <video src={vidSrc} muted preload="metadata" className="w-full h-full object-cover" />
                    ) : url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={label ?? 'image'} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-(--fg-faint)">No image</div>
                    )}
                  </div>
                  {cleanUrl && cleanUrl !== url && (
                    <div className="rounded-xl overflow-hidden bg-[#0a0a0a] aspect-square opacity-60">
                      <p className="text-[9px] text-(--fg-faint) px-2 pt-1">Clean (no Arabic)</p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={cleanUrl} alt="clean" className="w-full object-cover" />
                    </div>
                  )}
                </div>
              )
              return (
              <div className="p-6 space-y-1">

                {/* Timeline header */}
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-(--fg-faint)">
                    Generation timeline — {1 + regens.length} version{regens.length > 0 ? 's' : ''}{item.revision_count ? ` · ${item.revision_count} client revision${item.revision_count !== 1 ? 's' : ''}` : ''}
                  </p>
                  {approvedRegen && (
                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/12 border border-emerald-500/20 rounded-full px-2.5 py-0.5">
                      v{approvedRegen.version} is live
                    </span>
                  )}
                </div>

                {/* Vertical timeline connector */}
                <div className="relative">
                  {/* Left rail line */}
                  {(regens.length > 0) && (
                    <div className="absolute left-[11px] top-8 bottom-8 w-px bg-(--border-subtle)" />
                  )}

                  <div className="space-y-4">

                {/* ── v0: Original A01 generation ── */}
                <div className="rounded-2xl border border-(--border-subtle) bg-(--surface-2) overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-(--border-subtle) bg-(--surface-1)">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--surface-3) border border-(--border-subtle) text-[10px] font-bold text-(--fg-faint)">0</div>
                    <div>
                      <p className="text-sm font-semibold text-(--fg)">Original — A01 generation</p>
                      <p className="text-[10px] text-(--fg-faint)">{fmtDate(item.posting_time ?? item.created_at)}</p>
                    </div>
                    {!approvedRegen && (
                      <span className="ml-auto text-[10px] font-semibold text-emerald-400 bg-emerald-500/12 border border-emerald-500/20 rounded-full px-2 py-0.5">Live</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5">
                    <ImgBlock
                      url={isVideo ? originalImgUrl?.replace(/\.mp4(\?.*)?$/i, '-kf.jpg') ?? null : originalImgUrl}
                      cleanUrl={originalCleanUrl}
                      label={originalImgUrl ? 'Original image' : 'Original image (not available — overwritten by regen)'}
                    />
                    <div className="space-y-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint) mb-2">Scores</p>
                        <div className="flex gap-2 flex-wrap">
                          <ScoreChip val={normaliseComposite(item.confidence_score)} label="Composite" />
                          <ScoreChip val={item.visual_score} label="Visual" />
                          <ScoreChip val={item.cco_score} label="Caption" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span className="text-(--fg-faint)">Route</span><span className={`font-semibold ${item.route_decision === 'clean' ? 'text-emerald-400' : item.route_decision === 'hold' ? 'text-red-400' : 'text-amber-400'}`}>{item.route_decision ?? '—'}</span>
                        <span className="text-(--fg-faint)">Chain</span><span className="text-(--fg) font-mono">{item.chain_id ?? '—'}</span>
                        <span className="text-(--fg-faint)">Format</span><span className="text-(--fg) font-mono">{item.format_tier ?? item.format ?? '—'}</span>
                        <span className="text-(--fg-faint)">Watermark</span><span className={item.watermark ? 'text-amber-400' : 'text-(--fg-faint)'}>{item.watermark != null ? (item.watermark ? 'Yes' : 'No') : '—'}</span>
                      </div>
                      {item.visual_brief_en && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint) mb-1.5">Image prompt</p>
                          <p className="font-mono text-[10px] leading-relaxed text-(--fg-muted) bg-(--surface-1) border border-(--border-subtle) rounded-lg p-2.5 break-all">{item.visual_brief_en}</p>
                        </div>
                      )}
                      {item.caption_ar && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint) mb-1.5">Caption (AR)</p>
                          <p dir="rtl" className="text-sm text-(--fg) bg-(--surface-1) border border-(--border-subtle) rounded-lg p-2.5 leading-relaxed">{item.caption_ar}</p>
                          {item.hashtags && item.hashtags.length > 0 && (
                            <p className="mt-1 text-xs text-blue-400" dir="rtl">{item.hashtags.map((h) => h.startsWith('#') ? h : `#${h}`).join(' ')}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {item.last_error && (
                    <div className="px-5 pb-5">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-red-400 mb-1">Last error</p>
                      <p className="font-mono text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 break-all">{item.last_error}</p>
                    </div>
                  )}
                </div>

                {/* ── Regeneration cards (oldest → newest) ── */}
                {timelineRegens.map((regen) => {
                  const rv = regen.media_type === 'video' && regen.storage_url ? regen.storage_url : null
                  const cs = normaliseComposite(regen.confidence_score)
                  const statusMeta =
                    regen.status === 'approved'   ? { label: 'Approved — Live',  cls: 'text-emerald-400 bg-emerald-500/12 border-emerald-500/25', dot: 'bg-emerald-400' } :
                    regen.status === 'rejected'    ? { label: 'Rejected',         cls: 'text-red-400 bg-red-500/12 border-red-500/25',         dot: 'bg-red-400'     } :
                    regen.status === 'draft'       ? { label: 'Draft — pending',  cls: 'text-blue-400 bg-blue-500/12 border-blue-500/25',       dot: 'bg-blue-400 animate-pulse' } :
                                                     { label: 'Superseded',       cls: 'text-(--fg-faint) bg-(--surface-3) border-(--border-subtle)', dot: 'bg-(--fg-faint)' }
                  return (
                    <div key={regen.regen_id} className={`rounded-2xl border overflow-hidden ${regen.status === 'approved' ? 'border-emerald-500/30' : 'border-(--border-subtle)'}`}>
                      <div className={`flex items-center gap-3 px-4 py-3 border-b ${regen.status === 'approved' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-(--border-subtle) bg-(--surface-1)'}`}>
                        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${regen.status === 'approved' ? 'bg-emerald-500/25 text-emerald-400' : 'bg-(--surface-3) border border-(--border-subtle) text-(--fg-faint)'}`}>
                          {regen.version}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-(--fg)">Regeneration v{regen.version}</p>
                            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusMeta.cls}`}>
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusMeta.dot}`} />
                              {statusMeta.label}
                            </span>
                          </div>
                          <p className="text-[10px] text-(--fg-faint) mt-0.5">
                            {fmtDate(regen.created_at)}{regen.created_by ? ` · ${regen.created_by}` : ''}
                          </p>
                        </div>
                        {/* Quick score summary in header */}
                        <div className="shrink-0 flex items-center gap-1.5 text-[10px] font-bold">
                          {cs != null && <span className={cs >= 75 ? 'text-emerald-400' : cs >= 50 ? 'text-amber-400' : 'text-red-400'}>{cs.toFixed(1)}</span>}
                          {regen.visual_score != null && <span className={regen.visual_score >= 75 ? 'text-emerald-400' : regen.visual_score >= 50 ? 'text-amber-400' : 'text-red-400'}>V{regen.visual_score.toFixed(0)}</span>}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-5 bg-(--surface-2)">
                        <ImgBlock url={rv ? regen.storage_url?.replace(/\.mp4(\?.*)?$/i, '-kf.jpg') ?? null : regen.storage_url} cleanUrl={regen.clean_storage_url} vidSrc={rv} label="Generated image" />
                        <div className="space-y-4">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint) mb-2">Scores</p>
                            <div className="flex gap-2 flex-wrap">
                              <ScoreChip val={cs} label="Composite" />
                              <ScoreChip val={regen.visual_score} label="Visual" />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <span className="text-(--fg-faint)">Media</span><span className="text-(--fg) capitalize">{regen.media_type}</span>
                            <span className="text-(--fg-faint)">Watermark</span><span className={regen.watermark ? 'text-amber-400' : 'text-(--fg-faint)'}>{regen.watermark ? 'Yes' : 'No'}</span>
                            <span className="text-(--fg-faint)">By</span><span className="text-(--fg) text-[10px] truncate">{regen.created_by ?? '—'}</span>
                          </div>
                          {regen.visual_issues && regen.visual_issues.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint) mb-1.5">Visual issues</p>
                              <div className="space-y-1">
                                {(regen.visual_issues as Array<{ code: string; label: string; severity: string; detail?: string }>).map((vi) => (
                                  <div key={vi.code} className={`rounded-lg px-2.5 py-1.5 border text-[10px] ${vi.severity === 'high' ? 'bg-red-500/15 border-red-500/30 text-red-300' : vi.severity === 'med' ? 'bg-amber-500/12 border-amber-500/25 text-amber-300' : 'bg-(--surface-1) border-(--border-subtle) text-(--fg-muted)'}`}>
                                    <span className="font-semibold">{vi.label}</span>
                                    {vi.detail && <span className="ml-1 opacity-70">— {vi.detail}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {regen.caption_ar && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint) mb-1.5">Caption (AR)</p>
                              <p dir="rtl" className="text-sm text-(--fg) bg-(--surface-1) border border-(--border-subtle) rounded-lg p-2.5 leading-relaxed">{regen.caption_ar}</p>
                              {Array.isArray(regen.hashtags) && regen.hashtags.length > 0 && (
                                <p className="mt-1 text-xs text-blue-400" dir="rtl">{(regen.hashtags as string[]).map((h: string) => h.startsWith('#') ? h : `#${h}`).join(' ')}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}

                  </div>{/* end timeline items */}
                </div>{/* end relative timeline */}
              </div>
              )
            })()}
          </div>

          {/* ── RIGHT COL: image + meta + actions ─────────────────── */}
          <div className="lg:col-span-2 flex flex-col gap-3">

            {/* Image thumbnail — for video posts shows the keyframe still (the source image
                the video was generated from), not the video itself. Keyframe is stored at
                the same path as the mp4 but with -kf.jpg suffix. */}
            {item.storage_url ? (
              <div
                className="relative overflow-hidden rounded-2xl border border-(--border-subtle) cursor-pointer group"
                onClick={() => { setLightboxClean(false); setLightboxOpen(true) }}
                title="Click to open fullscreen (or press F)"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={isVideo ? item.storage_url.replace(/\.mp4(\?.*)?$/i, '-kf.jpg') : item.storage_url}
                  alt="Generated post"
                  className="w-full aspect-square object-cover"
                  draggable={false}
                />
                {isVideo && (
                  <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-1 text-[10px] font-semibold text-white/80">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    Source image
                  </div>
                )}
                {/* Visual score overlay */}
                {item.visual_score != null && (
                  <div className={`absolute top-2.5 left-2.5 rounded-lg px-2.5 py-1 text-xs font-bold backdrop-blur-sm ${
                    item.visual_score === 0 ? 'bg-red-600/80 text-white' :
                    item.visual_score >= 80 ? 'bg-emerald-600/80 text-white' :
                    'bg-amber-500/80 text-white'
                  }`}>
                    Visual {item.visual_score.toFixed(0)}
                  </div>
                )}
                {/* Fullscreen hint */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <div className="rounded-xl bg-black/60 backdrop-blur-sm px-3 py-2 text-xs font-semibold text-white flex items-center gap-1.5">
                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
                    Fullscreen
                  </div>
                </div>
                {/* Clean version toggle */}
                {item.clean_storage_url && item.clean_storage_url !== item.storage_url && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setLightboxClean(true); setLightboxOpen(true) }}
                    className="absolute top-2.5 right-2.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/20 px-2.5 py-1 text-[10px] font-semibold text-white/80 hover:text-white transition-colors"
                  >
                    Clean
                  </button>
                )}
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-(--border-subtle) bg-(--surface-2) text-sm text-(--fg-faint)">
                No image yet
              </div>
            )}

            {/* IDs + meta — compact inline chip layout */}
            <div className="rounded-2xl border border-(--border-subtle) bg-(--surface-2) px-4 py-3 space-y-3">
              {/* Post ID */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-(--fg-faint) shrink-0">Post ID</span>
                <code className="font-mono text-[10px] text-(--fg-muted) truncate">{item.post_id || '—'}</code>
              </div>
              {/* Chips row */}
              <div className="flex flex-wrap gap-2">
                {/* Scheduled */}
                <div className="flex items-center gap-1.5 rounded-lg bg-(--surface-3) border border-(--border-subtle) px-2.5 py-1.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-(--fg-faint) shrink-0"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                  <span className="text-[9px] text-(--fg-faint) uppercase tracking-wide">Sched</span>
                  <span className="text-xs font-medium text-(--fg)">
                    {item.scheduled_date
                      ? new Date(item.scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : '—'}
                  </span>
                </div>
                {/* Chain */}
                <div className="flex items-center gap-1.5 rounded-lg bg-(--surface-3) border border-(--border-subtle) px-2.5 py-1.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-(--fg-faint) shrink-0"><path strokeLinecap="round" d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path strokeLinecap="round" d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                  <span className="text-[9px] text-(--fg-faint) uppercase tracking-wide">Chain</span>
                  <span className="text-xs font-mono font-semibold text-(--fg)">{item.chain_id ?? '—'}</span>
                </div>
                {/* Format */}
                <div className="flex items-center gap-1.5 rounded-lg bg-(--surface-3) border border-(--border-subtle) px-2.5 py-1.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-(--fg-faint) shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  <span className="text-[9px] text-(--fg-faint) uppercase tracking-wide">Format</span>
                  <span className="text-xs font-mono text-(--fg)">{item.format_tier ?? item.format ?? '—'}</span>
                </div>
                {/* Route — coloured */}
                <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
                  item.route_decision === 'hold'      ? 'bg-red-500/10 border-red-500/25' :
                  item.route_decision === 'watermark' ? 'bg-amber-500/10 border-amber-500/25' :
                  item.route_decision === 'clean'     ? 'bg-emerald-500/10 border-emerald-500/25' :
                  'bg-(--surface-3) border-(--border-subtle)'
                }`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`shrink-0 ${item.route_decision === 'hold' ? 'text-red-400' : item.route_decision === 'watermark' ? 'text-amber-400' : item.route_decision === 'clean' ? 'text-emerald-400' : 'text-(--fg-faint)'}`}><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 8v4m0 4h.01"/></svg>
                  <span className="text-[9px] text-(--fg-faint) uppercase tracking-wide">Route</span>
                  <span className={`text-xs font-bold uppercase ${
                    item.route_decision === 'hold'      ? 'text-red-400' :
                    item.route_decision === 'watermark' ? 'text-amber-400' :
                    item.route_decision === 'clean'     ? 'text-emerald-400' :
                    'text-(--fg)'
                  }`}>{item.route_decision ?? '—'}</span>
                </div>
                {/* Attempts */}
                <div className="flex items-center gap-1.5 rounded-lg bg-(--surface-3) border border-(--border-subtle) px-2.5 py-1.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-(--fg-faint) shrink-0"><path strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                  <span className="text-[9px] text-(--fg-faint) uppercase tracking-wide">Attempts</span>
                  <span className="text-xs font-mono font-semibold text-(--fg)">{item.generation_attempt ?? 0}</span>
                </div>
              </div>
            </div>

            {/* ── Regenerate ───────────────────────────────────── */}
            <div className="rounded-2xl border border-(--border-subtle) bg-(--surface-2) overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-0">
                <div className="flex items-center gap-1.5">
                  <RefreshCw size={12} className="text-(--fg-faint)" aria-hidden />
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-(--fg-faint)">Regenerate</p>
                </div>
                {regens.filter(r => r.status === 'draft').length > 0 && (
                  <span className="rounded-full bg-(--accent)/15 px-2 py-0.5 text-[10px] font-semibold text-(--accent)">
                    {regens.filter(r => r.status === 'draft').length} draft{regens.filter(r => r.status === 'draft').length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <div className="p-3 space-y-2">
                {/* ── Post is finalised — regeneration not allowed ── */}
                {isDecided ? (
                  <div className="flex items-center gap-2.5 rounded-xl border border-(--border-subtle) bg-(--surface-1) px-3 py-3 text-xs text-(--fg-faint)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0 opacity-40"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    <span>
                      Regeneration is locked — this post is{' '}
                      <span className={`font-semibold ${item.status === 'rejected' ? 'text-red-400' : item.status === 'approved' ? 'text-emerald-400' : 'text-blue-400'}`}>
                        {item.status === 'released' ? 'released to client' : item.status === 'approved' ? 'client approved' : 'rejected'}
                      </span>.
                    </span>
                  </div>
                ) : (
                  <>
                    {/* ── Failed visual banner ── */}
                    {item.raw_status === 'failed_visual' && (
                      <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/8 px-3 py-2.5 text-xs leading-relaxed text-red-400">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <p className="font-semibold">Visual generation failed</p>
                          {item.last_error && (
                            <p className="mt-0.5 font-mono text-[10px] text-red-400/80 break-all line-clamp-3">{item.last_error}</p>
                          )}
                          <p className="mt-1 text-(--fg-muted)">Regenerate to create a new draft. The failed attempt will not be shown to the client.</p>
                        </div>
                      </div>
                    )}

                    {/* ── Non-failed last_error ── */}
                    {item.raw_status !== 'failed_visual' && item.last_error && (
                      <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/8 px-3 py-2.5 text-xs leading-relaxed text-amber-400">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
                        <div className="min-w-0">
                          <p className="font-semibold">Last pipeline error</p>
                          <p className="mt-0.5 font-mono text-[10px] text-amber-400/80 break-all line-clamp-3">{item.last_error}</p>
                        </div>
                      </div>
                    )}

                    {/* ── Regenerate trigger ── */}
                    <AdminRegenerateButton
                      postId={item.post_id}
                      requestId={null}
                      brandId={group.brand_id}
                      mediaType={isVideo ? 'video' : 'image'}
                      previousPrompt={item.visual_brief_en ?? item.final_prompt ?? null}
                      currentImageUrl={item.storage_url ?? null}
                      label={item.raw_status === 'failed_visual' ? 'Retry Generation' : 'Regenerate Post'}
                    />
                  </>
                )}
              </div>

              {/* ── Draft history strip (outside the padded area, full-width) ── */}
              {regens.length > 0 && (
                <AdminRegenHistory
                  regens={regens}
                  labels={{ title: 'Drafts', approveVersion: 'Approve', reject: 'Reject' }}
                />
              )}
            </div>

            {/* ── Action suite ─── */}
            <div className="rounded-2xl border border-(--border-subtle) bg-(--surface-2) overflow-hidden">

              {phase === 'revision' && (
                <div className="border-b border-(--border-subtle) p-4">
                  <p className="mb-2 text-xs font-semibold text-(--fg-muted)">
                    Notes for B03 revision workflow
                    <span className="ml-1 text-[10px] text-(--fg-faint)">(min 5 chars)</span>
                  </p>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Describe what needs to change — tone, visual style, compliance issue…"
                    rows={3}
                    autoFocus
                    className="w-full resize-none rounded-xl border border-(--border-subtle) bg-(--surface-1) px-3 py-2 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none focus:ring-1 focus:ring-(--accent)"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setPhase('idle')} className="rounded-lg px-3 py-1.5 text-xs text-(--fg-muted) hover:bg-(--surface-3) transition-colors">Cancel</button>
                    <button
                      type="button"
                      disabled={notes.trim().length < 5 || isPending}
                      onClick={doRevision}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-(--accent) px-4 py-1.5 text-xs font-semibold text-white hover:bg-(--accent)/90 disabled:opacity-40 transition-colors"
                    >
                      {isPending ? <Spinner size={11} className="text-white" /> : null}
                      Send to B03
                    </button>
                  </div>
                </div>
              )}

              {phase === 'confirm_approve' && (
                <div className="border-b border-blue-500/25 bg-blue-500/8 p-4">
                  <p className="text-sm font-medium text-blue-300 mb-2">Release this post to the client calendar?</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPhase('idle')} className="rounded-lg px-3 py-1.5 text-xs text-(--fg-muted) hover:bg-(--surface-3) transition-colors">Cancel</button>
                    <button type="button" disabled={isPending} onClick={doApprove} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors">
                      {isPending ? <Spinner size={11} className="text-white" /> : null}
                      Confirm Release
                    </button>
                  </div>
                </div>
              )}

              {phase === 'confirm_reject' && (
                <div className="border-b border-red-500/25 bg-red-500/8 p-4">
                  <p className="text-sm font-medium text-red-300 mb-2">Reject? Post will NOT appear on the client calendar.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPhase('idle')} className="rounded-lg px-3 py-1.5 text-xs text-(--fg-muted) hover:bg-(--surface-3) transition-colors">Cancel</button>
                    <button type="button" disabled={isPending} onClick={doReject} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40 transition-colors">
                      {isPending ? <Spinner size={11} className="text-white" /> : null}
                      Confirm Reject
                    </button>
                  </div>
                </div>
              )}

              {phase === 'submitting' && (
                <div className="flex items-center justify-center gap-2 p-4">
                  <Spinner size={16} className="text-(--accent)" />
                  <span className="text-sm text-(--fg-muted)">Processing…</span>
                </div>
              )}

              {phase === 'idle' && isBlockedStatus && (
                <div className="flex items-start gap-3 p-4">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--surface-1) text-(--fg-muted) ring-1 ring-(--border-default)">
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-(--fg)">Compliance-blocked by the system</p>
                    <p className="mt-1 text-xs text-(--fg-muted)">
                      This post was hard-blocked at generation{triggerKeys.length > 0 ? ` (${triggerKeys.map((k) => TRIGGER_LABELS[k] ?? k).join(', ')})` : ''}. No image was generated and it cannot be approved or sent to the client.
                    </p>
                  </div>
                </div>
              )}

              {phase === 'idle' && isDecided && (
                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-2 text-sm">
                    {isReleased ? (
                      <>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-white">
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>
                        </span>
                        <span className="font-semibold text-blue-400">Released</span>
                        <span className="text-xs text-(--fg-faint)">— awaiting client approval</span>
                      </>
                    ) : item.status === 'approved' ? (
                      <>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                        </span>
                        <span className="font-semibold text-emerald-400">Client approved</span>
                      </>
                    ) : (
                      <>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white">
                          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        </span>
                        <span className="font-semibold text-red-400">Rejected</span>
                      </>
                    )}
                  </div>
                  {item.status === 'rejected' && (
                    <button type="button" disabled={isPending} onClick={() => setPhase('confirm_approve')}
                      className="rounded-lg border border-blue-500/30 px-3 py-1.5 text-xs font-semibold text-blue-400 hover:bg-blue-500/10 disabled:opacity-40">
                      Change to Release
                    </button>
                  )}
                </div>
              )}

              {phase === 'idle' && !isDecided && !isBlockedStatus && (
                <div className="grid grid-cols-2 gap-2 p-3">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setPhase('confirm_reject')}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/35 bg-red-500/8 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/18 disabled:opacity-40 transition-colors"
                  >
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setPhase('confirm_approve')}
                    title="Release to the client for their approval"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-40 transition-colors shadow-md shadow-blue-600/25"
                  >
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>
                    Release
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Fullscreen lightbox ───────────────────────────────────── */}
      {lightboxOpen && (item.storage_url || item.clean_storage_url) && (() => {
        const src = lightboxClean ? (item.clean_storage_url ?? item.storage_url) : (item.storage_url ?? item.clean_storage_url)
        const hasCleanToggle = !!(item.storage_url && item.clean_storage_url && item.clean_storage_url !== item.storage_url)
        const brandName = group.brand_name_en ?? group.brand_name_ar ?? 'Brand'
        return (
          <div
            className="fixed inset-0 z-50 flex bg-black"
            onClick={(e) => { if (e.target === e.currentTarget) setLightboxOpen(false) }}
          >
            <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
              {isVideo && !lightboxClean ? (
                <video
                  src={src ?? ''}
                  controls
                  autoPlay
                  loop
                  className="h-full w-full object-contain"
                  style={{ maxHeight: '100vh', maxWidth: 'calc(100vh * 0.5625)' }}
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={src ?? ''}
                  alt={lightboxClean ? 'Clean version' : 'Final version'}
                  className="h-full w-full object-contain"
                  style={{ maxHeight: '100vh', maxWidth: 'calc(100vh * 0.8)' }}
                  draggable={false}
                />
              )}

              <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 to-transparent">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/80 hover:text-white backdrop-blur-sm transition-colors"
                    title="Close (Esc)"
                  >
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                  {hasCleanToggle && (
                    <div className="flex rounded-lg border border-white/20 overflow-hidden text-[10px] font-semibold backdrop-blur-sm">
                      <button type="button" onClick={() => setLightboxClean(false)} className={`px-3 py-1.5 transition-colors ${!lightboxClean ? 'bg-white/25 text-white' : 'bg-black/30 text-white/50 hover:text-white/80'}`}>
                        With Arabic
                      </button>
                      <button type="button" onClick={() => setLightboxClean(true)} className={`px-3 py-1.5 transition-colors ${lightboxClean ? 'bg-white/25 text-white' : 'bg-black/30 text-white/50 hover:text-white/80'}`}>
                        Clean
                      </button>
                    </div>
                  )}
                </div>
                <a
                  href={src ?? ''}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg bg-black/50 backdrop-blur-sm border border-white/15 px-2.5 py-1.5 text-[10px] font-semibold text-white/60 hover:text-white transition-colors"
                >
                  <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Download
                </a>
              </div>

              {/* Esc hint — minimal, bottom center */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[9px] text-white/20 pointer-events-none select-none">
                Esc — close
              </div>
            </div>

            <div className="hidden lg:flex w-80 shrink-0 flex-col border-l border-white/8 bg-[#0a0a0a]">
              <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/8">
                <div className="h-9 w-9 rounded-full overflow-hidden ring-2 ring-white/20 shrink-0 flex items-center justify-center">
                  {group.logo_url
                    ? <img src={group.logo_url} alt={brandName} className="h-full w-full object-cover" draggable={false} />
                    : <div className="h-full w-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center">
                        <span className="text-xs font-bold text-white">{brandName.slice(0,1)}</span>
                      </div>
                  }
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{brandName}</p>
                  {item.scheduled_date && (
                    <p className="text-[10px] text-white/40">
                      {new Date(item.scheduled_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {item.caption_ar && (
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/25 mb-1.5">Caption</p>
                    <p dir="rtl" className="text-sm text-white/80 leading-relaxed">{item.caption_ar}</p>
                  </div>
                )}
                {item.hashtags && item.hashtags.length > 0 && (
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/25 mb-1.5">Hashtags</p>
                    <div className="flex flex-wrap gap-1.5" dir="rtl">
                      {item.hashtags.map((h) => (
                        <span key={h} className="rounded-full bg-white/6 border border-white/10 px-2.5 py-1 text-[10px] text-blue-300/80">
                          {h.startsWith('#') ? h : `#${h}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Score summary in lightbox */}
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-white/25 mb-2">Scores</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['Caption',   item.cco_score],
                      ['Visual',    item.visual_score],
                      ['Composite', normaliseComposite(item.confidence_score)],
                    ] as [string, number | null][]).map(([label, val]) => (
                      <div key={label} className="rounded-lg bg-white/4 border border-white/6 px-2 py-2 text-center">
                        <p className="text-sm font-bold text-white">{val != null ? val.toFixed(1) : '—'}</p>
                        <p className="text-[8px] text-white/30 uppercase tracking-wider mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Post',    `#${item.position > 0 ? item.position : '—'}`],
                    ['Format',  item.format_tier ?? '—'],
                    ['Chain',   item.chain_id ?? '—'],
                    ['Route',   item.route_decision ?? '—'],
                    ['Type',    item.content_type ?? '—'],
                    ['Platform', item.channel ?? '—'],
                  ].map(([label, val]) => (
                    <div key={label as string} className="rounded-lg bg-white/4 border border-white/6 px-2.5 py-2">
                      <p className="text-[8px] text-white/30 font-semibold uppercase tracking-wider mb-0.5">{label as string}</p>
                      <p className="text-[11px] font-semibold text-white/70 truncate capitalize">{val as string}</p>
                    </div>
                  ))}
                </div>

                {/* Visual issues in lightbox */}
                {Array.isArray(item.visual_issues) && item.visual_issues.length > 0 && (
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/25 mb-2">Visual Issues</p>
                    <div className="space-y-1.5">
                      {(item.visual_issues as Array<{ code: string; label: string; severity: string; detail?: string }>).map((vi) => (
                        <div key={vi.code} className={`rounded-lg px-2.5 py-2 border text-[10px] ${
                          vi.severity === 'high' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
                          vi.severity === 'med'  ? 'bg-amber-500/12 border-amber-500/25 text-amber-300' :
                          'bg-white/4 border-white/8 text-white/50'
                        }`}>
                          <span className="font-semibold">{vi.label}</span>
                          {vi.detail && <span className="ml-1 opacity-70">— {vi.detail}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t border-white/8 flex gap-2">
                <a
                  href={src ?? ''}
                  download
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/60 hover:text-white transition-all"
                >
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setLightboxOpen(false)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/8 hover:bg-white/12 border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/60 hover:text-white transition-all"
                >
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
