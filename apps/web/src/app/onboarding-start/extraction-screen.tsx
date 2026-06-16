'use client'

/**
 * Step 2 — Live extraction screen.
 *
 * The brand row exists. N8N-A06 is running 3 scrapers in parallel
 * (Instagram via Apify, Website fetch, Google Places). This component
 * polls /api/onboarding/extraction-status every 2.5s and animates each
 * lane independently — Pending → Done | Unavailable | Skipped — surfacing
 * snippets of what was found as soon as we have them.
 *
 * Behaviour:
 *   • Auto-advances to Step 3 the moment all expected lanes have settled
 *     (≈ 0.6s after the last lane finishes, to let the user see the green).
 *   • Falls back to a 90s hard cap → user can continue manually.
 *   • If `extractionKickedOff = false` (no sources / A06 down), shows a
 *     friendly "skip ahead" panel and advances after 1.5s.
 *
 * The pre-fill data is fetched once on entry to Step 3 — this screen does
 * not need to surface every field, just enough to make the user feel
 * something real is happening.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@repo/ui/button'

interface ExtractionStatusResponse {
  ok: boolean
  onboarding_status?: string
  sources_present?: { instagram: boolean; website: boolean; places: boolean }
  source_status?: {
    instagram: 'pending' | 'done' | 'unavailable' | 'skipped'
    website:   'pending' | 'done' | 'unavailable' | 'skipped'
    places:    'pending' | 'done' | 'unavailable' | 'skipped'
  }
  pre_fill?: {
    brand_name_en: string | null
    business_category: string | null
    sector_hint: string | null
    dialect_hint: string | null
    differentiator_seed: string | null
    lifecycle_stage_hint: string | null
    rating: number | null
    user_ratings_total: number | null
    formatted_address: string | null
    account_age_months: number | null
    post_count: number | null
    post_frequency_30d: number | null
    // v2 — Instagram profile (details) signals
    ig_username: string | null
    ig_full_name: string | null
    ig_followers_count: number | null
    ig_follows_count: number | null
    ig_posts_count_total: number | null
    ig_profile_pic_url: string | null
    ig_is_verified: boolean
    ig_is_business_account: boolean
    ig_external_url: string | null
    ig_post_image_urls?: string[]
    // v2 — Website signals (Apify Website Content Crawler)
    website_url: string | null
    website_page_count: number | null
    website_language: string | null
    website_og_image: string | null
    website_canonical_url: string | null
  }
}

type LaneStatus = 'pending' | 'done' | 'unavailable' | 'skipped'

export interface ExtractionScreenProps {
  brand_id: string
  extractionKickedOff: boolean
  /** When false, the screen still polls + renders status but does NOT call
   *  onComplete on its own. Used when the user navigates back from Step 3
   *  to inspect the lanes — they should advance via the next/continue button,
   *  not be auto-bounced forward. */
  autoAdvance?: boolean
  /** Error from the A06 trigger (n8n webhook unreachable / 4xx / timeout).
   *  When set, the screen surfaces a banner instead of auto-advancing. */
  triggerError: string | null
  onComplete: () => void
  onBack: () => void
}

const POLL_INTERVAL_MS = 2500
const AUTO_CONTINUE_DELAY_MS = 800
/** Minimum wall time before any auto-advance — prevents the screen from
 *  blinking past in cases where extraction-status returns 'unavailable' on
 *  the very first poll (n8n trigger failed or A06 marked unavailable). */
const MIN_DISPLAY_MS = 3000
const HARD_CAP_MS = 90_000

export function ExtractionScreen({ brand_id, extractionKickedOff, autoAdvance = true, triggerError, onComplete, onBack }: ExtractionScreenProps) {
  const [data, setData] = useState<ExtractionStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [forceContinue, setForceContinue] = useState(false)
  const completedRef = useRef(false)
  const tickStart = useRef<number>(Date.now())

  // ── Polling ────────────────────────────────────────────────────────
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      if (stopped) return
      try {
        const res = await fetch(`/api/onboarding/extraction-status/${brand_id}`, { cache: 'no-store' })
        if (!res.ok) {
          // 404/500 — keep polling silently for a few cycles
          if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS)
          return
        }
        const json = (await res.json()) as ExtractionStatusResponse
        if (stopped) return
        setData(json)
        setError(null)

        // Only treat the run as "complete" when:
        //   • brand status is a real terminal (extraction_done — A06 finished
        //     every lane and posted its final callback), AND
        //   • every expected lane (the ones the user provided sources for)
        //     reached 'done' or 'unavailable' — NOT just 'skipped'.
        //
        // 'extraction_unavailable' alone is NOT enough to auto-advance: that
        //  state can be set by submitSeed when the n8n trigger fails (the
        //  workflow never ran). In that case we want the user to see the
        //  banner and click "Continue" themselves, not be silently advanced.
        //
        // We also enforce MIN_DISPLAY_MS so the screen never flashes past
        // before the user can read it, and never auto-advance when there is
        // a trigger_error from the seed action.
        // STRICT auto-advance gate. ALL of the following must be true:
        //   1. brand.onboarding_status === 'extraction_done' (A06 reached its
        //      final "Collect final" merge node and updated the row).
        //   2. Every lane the user provided sources for is settled (done or
        //      unavailable — never 'pending').
        //   3. At least one lane returned 'done' (proves A06 wrote real
        //      evidence; if every lane is unavailable/skipped, A06 produced
        //      no source_records and we should NOT silently advance).
        //   4. No trigger_error from the seed action.
        //   5. MIN_DISPLAY_MS elapsed (so the screen can't blink past).
        //
        // Anything short of this keeps polling — user can still click the
        // manual "Continue" once the hard cap fires (HARD_CAP_MS).
        const status = json.onboarding_status
        const ss = json.source_status
        const allExpectedDone = isAllExpectedDone(ss)
        const atLeastOneDone = ss
          ? (['instagram', 'website', 'places'] as const).some((k) => ss[k] === 'done')
          : false
        const reallyComplete =
          status === 'extraction_done' && allExpectedDone && atLeastOneDone
        const elapsedMs = Date.now() - tickStart.current
        if (reallyComplete && !triggerError && elapsedMs >= MIN_DISPLAY_MS) {
          if (autoAdvance && !completedRef.current) {
            completedRef.current = true
            setTimeout(() => { if (!stopped) onComplete() }, AUTO_CONTINUE_DELAY_MS)
          }
          // Once complete, stop polling — there's nothing more to discover.
          return
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS)
      } catch {
        if (!stopped) {
          setError('Reconnecting…')
          timer = setTimeout(poll, POLL_INTERVAL_MS)
        }
      }
    }

    if (extractionKickedOff) {
      void poll()
    }
    // No-extraction case: do NOT auto-advance. Stepper handles that branch
    // (jumps directly from Step 1 to Step 3 when has_sources is false).
    // If we still ended up here with extractionKickedOff=false, user must
    // click "Continue" themselves — see the footer button.

    // Hard cap
    const cap = setTimeout(() => {
      if (!stopped && !completedRef.current) setForceContinue(true)
    }, HARD_CAP_MS)

    // Tick for elapsed counter
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - tickStart.current) / 1000))
    }, 1000)

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      clearTimeout(cap)
      clearInterval(tick)
    }
  }, [brand_id, extractionKickedOff, autoAdvance, onComplete, triggerError])

  // ── Derived ────────────────────────────────────────────────────────
  const lanes: Array<{ key: 'instagram' | 'website' | 'places'; label: string; icon: string }> = useMemo(() => [
    { key: 'instagram', label: 'Instagram',   icon: '📷' },
    { key: 'website',   label: 'Website',     icon: '🌐' },
    { key: 'places',    label: 'Google Maps', icon: '📍' },
  ], [])

  const ss = data?.source_status
  const atLeastOneLaneDone = ss
    ? (['instagram', 'website', 'places'] as const).some((k) => ss[k] === 'done')
    : false
  // The screen is "done" only when extraction REALLY finished — A06 wrote
  // source_records AND posted its final stage callback AND at least one
  // lane succeeded. We do NOT treat 'extraction_unavailable' as success.
  const overallDone =
    data?.onboarding_status === 'extraction_done' &&
    isAllExpectedDone(ss) &&
    atLeastOneLaneDone
  // 'unavailable' here means: a06 trigger failed OR n8n marked the run
  // unavailable OR all expected lanes failed. User must click Continue.
  const overallUnavailable =
    !!triggerError ||
    data?.onboarding_status === 'extraction_unavailable' ||
    (data?.onboarding_status === 'extraction_done' && !atLeastOneLaneDone)

  const pf = data?.pre_fill ?? null
  const detectedCount = ss
    ? (['instagram', 'website', 'places'] as const).filter((k) => ss[k] === 'done').length
    : 0

  // ── No-extraction short-circuit ────────────────────────────────────
  if (!extractionKickedOff) {
    return (
      <div className="space-y-6 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) p-6 text-center">
        <Spinner />
        <p className="text-sm text-(--fg-muted)">
          No sources to detect — taking you to the form…
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1 text-center">
        <h2 className="font-display text-lg font-semibold text-(--fg)">
          {overallDone
            ? 'Auto-detection complete'
            : overallUnavailable
              ? 'Couldn’t reach the auto-detection service'
              : 'Looking up your brand…'}
        </h2>
        <p className="text-sm text-(--fg-muted)">
          {overallDone
            ? `We found ${detectedCount} ${detectedCount === 1 ? 'source' : 'sources'}. The next step is pre-filled — just review.`
            : overallUnavailable
              ? 'No problem — you can fill the form manually in the next step.'
              : 'We\'re scanning Instagram, your website, and Google Maps in parallel. This usually takes 60-120 seconds.'}
        </p>
      </header>

      {/* Trigger error banner — shown when A06 webhook didn't accept the call */}
      {triggerError && (
        <div className="rounded-(--r-md) border border-(--warning)/40 bg-(--warning)/10 p-3 text-xs text-(--warning)">
          <p className="font-semibold">Auto-detection skipped</p>
          <p className="mt-1 text-(--fg-muted)">
            We couldn&apos;t reach n8n to start the scan ({triggerError}). This usually means the
            A06 workflow isn&apos;t activated, the test-mode webhook hasn&apos;t been clicked,
            or <code>N8N_INBOUND_URL</code> / <code>N8N_A06_WEBHOOK_PATH</code> are wrong.
            You can still continue and fill the form manually.
          </p>
        </div>
      )}

      {/* Pulsing scanner beacon */}
      <div className="relative mx-auto h-32 w-32">
        <div
          className={
            'absolute inset-0 rounded-full ' +
            (overallDone
              ? 'bg-(--success)/20'
              : overallUnavailable
                ? 'bg-(--warning)/20'
                : 'animate-ping-slow bg-(--accent)/20')
          }
        />
        <div
          className={
            'absolute inset-3 rounded-full ' +
            (overallDone
              ? 'bg-(--success)/30'
              : overallUnavailable
                ? 'bg-(--warning)/30'
                : 'animate-ping-slower bg-(--accent)/30')
          }
        />
        <div
          className={
            'absolute inset-6 flex items-center justify-center rounded-full text-2xl shadow-lg transition-colors ' +
            (overallDone
              ? 'bg-(--success) text-white'
              : overallUnavailable
                ? 'bg-(--warning) text-white'
                : 'bg-(--accent) text-(--accent-fg)')
          }
        >
          {overallDone ? '✓' : overallUnavailable ? '!' : <SpinnerIcon />}
        </div>
      </div>

      {/* Lanes */}
      <ol className="space-y-3">
        {lanes.map((lane) => {
          const status: LaneStatus = ss?.[lane.key] ?? 'pending'
          return <Lane key={lane.key} icon={lane.icon} label={lane.label} status={status} pre={pf} laneKey={lane.key} />
        })}
      </ol>

      {/* Live findings */}
      {pf && (pf.brand_name_en || pf.business_category || pf.lifecycle_stage_hint) && (
        <div className="rounded-(--r-md) border border-(--accent)/30 bg-(--accent-soft)/30 p-4">
          <p className="mb-2 text-xs font-semibold text-(--accent)">What we&apos;ve detected so far</p>

          {/* IG profile header — when we have details, lead with the avatar + name. */}
          {(pf.ig_profile_pic_url || pf.ig_full_name || pf.ig_followers_count != null) && (
            <div className="mb-3 flex items-center gap-3 rounded-(--r-sm) bg-(--surface-4) p-2">
              {pf.ig_profile_pic_url && (
                // IG CDN refuses cross-origin Referer; no-referrer fixes the
                // direct load, /api/img-proxy is the fallback for expired URLs.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pf.ig_profile_pic_url} alt="Instagram avatar"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="h-12 w-12 shrink-0 rounded-full border border-(--border-subtle) object-cover"
                  onError={(e) => {
                    const el = e.currentTarget as HTMLImageElement
                    const proxied = `/api/img-proxy?u=${encodeURIComponent(pf.ig_profile_pic_url!)}`
                    if (!el.src.includes('/api/img-proxy')) el.src = proxied
                    else el.style.display = 'none'
                  }}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-sm font-medium text-(--fg) [overflow-wrap:anywhere]">
                  {pf.ig_full_name || pf.ig_username || 'Instagram'}
                  {pf.ig_is_verified && (
                    <span title="Verified" className="inline-block text-(--accent)">✓</span>
                  )}
                </p>
                {pf.ig_username && pf.ig_full_name && (
                  <p className="text-xs text-(--fg-muted)">@{pf.ig_username}</p>
                )}
              </div>
            </div>
          )}

          <ul className="grid gap-2 sm:grid-cols-2">
            {pf.brand_name_en && (
              <Finding label="Brand name (English)" value={pf.brand_name_en} />
            )}
            {pf.business_category && (
              <Finding label="Business type" value={pf.business_category} />
            )}
            {pf.sector_hint && (
              <Finding label="Sector signal" value={pf.sector_hint} />
            )}
            {pf.dialect_hint && (
              <Finding label="Voice signal" value={pf.dialect_hint} />
            )}
            {pf.lifecycle_stage_hint && (
              <Finding label="Lifecycle" value={pf.lifecycle_stage_hint} />
            )}
            {pf.ig_followers_count != null && (
              <Finding label="Followers" value={formatCount(pf.ig_followers_count)} />
            )}
            {pf.ig_follows_count != null && (
              <Finding label="Following" value={formatCount(pf.ig_follows_count)} />
            )}
            {pf.ig_posts_count_total != null && (
              <Finding label="Total posts" value={formatCount(pf.ig_posts_count_total)} />
            )}
            {pf.ig_is_business_account && (
              <Finding label="Account type" value="Business" />
            )}
            {pf.ig_external_url && (
              <Finding label="IG website link" value={pf.ig_external_url} />
            )}
            {pf.rating != null && pf.user_ratings_total != null && (
              <Finding label="Reviews" value={`${pf.rating} ★ · ${pf.user_ratings_total}`} />
            )}
            {pf.account_age_months != null && (
              <Finding label="Account age" value={`${pf.account_age_months} months`} />
            )}
            {pf.post_count != null && (
              <Finding label="Posts seen" value={`${pf.post_count}`} />
            )}
            {pf.website_page_count != null && pf.website_page_count > 0 && (
              <Finding label="Pages crawled" value={`${pf.website_page_count}`} />
            )}
            {pf.website_language && (
              <Finding label="Site language" value={pf.website_language} />
            )}
          </ul>
        </div>
      )}

      {/* Status footer */}
      <div className="flex items-center justify-between border-t border-(--border-subtle) pt-5">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Back
        </Button>
        <div className="flex items-center gap-3 text-xs text-(--fg-muted)">
          {error && <span className="text-(--warning)">{error}</span>}
          <span>
            {overallDone ? 'Done' : overallUnavailable ? 'Unavailable' : `${elapsed}s elapsed`}
          </span>
          {(forceContinue || overallDone || overallUnavailable) && (
            <Button
              type="button" size="sm"
              onClick={() => { completedRef.current = true; onComplete() }}
            >
              Continue →
            </Button>
          )}
        </div>
      </div>

      {/* Local keyframes for the slow ping. Tailwind's default ping is too fast. */}
      <style jsx>{`
        @keyframes ping-slow  { 0% { transform: scale(1); opacity: 0.6 } 80%, 100% { transform: scale(1.6); opacity: 0 } }
        @keyframes ping-slower { 0% { transform: scale(1); opacity: 0.5 } 80%, 100% { transform: scale(1.4); opacity: 0 } }
        :global(.animate-ping-slow)   { animation: ping-slow   2.2s cubic-bezier(0,0,0.2,1) infinite; }
        :global(.animate-ping-slower) { animation: ping-slower 2.2s cubic-bezier(0,0,0.2,1) infinite 0.5s; }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function Lane({
  icon, label, status, pre, laneKey,
}: {
  icon: string
  label: string
  status: LaneStatus
  pre: ExtractionStatusResponse['pre_fill'] | null
  laneKey: 'instagram' | 'website' | 'places'
}) {
  const tone =
    status === 'done'         ? 'border-(--success)/40 bg-(--success)/10' :
    status === 'unavailable'  ? 'border-(--warning)/40 bg-(--warning)/10' :
    status === 'skipped'      ? 'border-(--border-subtle) bg-(--surface-3) opacity-60' :
                                'border-(--accent)/30 bg-(--surface-3)'

  const detail = useLaneDetail(laneKey, status, pre)

  return (
    <li className={'flex items-center justify-between gap-3 rounded-(--r-md) border px-4 py-3 transition-all ' + tone}>
      <div className="flex items-center gap-3">
        <span className="text-xl" aria-hidden>{icon}</span>
        <div>
          <p className="text-sm font-medium text-(--fg)">{label}</p>
          {detail && <p className="text-xs text-(--fg-muted)">{detail}</p>}
        </div>
      </div>
      <StatusPill status={status} />
    </li>
  )
}

function useLaneDetail(
  key: 'instagram' | 'website' | 'places',
  status: LaneStatus,
  pre: ExtractionStatusResponse['pre_fill'] | null,
): string | null {
  if (status === 'pending') {
    if (key === 'instagram') return 'Reading recent posts…'
    if (key === 'website')   return 'Fetching homepage…'
    if (key === 'places')    return 'Searching Google Maps…'
  }
  if (status === 'skipped')     return 'Not provided'
  if (status === 'unavailable') return 'No data found — that\'s fine'
  // done
  if (key === 'instagram' && pre) {
    if (pre.post_count != null) return `${pre.post_count} posts · ${pre.account_age_months ?? '—'}m old`
    return 'Posts captured'
  }
  if (key === 'website' && pre) {
    return pre.brand_name_en ? `Title: ${pre.brand_name_en}` : 'Site captured'
  }
  if (key === 'places' && pre) {
    if (pre.rating != null && pre.user_ratings_total != null) return `${pre.rating} ★ · ${pre.user_ratings_total} reviews`
    if (pre.brand_name_en) return `Found: ${pre.brand_name_en}`
    return 'Listing found'
  }
  return null
}

function StatusPill({ status }: { status: LaneStatus }) {
  const cls =
    status === 'done'         ? 'bg-(--success) text-white' :
    status === 'unavailable'  ? 'bg-(--warning)/80 text-white' :
    status === 'skipped'      ? 'bg-(--surface-4) text-(--fg-faint)' :
                                'bg-(--accent) text-(--accent-fg) animate-pulse'
  const label =
    status === 'done'         ? '✓ Done' :
    status === 'unavailable'  ? '— None'  :
    status === 'skipped'      ? 'Skipped' :
                                'Scanning'
  return <span className={'rounded-full px-2.5 py-1 text-[11px] font-semibold ' + cls}>{label}</span>
}

function Finding({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-xs text-(--fg-muted)">{label}</span>
      <span className="font-medium text-(--fg) [overflow-wrap:anywhere]">{value}</span>
    </li>
  )
}

/** Format a follower / post count compactly: 412000 → "412k", 1842 → "1.8k". */
function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
}

function Spinner() {
  return (
    <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-(--accent) border-t-transparent" />
  )
}

function SpinnerIcon() {
  return (
    <svg className="h-7 w-7 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/**
 * "All expected lanes done" — every lane that wasn't 'skipped' from the start
 * has reached a real terminal ('done' or 'unavailable'). 'pending' anywhere
 * means we're still waiting; 'skipped' is fine (the user didn't provide that
 * source). If EVERY lane is 'skipped' we return false — that means the user
 * provided no sources at all and the screen should never have rendered.
 */
function isAllExpectedDone(ss: ExtractionStatusResponse['source_status'] | undefined): boolean {
  if (!ss) return false
  const lanes = (['instagram', 'website', 'places'] as const).map((k) => ss[k])
  if (lanes.every((s) => s === 'skipped')) return false
  return lanes.every((s) => s === 'done' || s === 'unavailable' || s === 'skipped')
}
