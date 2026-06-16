// Brand Scorecard — shared types for scoring engine
// Used by scorers, API routes, and UI pages.

export type ScoreDimensionKey =
  | 'visual_quality'
  | 'cultural_fit'
  | 'posting_consistency'
  | 'brand_coherence'
  | 'engagement_health'

export const DIMENSION_WEIGHTS: Record<ScoreDimensionKey, number> = {
  visual_quality:       0.20,
  cultural_fit:         0.30,
  posting_consistency:  0.15,
  brand_coherence:      0.20,
  engagement_health:    0.15,
}

export const DIMENSION_LABELS: Record<ScoreDimensionKey, { en: string; ar: string; desc_en: string; desc_ar: string }> = {
  visual_quality:      { en: 'Visual Quality',       ar: 'جودة الصور',       desc_en: 'photography & composition',    desc_ar: 'تصوير وتكوين' },
  cultural_fit:        { en: 'Cultural Fit',          ar: 'الملاءمة الثقافية', desc_en: 'language, occasions & values', desc_ar: 'اللغة والمناسبات والقيم' },
  posting_consistency: { en: 'Posting Consistency',   ar: 'انتظام النشر',      desc_en: 'cadence & timing',            desc_ar: 'التوقيت والانتظام' },
  brand_coherence:     { en: 'Brand Coherence',       ar: 'تماسك الهوية',     desc_en: 'colors, fonts & voice',        desc_ar: 'الألوان والخطوط والصوت' },
  engagement_health:   { en: 'Engagement Health',     ar: 'صحة التفاعل',      desc_en: 'saves, comments & growth',     desc_ar: 'الحفظ والتعليقات والنمو' },
}

export interface InstagramPost {
  id: string
  media_url: string | null
  short_code?: string        // Instagram post shortCode
  media_base64?: string      // Pre-fetched image bytes as base64 (fetched immediately after scrape while CDN URLs are fresh)
  media_mime?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  caption: string | null
  timestamp: string         // ISO string
  like_count: number
  comments_count: number
}

export interface InstagramProfile {
  handle: string
  name: string
  biography: string | null
  followers_count: number
  media_count: number
  posts: InstagramPost[]
}

export interface BenchmarkSet {
  // keyed by submetric name → p50 value
  [submetric: string]: number
}

export interface DimensionResult {
  dimension: ScoreDimensionKey
  score: number               // 0–100
  weight: number
  benchmark: number | null
  submetrics: Record<string, number | string | null | Record<string, number>>
  findings: FindingDraft[]
  action: ActionDraft
}

export interface FindingDraft {
  finding_en: string
  finding_ar: string
  evidence_count: number | null
  evidence_total: number | null
  benchmark_count: number | null
  severity: 'high' | 'mid' | 'low'
}

export interface ActionDraft {
  workflow_id: string
  action_label_en: string
  action_label_ar: string
  estimated_lift: number
  timeframe_weeks: number
  icon_emoji: string
}

export interface ScoringInput {
  handle: string
  profile: InstagramProfile
  sector: string
  benchmarks: Record<ScoreDimensionKey, BenchmarkSet>
  // If authorized via Graph API (optional)
  audience_active_hours?: { start: number; end: number } | null
  saves_data?: Record<string, number> | null   // post_id → save_count
}

export interface ScoringOutput {
  dimensions: DimensionResult[]
  overall_score: number
  tier: 'low' | 'mid' | 'high'
  cultural_deepdive: CulturalDeepDive
}

export interface CulturalDeepDive {
  language_breakdown: Record<string, number>
  occasions: Array<{ key: string; status: 'hit' | 'late' | 'miss' }>
  dialect_multiplier: number | null
  dialect_multiplier_note_en: string
  dialect_multiplier_note_ar: string
}

export function scoreTier(score: number): 'low' | 'mid' | 'high' {
  if (score >= 70) return 'high'
  if (score >= 40) return 'mid'
  return 'low'
}

export function clamp(v: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, v))
}
