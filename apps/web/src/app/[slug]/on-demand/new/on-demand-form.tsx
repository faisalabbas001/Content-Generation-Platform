'use client'

/**
 * On-demand single-post form.
 *
 * The user supplies one thing: the image prompt (English, Hard Rule #3).
 * All other brief fields (platform, canvas, color, content_type, objective)
 * are derived from BrandDNA or defaulted for the CEO chain to refine.
 *
 * State machine:
 *   form  ──submit──►  submitting  ──202──►  polling  ──delivered──►  success
 *                                                 │
 *                                           failed/held/timedOut
 *
 * On failure the user stays on this page with their prompt intact.
 * "Try again" re-POSTs with the same text. "Edit prompt" returns to the form.
 *
 * Hard Rule #3: textarea is dir="ltr", English-only placeholder.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@repo/ui/button'
import { Field, Textarea } from '@repo/ui/input'
import { Sparkles, Check, X, AlertCircle, RefreshCw, Loader2, Clock, ImageIcon, Video } from '@repo/ui/icons'

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_CHARS       = 5000
const MIN_CHARS       = 10
const POLL_INTERVAL_MS = 2500
// Image finishes in ~1-2 min; the video chain (Flux keyframe → Kling animate)
// can take ~5 min, so the "still working" escape hatch appears later for video.
const HARD_CAP_IMAGE_MS = 120_000   // 2 minutes
const HARD_CAP_VIDEO_MS = 300_000   // 5 minutes

type MediaType = 'image' | 'video'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface OnDemandFormStrings {
  rule: string
  submit: string
  footer: string
  /** Image | Video output selector. Optional so older callers still compile. */
  mediaType?: {
    label: string
    image: string
    video: string
    imageDesc: string
    videoDesc: string
  }
  prompt: {
    label: string
    placeholder: string
    /** Placeholder shown when Video is selected (action/story-oriented). Optional. */
    videoPlaceholder?: string
    charLimit: string
    tooShort: string
    tooLong: string
  }
  processing: {
    title: string
    steps: {
      validating: string
      connecting: string
      generating: string
      finalizing: string
    }
    stepDetail: {
      ceo:     string
      coo:     string
      caption: string
      qc:      string
      image:   string
      upload:  string
    }
    held: string
    heldBackToList: string
    failed: string
    failureReasons: {
      auth: string
      timeout: string
      unreachable: string
      quality: string
      blocked: string
    }
    retry: string
    editPrompt: string
    successTitle: string
    successBody: string
    hint: string
    checkLater: string
    hardCapMessage: string
  }
}

interface Props {
  strings: OnDemandFormStrings
  clientSlug: string
  defaultPlatform: string | null
  defaultColorHex: string | null
}

type Phase =
  | { kind: 'form' }
  | { kind: 'submitting' }
  | { kind: 'polling'; requestId: string; currentStep: string | null }
  | { kind: 'held' }
  | { kind: 'failed'; message: string; detail?: string }
  | { kind: 'success'; requestId: string }

type StepState = 'idle' | 'active' | 'done' | 'failed' | 'warning'

// ── Helpers ───────────────────────────────────────────────────────────────────
function platformToCanvas(platform: string): 'ig_square' | 'ig_portrait' | 'ig_story' | 'snap' {
  return platform === 'Snapchat' ? 'snap' : 'ig_square'
}

/**
 * Translate a raw `failure_reason` from n8n/the backend into a calm, plain-
 * language message. The raw value is often technical — HTTP codes, HMAC
 * errors, JSON blobs (e.g. `401 - {"error":"bad_signature",...}`) — and must
 * never be shown verbatim to a brand user. We classify by keyword and fall
 * back to the generic "failed" copy. The original reason is preserved
 * separately (as `detail`) so support can still see it via a hover tooltip.
 */
function humanizeFailure(
  raw: string | null | undefined,
  f: OnDemandFormStrings['processing']['failureReasons'],
  fallback: string,
): string {
  if (!raw) return fallback
  const r = raw.toLowerCase()
  if (/bad_signature|hmac|unauthor|forbidden|\b401\b|\b403\b/.test(r)) return f.auth
  if (/timeout|timed.?out|etimedout|abort|deadline/.test(r))           return f.timeout
  if (/unreachable|econnrefused|fetch failed|network|\b50[234]\b|n8n_trigger/.test(r)) return f.unreachable
  if (/visual_qc|qc_fail|quality/.test(r))                             return f.quality
  if (/blocked|hard_block/.test(r))                                    return f.blocked
  return fallback
}

/**
 * Map the current phase + n8n currentStep to a visual state for each of the
 * 4 UI steps: 0=validating, 1=connecting, 2=generating, 3=finalizing.
 *
 * currentStep values from n8n (in order):
 *   ceo → coo → caption → qc → image → upload → (delivered by webhook)
 */
function stepStates(phase: Phase): [StepState, StepState, StepState, StepState] {
  switch (phase.kind) {
    case 'form':       return ['idle',   'idle',   'idle',    'idle']
    case 'submitting': return ['active', 'idle',   'idle',    'idle']
    case 'polling': {
      const step = phase.currentStep
      if (!step)             return ['done', 'active', 'idle',   'idle']
      if (step === 'upload') return ['done', 'done',   'done',   'active']
      return                        ['done', 'done',   'active', 'idle']
    }
    case 'success':    return ['done',   'done',   'done',    'done']
    case 'held':       return ['done',   'done',   'warning', 'idle']
    case 'failed':     return ['done',   'done',   'failed',  'idle']
  }
}

/** Returns the granular subtitle to show under the active step, or null. */
function activeDetail(
  phase: Phase,
  stepDetail: OnDemandFormStrings['processing']['stepDetail'],
): string | null {
  if (phase.kind !== 'polling') return null
  const step = phase.currentStep
  if (!step) return null
  return (stepDetail as Record<string, string>)[step] ?? null
}

// ── Step indicator bubble ─────────────────────────────────────────────────────
function StepBubble({ state, index }: { state: StepState; index: number }) {
  const base =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-300'

  if (state === 'done')
    return (
      <div className={`${base} border-transparent bg-(--accent) text-white`}>
        <Check size={13} strokeWidth={3} aria-hidden />
      </div>
    )
  if (state === 'active')
    return (
      <div className={`${base} border-(--accent) bg-(--accent)/12 text-(--accent)`}>
        <Loader2 size={14} className="animate-spin" aria-hidden />
      </div>
    )
  if (state === 'failed')
    return (
      <div className={`${base} border-red-500 bg-red-500/10 text-red-400`}>
        <X size={13} strokeWidth={3} aria-hidden />
      </div>
    )
  if (state === 'warning')
    return (
      <div className={`${base} border-amber-400 bg-amber-400/10 text-amber-400`}>
        <AlertCircle size={13} aria-hidden />
      </div>
    )
  // idle
  return (
    <div className={`${base} border-(--border-subtle) bg-(--surface-2) text-(--fg-faint)`}>
      {index + 1}
    </div>
  )
}

// ── Output type selector (Image | Video) ──────────────────────────────────────
function MediaTypeSelector({
  value,
  onChange,
  s,
}: {
  value: MediaType
  onChange: (v: MediaType) => void
  s: OnDemandFormStrings
}) {
  const m = s.mediaType
  const options: Array<{ key: MediaType; label: string; desc: string; Icon: typeof ImageIcon }> = [
    { key: 'image', label: m?.image ?? 'Image', desc: m?.imageDesc ?? 'A single still image post', Icon: ImageIcon },
    { key: 'video', label: m?.video ?? 'Video', desc: m?.videoDesc ?? 'A short animated video clip', Icon: Video },
  ]

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-(--fg)">{m?.label ?? 'Output type'}</p>
      <div role="radiogroup" aria-label={m?.label ?? 'Output type'} className="grid grid-cols-2 gap-2.5">
        {options.map(({ key, label, desc, Icon }) => {
          const selected = value === key
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(key)}
              className={`flex items-start gap-2.5 rounded-(--r-sm) border p-3 text-start transition-colors ${
                selected
                  ? 'border-(--accent) bg-(--accent)/8'
                  : 'border-(--border-subtle) bg-(--surface-2) hover:bg-(--surface)'
              }`}
            >
              <Icon
                size={18}
                className={`mt-0.5 shrink-0 ${selected ? 'text-(--accent)' : 'text-(--fg-muted)'}`}
                aria-hidden
              />
              <span>
                <span className={`block text-sm font-semibold ${selected ? 'text-(--accent)' : 'text-(--fg)'}`}>
                  {label}
                </span>
                <span className="block text-xs text-(--fg-muted)">{desc}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Processing steps panel ────────────────────────────────────────────────────
function ProcessingSteps({
  phase,
  s,
  hardCapped,
  clientSlug,
  onRetry,
  onEdit,
}: {
  phase: Phase
  s: OnDemandFormStrings
  hardCapped: boolean
  clientSlug: string
  onRetry: () => void
  onEdit: () => void
}) {
  const states  = stepStates(phase)
  const detail  = activeDetail(phase, s.processing.stepDetail)
  const stepLabels = [
    s.processing.steps.validating,
    s.processing.steps.connecting,
    s.processing.steps.generating,
    s.processing.steps.finalizing,
  ]

  return (
    <div className="space-y-5">
      {/* Steps list */}
      <div>
        {stepLabels.map((label, i) => {
          const st     = states[i]
          const isLast = i === stepLabels.length - 1
          const showDetail = st === 'active' && detail && i === 2   // detail only on generating step

          return (
            <div key={i} className="flex gap-3.5">
              {/* Bubble + connector line */}
              <div className="flex flex-col items-center">
                <StepBubble state={st} index={i} />
                {!isLast && (
                  <div
                    className={`mt-1 mb-1 w-px flex-1 transition-colors duration-500 ${
                      st === 'done' ? 'bg-(--accent)/40' : 'bg-(--border-subtle)'
                    }`}
                    style={{ minHeight: '1.5rem' }}
                  />
                )}
              </div>

              {/* Label + optional granular detail */}
              <div className={`pt-1 pb-5 ${isLast ? 'pb-0' : ''}`}>
                <p
                  className={`text-sm font-medium transition-colors duration-300 ${
                    st === 'done'
                      ? 'text-(--fg-muted)'
                      : st === 'active'
                      ? 'text-(--fg)'
                      : st === 'failed'
                      ? 'text-red-400'
                      : st === 'warning'
                      ? 'text-amber-400'
                      : 'text-(--fg-faint)'
                  }`}
                >
                  {label}
                  {st === 'active' && !showDetail && (
                    <span className="ms-2 text-(--fg-muted) font-normal text-xs">
                      {s.processing.hint}
                    </span>
                  )}
                </p>
                {showDetail && (
                  <p className="mt-0.5 text-xs text-(--fg-muted) animate-pulse">
                    {detail}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Hard-cap escape hatch — shown after 2 min while still polling */}
      {hardCapped && (phase.kind === 'polling' || phase.kind === 'submitting') && (
        <div className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-2) p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Clock size={15} className="mt-0.5 shrink-0 text-(--fg-muted)" aria-hidden />
            <p className="text-sm text-(--fg-muted)">{s.processing.hardCapMessage}</p>
          </div>
          <Link
            href={`/${clientSlug}/on-demand`}
            className="inline-flex items-center rounded-(--r-sm) border border-(--border) bg-(--surface) px-3 py-1.5 text-sm font-medium text-(--fg) hover:bg-(--surface-2) transition-colors"
          >
            {s.processing.checkLater}
          </Link>
        </div>
      )}

      {/* Status banners */}
      {phase.kind === 'failed' && (
        <div className="rounded-(--r-sm) border border-red-500/25 bg-red-500/8 p-4 space-y-3">
          <p className="text-sm text-red-400" title={phase.detail || undefined}>
            {phase.message || s.processing.failed}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onEdit}
            >
              {s.processing.editPrompt}
            </Button>
            <Button
              type="button"
              size="sm"
              leadingIcon={<RefreshCw size={13} />}
              onClick={onRetry}
            >
              {s.processing.retry}
            </Button>
          </div>
        </div>
      )}

      {phase.kind === 'held' && (
        <div className="rounded-(--r-sm) border border-amber-400/25 bg-amber-400/8 p-4 space-y-3">
          <p className="text-sm text-amber-400">{s.processing.held}</p>
          <Link
            href={`/${clientSlug}/on-demand`}
            className="inline-flex items-center gap-1.5 rounded-(--r-sm) border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-sm font-medium text-amber-400 hover:bg-amber-400/20 transition-colors"
          >
            {s.processing.heldBackToList}
          </Link>
        </div>
      )}

      {phase.kind === 'success' && (
        <div className="rounded-(--r-sm) border border-(--accent)/25 bg-(--accent)/8 p-4 space-y-1">
          <p className="text-sm font-semibold text-(--accent)">{s.processing.successTitle}</p>
          <p className="text-xs text-(--fg-muted)">{s.processing.successBody}</p>
        </div>
      )}
    </div>
  )
}

// ── Main form component ───────────────────────────────────────────────────────
export function OnDemandForm({ strings, clientSlug, defaultPlatform, defaultColorHex }: Props) {
  const router = useRouter()
  const s = strings

  // Controlled textarea — preserved across all phase transitions for retry/edit
  const [prompt, setPrompt]       = useState('')
  const [mediaType, setMediaType] = useState<MediaType>('image')
  const [phase, setPhase]         = useState<Phase>({ kind: 'form' })
  const [hardCapped, setHardCapped] = useState(false)

  // Keep latest mediaType in a ref so retry (which reuses the last prompt)
  // submits with the same medium without re-creating the polling callback.
  const mediaTypeRef = useRef(mediaType)
  useEffect(() => { mediaTypeRef.current = mediaType }, [mediaType])

  // Keep latest prompt in a ref so the polling callback can read it without
  // being included in its dependency array (avoids restarting the interval).
  const promptRef = useRef(prompt)
  useEffect(() => { promptRef.current = prompt }, [prompt])

  const pollingRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const hardCapRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Validation ──────────────────────────────────────────────────────────────
  const charCount   = prompt.length
  const isTooShort  = charCount < MIN_CHARS
  const isTooLong   = charCount > MAX_CHARS
  const isFormValid = !isTooShort && !isTooLong

  const charColor =
    charCount > MAX_CHARS
      ? 'text-red-400'
      : charCount > MAX_CHARS * 0.9
      ? 'text-amber-400'
      : 'text-(--fg-faint)'

  // ── Polling + hard-cap cleanup ───────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    if (hardCapRef.current) {
      clearTimeout(hardCapRef.current)
      hardCapRef.current = null
    }
  }, [])

  const startPolling = useCallback(
    (requestId: string) => {
      stopPolling()
      setHardCapped(false)

      const poll = async () => {
        try {
          const res = await fetch(`/api/posts/on-demand/${requestId}/status`)
          if (!res.ok) return // transient — keep polling
          const data = (await res.json()) as {
            status: string
            failure_reason?: string | null
            current_step?: string | null
          }

          if (data.status === 'delivered') {
            stopPolling()
            setPhase({ kind: 'success', requestId })
            setTimeout(
              () => router.push(`/${clientSlug}/on-demand/${requestId}`),
              1800,
            )
          } else if (data.status === 'failed') {
            stopPolling()
            setPhase({
              kind: 'failed',
              message: humanizeFailure(
                data.failure_reason,
                s.processing.failureReasons,
                s.processing.failed,
              ),
              detail: data.failure_reason ?? undefined,
            })
          } else if (data.status === 'held') {
            stopPolling()
            setPhase({ kind: 'held' })
          } else {
            // Still running — update currentStep so the UI reflects real progress
            const step = data.current_step ?? null
            setPhase((prev) =>
              prev.kind === 'polling' ? { ...prev, currentStep: step } : prev,
            )
          }
        } catch {
          // Network hiccup — keep polling
        }
      }

      poll() // immediate first tick
      pollingRef.current = setInterval(poll, POLL_INTERVAL_MS)

      // Hard cap: show the escape hatch once generation is taking unusually
      // long (later for video, which legitimately runs ~5 min). Polling
      // continues regardless.
      const cap = mediaTypeRef.current === 'video' ? HARD_CAP_VIDEO_MS : HARD_CAP_IMAGE_MS
      hardCapRef.current = setTimeout(() => setHardCapped(true), cap)
    },
    [clientSlug, router, s.processing.failed, stopPolling],
  )

  // Clean up on unmount
  useEffect(() => () => stopPolling(), [stopPolling])

  // ── Submit (also used by retry) ─────────────────────────────────────────────
  const submitPrompt = useCallback(
    async (text: string) => {
      const platform = defaultPlatform ?? 'Instagram'
      const now = new Date()

      const body = {
        client_slug:      clientSlug,
        media_type:       mediaTypeRef.current,
        content_type:     'educational',  // FIX: Changed from hardcoded 'lifestyle' to prevent chain override
        objective:        'awareness',
        platform,
        posting_time:     now.toISOString(),
        month:            now.toISOString().slice(0, 7),
        canvas:           platformToCanvas(platform),
        color_palette:    defaultColorHex ? [defaultColorHex] : [],
        style_descriptor: text,
        hero_concept:     text,
      }

      setHardCapped(false)
      setPhase({ kind: 'submitting' })

      try {
        const res = await fetch('/api/posts/on-demand', {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify(body),
        })
        const json = (await res.json().catch(() => ({}))) as {
          request_id?: string
          error?: string
          issues?: Array<{ path: string; message: string }>
        }

        if (!res.ok) {
          const msg = json.issues?.[0]?.message ?? json.error ?? `HTTP ${res.status}`
          setPhase({ kind: 'failed', message: msg })
          return
        }

        const requestId = json.request_id ?? ''
        setPhase({ kind: 'polling', requestId, currentStep: null })
        startPolling(requestId)
      } catch (err) {
        setPhase({
          kind: 'failed',
          message: err instanceof Error ? err.message : 'network_error',
        })
      }
    },
    [clientSlug, defaultColorHex, defaultPlatform, startPolling],
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!isFormValid || phase.kind === 'submitting' || phase.kind === 'polling') return
      submitPrompt(prompt)
    },
    [isFormValid, phase.kind, prompt, submitPrompt],
  )

  const handleRetry = useCallback(() => {
    submitPrompt(promptRef.current)
  }, [submitPrompt])

  const handleEdit = useCallback(() => {
    stopPolling()
    setHardCapped(false)
    setPhase({ kind: 'form' })
  }, [stopPolling])

  // ── Render ──────────────────────────────────────────────────────────────────
  const showProcessing = phase.kind !== 'form'

  return (
    <div className="space-y-6">
      {/* ── Form (hidden during processing, kept in DOM to preserve state) ── */}
      <div className={showProcessing ? 'hidden' : undefined}>
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* ── Output type: Image | Video ── */}
          <MediaTypeSelector value={mediaType} onChange={setMediaType} s={s} />

          <Field label={s.prompt.label} required>
            <Textarea
              name="image_prompt"
              dir="ltr"
              placeholder={
                mediaType === 'video'
                  ? s.prompt.videoPlaceholder ?? s.prompt.placeholder
                  : s.prompt.placeholder
              }
              rows={7}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              aria-describedby="prompt-meta"
            />
            {/* Character counter + validation hint */}
            <div
              id="prompt-meta"
              className="mt-1.5 flex items-center justify-between gap-2 text-xs"
            >
              <span className={isTooLong ? 'text-red-400' : isTooShort && charCount > 0 ? 'text-amber-400' : 'text-(--fg-faint)'}>
                {isTooLong
                  ? s.prompt.tooLong
                  : isTooShort && charCount > 0
                  ? s.prompt.tooShort
                  : null}
              </span>
              <span className={`font-mono tabular-nums ${charColor}`}>
                {charCount.toLocaleString()} {s.prompt.charLimit}
              </span>
            </div>
          </Field>

          <div className="flex flex-col-reverse items-stretch gap-3 border-t border-(--border-subtle) pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-(--fg-muted)">{s.rule}</p>
            <Button
              type="submit"
              size="lg"
              leadingIcon={<Sparkles size={16} />}
              disabled={!isFormValid}
            >
              {s.submit}
            </Button>
          </div>
        </form>
      </div>

      {/* ── Processing panel ─────────────────────────────────────────────────── */}
      {showProcessing && (
        <div className="space-y-5">
          <p className="text-sm font-semibold text-(--fg)">{s.processing.title}</p>
          <ProcessingSteps
            phase={phase}
            s={s}
            hardCapped={hardCapped}
            clientSlug={clientSlug}
            onRetry={handleRetry}
            onEdit={handleEdit}
          />
          {/* Footer note shown during active polling */}
          {(phase.kind === 'submitting' || phase.kind === 'polling') && !hardCapped && (
            <p className="text-xs text-(--fg-muted)">{s.footer}</p>
          )}
        </div>
      )}
    </div>
  )
}
