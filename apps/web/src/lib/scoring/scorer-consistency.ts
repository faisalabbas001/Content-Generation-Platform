// Posting Consistency scorer — pure math, no AI calls needed.
// Weight: 15%

import type { ScoringInput, DimensionResult, FindingDraft } from './types'
import { clamp } from './types'

// Saudi timezone offset (AST = UTC+3)
const AST_OFFSET = 3

// Sector prime-time windows in Saudi local hours (24h)
const PRIME_TIME: Record<string, { start: number; end: number }> = {
  fnb:     { start: 18, end: 21 },  // 6pm–9pm
  beauty:  { start: 20, end: 23 },  // 8pm–11pm
  retail:  { start: 19, end: 22 },  // 7pm–10pm
  default: { start: 18, end: 22 },
}

export function scorePostingConsistency(input: ScoringInput): DimensionResult {
  const posts = input.profile.posts
  const benchmarks = input.benchmarks.posting_consistency

  if (posts.length === 0) {
    return emptyResult()
  }

  const timestamps = posts
    .map(p => new Date(p.timestamp).getTime())
    .sort((a, b) => a - b)

  const now = Date.now()
  const day60 = now - 60 * 24 * 60 * 60 * 1000
  const postsLast60 = timestamps.filter(t => t >= day60)
  const postsPerWeek = postsLast60.length / (60 / 7)

  // ── Cadence score ─────────────────────────────────────────────────────────
  const benchmarkPpw = benchmarks['posts_per_week'] ?? 4.2
  const cadenceScore = clamp((postsPerWeek / benchmarkPpw) * 100)

  // ── Gap penalty ───────────────────────────────────────────────────────────
  let longestGapDays = 0
  let longestGapStart: Date | null = null
  let longestGapEnd: Date | null = null
  for (let i = 1; i < timestamps.length; i++) {
    const gapDays = (timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60 * 24)
    if (gapDays > longestGapDays) {
      longestGapDays = gapDays
      longestGapStart = new Date(timestamps[i - 1])
      longestGapEnd = new Date(timestamps[i])
    }
  }
  const gapScore = clamp(100 - longestGapDays * 3)

  // ── Prime-time hit rate ────────────────────────────────────────────────────
  const window = input.audience_active_hours ?? PRIME_TIME[input.sector] ?? PRIME_TIME.default
  const primeTimeHits = timestamps.filter(t => {
    const localHour = (new Date(t).getUTCHours() + AST_OFFSET) % 24
    return localHour >= window.start && localHour < window.end
  })
  const primeTimeScore = clamp((primeTimeHits.length / Math.max(posts.length, 1)) * 100)

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const score = Math.round(cadenceScore * 0.40 + gapScore * 0.20 + primeTimeScore * 0.40)

  // ── Findings ──────────────────────────────────────────────────────────────
  const findings: FindingDraft[] = []
  const benchP50 = benchmarks['overall'] ?? 48

  findings.push({
    finding_en: `Posts ${postsPerWeek.toFixed(1)} per week. Sector benchmark: ${benchmarkPpw.toFixed(1)}/week.`,
    finding_ar: `تنشر ${postsPerWeek.toFixed(1)} مرة في الأسبوع. معيار القطاع: ${benchmarkPpw.toFixed(1)} مرة.`,
    evidence_count: Math.round(postsPerWeek * 10) / 10,
    evidence_total: null,
    benchmark_count: Math.round(benchmarkPpw * 10) / 10,
    severity: postsPerWeek < benchmarkPpw * 0.5 ? 'high' : postsPerWeek < benchmarkPpw * 0.8 ? 'mid' : 'low',
  })

  if (longestGapDays > 7 && longestGapStart && longestGapEnd) {
    const fmt = (d: Date) => d.toLocaleDateString('en-SA', { month: 'short', day: 'numeric' })
    findings.push({
      finding_en: `${Math.round(longestGapDays)}-day gap between ${fmt(longestGapStart)} and ${fmt(longestGapEnd)} — longest silence.`,
      finding_ar: `انقطاع ${Math.round(longestGapDays)} يومًا بين ${fmt(longestGapStart)} و${fmt(longestGapEnd)}.`,
      evidence_count: Math.round(longestGapDays),
      evidence_total: null,
      benchmark_count: null,
      severity: longestGapDays > 21 ? 'high' : 'mid',
    })
  }

  const offPeakPct = Math.round((1 - primeTimeHits.length / Math.max(posts.length, 1)) * 100)
  if (offPeakPct > 50) {
    findings.push({
      finding_en: `${offPeakPct}% of posts published outside peak hours (${window.start}:00–${window.end}:00 Saudi time).`,
      finding_ar: `${offPeakPct}% من منشوراتك خارج ساعات الذروة (${window.start}:00–${window.end}:00 توقيت السعودية).`,
      evidence_count: posts.length - primeTimeHits.length,
      evidence_total: posts.length,
      benchmark_count: null,
      severity: offPeakPct > 70 ? 'high' : 'mid',
    })
  }

  const lift = clamp(85 - score, 0, 35)

  return {
    dimension: 'posting_consistency',
    score,
    weight: 0.15,
    benchmark: Math.round(benchP50),
    submetrics: {
      posts_per_week: Math.round(postsPerWeek * 10) / 10,
      cadence_score: Math.round(cadenceScore),
      longest_gap_days: Math.round(longestGapDays),
      gap_score: Math.round(gapScore),
      prime_time_pct: Math.round((primeTimeHits.length / Math.max(posts.length, 1)) * 100),
      prime_time_score: Math.round(primeTimeScore),
    },
    findings,
    action: {
      workflow_id: 'ai_content_calendar',
      action_label_en: 'AI Content Calendar — automated weekly schedule',
      action_label_ar: 'تقويم محتوى ذكي — جدول أسبوعي تلقائي',
      estimated_lift: lift,
      timeframe_weeks: 4,
      icon_emoji: '📅',
    },
  }
}

function emptyResult(): DimensionResult {
  return {
    dimension: 'posting_consistency',
    score: 0,
    weight: 0.15,
    benchmark: 48,
    submetrics: {},
    findings: [{
      finding_en: 'No posts found to analyze.',
      finding_ar: 'لا توجد منشورات للتحليل.',
      evidence_count: 0, evidence_total: 0, benchmark_count: null, severity: 'high',
    }],
    action: {
      workflow_id: 'ai_content_calendar',
      action_label_en: 'Start posting consistently with AI Calendar',
      action_label_ar: 'ابدأ النشر بانتظام مع تقويم الذكاء الاصطناعي',
      estimated_lift: 35, timeframe_weeks: 4, icon_emoji: '📅',
    },
  }
}
