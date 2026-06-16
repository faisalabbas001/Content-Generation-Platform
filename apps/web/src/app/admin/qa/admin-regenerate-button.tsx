'use client'

import { useState, useTransition, useEffect, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import {
  RefreshCw, Loader2, CheckCircle2, AlertCircle, Check, Sparkles, X, Clock,
} from '@repo/ui/icons'
import {
  requestAdminRegenerate,
  type AdminRegeneratePromptOverride,
} from '@/app/actions/admin-regenerate'

const HARD_CAP_IMAGE_MS = 120000
const HARD_CAP_VIDEO_MS = 300000

type StepState = 'idle' | 'active' | 'done' | 'failed' | 'warning'

// Same staged lifecycle as the user-side RegenProgress. `currentStep` mirrors the
// real B03 pipeline step (on_demand_requests.current_step), polled live while the
// (synchronous) regeneration runs.
type RegenPhase =
  | { kind: 'idle' }
  | { kind: 'queueing' }
  | { kind: 'generating'; currentStep: string | null }
  | { kind: 'success' }
  | { kind: 'held'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'failed'; message: string }

export interface AdminRegenerateButtonProps {
  postId: string
  requestId: string | null
  brandId: string
  mediaType: 'image' | 'video'
  label: string
  /** The actual prompt that generated the current image — shown as read-only reference */
  previousPrompt?: string | null
  /** Current post image/video URL — shown as a thumbnail in the modal so admin sees what they're correcting */
  currentImageUrl?: string | null
}

// ── Step pipeline (identical wording to the user side) ──────────────────────
const stepLabels = ['Queuing request', 'Connecting to pipeline', 'Running AI generation', 'Saving draft']

// Maps the real B03 current_step values (same labels A02/B03 write) to the
// sub-detail shown under "Running AI generation".
const stepDetailMap: Record<string, string> = {
  ceo:     'Analysing brand context…',
  coo:     'Building caption context…',
  caption: 'Generating Arabic caption…',
  qc:      'Running quality checks…',
  image:   'Creating the image…',
  video:   'Generating video…',
  upload:  'Saving the draft…',
}

function deriveStepStates(phase: RegenPhase): [StepState, StepState, StepState, StepState] {
  switch (phase.kind) {
    case 'idle':      return ['idle', 'idle', 'idle', 'idle']
    case 'queueing':  return ['active', 'idle', 'idle', 'idle']
    case 'generating': {
      // 'upload' = the final save step; everything else is the AI-generation step.
      if (phase.currentStep === 'upload') return ['done', 'done', 'done', 'active']
      return ['done', 'done', 'active', 'idle']
    }
    case 'success':   return ['done', 'done', 'done', 'done']
    case 'held':      return ['done', 'done', 'warning', 'idle']
    case 'rejected':
    case 'failed':    return ['done', 'done', 'failed', 'idle']
  }
}

function StepBubble({ state, index }: { state: StepState; index: number }) {
  const base =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300'
  if (state === 'done')
    return <span className={`${base} border-transparent bg-(--accent) text-white`}><Check size={13} strokeWidth={3} aria-hidden /></span>
  if (state === 'active')
    return <span className={`${base} border-(--accent) bg-(--accent)/12 text-(--accent)`}><Loader2 size={14} className="animate-spin" aria-hidden /></span>
  if (state === 'failed')
    return <span className={`${base} border-red-500 bg-red-500/10 text-red-400`}><X size={13} aria-hidden /></span>
  if (state === 'warning')
    return <span className={`${base} border-amber-400 bg-amber-400/10 text-amber-400`}><AlertCircle size={13} aria-hidden /></span>
  return <span className={`${base} border-(--border-subtle) bg-(--surface-2) text-(--fg-faint)`}>{index + 1}</span>
}

function labelClass(s: StepState): string {
  return s === 'done' ? 'text-(--fg-muted)' : s === 'active' ? 'text-(--fg)' : s === 'failed' ? 'text-red-400' : s === 'warning' ? 'text-amber-400' : 'text-(--fg-faint)'
}
function connectorClass(s: StepState): string { return s === 'done' ? 'bg-(--accent)/40' : 'bg-(--border-subtle)' }

function RegenProgress({
  phase, isVideo, hardCapped, onRetry, onEdit,
}: {
  phase: RegenPhase; isVideo: boolean; hardCapped: boolean; onRetry: () => void; onEdit: () => void
}) {
  const states = deriveStepStates(phase)
  const contentLabel = isVideo ? 'video' : 'image'
  const currentStep = phase.kind === 'generating' ? phase.currentStep : null
  // Real B03 step label when available; otherwise the generic content label.
  const stepDetail = (currentStep && stepDetailMap[currentStep]) || `${contentLabel}…`

  return (
    <div className="space-y-3">
      {/* ── Horizontal step track ─────────────────────────────────────── */}
      <div className="flex items-start">
        {stepLabels.map((label, i) => {
          const st = states[i] as StepState
          const isLast = i === stepLabels.length - 1
          return (
            <Fragment key={label}>
              {/* Bubble + label stacked vertically, centred under their bubble */}
              <div className="flex shrink-0 flex-col items-center gap-2">
                <StepBubble state={st} index={i} />
                <div className="flex flex-col items-center gap-0.5 px-1">
                  <span className={`max-w-[72px] text-center text-[10px] font-medium leading-tight ${labelClass(st)}`}>
                    {label}
                  </span>
                  {i === 2 && st === 'active' && (
                    <span className="animate-pulse text-center text-[9px] text-(--fg-muted)">
                      {stepDetail}
                    </span>
                  )}
                </div>
              </div>
              {/* Horizontal connector — vertically centred relative to the h-8 bubble */}
              {!isLast && (
                <div
                  className={`mt-4 h-px min-w-[12px] flex-1 transition-colors duration-500 ${connectorClass(st)}`}
                />
              )}
            </Fragment>
          )
        })}
      </div>

      {/* ── Status messages ───────────────────────────────────────────── */}
      {hardCapped && phase.kind === 'generating' && (
        <div className="flex items-start gap-2 rounded-(--r-md) border border-(--warning)/30 bg-(--warning)/10 px-3 py-2.5 text-xs leading-relaxed text-(--fg-muted)">
          <Clock size={14} className="mt-0.5 shrink-0 text-(--warning)" aria-hidden />
          <span>Taking longer than expected — generation continues in the background. Refresh later.</span>
        </div>
      )}

      {(phase.kind === 'failed' || phase.kind === 'rejected') && (
        <div className="space-y-3 rounded-(--r-md) border border-red-500/30 bg-red-500/10 px-3 py-3">
          <div className="flex items-start gap-2 text-xs leading-relaxed text-red-400">
            <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>{phase.message}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onEdit} leadingIcon={<Sparkles size={13} aria-hidden />}>Edit Prompt</Button>
            <Button variant="secondary" size="sm" onClick={onRetry} leadingIcon={<RefreshCw size={13} aria-hidden />}>Try Again</Button>
          </div>
        </div>
      )}

      {phase.kind === 'held' && (
        <div className="flex items-start gap-2 rounded-(--r-md) border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-relaxed text-amber-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>{phase.message}</span>
        </div>
      )}

      {phase.kind === 'success' && (
        <div className="flex items-start gap-2 rounded-(--r-md) border border-(--accent)/30 bg-(--accent-soft) px-3 py-2.5 text-xs leading-relaxed text-(--fg)">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-(--accent)" aria-hidden />
          <span>New draft is ready — refreshing…</span>
        </div>
      )}
    </div>
  )
}


/**
 * Admin Regenerate — opens the prompt modal (empty fields so admin writes a
 * fresh directive), triggers N8N-B03 with target:'admin'. Chain selection
 * follows the same A01 rules — CEO → COO → DeepSeek decide from 26 families /
 * 88 chains automatically. No model picker exposed here.
 *
 * The result lands in the admin_regenerations draft lane (hidden from clients)
 * and surfaces below the card via <AdminRegenHistory>.
 */
export function AdminRegenerateButton({
  postId, requestId, brandId, mediaType, label, previousPrompt, currentImageUrl,
}: AdminRegenerateButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [phase, setPhase] = useState<RegenPhase>({ kind: 'idle' })
  const [hardCapped, setHardCapped] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [showOldPrompt, setShowOldPrompt] = useState(false)

  // Single instruction field — plain language correction directive
  const [instruction, setInstruction] = useState('')
  const INSTRUCTION_MAX = 1000

  const overrideRef = useRef<AdminRegeneratePromptOverride | undefined>(undefined)

  const isVideo = mediaType === 'video'
  const contentLabel = isVideo ? 'video' : 'image'
  const isActive = phase.kind === 'queueing' || phase.kind === 'generating'
  const isLoading = pending || isActive

  // Detect if instruction asks to switch media type — not allowed.
  const VIDEO_WORDS = /\b(video|reel|animation|animate|mp4|moving|motion)\b/i
  const IMAGE_WORDS = /\b(image|photo|picture|still|static|jpeg|jpg|png)\b/i
  const mediaTypeSwitchError = isVideo
    ? (IMAGE_WORDS.test(instruction) ? `This is a video post — you cannot switch it to an image. Change the visual style instead.` : null)
    : (VIDEO_WORDS.test(instruction) ? `This is an image post — you cannot switch it to a video. Change the visual style instead.` : null)

  const canGenerate = instruction.length <= INSTRUCTION_MAX && !mediaTypeSwitchError
  const hasOldPrompt = !!previousPrompt?.trim()

  function openModal() {
    setInstruction('')
    setShowOldPrompt(false)
    setModalOpen(true)
  }
  function closeModal() { if (!isLoading) setModalOpen(false) }

  function runGeneration(override: AdminRegeneratePromptOverride | undefined) {
    overrideRef.current = override
    setHardCapped(false)
    setPhase({ kind: 'queueing' })
    startTransition(async () => {
      setPhase({ kind: 'generating', currentStep: null })
      const res = await requestAdminRegenerate({ postId, requestId, brandId, promptOverride: override, imageModel: 'auto' })
      if (res.ok) {
        setPhase({ kind: 'success' })
        setTimeout(() => router.refresh(), 1500)
      } else if (res.status === 'held') {
        setPhase({ kind: 'held', message: res.message ?? 'Regeneration was held by the quality gate.' })
      } else if (res.status === 'rejected') {
        setPhase({ kind: 'rejected', message: res.message ?? 'Regeneration was blocked by the brand-safety gate.' })
      } else {
        setPhase({ kind: 'failed', message: res.message ?? res.error ?? 'Regeneration failed. Please try again.' })
      }
    })
  }

  function startGeneration() {
    setModalOpen(false)
    const override: AdminRegeneratePromptOverride | undefined = instruction.trim()
      ? { special_instructions: instruction.trim() }
      : undefined
    runGeneration(override)
  }

  function handleRetry() { runGeneration(overrideRef.current) }
  function handleEdit() {
    setInstruction(overrideRef.current?.special_instructions ?? '')
    setShowOldPrompt(false)
    setPhase({ kind: 'idle' })
    setHardCapped(false)
    setModalOpen(true)
  }

  // Escape + scroll lock while modal is open.
  useEffect(() => {
    if (!modalOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closeModal() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, isLoading])

  // Hard-cap banner while generating (same thresholds as user side).
  const isGenerating = phase.kind === 'generating'
  useEffect(() => {
    if (!isGenerating) return
    const cap = isVideo ? HARD_CAP_VIDEO_MS : HARD_CAP_IMAGE_MS
    const t = setTimeout(() => setHardCapped(true), cap)
    return () => clearTimeout(t)
  }, [isGenerating, isVideo])

  // Live step polling — runs concurrently with the (synchronous) B03 request and
  // reflects the REAL pipeline step (on_demand_requests.current_step, written by
  // B03). Only possible for posts that have a request_id; otherwise the generic
  // "Running AI generation" label stays. The final outcome still comes from the
  // awaited action result, not this poll.
  useEffect(() => {
    if (!isGenerating || !requestId) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/on-demand/${requestId}/status`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { current_step?: string | null }
        if (cancelled) return
        setPhase((prev) =>
          prev.kind === 'generating'
            ? { kind: 'generating', currentStep: data.current_step ?? null }
            : prev,
        )
      } catch {
        // Transient — keep polling.
      }
    }
    poll()
    const id = setInterval(poll, 2500)
    return () => { cancelled = true; clearInterval(id) }
  }, [isGenerating, requestId])

  const showTrigger = phase.kind === 'idle' || phase.kind === 'held' || phase.kind === 'rejected' || phase.kind === 'failed'

  return (
    <>
      <div className="flex flex-col gap-3">

        {/* ── Idle / error / held — show trigger button ── */}
        {showTrigger && phase.kind === 'idle' && (
          <button
            type="button"
            onClick={openModal}
            className="group w-full flex items-center justify-center gap-2.5 rounded-xl border border-(--border-subtle) bg-(--surface-1) hover:bg-(--surface-3) hover:border-(--accent)/40 transition-all duration-200 px-4 py-3"
          >
            <RefreshCw size={15} className="text-(--fg-muted) group-hover:text-(--accent) transition-colors" aria-hidden />
            <span className="text-sm font-semibold text-(--fg-muted) group-hover:text-(--fg) transition-colors">{label}</span>
          </button>
        )}

        {/* ── Active — compact inline progress bar (same height as idle button) ── */}
        {(phase.kind === 'queueing' || phase.kind === 'generating') && (
          <div className="w-full flex flex-col gap-1.5 rounded-xl border border-(--accent)/25 bg-(--accent)/5 px-4 py-3 overflow-hidden">
            {/* Top row: spinner + label + dots */}
            <div className="flex items-center gap-3">
              <div className="relative h-5 w-5 shrink-0">
                <svg className="absolute inset-0 animate-spin" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2.5" className="text-(--border-subtle)" />
                  <path d="M10 3 a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-(--accent)" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-(--fg) leading-none">
                  {phase.kind === 'queueing' ? 'Queueing request…' : `Generating ${contentLabel}…`}
                </p>
                <p className="mt-0.5 text-xs text-(--fg-faint)">
                  {phase.kind === 'queueing' ? 'Sending to pipeline' : isVideo ? 'Video takes ~2–4 min' : 'Usually under 30 s'}
                </p>
              </div>
              {/* Step dots */}
              <div className="flex items-center gap-1 shrink-0">
                {(['queueing', 'generating', 'saving'] as const).map((s, i) => {
                  const done = (phase.kind === 'generating' && i === 0) || ((phase as { kind: string }).kind === 'success' && i <= 1)
                  const active = (phase.kind === 'queueing' && i === 0) || (phase.kind === 'generating' && i === 1)
                  return (
                    <span
                      key={s}
                      className={[
                        'h-1.5 rounded-full transition-all duration-500',
                        active ? 'w-4 bg-(--accent)' : done ? 'w-1.5 bg-(--accent)/50' : 'w-1.5 bg-(--border-subtle)',
                      ].join(' ')}
                    />
                  )
                })}
              </div>
            </div>
            {/* Animated progress bar */}
            <div className="h-0.5 w-full rounded-full bg-(--border-subtle) overflow-hidden">
              <div className={[
                'h-full rounded-full bg-(--accent) transition-all duration-700',
                phase.kind === 'queueing' ? 'w-1/4' : 'w-3/4',
              ].join(' ')} />
            </div>
          </div>
        )}

        {/* ── Success ── */}
        {phase.kind === 'success' && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3 flex items-center gap-3">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-400" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-emerald-400">Draft ready</p>
              <p className="text-xs text-(--fg-faint)">Refreshing page…</p>
            </div>
          </div>
        )}

        {/* ── Failed / rejected / held — error card + actions ── */}
        {(phase.kind === 'failed' || phase.kind === 'rejected' || phase.kind === 'held') && (
          <div className={[
            'rounded-xl border px-4 py-3 space-y-3',
            phase.kind === 'held' ? 'border-amber-400/30 bg-amber-400/8' : 'border-red-500/30 bg-red-500/8',
          ].join(' ')}>
            <div className="flex items-start gap-2.5">
              <AlertCircle size={15} className={`mt-0.5 shrink-0 ${phase.kind === 'held' ? 'text-amber-400' : 'text-red-400'}`} aria-hidden />
              <div className="min-w-0">
                <p className={`text-xs font-semibold ${phase.kind === 'held' ? 'text-amber-400' : 'text-red-400'}`}>
                  {phase.kind === 'held' ? 'Held by quality gate' : 'Generation failed'}
                </p>
                <p className="mt-0.5 text-xs text-(--fg-muted) leading-relaxed">{(phase as { message?: string }).message}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleEdit} leadingIcon={<Sparkles size={12} aria-hidden />}>Edit & Retry</Button>
              <Button variant="secondary" size="sm" onClick={handleRetry} leadingIcon={<RefreshCw size={12} aria-hidden />}>Retry</Button>
            </div>
          </div>
        )}

        {/* ── Step pipeline — only shown during active/error states ── */}
        {(phase.kind === 'failed' || phase.kind === 'rejected') && (
          <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) p-4">
            <RegenProgress phase={phase} isVideo={isVideo} hardCapped={hardCapped} onRetry={handleRetry} onEdit={handleEdit} />
          </div>
        )}
      </div>

      {modalOpen && typeof document !== 'undefined' && createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="admin-regen-title" className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={closeModal} aria-hidden="true" />
          <div className="relative w-full sm:max-w-2xl max-h-[92dvh] flex flex-col rounded-t-(--r-xl) sm:rounded-(--r-xl) border border-(--border-subtle) bg-(--surface-1) shadow-2xl overflow-hidden">
            <div className="h-1 w-full bg-(--accent)" />
            <div className="flex items-center justify-between gap-4 border-b border-(--border-subtle) px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-(--accent)/10 text-(--accent)"><RefreshCw className="h-4 w-4" aria-hidden /></span>
                <div>
                  <h2 id="admin-regen-title" className="text-base font-semibold text-(--fg)">Regenerate {contentLabel}</h2>
                  <p className="text-xs text-(--fg-muted)">Admin draft — hidden from client until approved</p>
                </div>
              </div>
              <button type="button" onClick={closeModal} disabled={isLoading} aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-(--r-md) text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) disabled:pointer-events-none disabled:opacity-50">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Current post thumbnail — so admin sees what they're correcting */}
              {currentImageUrl && (
                <div className="flex items-start gap-4 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) p-3">
                  {isVideo ? (
                    <video
                      src={currentImageUrl}
                      muted
                      loop
                      playsInline
                      autoPlay
                      className="h-20 w-20 shrink-0 rounded-(--r-sm) object-cover bg-black"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={currentImageUrl}
                      alt="Current post"
                      className="h-20 w-20 shrink-0 rounded-(--r-sm) object-cover bg-(--surface-3)"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-(--fg)">Current {contentLabel}</p>
                    <p className="mt-0.5 text-xs text-(--fg-muted) leading-relaxed">
                      Describe what the pipeline should change — caption is regenerated automatically alongside the new visual.
                    </p>
                  </div>
                </div>
              )}

              {/* Single instruction field */}
              <div className="space-y-1.5">
                <label htmlFor="admin-regen-instruction" className="text-sm font-semibold text-(--fg)">
                  What should change?
                </label>
                <p className="text-xs text-(--fg-muted)">
                  Describe in plain language what you want different — the pipeline  handles everything else. Leave blank to regenerate with the same brief.
                </p>
                <textarea
                  id="admin-regen-instruction"
                  dir="ltr"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={4}
                  placeholder="e.g. The product should be more prominent, use a cleaner background, remove any text-like shapes…"
                  className={[
                    'w-full resize-y rounded-(--r-md) border bg-(--surface-3) px-3 py-2.5 text-sm text-(--fg)',
                    'placeholder:text-(--fg-muted)/50 focus:outline-none focus:ring-2',
                    (instruction.length > INSTRUCTION_MAX || mediaTypeSwitchError)
                      ? 'border-(--danger)/60 focus:ring-(--danger)/30'
                      : 'border-(--border-subtle) focus:ring-(--accent)/30',
                  ].join(' ')}
                />
                {mediaTypeSwitchError && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="shrink-0"><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 8v4m0 4h.01"/></svg>
                    {mediaTypeSwitchError}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-(--danger)">
                    {instruction.length > INSTRUCTION_MAX ? `Exceeds ${INSTRUCTION_MAX} character limit.` : ''}
                  </span>
                  <span className={`text-xs tabular-nums ${instruction.length > INSTRUCTION_MAX ? 'text-(--danger)' : 'text-(--fg-faint)'}`}>
                    {instruction.length} / {INSTRUCTION_MAX}
                  </span>
                </div>
              </div>

              {/* Previous generation prompt — collapsible read-only reference */}
              {hasOldPrompt && (
                <div className="rounded-(--r-md) border border-(--border-subtle) overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowOldPrompt((v) => !v)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-(--surface-2) hover:bg-(--surface-3) transition-colors text-left"
                  >
                    <span className="text-xs font-medium text-(--fg-muted)">Previous generation prompt (reference)</span>
                    <svg
                      className={`w-3.5 h-3.5 text-(--fg-faint) transition-transform duration-200 ${showOldPrompt ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showOldPrompt && (
                    <div className="px-4 py-3 bg-(--surface-3)/40">
                      <p className="text-sm text-(--fg) leading-relaxed whitespace-pre-wrap">{previousPrompt}</p>
                    </div>
                  )}
                </div>
              )}

              <p className="text-[11px] text-(--fg-faint) leading-relaxed">
                Write in English — Arabic caption and text overlay are applied automatically after generation.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-(--border-subtle) px-6 py-4">
              <Button variant="ghost" onClick={closeModal} disabled={isLoading}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!canGenerate || isLoading}
                onClick={startGeneration}
                leadingIcon={<RefreshCw size={14} aria-hidden />}
              >
                Generate
              </Button>
            </div>
          </div>
        </div>
      , document.body)}
    </>
  )
}
