/**
 * DeepSeek V3 — Zod schema for the 20-Arabic-caption batch generation.
 *
 * The DeepSeek system prompt enforces the JSON contract below. The model
 * receives the COO-compiled CaptionContext (800–1200 tokens) and returns
 * a fixed-length array of caption objects.
 */
import { z } from 'zod'

export const ContentObjective = z.enum([
  'awareness',
  'engagement',
  'conversion',
  'cultural',
  'trust',
])
export type ContentObjective = z.infer<typeof ContentObjective>

export const ContentType = z.enum([
  'emotional',
  'lifestyle',
  'offer',
  'educational',
  'testimonial',
  'announcement',
  'experiential',
])
export type ContentType = z.infer<typeof ContentType>

export const Platform = z.enum(['Instagram', 'Snapchat', 'TikTok', 'Twitter'])

export const CaptionVariant = z.object({
  caption_ar: z.string().min(1),
  hashtags: z.array(z.string()).max(15),
  tone: z.string().min(1),
})
export type CaptionVariant = z.infer<typeof CaptionVariant>

export const OfferType = z.enum(['discount', 'bundle', 'free_shipping']).nullable()
export type OfferType = z.infer<typeof OfferType>

export const DeepSeekCaption = z.object({
  post_id: z.string(),
  caption_ar: z.string().min(1),
  // DeepSeek occasionally returns >15 hashtags — trim silently rather than fail all 3 retries.
  hashtags: z.array(z.string()).transform((arr) => arr.slice(0, 15)),
  // .catch() — DeepSeek occasionally invents an out-of-enum value (e.g. content
  // type "promotional", objective "loyalty"). These are soft routing hints, not
  // hard constraints, so default rather than failing the entire chunk's parse.
  content_type: ContentType.catch('emotional' as const),
  objective: ContentObjective.catch('engagement' as const),
  posting_time: z.string(), // ISO-8601 or "YYYY-MM-DD HH:mm"
  // .catch() — if DeepSeek omits or misspells platform, default to Instagram instead of retrying.
  platform: Platform.catch('Instagram' as const),
  visual_brief_en: z.string().min(1), // English-only brief for image gen (Hard Rule 3)
  watermark_required: z.boolean(),
  // Visual guidance — DeepSeek as single source of truth for Sharp overlay (§3.3).
  // .catch() so a model omission silently defaults rather than failing the entire 20-post batch.
  sharp_text_gravity: z.enum(['south', 'north', 'center']).catch('south' as const),
  font_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).catch('#FFFFFF' as const),
  font_size: z.number().int().min(24).max(96).catch(48 as const),
  // Rationale fields — logged to usage_logs only, never stored in calendar_posts.
  gravity_rationale: z.string().optional(),
  posting_time_rationale: z.string().optional(),
  caption_variants: z.array(CaptionVariant).length(3).optional(),
  // Offer fields — DeepSeek decides sector/occasion-appropriate commercial offers.
  // .catch(null) so omission never fails the batch.
  offer_type: OfferType.catch(null),
  discount_percentage: z.number().int().min(0).max(70).nullable().catch(null),
  // CCO scoring hints — positive boosts score, negative reduces it and may trigger flags.
  // Arrays default to [] on omission so downstream code never needs to null-check.
  positive_keywords: z.array(z.string()).catch([]),
  negative_keywords: z.array(z.string()).catch([]),
  // DeepSeek self-decides format based on visual_brief_en content — replaces plan-slots.
  // .catch('image') so older batches or omissions default safely without failing the whole batch.
  format: z.enum(['image', 'video']).catch('image' as const),
})
export type DeepSeekCaption = z.infer<typeof DeepSeekCaption>

export const DeepSeekResponse = z.object({
  brand_id: z.string().uuid(),
  month: z.string(), // "YYYY-MM"
  posts: z.array(DeepSeekCaption),
  reasoning: z.string().min(1),
})
export type DeepSeekResponse = z.infer<typeof DeepSeekResponse>

// ── Input ──────────────────────────────────────────────────────────
export interface ScheduleDate {
  date: string         // "YYYY-MM-DD"
  posting_time: string // "YYYY-MM-DDTHH:00:00+03:00"
  hour: number
}

export interface DeepSeekInput {
  brand_id: string
  month: string // "YYYY-MM"
  caption_context: string // Compiled by COO Job 2 — 800-1200 tokens
  post_count: number // dynamic — remaining working days this month, max 20
  schedule_dates: ScheduleDate[] // exact dates to use for posting_time, in order
  start_date: string // "YYYY-MM-DD" — today, first allowed date
  off_days: number[] // day-of-week indices: [0,6] = Sun+Sat
  occasion_context?: { name: string; lead_weeks: number; priority: string }
  intended_format?: string
  watermark_required: boolean
  /**
   * Per-slot content_type plan from the deterministic calendar slot planner,
   * aligned 1:1 with schedule_dates/posts order. When present, DeepSeek must
   * write each post to its assigned type (the n8n Merge step also enforces it).
   */
  content_type_plan?: ContentType[]
  /**
   * @deprecated — format is now decided per-post by DeepSeek itself based on
   * visual_brief_en content. This field is accepted for backward compat but
   * ignored; DeepSeek outputs `format` on each post instead (Doc §9.5 updated).
   */
  per_slot_formats?: ('image' | 'video')[]
}
