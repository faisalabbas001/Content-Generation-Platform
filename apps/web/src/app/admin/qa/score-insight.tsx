'use client'

/**
 * ScoreInsight — the honest "why this score" engine + UI.
 *
 * The CCO agent (packages/core/src/schemas/cco.ts) produces a SINGLE 0–100
 * `cco_score` plus structured signals: `negpat_flag` (NONE→HARD_BLOCK),
 * `dialect_flag`, `cultural_flag`, `brave_route_flag`, and an `issues[]` array
 * drawn from a controlled vocabulary. There is NO per-dimension sub-score —
 * so this component never fabricates weighted bars. Instead it surfaces the
 * REAL fired signals as the explanation: which issues the CCO raised, which
 * compliance flags tripped, the human-override triggers, and the strategic
 * rationale. A clean post shows "nothing fired" — which is itself the why.
 *
 * Everything is derived defensively from `item.flags` (free-form JSONB that may
 * or may not carry the CCO fields), `trigger_reason`, and `strategic_rationale`.
 */

import type { ReactNode } from 'react'
import { scoreBand as coreScoreBand, type ScoreBand } from '@repo/core'

// ── Score bands ────────────────────────────────────────────────────────────
// Thresholds live in @repo/core (SCORE_BANDS) — single source of truth. This
// module re-exports the band helper so the QA UI imports one consistent rule.

export type Band = ScoreBand

export const scoreBand = coreScoreBand

const BAND_META: Record<Band, { label: string; text: string; ring: string; bg: string; border: string }> = {
  clean: { label: 'CLEAN', text: 'text-emerald-400', ring: '#22c55e', bg: 'bg-emerald-500/8', border: 'border-emerald-500/25' },
  mark:  { label: 'MARK',  text: 'text-amber-400',   ring: '#f59e0b', bg: 'bg-amber-500/8',   border: 'border-amber-500/25' },
  hold:  { label: 'HOLD',  text: 'text-red-400',     ring: '#f43f5e', bg: 'bg-red-500/8',     border: 'border-red-500/25' },
}

// ── Severity ───────────────────────────────────────────────────────────────

type Severity = 'high' | 'med' | 'low'

const SEV_META: Record<Severity, { dot: string; text: string; label: string }> = {
  high: { dot: 'bg-red-400',    text: 'text-red-400',    label: 'high' },
  med:  { dot: 'bg-amber-400',  text: 'text-amber-400',  label: 'med' },
  low:  { dot: 'bg-(--fg-faint)', text: 'text-(--fg-muted)', label: 'low' },
}

// ── CCO issue vocabulary → human label + severity ──────────────────────────
// Keys mirror packages/core/src/schemas/cco.ts CcoIssue exactly.

const ISSUE_INFO: Record<string, { label: string; detail: string; sev: Severity }> = {
  translation_smell:             { label: 'Translation smell',        detail: 'Arabic reads like a literal translation, not native copy.', sev: 'med' },
  dialect_mismatch:              { label: 'Dialect mismatch',         detail: 'Dialect differs from the brand’s confirmed dialect.',       sev: 'med' },
  tone_drift:                    { label: 'Tone drift',               detail: 'Voice/register drifts from the brand method contract.',     sev: 'med' },
  anti_attribute_violation:      { label: 'Anti-attribute hit',       detail: 'Uses a phrasing the brand explicitly forbids.',             sev: 'high' },
  cultural_insensitivity:        { label: 'Cultural insensitivity',   detail: 'Content risks reading as culturally off in the KSA market.', sev: 'high' },
  hashtag_issue:                 { label: 'Hashtag issue',            detail: 'Hashtags are off-brand, malformed, or low quality.',        sev: 'low' },
  grammar_error:                 { label: 'Grammar error',            detail: 'Grammatical error in the Arabic caption.',                  sev: 'low' },
  religious_reference_uncleared: { label: 'Religious ref (uncleared)', detail: 'Religious reference used without compliance clearance.',    sev: 'high' },
  competitor_reference:          { label: 'Competitor reference',     detail: 'Mentions or alludes to a competitor.',                      sev: 'med' },
  price_claim_prohibited:        { label: 'Prohibited price claim',   detail: 'States a price/discount claim that policy prohibits.',      sev: 'high' },
  evaluation_failed:             { label: 'Evaluation failed',        detail: 'CCO could not evaluate this post (defaulted to 0).',        sev: 'high' },
  // v2 method-adherence issues — which brand-method dimension the caption broke.
  voice_register_mismatch:       { label: 'Voice register mismatch',  detail: 'Caption tone contradicts the brand’s voice register.',      sev: 'med' },
  opening_pattern_mismatch:      { label: 'Opening pattern mismatch', detail: 'Opening line doesn’t follow the brand’s diagnostic pattern.', sev: 'med' },
  visual_brief_mismatch:         { label: 'Visual idiom mismatch',    detail: 'Image brief contradicts the brand’s visual idiom.',         sev: 'med' },
  cadence_role_mismatch:         { label: 'Cadence role mismatch',    detail: 'Content type/objective is wrong for the brand’s cadence rule.', sev: 'med' },
  closing_pattern_mismatch:      { label: 'Closing pattern mismatch', detail: 'CTA/closing doesn’t match the brand’s closing pattern.',     sev: 'med' },
  // The method profile never reached the CCO → method adherence was NOT graded
  // (defaulted to neutral). Surfaced so admins know the score is incomplete.
  no_method_profile:             { label: 'Not graded on brand method', detail: 'No method profile reached the CCO — the 30% method-adherence portion of this score defaulted to neutral. Score reflects Arabic quality + brand fit only.', sev: 'low' },
}

// Named CCO compliance flags. negpat_flag is an enum; the rest are booleans.
const NEGPAT_SEV: Record<string, Severity | null> = {
  NONE: null, SOFT_WARN: 'low', STRONG_WARN: 'med', HARD_BLOCK: 'high',
}

// ── Signal extraction ──────────────────────────────────────────────────────

export interface Signal {
  key: string
  label: string
  detail: string
  sev: Severity
}

interface ComplianceFlag {
  label: string
  value: string
  ok: boolean
  sev: Severity | null
}

export interface VisualIssueItem {
  code: string
  label: string
  severity: 'high' | 'med' | 'low'
  detail?: string
}

export interface InsightSource {
  cco_score: number | null
  confidence_score?: number | null
  visual_score?: number | null
  visual_issues?: VisualIssueItem[] | null
  route_decision?: string | null
  flags?: Record<string, unknown> | null
  trigger_reason?: string | null
  strategic_rationale?: string | null
}

/** Parse flags defensively — n8n sometimes double-serializes JSONB as a string. */
function readFlags(flags: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!flags) return {}
  if (typeof flags === 'string') {
    try { return JSON.parse(flags) as Record<string, unknown> } catch { return {} }
  }
  return flags
}

/**
 * Build the full insight model from whatever real data the row carries.
 * Returns issue signals (from CCO issues[]), the four compliance flags, visual
 * issues, and a one-line plain verdict — all grounded in stored fields.
 */
export function buildInsight(src: InsightSource): {
  band: Band
  issues: Signal[]
  visualIssues: VisualIssueItem[]
  flags: ComplianceFlag[]
  verdict: string
  hasVisualScore: boolean
} {
  const flags = readFlags(src.flags)
  // Band is based on normalised composite (0-100) when available, else cco_score.
  const displayScore = normaliseComposite(src.confidence_score) ?? src.cco_score
  const band = scoreBand(displayScore)

  // 1. CCO issues[] — the richest caption "why". May live under flags.issues / cco_issues.
  const rawIssues =
    (Array.isArray(flags.issues) ? flags.issues : null) ??
    (Array.isArray(flags.cco_issues) ? flags.cco_issues : null) ??
    []
  const issues: Signal[] = (rawIssues as unknown[])
    .map((i) => String(i))
    .filter(Boolean)
    .map((key) => {
      const info = ISSUE_INFO[key]
      return info
        ? { key, label: info.label, detail: info.detail, sev: info.sev }
        : { key, label: key.replace(/_/g, ' '), detail: 'Flagged by the CCO agent.', sev: 'med' as Severity }
    })

  // 2. Visual issues — from migration 0117 visual QC pass.
  const visualIssues: VisualIssueItem[] = Array.isArray(src.visual_issues)
    ? src.visual_issues
    : []
  const hasVisualScore = typeof src.visual_score === 'number'

  // 3. The four named compliance flags.
  const complianceFlags: ComplianceFlag[] = []
  const negpat = flags.negpat_flag
  if (typeof negpat === 'string') {
    const sev = NEGPAT_SEV[negpat] ?? null
    complianceFlags.push({ label: 'Negative pattern', value: negpat, ok: negpat === 'NONE', sev })
  }
  for (const [key, label] of [
    ['dialect_flag', 'Dialect'],
    ['cultural_flag', 'Cultural'],
    ['brave_route_flag', 'Brave route'],
  ] as const) {
    if (key in flags && typeof flags[key] === 'boolean') {
      const tripped = flags[key] === true
      complianceFlags.push({ label, value: tripped ? 'flagged' : 'clean', ok: !tripped, sev: tripped ? 'med' : null })
    }
  }
  // Visual hard block flag — fires when visual_score === 0
  if (hasVisualScore && src.visual_score === 0) {
    complianceFlags.push({ label: 'Visual hard block', value: 'BLOCKED', ok: false, sev: 'high' })
  }

  // 4. Plain verdict — driven by score band only, NOT route_decision.
  // route_decision = 'hold' means "was sent to admin queue" (a routing action),
  // not "score is below threshold". A post scoring 84 with route=hold is CLEAN
  // score-wise — it was held by a human-override trigger, not because it failed.
  const s = displayScore ?? 0
  let verdict: string
  if (src.visual_score === 0) {
    verdict = `Visual hard block — image scored 0. Saudi cultural violation detected. Cannot be published.`
  } else if (band === 'hold') {
    verdict = `Score ${s.toFixed(0)} is below 50 — quality threshold not met.`
  } else if (band === 'mark') {
    verdict = `Score ${s.toFixed(0)} is in the 50–74 band — passes with watermark.`
  } else {
    verdict = `Score ${s.toFixed(0)} cleared 75 — meets quality threshold.`
  }

  return { band, issues, visualIssues, flags: complianceFlags, verdict, hasVisualScore }
}

// ── UI: circular score ring ────────────────────────────────────────────────

export function ScoreRing({ score, size = 64, label }: { score: number | null; size?: number; label?: string }) {
  const s = Math.max(0, Math.min(100, score ?? 0))
  const band = scoreBand(score)
  const meta = BAND_META[band]
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  const dash = (s / 100) * c
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={4} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={meta.ring} strokeWidth={4}
            strokeDasharray={`${dash} ${c}`} strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold ${meta.text}`} style={{ fontSize: size * 0.34 }}>
            {score === null ? '—' : s.toFixed(0)}
          </span>
        </div>
      </div>
      {label && <span className="text-[10px] uppercase tracking-widest text-(--fg-faint)">{label}</span>}
    </div>
  )
}

// ── UI: pillar bar ────────────────────────────────────────────────────────
// States:
//   score = number  → real scored bar, color-coded
//   score = null, pending = false (notScored) → "Not scored yet" — image QC hasn't run
//   score = null, pending = true  → "Coming soon" — pillar not yet implemented

function PillarBar({
  label, weight, score, pending, notScored,
}: { label: string; weight: string; score: number | null; pending?: boolean; notScored?: boolean }) {
  const pct = score === null ? 0 : Math.round(score)
  const barColor =
    score === null ? ''
    : score === 0  ? 'bg-red-500'
    : score >= 75  ? 'bg-emerald-500'
    : score >= 50  ? 'bg-amber-500'
                   : 'bg-red-400'

  return (
    <div className="flex items-center gap-3">
      {/* Label + weight */}
      <div className="w-28 shrink-0">
        <span className="text-[12px] font-semibold text-(--fg)">{label}</span>
        <span className="ml-1.5 text-[9px] font-normal text-(--fg-faint)">{weight}</span>
      </div>

      {/* Bar track */}
      <div className="flex-1 relative h-2.5 rounded-full bg-(--surface-3) overflow-hidden">
        {pending ? (
          // Not-yet-implemented: subtle diagonal stripe
          <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent,transparent_6px,rgba(255,255,255,0.035)_6px,rgba(255,255,255,0.035)_12px)]" />
        ) : notScored ? (
          // Image QC hasn't run yet: amber dashed pulse to communicate "should exist but missing"
          <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent,transparent_8px,rgba(245,158,11,0.12)_8px,rgba(245,158,11,0.12)_16px)] animate-pulse" />
        ) : (
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>

      {/* Score / status label */}
      <div className="w-16 shrink-0 text-right">
        {pending ? (
          <span className="text-[10px] text-(--fg-faint)">soon</span>
        ) : notScored ? (
          <span className="text-[10px] text-amber-500/70 font-medium">not run</span>
        ) : (
          <span className={`text-sm font-bold tabular-nums ${
            score === null ? 'text-(--fg-faint)'
            : score >= 75  ? 'text-emerald-400'
            : score >= 50  ? 'text-amber-400'
                           : 'text-red-400'
          }`}>
            {score === null ? '—' : score.toFixed(0)}
          </span>
        )}
      </div>
    </div>
  )
}

// ── UI: issue row ─────────────────────────────────────────────────────────

function IssueRow({ label, detail, severity }: { label: string; detail: string; severity: Severity }) {
  const sm = SEV_META[severity]
  const cardStyle =
    severity === 'high' ? 'border-red-500/30 bg-red-500/8'
    : severity === 'med' ? 'border-amber-500/25 bg-amber-500/8'
    : 'border-(--border-subtle) bg-(--surface-2)'
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 ${cardStyle}`}>
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${sm.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-(--fg)">{label}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-black/20 ${sm.text}`}>{sm.label}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-(--fg-muted)">{detail}</p>
      </div>
    </div>
  )
}

// ── UI: section header ────────────────────────────────────────────────────

function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-(--fg-faint)">{children}</p>
      {aside}
    </div>
  )
}

// ── UI: clean pass chip ───────────────────────────────────────────────────

function CleanChip({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/6 px-3.5 py-2.5">
      <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} className="shrink-0 text-emerald-400">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span className="text-xs text-emerald-300">{text}</span>
    </div>
  )
}

// ── UI: the full insight panel ─────────────────────────────────────────────
// NOTE: This panel does NOT render a score ring — the parent page owns the
// hero card. This panel only renders the detailed breakdown sections.

/** Normalise confidence_score: DB can store as basis-points (×100) when the CEO
 *  gate wrote it before B03's ÷100 guard was added. Anything >100 is divided by 100. */
export function normaliseComposite(raw: number | null | undefined): number | null {
  if (raw == null) return null
  return raw > 100 ? raw / 100 : raw
}

export function ScoreInsightPanel({ src, children }: { src: InsightSource; children?: ReactNode }) {
  const { issues, visualIssues, flags, hasVisualScore } = buildInsight(src)

  const captionScore   = src.cco_score
  const visualScore    = src.visual_score ?? null
  // Normalise: confidence_score may be stored as 0-10000 basis-points (÷100 → 0-100)
  const compositeScore = normaliseComposite(src.confidence_score)

  // Pillar scores from confidence-gate (stored in flags.pillars by B03 + A01).
  const pillars = (src.flags?.pillars ?? null) as Record<string, unknown> | null
  const brandFitScore  = typeof pillars?.brand_fit === 'number' ? (pillars.brand_fit as number) : null
  const occasionScore  = typeof pillars?.occasion  === 'number' ? (pillars.occasion  as number) : null

  // Only show the pillar breakdown if we have at least one real score
  const hasPillars = compositeScore !== null || captionScore !== null || hasVisualScore

  return (
    <div className="space-y-5">

      {/* ── Score breakdown ─────────────────────────────────────── */}
      {hasPillars && (
        <div>
          <SectionLabel>Score breakdown · 4 pillars</SectionLabel>
          <div className="rounded-2xl border border-(--border-subtle) bg-(--surface-2) px-5 py-4 space-y-3.5">
            <PillarBar label="Visual"    weight="35%" score={visualScore}    notScored={visualScore === null} />
            <PillarBar label="Caption"   weight="30%" score={captionScore ?? null} />
            <PillarBar label="Brand fit" weight="20%" score={brandFitScore}  notScored={brandFitScore === null} />
            <PillarBar label="Occasion"  weight="15%" score={occasionScore}  notScored={occasionScore === null} />
            <div className="pt-2 mt-1 border-t border-(--border-subtle) flex items-center justify-between">
              <span className="text-[11px] font-semibold text-(--fg-muted)">Composite</span>
              {compositeScore !== null ? (
                <span className={`text-lg font-bold tabular-nums ${
                  compositeScore >= 75 ? 'text-emerald-400' : compositeScore >= 50 ? 'text-amber-400' : 'text-red-400'
                }`}>{compositeScore.toFixed(1)} <span className="text-[10px] font-normal text-(--fg-faint)">/ 100</span></span>
              ) : (
                <span className="text-sm text-(--fg-faint)">{captionScore?.toFixed(0) ?? '—'} <span className="text-[10px] text-(--fg-faint)">(caption only)</span></span>
              )}
            </div>
          </div>

          {/* Explain why Visual shows "not run" */}
          {!hasVisualScore && (
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/6 px-3.5 py-2.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="shrink-0 mt-0.5 text-amber-400">
                <circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 8v4m0 4h.01"/>
              </svg>
              <div>
                <p className="text-[11px] font-semibold text-amber-300">Visual QC not run yet</p>
                <p className="text-[10px] text-amber-400/70 leading-relaxed mt-0.5">
                  The image has not been scored by the visual QC agent (GPT-4o vision). Visual score counts for 35% of the composite — once N8N calls the visual-qc route after generation, this will fill in automatically.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Visual QC ───────────────────────────────────────────── */}
      {hasVisualScore && (
        <div>
          <SectionLabel
            aside={
              <span className={`rounded-lg px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                visualScore === 0    ? 'bg-red-500/15 text-red-400'
                : (visualScore ?? 0) >= 75 ? 'bg-emerald-500/12 text-emerald-400'
                : (visualScore ?? 0) >= 50 ? 'bg-amber-500/12 text-amber-400'
                : 'bg-red-500/12 text-red-400'
              }`}>
                {visualScore}/100
              </span>
            }
          >
            Visual QC · GPT-4o
          </SectionLabel>
          {visualIssues.length === 0
            ? <CleanChip text="Image passed all visual checks — no issues found." />
            : <div className="space-y-2">{visualIssues.map((vi) => <IssueRow key={vi.code} label={vi.label} detail={vi.detail ?? ''} severity={vi.severity} />)}</div>
          }
        </div>
      )}

      {/* ── Caption QC ──────────────────────────────────────────── */}
      <div>
        <SectionLabel
          aside={
            captionScore !== null ? (
              <span className={`rounded-lg px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                (captionScore ?? 0) >= 75 ? 'bg-emerald-500/12 text-emerald-400'
                : (captionScore ?? 0) >= 50 ? 'bg-amber-500/12 text-amber-400'
                : 'bg-red-500/12 text-red-400'
              }`}>{captionScore}/100</span>
            ) : undefined
          }
        >
          Caption QC · CCO
        </SectionLabel>
        {issues.length === 0
          ? <CleanChip text="Caption passed — CCO found no issues to flag." />
          : <div className="space-y-2">{issues.map((sig) => <IssueRow key={sig.key} label={sig.label} detail={sig.detail} severity={sig.sev} />)}</div>
        }
      </div>

      {/* ── Compliance flags ────────────────────────────────────── */}
      {flags.length > 0 && (
        <div>
          <SectionLabel>Compliance flags</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {flags.map((f) => (
              <div key={f.label} className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 ${
                f.ok ? 'border-(--border-subtle) bg-(--surface-2)' : f.sev === 'high' ? 'border-red-500/30 bg-red-500/8' : 'border-amber-500/25 bg-amber-500/8'
              }`}>
                <span className="text-[11px] text-(--fg-muted)">{f.label}</span>
                <span className={`text-[10px] font-bold ${f.ok ? 'text-emerald-400' : f.sev === 'high' ? 'text-red-400' : 'text-amber-400'}`}>
                  {f.ok ? '✓' : f.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Strategic rationale ─────────────────────────────────── */}
      {src.strategic_rationale && (
        <div>
          <SectionLabel>Strategic rationale</SectionLabel>
          <p className="rounded-xl border border-(--border-subtle) bg-(--surface-2) px-4 py-3 text-xs leading-relaxed text-(--fg-muted)">
            {src.strategic_rationale}
          </p>
        </div>
      )}

      {children}
    </div>
  )
}

export { BAND_META }
