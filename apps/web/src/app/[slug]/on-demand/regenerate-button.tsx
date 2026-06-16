'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Check,
  Sparkles,
  X,
  Clock,
  Zap,
} from '@repo/ui/icons'
import {
  requestRegenerate,
  getPostRevisionState,
  type RegeneratePromptOverride,
} from './actions'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_REVISIONS = 3
const POLL_INTERVAL_MS = 2500
const HARD_CAP_IMAGE_MS = 120000
const HARD_CAP_VIDEO_MS = 300000
// Single free-text prompt — B03's CEO picks the chain + model automatically from
// the prompt, so the user only provides one prompt (no style/concept split).
const PROMPT_MAX = 5000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type StepState = 'idle' | 'active' | 'done' | 'failed' | 'warning'

type RegenPhase =
  | { kind: 'idle' }
  | { kind: 'queueing' }
  | { kind: 'generating'; currentStep: string | null }
  | { kind: 'success' }
  | { kind: 'held' }
  | { kind: 'failed'; message: string }

export interface RegenerateButtonProps {
  slug: string
  requestId: string | null
  postId: string
  brandId: string
  revisionCount: number
  /** The actual prompt that generated the current image — shown as read-only reference */
  previousPrompt?: string | null
  /** Current post image URL — shown as a thumbnail in the modal so the user knows what they're correcting */
  currentImageUrl?: string | null
  isVideo?: boolean
  onRegenStart?: (postId: string) => void
  onRegenEnd?: (postId: string) => void
}

type ModalStep = 'choose' | 'editing'

// ---------------------------------------------------------------------------
// Step configuration
// ---------------------------------------------------------------------------
const stepLabels = [
  'Queuing request',
  'Connecting to pipeline',
  'Running AI generation',
  'Saving output',
]

const stepDetailMap: Record<string, string> = {
  ceo: 'Analysing brand context…',
  coo: 'Building caption context…',
  caption: 'Generating Arabic caption…',
  qc: 'Running quality checks…',
  image: 'Creating the image…',
  video: 'Generating video…',
  upload: 'Uploading to your library…',
}

function deriveStepStates(phase: RegenPhase): [StepState, StepState, StepState, StepState] {
  switch (phase.kind) {
    case 'idle':
      return ['idle', 'idle', 'idle', 'idle']
    case 'queueing':
      return ['active', 'idle', 'idle', 'idle']
    case 'generating': {
      const step = phase.currentStep
      if (!step) return ['done', 'active', 'idle', 'idle']
      if (step === 'upload') return ['done', 'done', 'done', 'active']
      return ['done', 'done', 'active', 'idle']
    }
    case 'success':
      return ['done', 'done', 'done', 'done']
    case 'held':
      return ['done', 'done', 'warning', 'idle']
    case 'failed':
      return ['done', 'done', 'failed', 'idle']
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepBubble({ state, index }: { state: StepState; index: number }) {
  const base =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300'

  if (state === 'done') {
    return (
      <span className={`${base} border-transparent bg-(--accent) text-white`}>
        <Check size={13} strokeWidth={3} aria-hidden />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className={`${base} border-(--accent) bg-(--accent)/12 text-(--accent)`}>
        <Loader2 size={14} className="animate-spin" aria-hidden />
      </span>
    )
  }
  if (state === 'failed') {
    return (
      <span className={`${base} border-red-500 bg-red-500/10 text-red-400`}>
        <X size={13} aria-hidden />
      </span>
    )
  }
  if (state === 'warning') {
    return (
      <span className={`${base} border-amber-400 bg-amber-400/10 text-amber-400`}>
        <AlertCircle size={13} aria-hidden />
      </span>
    )
  }
  return (
    <span className={`${base} border-(--border-subtle) bg-(--surface-2) text-(--fg-faint)`}>
      {index + 1}
    </span>
  )
}

function labelClass(state: StepState): string {
  switch (state) {
    case 'done':
      return 'text-(--fg-muted)'
    case 'active':
      return 'text-(--fg)'
    case 'failed':
      return 'text-red-400'
    case 'warning':
      return 'text-amber-400'
    default:
      return 'text-(--fg-faint)'
  }
}

function connectorClass(state: StepState): string {
  return state === 'done' ? 'bg-(--accent)/40' : 'bg-(--border-subtle)'
}

interface RegenProgressProps {
  phase: RegenPhase
  isVideo: boolean
  hardCapped: boolean
  onRetry: () => void
  onEdit: () => void
  slug: string
}

function RegenProgress({ phase, isVideo, hardCapped, onRetry, onEdit, slug }: RegenProgressProps) {
  const states = deriveStepStates(phase)
  const contentLabel = isVideo ? 'video' : 'image'
  const currentStep =
    phase.kind === 'generating' ? (phase.currentStep ?? null) : null
  const stepDetail = currentStep ? stepDetailMap[currentStep] : null

  return (
    <div className="space-y-4">
      {/* Vertical step list */}
      <div className="flex flex-col gap-0">
        {stepLabels.map((label, i) => {
          const st = states[i] as StepState
          const isLast = i === stepLabels.length - 1
          return (
            <div key={label} className="flex gap-3.5">
              {/* Left column: bubble + connector */}
              <div className="flex flex-col items-center">
                <StepBubble state={st} index={i} />
                {!isLast && (
                  <div
                    className={`mt-1 mb-1 w-px flex-1 transition-colors duration-500 ${connectorClass(st)}`}
                    style={{ minHeight: '1.5rem' }}
                  />
                )}
              </div>

              {/* Right column: label + optional sub-detail */}
              <div className="flex flex-col justify-start pb-5 pt-1">
                <span className={`text-sm font-medium leading-none ${labelClass(st)}`}>
                  {label}
                </span>
                {i === 2 && st === 'active' && stepDetail && (
                  <span className="mt-1 animate-pulse text-xs text-(--fg-muted)">
                    {stepDetail}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Hard cap banner */}
      {hardCapped && phase.kind === 'generating' && (
        <div className="flex items-start gap-2 rounded-(--r-md) border border-(--warning)/30 bg-(--warning)/10 px-3 py-2.5 text-xs leading-relaxed text-(--fg-muted)">
          <Clock size={14} className="mt-0.5 shrink-0 text-(--warning)" aria-hidden />
          <span>
            This is taking longer than expected.{' '}
            <a
              href={`/${slug}/on-demand`}
              className="underline underline-offset-2 hover:text-(--fg)"
            >
              Return to on-demand list
            </a>{' '}
            — generation will continue in the background.
          </span>
        </div>
      )}

      {/* Failed banner */}
      {phase.kind === 'failed' && (
        <div className="space-y-3 rounded-(--r-md) border border-red-500/30 bg-red-500/10 px-3 py-3">
          <div className="flex items-start gap-2 text-xs leading-relaxed text-red-400">
            <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>{phase.message}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              leadingIcon={<Sparkles size={13} aria-hidden />}
            >
              Edit Prompt
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRetry}
              leadingIcon={<RefreshCw size={13} aria-hidden />}
            >
              Try Again
            </Button>
          </div>
        </div>
      )}

      {/* Held banner */}
      {phase.kind === 'held' && (
        <div className="flex items-start gap-2 rounded-(--r-md) border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-relaxed text-amber-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            This regeneration was sent for admin review and cannot be published yet. Check back
            later.
          </span>
        </div>
      )}

      {/* Success banner */}
      {phase.kind === 'success' && (
        <div className="flex items-start gap-2 rounded-(--r-md) border border-(--accent)/30 bg-(--accent-soft) px-3 py-2.5 text-xs leading-relaxed text-(--fg)">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-(--accent)" aria-hidden />
          <span>New {contentLabel} is ready — refreshing page…</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RegenerateButton({
  slug,
  requestId,
  postId,
  brandId,
  revisionCount,
  previousPrompt,
  currentImageUrl,
  isVideo = false,
  onRegenStart,
  onRegenEnd,
}: RegenerateButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [regenPhase, setRegenPhase] = useState<RegenPhase>({ kind: 'idle' })
  const [hardCapped, setHardCapped] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [step, setStep] = useState<ModalStep>('choose')

  const [editPrompt, setEditPrompt] = useState(previousPrompt ?? '')

  const overrideRef = useRef<RegeneratePromptOverride | undefined>(undefined)
  const baseCountRef = useRef<number>(revisionCount)

  const atLimit = revisionCount >= MAX_REVISIONS
  const remaining = Math.max(0, MAX_REVISIONS - revisionCount)
  const contentLabel = isVideo ? 'video' : 'image'
  const isActive = regenPhase.kind === 'queueing' || regenPhase.kind === 'generating'
  const isLoading = pending || isActive

  const canGenerate =
    editPrompt.trim().length > 0 && editPrompt.length <= PROMPT_MAX

  // ---------------------------------------------------------------------------
  // Modal helpers
  // ---------------------------------------------------------------------------
  function openModal() {
    setEditPrompt(previousPrompt ?? '')
    setStep('choose')
    setModalOpen(true)
  }

  function closeModal() {
    if (isLoading) return
    setModalOpen(false)
  }

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------
  function startGeneration() {
    setModalOpen(false)
    setHardCapped(false)

    const override: RegeneratePromptOverride | undefined = editPrompt.trim()
      ? { hero_concept: editPrompt.trim() }
      : undefined

    overrideRef.current = override
    baseCountRef.current = revisionCount
    setRegenPhase({ kind: 'queueing' })
    onRegenStart?.(postId)

    startTransition(async () => {
      const res = await requestRegenerate(slug, requestId, postId, brandId, override)
      if (res.ok) {
        setRegenPhase({ kind: 'generating', currentStep: null })
      } else if (res.status === 'held') {
        setRegenPhase({ kind: 'held' })
        onRegenEnd?.(postId)
      } else {
        setRegenPhase({ kind: 'failed', message: res.message ?? 'Something went wrong.' })
        onRegenEnd?.(postId)
      }
    })
  }

  function handleRetry() {
    setHardCapped(false)
    setRegenPhase({ kind: 'queueing' })
    const prev = overrideRef.current
    startTransition(async () => {
      const res = await requestRegenerate(slug, requestId, postId, brandId, prev)
      if (res.ok) {
        setRegenPhase({ kind: 'generating', currentStep: null })
      } else if (res.status === 'held') {
        setRegenPhase({ kind: 'held' })
      } else {
        setRegenPhase({ kind: 'failed', message: res.message ?? 'Something went wrong.' })
      }
    })
  }

  function handleEdit() {
    const prev = overrideRef.current
    setEditPrompt(prev?.hero_concept ?? previousPrompt ?? '')
    setStep('editing')
    setRegenPhase({ kind: 'idle' })
    setHardCapped(false)
    setModalOpen(true)
  }

  // ---------------------------------------------------------------------------
  // Effect 1: keyboard (Escape) + body scroll lock
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!modalOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal()
    }

    document.addEventListener('keydown', handleKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, isLoading])

  // ---------------------------------------------------------------------------
  // Effect 2: dual polling — status API + revision count
  // ---------------------------------------------------------------------------
  const isGenerating = regenPhase.kind === 'generating'

  useEffect(() => {
    if (!isGenerating) return

    const capMs = isVideo ? HARD_CAP_VIDEO_MS : HARD_CAP_IMAGE_MS
    const capTimer = setTimeout(() => setHardCapped(true), capMs)

    let intervalId: ReturnType<typeof setInterval>

    const poll = async () => {
      // 1. Status API for current_step display (only when requestId is known)
      if (requestId) {
        try {
          const res = await fetch(`/api/posts/on-demand/${requestId}/status`)
          if (res.ok) {
            const data = (await res.json()) as { current_step?: string | null }
            setRegenPhase((prev) =>
              prev.kind === 'generating'
                ? { kind: 'generating', currentStep: data.current_step ?? null }
                : prev,
            )
          }
        } catch {
          // Transient network error — keep polling.
        }
      }

      // 2. Revision count for completion signal
      try {
        const state = await getPostRevisionState(postId)
        if (state && state.revisionCount > baseCountRef.current) {
          clearInterval(intervalId)
          clearTimeout(capTimer)
          setHardCapped(false)
          setRegenPhase({ kind: 'success' })
          onRegenEnd?.(postId)
          setTimeout(() => router.refresh(), 1800)
        }
      } catch {
        // Transient error — keep polling.
      }
    }

    poll()
    intervalId = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      clearInterval(intervalId)
      clearTimeout(capTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating])

  // ---------------------------------------------------------------------------
  // Render — at limit
  // ---------------------------------------------------------------------------
  if (atLimit) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-(--r-sm) border border-(--warning)/30 bg-(--warning)/10 px-3 py-2.5 text-xs leading-relaxed text-(--fg-muted)"
      >
        <AlertCircle size={14} className="mt-0.5 shrink-0 text-(--warning)" aria-hidden />
        <span>Maximum {MAX_REVISIONS} regenerations reached for this post.</span>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render — trigger area + modal
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Trigger area */}
      <div className="flex flex-col items-stretch gap-3">
        {(regenPhase.kind === 'idle' ||
          regenPhase.kind === 'failed' ||
          regenPhase.kind === 'held') && (
          <>
            <Button
              variant="secondary"
              onClick={openModal}
              leadingIcon={<RefreshCw className="h-4 w-4" aria-hidden />}
            >
              Regenerate
            </Button>
            <p className="text-center text-[11px] text-(--fg-muted)">
              {remaining} of {MAX_REVISIONS} regeneration{remaining !== 1 ? 's' : ''} remaining
            </p>
          </>
        )}

        {(regenPhase.kind === 'queueing' ||
          regenPhase.kind === 'generating' ||
          regenPhase.kind === 'success') && (
          <Button
            variant="secondary"
            disabled
            leadingIcon={<Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          >
            {regenPhase.kind === 'queueing' ? 'Queueing…' : 'Generating…'}
          </Button>
        )}

        {regenPhase.kind !== 'idle' && (
          <RegenProgress
            phase={regenPhase}
            isVideo={isVideo}
            hardCapped={hardCapped}
            onRetry={handleRetry}
            onEdit={handleEdit}
            slug={slug}
          />
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="regen-modal-title"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={closeModal}
            aria-hidden="true"
          />

          {/* Modal card */}
          <div className="relative w-full sm:max-w-2xl max-h-[92dvh] flex flex-col rounded-t-(--r-xl) sm:rounded-(--r-xl) border border-(--border-subtle) bg-(--surface-1) shadow-2xl overflow-hidden">
            {/* Top accent stripe */}
            <div className="h-1 w-full bg-(--accent)" />

            {/* Header */}
            <div className="flex items-center justify-between gap-4 border-b border-(--border-subtle) px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-(--accent)/10 text-(--accent)">
                  <RefreshCw className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <h2 id="regen-modal-title" className="text-base font-semibold text-(--fg)">
                    Regenerate {contentLabel}
                  </h2>
                  <p className="text-xs text-(--fg-muted)">
                    {remaining} revision{remaining !== 1 ? 's' : ''} remaining
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isLoading}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-(--r-md) text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-6">
              {step === 'choose' ? (
                <div className="space-y-6">
                  {/* Current post thumbnail */}
                  {currentImageUrl && (
                    <div className="flex items-start gap-4 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) p-3">
                      {isVideo ? (
                        <video src={currentImageUrl} muted loop playsInline autoPlay className="h-20 w-20 shrink-0 rounded-(--r-sm) object-cover bg-black" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={currentImageUrl} alt="Current post" className="h-20 w-20 shrink-0 rounded-(--r-sm) object-cover bg-(--surface-3)" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-(--fg)">Current {contentLabel}</p>
                        <p className="mt-0.5 text-xs text-(--fg-muted) leading-relaxed">Choose to regenerate with the same brief, or edit the prompt to steer toward a different result.</p>
                      </div>
                    </div>
                  )}

                  {/* Options */}
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-(--fg)">Choose an option</h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <OptionCard
                        icon={<Zap className="h-5 w-5" aria-hidden />}
                        title="Use Existing Prompt"
                        description="Regenerate immediately using the same prompts. No editing needed."
                        onClick={() => startGeneration()}
                      />
                      <OptionCard
                        icon={<Sparkles className="h-5 w-5" aria-hidden />}
                        title="Edit & Regenerate"
                        description="Modify prompts to guide the AI toward a different result."
                        onClick={() => setStep('editing')}
                      />
                    </div>
                  </section>
                </div>
              ) : (
                <div className="space-y-5">
                  <button type="button" onClick={() => setStep('choose')}
                    className="flex items-center gap-1.5 rounded-(--r-sm) text-sm text-(--fg-muted) hover:text-(--fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
                    Back
                  </button>

                  <PromptTextarea
                    id="edit-prompt"
                    label="Prompt"
                    hint="Describe what you want to generate. The system picks the best chain and model automatically from your prompt. English only."
                    value={editPrompt}
                    onChange={setEditPrompt}
                    maxLength={PROMPT_MAX}
                    required
                  />

                  <p className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3)/50 px-3 py-2 text-xs text-(--fg-muted)">
                    All prompts must be in English — Arabic overlay is applied automatically after generation.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-(--border-subtle) px-6 py-4">
              <Button variant="ghost" onClick={closeModal} disabled={isLoading}>
                Cancel
              </Button>
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
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Helper sub-components
// ---------------------------------------------------------------------------

function OptionCard({
  icon, title, description, onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) p-4 text-left transition-colors hover:border-(--accent)/40 hover:bg-(--surface-3) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
    >
      <span className="text-(--accent)">{icon}</span>
      <span className="text-sm font-semibold text-(--fg)">{title}</span>
      <span className="text-xs text-(--fg-muted) leading-relaxed">{description}</span>
    </button>
  )
}

function PromptRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-(--fg-faint) mb-1">{label}</p>
      <p className="text-sm text-(--fg) leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  )
}

function PromptTextarea({
  id, label, hint, value, onChange, maxLength, required,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  maxLength: number
  required?: boolean
}) {
  const over = value.length > maxLength
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-(--fg)">{label}</label>
      {hint && <p className="text-xs text-(--fg-muted)">{hint}</p>}
      <textarea
        id={id}
        dir="ltr"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        required={required}
        className={[
          'w-full resize-y rounded-(--r-md) border bg-(--surface-3) px-3 py-2.5 text-sm text-(--fg)',
          'placeholder:text-(--fg-muted)/50 focus:outline-none focus:ring-2',
          over ? 'border-(--danger)/60 focus:ring-(--danger)/30' : 'border-(--border-subtle) focus:ring-(--accent)/30',
        ].join(' ')}
      />
      <div className="flex justify-end">
        <span className={`text-xs tabular-nums ${over ? 'text-(--danger)' : 'text-(--fg-faint)'}`}>
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  )
}
