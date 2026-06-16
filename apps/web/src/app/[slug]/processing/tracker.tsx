'use client'

/**
 * Client-side realtime tracker for the /[slug]/processing page.
 *
 * Doc §8.3 implementation, with enhancements:
 *   - Two realtime channels: brand_snapshots (stage transitions) AND
 *     brand_profiles (onboarding_status flips → instant redirect on success)
 *   - Stage timestamps surfaced (when each stage went green)
 *   - 10-min soft timeout → recovery banner with one-click retry
 *   - Polling fallback every 10s when realtime disconnects
 *   - Connection-status badge so users + ops can see realtime is alive
 *   - Detects anomaly_records via the failed status — surfaces a clearer message
 *
 * Doc §5.4 recovery: the "Retry" button calls /api/onboarding/retry which
 * re-fires N8N-A03 from the original source_records row. No data lost.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { browserClient } from '@repo/db/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { Card, CardBody } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { Button } from '@repo/ui/button'

const TIMEOUT_MS = 3 * 60 * 1000         // 3 min — show retry banner faster when pipeline stalls
const POLL_FALLBACK_MS = 10_000           // Polling when realtime is dead
const CONNECTION_HEALTHY_MS = 30_000      // If we haven't heard anything in 30s, mark connection 'stale'

interface Stage {
  key: string
  label: string
  sub: string
}

const STAGES: Stage[] = [
  { key: 'form_submitted',     label: 'Form received',      sub: 'Brand profile created. Logo uploaded.' },
  { key: 'ceo_classified',     label: 'CEO routing',        sub: 'Confidence mode + dispatch decided.' },
  { key: 'scraping_complete',  label: 'Scraping signals',   sub: 'Instagram + website + Google Places consolidated.' },
  { key: 'coo_branddna_built', label: 'BrandDNA build',     sub: 'COO mapping signals to BrandDNA + three-axis composition.' },
  { key: 'ceo_confidence_refined', label: 'CEO refinement', sub: 'Re-routing with COO evidence (post-build confidence gate).' },
  { key: 'memory_drained',     label: 'Memory written',     sub: 'Memory Controller persisting nominations.' },
  { key: 'snapshot_ready',     label: 'Snapshot ready',     sub: 'Redirecting to strategy review…' },
]

const STAGE_INDEX = new Map(STAGES.map((s, i) => [s.key, i]))
// Aliases — older stage names map to the canonical step they belong to.
// Keeps the UI working for in-flight pipelines that emitted the legacy name.
const STAGE_ALIASES: Record<string, string> = {
  scraping: 'scraping_complete',
}

type ConnState = 'connecting' | 'live' | 'stale' | 'reconnecting'

interface SectorBaseline {
  recommended_content_mix: Record<string, number>
  top_performing_tones: string[]
  worst_performing_tones: string[]
  occasion_insights: Record<string, unknown>
  confidence_benchmarks: Record<string, unknown>
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  product:       'منتجات',
  lifestyle:     'أسلوب حياة',
  occasion:      'مناسبات',
  behind_scenes: 'كواليس',
}

export function ProcessingTracker({
  slug,
  brandId,
  initialIsComplete,
  initialSnapshotData,
  initialOnboardingStatus,
  hasNoSocialHistory = false,
  sector = null,
  sectorBaseline = null,
}: {
  slug: string
  brandId: string
  initialIsComplete: boolean
  initialSnapshotData: Record<string, unknown> | null
  initialOnboardingStatus: string | null
  hasNoSocialHistory?: boolean
  sector?: string | null
  sectorBaseline?: SectorBaseline | null
}) {
  const router = useRouter()
  const [stage, setStage] = useState<string>(
    typeof initialSnapshotData?.stage === 'string' ? (initialSnapshotData.stage as string) : 'form_submitted',
  )
  const [stageTimestamps, setStageTimestamps] = useState<Record<string, string>>({})
  const [isComplete, setIsComplete] = useState<boolean>(initialIsComplete)
  const [onboardingStatus, setOnboardingStatus] = useState<string | null>(initialOnboardingStatus)
  // Gap notification from A03 doc §5.3 step 9. When completeness < 40 or
  // dialect_unconfirmed, A03 emits stage='gap_notification' with metadata
  // .gap_questions[] — we render them so the user can answer in place.
  const initialGap = typeof initialSnapshotData?.stage === 'string' && initialSnapshotData.stage === 'gap_notification'
    ? (initialSnapshotData as { gap_questions?: Array<{ field: string; question: string }>; suppressed?: boolean })
    : null
  const [gapQuestions, setGapQuestions] = useState<Array<{ field: string; question: string }>>(
    initialGap && !initialGap.suppressed ? (initialGap.gap_questions ?? []) : [],
  )
  // Dev-only override: append `?retry=1` to the URL to force the timeout banner
  // (and therefore the "Retry now" button) without waiting for the 10-min timer
  // and without flipping onboarding_status in SQL. Used to re-run failed dev
  // pipelines quickly. Honoured at all NODE_ENVs — it's harmless in prod (only
  // shows the banner; clicking still goes through the same /api/onboarding/retry
  // gate which validates ownership).
  const [timedOut, setTimedOut] = useState(false)
  const [connState, setConnState] = useState<ConnState>('connecting')
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [isBlocked, setIsBlocked] = useState(false)
  const [blockReasons, setBlockReasons] = useState<string[]>([])

  const supabaseRef = useRef<ReturnType<typeof browserClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = browserClient()
  const supabase = supabaseRef.current

  const lastEventAtRef = useRef<number>(Date.now())
  const markActivity = useCallback(() => {
    lastEventAtRef.current = Date.now()
  }, [])

  const goToSnapshot = useCallback(() => {
    // Go to snapshot first — snapshot shows a one-time strategy-review CTA
    router.push(`/${slug}/snapshot`)
  }, [router, slug])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const retry = new URLSearchParams(window.location.search).get('retry') === '1'
    if (retry) setTimedOut(true)
  }, [])

  const handleStageRow = useCallback(
    (row: { is_partial?: boolean; snapshot_data?: Record<string, unknown> | null }) => {
      markActivity()
      const sd = row.snapshot_data ?? {}
      const newStage = typeof sd.stage === 'string' ? (sd.stage as string) : null
      const stageAt = typeof sd.stage_at === 'string' ? (sd.stage_at as string) : new Date().toISOString()

      // Gap notification — surface questions to the user. A03 also emits a
      // `suppressed` form when the form is complete; we treat that as no-op.
      if (newStage === 'gap_notification') {
        const suppressed = (sd as { suppressed?: boolean }).suppressed === true
        const qs = (sd as { gap_questions?: Array<{ field: string; question: string }> }).gap_questions ?? []
        if (!suppressed && qs.length > 0) setGapQuestions(qs)
        return
      }

      // CEO hard block — show blocked UI immediately, stop polling
      if (newStage === 'blocked' || (sd as { confidence_mode?: string }).confidence_mode === 'Blocked') {
        const reasons = (sd as { human_gate_reasons?: string[] }).human_gate_reasons ?? []
        setIsBlocked(true)
        setBlockReasons(reasons)
        return
      }

      if (newStage) {
        setStage(newStage)
        setStageTimestamps((prev) => (prev[newStage] ? prev : { ...prev, [newStage]: stageAt }))
      }
      if (row.is_partial === false) {
        setIsComplete(true)
        setTimeout(goToSnapshot, 600)
      }
    },
    [markActivity, goToSnapshot],
  )

  // ── 1. Realtime — brand_snapshots INSERTs ──────────────────────────
  useEffect(() => {
    if (isComplete) {
      goToSnapshot()
      return
    }

    let snapshotsChannel: RealtimeChannel | null = null
    let profileChannel: RealtimeChannel | null = null

    snapshotsChannel = supabase
      .channel(`processing_snap_${brandId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'brand_snapshots', filter: `brand_id=eq.${brandId}` },
        (payload) => handleStageRow(payload.new as { is_partial?: boolean; snapshot_data?: Record<string, unknown> | null }),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnState('live')
        else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') setConnState('reconnecting')
      })

    // ── 2. Realtime — brand_profiles UPDATEs (onboarding_status flips) ──
    profileChannel = supabase
      .channel(`processing_brand_${brandId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'brand_profiles', filter: `brand_id=eq.${brandId}` },
        (payload) => {
          markActivity()
          const next = payload.new as { onboarding_status?: string | null }
          if (next.onboarding_status) {
            setOnboardingStatus(next.onboarding_status)
            if (next.onboarding_status === 'complete') {
              setIsComplete(true)
              setTimeout(goToSnapshot, 600)
            }
            if (next.onboarding_status === 'failed' || next.onboarding_status === 'blocked') {
              setIsBlocked(true)
              setBlockReasons((prev) => prev.length > 0 ? prev : ['pipeline_error'])
            }
          }
        },
      )
      .subscribe()

    return () => {
      if (snapshotsChannel) void supabase.removeChannel(snapshotsChannel)
      if (profileChannel) void supabase.removeChannel(profileChannel)
    }
  }, [supabase, brandId, isComplete, goToSnapshot, handleStageRow, markActivity])

  // ── 3. Polling fallback — fires when realtime hasn't pushed in a while ──
  useEffect(() => {
    if (isComplete) return
    const id = setInterval(async () => {
      const { data } = await supabase
        .from('brand_snapshots')
        .select('is_partial, snapshot_data, created_at')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .limit(1)
      const row = data?.[0]
      if (row) {
        // snapshot_data is typed as `Json` (could be string/array/null in theory).
        // Narrow to a plain record before forwarding.
        const sd = row.snapshot_data && typeof row.snapshot_data === 'object' && !Array.isArray(row.snapshot_data)
          ? (row.snapshot_data as Record<string, unknown>)
          : null
        handleStageRow({ is_partial: row.is_partial as boolean, snapshot_data: sd })
      }
    }, POLL_FALLBACK_MS)
    return () => clearInterval(id)
  }, [supabase, brandId, isComplete, handleStageRow])

  // ── 4. Connection-health watcher ──────────────────────────────────
  useEffect(() => {
    if (isComplete) return
    const id = setInterval(() => {
      const since = Date.now() - lastEventAtRef.current
      if (connState === 'live' && since > CONNECTION_HEALTHY_MS) setConnState('stale')
    }, 5000)
    return () => clearInterval(id)
  }, [connState, isComplete])

  // ── 5. Soft timeout banner ────────────────────────────────────────
  useEffect(() => {
    if (isComplete) return
    const t = setTimeout(() => setTimedOut(true), TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [isComplete])

  // ── 6. Retry handler ──────────────────────────────────────────────
  const onRetry = useCallback(async () => {
    setRetrying(true)
    setRetryError(null)
    try {
      const r = await fetch('/api/onboarding/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!r.ok || !j.ok) {
        setRetryError(j.error ?? `retry failed (${r.status})`)
      } else {
        // Reset all state so processing steps show again from the beginning
        setTimedOut(false)
        setIsBlocked(false)
        setBlockReasons([])
        setGapQuestions([])
        setStage('form_submitted')
        markActivity()
      }
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : 'network error')
    } finally {
      setRetrying(false)
    }
  }, [slug, markActivity])

  const canonicalStage = STAGE_ALIASES[stage] ?? stage
  const currentIndex = STAGE_INDEX.get(canonicalStage) ?? 0
  const isFailed = onboardingStatus === 'failed' || stage === 'failed'

  // Treat pipeline failure the same as a block — show the full error UI
  // with a retry button instead of a small bottom banner that's easy to miss.
  if (isFailed && !isComplete) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-rose-300 bg-rose-50/60 px-6 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl" aria-hidden>⚠️</span>
            <div>
              <p className="font-semibold text-rose-900 text-sm">Pipeline error</p>
              <p className="text-rose-700 text-xs mt-1">
                The BrandDNA pipeline encountered an error. Your form data is saved — click Retry to
                re-run the pipeline from your saved answers. No information will be lost.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 pl-9">
            <Button onClick={onRetry} disabled={retrying} size="sm">
              {retrying ? 'Re-firing pipeline…' : 'Retry now'}
            </Button>
            <a className="text-xs font-medium text-rose-700 hover:underline" href={`/${slug}/snapshot`}>
              View partial snapshot →
            </a>
          </div>
          {retryError && <p className="text-xs text-rose-700 pl-9">{retryError}</p>}
        </div>
      </div>
    )
  }

  // ── Blocked state — CEO hard-blocked the pipeline ─────────────────
  if (isBlocked) {
    const REASON_LABELS: Record<string, string> = {
      blocked_critical_field_missing:         'Critical brand fields are missing',
      intake_form_incomplete:                 'The onboarding form was not fully completed',
      critical_fields_provided_count_below_minimum: 'Too few answers were provided',
      arabic_dialect_not_provided:            'Arabic dialect was not selected',
      budget_ceiling_breached:                'Monthly cost ceiling has been reached',
      pipeline_error:                         'The AI pipeline encountered an error — click Retry to re-run',
    }
    const humanReasons = blockReasons.map((r) => REASON_LABELS[r] ?? r).filter(Boolean)
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-rose-300 bg-rose-50/60 px-6 py-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl" aria-hidden>🚫</span>
            <div>
              <p className="font-semibold text-rose-900 text-sm">
                Your BrandDNA pipeline was blocked
              </p>
              <p className="text-rose-700 text-xs mt-1">
                The system could not build your strategy because required information is missing.
                Go back and complete the form, then try again.
              </p>
            </div>
          </div>
          {humanReasons.length > 0 && (
            <ul className="space-y-1 pl-8 list-disc">
              {humanReasons.map((r) => (
                <li key={r} className="text-xs text-rose-800">{r}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-3 pl-8">
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="rounded-full bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-50 transition-colors"
            >
              {retrying ? 'Retrying…' : 'Try again'}
            </button>
            <a
              href={`/${slug}/snapshot`}
              className="rounded-full border border-rose-300 px-4 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100 transition-colors"
            >
              View partial BrandDNA
            </a>
          </div>
          {retryError && <p className="text-xs text-rose-700 pl-8">{retryError}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── Timeout banner — always at the top ──────────────────── */}
      {timedOut && !isComplete && (
        <div className="flex items-center justify-between gap-4 rounded-(--r-md) border border-(--warning)/40 bg-(--warning-soft)/20 px-5 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 text-base" aria-hidden>⏳</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-(--fg)">Taking longer than expected</p>
              <p className="text-xs text-(--fg-muted) mt-0.5">Your form data is saved — retry to re-run the pipeline.</p>
              {retryError && <p className="text-xs text-(--danger) mt-1">{retryError}</p>}
            </div>
          </div>
          <Button onClick={onRetry} disabled={retrying} size="sm" className="shrink-0">
            {retrying ? 'Retrying…' : 'Retry now'}
          </Button>
        </div>
      )}

      {/* ── Top status strip ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) px-4 py-2.5 text-sm">
        <div className="flex items-center gap-2">
          <ConnectionDot state={connState} />
          <span className="text-(--fg-muted)">
            {connState === 'live'
              ? 'Live updates connected'
              : connState === 'stale'
              ? 'Live channel quiet — falling back to polling'
              : connState === 'reconnecting'
              ? 'Reconnecting to live channel…'
              : 'Connecting to live channel…'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--fg-muted)">Step {Math.min(currentIndex + 1, STAGES.length)} / {STAGES.length}</span>
          <Progress percent={isComplete ? 100 : Math.round(((currentIndex + 1) / STAGES.length) * 100)} />
        </div>
      </div>

      {/* ── Gap questions (A03 doc §5.3 step 9) ──────────────────
          Shows when COO reports critical_fields_missing or
          dialect_unconfirmed. User answers route to /api/onboarding/gap
          → enqueueNominations → Memory Controller (Hard Rule #2). */}
      {gapQuestions.length > 0 && (
        <GapQuestionsCard
          slug={slug}
          brandId={brandId}
          questions={gapQuestions}
          onSubmitted={() => setGapQuestions([])}
        />
      )}

      {/* ── No-history brand: sector baseline context ────────────
          Spec: "Shows the client anonymised examples of what works for
          brands like them" + "explicit about the 90-day calibration period"
          Only shown when brand has no Instagram/website history.          */}
      {hasNoSocialHistory && sectorBaseline && !isComplete && (
        <Card>
          <CardBody className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden>🧭</span>
              <div>
                <p className="text-sm font-semibold text-(--fg)" dir="rtl">
                  علامتك جديدة — نبني استراتيجيتك من بيانات القطاع
                </p>
                <p className="text-xs text-(--fg-muted) mt-0.5" dir="rtl">
                  بما أنك لا تملك حسابات تواصل اجتماعي بعد، نستخدم بيانات أداء العلامات المشابهة
                  في قطاع <strong>{sector}</strong> كنقطة انطلاق.
                  ستتحسّن التوصيات تلقائياً مع تراكم بياناتك الخاصة خلال 90 يوماً.
                </p>
              </div>
            </div>

            {/* Content mix from sector baseline */}
            {Object.keys(sectorBaseline.recommended_content_mix).length > 0 && (
              <div>
                <p className="text-xs font-medium text-(--fg-muted) uppercase tracking-wide mb-2" dir="rtl">
                  توزيع المحتوى الموصى به لقطاعك
                </p>
                <div className="space-y-2">
                  {Object.entries(sectorBaseline.recommended_content_mix).map(([type, pct]) => (
                    <div key={type} className="flex items-center gap-3">
                      <span className="w-24 text-xs text-(--fg) text-right" dir="rtl">
                        {CONTENT_TYPE_LABELS[type] ?? type}
                      </span>
                      <div className="flex-1 rounded-full bg-(--surface-3) h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-(--accent) transition-[width]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-xs text-(--fg-muted)">{pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top performing tones */}
            {sectorBaseline.top_performing_tones.length > 0 && (
              <div>
                <p className="text-xs font-medium text-(--fg-muted) uppercase tracking-wide mb-2" dir="rtl">
                  أنماط المحتوى الناجح في قطاعك
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sectorBaseline.top_performing_tones.slice(0, 4).map((tone) => (
                    <span
                      key={tone}
                      className="rounded-full bg-(--success)/10 px-2.5 py-1 text-xs text-(--success) font-medium"
                    >
                      {tone.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Calibration period explanation */}
            <div className="rounded-(--r-sm) border border-amber-200/60 bg-amber-50/40 px-3 py-2.5" dir="rtl">
              <p className="text-xs font-semibold text-amber-800">⏳ فترة التعلّم — 90 يوماً</p>
              <p className="text-xs text-amber-700 mt-0.5">
                خلال أول 90 يوماً، النظام في وضع التعلّم. كل منشور، كل تفاعل، كل مناسبة — يُحسّن
                البيانات ويجعل التوصيات أكثر دقةً لعلامتك تحديداً. ستُخطَر بكل تحديث مهم.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Stage list ───────────────────────────────────────────── */}
      <Card>
        <CardBody className="p-0">
          <ol>
            {STAGES.map((s, i) => {
              const status: 'done' | 'running' | 'pending' =
                isComplete ? 'done' : i < currentIndex ? 'done' : i === currentIndex ? 'running' : 'pending'
              // When timed out, the running stage is visually "stuck" and pending ones are dimmed
              const isStuck   = timedOut && !isComplete && status === 'running'
              const isDimmed  = timedOut && !isComplete && status === 'pending'
              const ts = stageTimestamps[s.key]
              return (
                <li
                  key={s.key}
                  className={[
                    'flex items-center gap-4 border-b border-(--border-subtle) px-6 py-4 last:border-b-0 transition-opacity',
                    isDimmed ? 'opacity-30 select-none' : '',
                  ].join(' ')}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-sm font-medium ${
                      status === 'done'
                        ? 'bg-(--success-soft) text-(--success)'
                        : isStuck
                        ? 'bg-(--warning-soft) text-(--warning)'
                        : status === 'running'
                        ? 'bg-(--accent-soft) text-(--accent)'
                        : 'bg-(--surface-3) text-(--fg-faint)'
                    }`}
                  >
                    {isStuck ? '!' : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={['text-sm', isStuck ? 'text-(--warning)' : 'text-(--fg)'].join(' ')}>{s.label}</div>
                    <div className="mt-0.5 text-xs text-(--fg-muted)">{s.sub}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge
                      tone={status === 'done' ? 'success' : isStuck ? 'warning' : status === 'running' ? 'accent' : 'outline'}
                      size="sm"
                    >
                      {status === 'done' ? 'Done' : isStuck ? 'Stuck' : status === 'running' ? 'Running' : 'Pending'}
                    </Badge>
                    {ts && <span className="font-mono text-xs text-(--fg-subtle)">{formatTime(ts)}</span>}
                  </div>
                </li>
              )
            })}
          </ol>
        </CardBody>
      </Card>

      {/* failure and timeout banners are at the top — see above */}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function ConnectionDot({ state }: { state: ConnState }) {
  const tone =
    state === 'live' ? 'bg-(--success)' :
    state === 'stale' ? 'bg-(--warning)' :
    state === 'reconnecting' ? 'bg-(--warning)' : 'bg-(--fg-faint)'
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${tone} ${state === 'connecting' || state === 'reconnecting' ? 'animate-pulse' : ''}`}
    />
  )
}

function Progress({ percent }: { percent: number }) {
  return (
    <div className="h-1 w-32 overflow-hidden rounded-full bg-(--surface-3)">
      <div className="h-full bg-(--accent) transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

// ── GapQuestionsCard ──────────────────────────────────────────────
// Renders the top-3 gap_questions[] from the A03 gap_notification snapshot
// and routes the user's answers to /api/onboarding/gap, which enqueues
// confidence_upgrade + field_update nominations into memory_controller_queue
// (Hard Rule #2 — never writes Layer 1 directly).
function GapQuestionsCard({
  slug,
  brandId,
  questions,
  onSubmitted,
}: {
  slug: string
  brandId: string
  questions: Array<{ field: string; question: string }>
  onSubmitted: () => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (field: string, value: string) => setAnswers((p) => ({ ...p, [field]: value }))

  const submit = async () => {
    setError(null)
    setSubmitting(true)
    try {
      const filled = Object.entries(answers).filter(([, v]) => v.trim().length > 0)
      if (filled.length === 0) {
        setError('Answer at least one question.')
        setSubmitting(false)
        return
      }
      const res = await fetch(`/api/onboarding/gap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brand_id: brandId, slug, answers: Object.fromEntries(filled) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Request failed (${res.status})`)
        setSubmitting(false)
        return
      }
      onSubmitted()
    } catch (e) {
      setError((e as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardBody className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-(--warning)">A few details still needed</div>
            <p className="mt-1 text-sm text-(--fg-muted)">
              We&apos;ve scraped what we could but need your input on these to finish BrandDNA.
            </p>
          </div>
        </div>
        <ul className="space-y-3">
          {questions.map((q) => (
            <li key={q.field} className="space-y-1.5">
              <label htmlFor={`gap-${q.field}`} className="block text-sm text-(--fg)">{q.question}</label>
              <input
                id={`gap-${q.field}`}
                type="text"
                value={answers[q.field] ?? ''}
                onChange={(e) => update(q.field, e.target.value)}
                disabled={submitting}
                placeholder="Your answer…"
                className="w-full rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-1) px-3 py-2 text-sm"
              />
            </li>
          ))}
        </ul>
        {error && <p className="text-xs text-(--danger-fg)">✗ {error}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Sending…' : 'Submit answers'}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
