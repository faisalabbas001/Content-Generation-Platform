'use client'

/**
 * BrandDNA Enrichment — dynamic, DB-driven question wizard.
 *
 * Architecture:
 *   1. QUESTION_CATALOGUE — every collectable field, with HOW to ask it.
 *      This is static code (you need to know how to present each field).
 *
 *   2. rawBrand — the actual SELECT * row from brand_profiles.
 *      The form checks every catalogue entry against rawBrand and builds
 *      the active question queue from fields that are null/empty in the DB.
 *      Fully dynamic — no hardcoded "show these questions" logic.
 *
 *   3. Required vs Optional — catalogue entries marked optional don't block
 *      the "all required done" state.
 *
 *   4. Each answer saves via saveField() immediately, then removes that field
 *      from the pending queue.
 */

import { useState, useTransition } from 'react'
import { saveField, type InsightResult } from './actions'
import { InsightSidebar } from './insight-sidebar'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface InsightFormProps {
  brandId: string
  slug: string
  brandNameAr: string
  brandNameEn: string | null
  primaryColorHex: string | null
  completenessScore: number
  sector: string
  arabicDialect: string | null
  /** The entire SELECT * row — used to detect which fields are null */
  rawBrand: Record<string, unknown>
}

// ── Question catalogue ────────────────────────────────────────────────────────
// Every entry = one DB field the wizard can collect.
// The form reads rawBrand[id] at runtime to decide if this question is needed.

type QType = 'radio' | 'chips' | 'text' | 'textarea' | 'boolean' | 'products' | 'sar_range'
interface Opt { v: string; l: string; d?: string; e?: string }

interface CatalogueEntry {
  /** Must match the exact column name in brand_profiles */
  id: string
  type: QType
  layer: string
  layerNum: 1 | 2 | 3 | 4
  layerColor: string
  title: string
  sub: string
  unlock: string
  /** If true, does not block the "all required done" progress state */
  optional?: boolean
  options?: Opt[]
  multi?: boolean
  placeholder?: string
  maxLength?: number
  rows?: number
  trueLabel?: string
  falseLabel?: string
  trueDesc?: string
  falseDesc?: string
}

// Priority order: Layer 4 (strategy) → Layer 2 owner → Layer 3 content
// Required questions come before optional ones within each layer.
const CATALOGUE: CatalogueEntry[] = [

  // ══ Layer 4 — Strategic Intelligence ══════════════════════════════════════
  {
    id: 'goal_phase', type: 'radio',
    layer: 'Strategic Intelligence', layerNum: 4, layerColor: '#3DB88A',
    title: 'What is your main content goal right now?',
    sub: 'Every post in your calendar will be optimised toward this outcome.',
    unlock: 'Goal-aligned content mix and posting cadence',
    options: [
      { v: 'awareness',  e: '📣', l: 'Get discovered',   d: 'New people need to find me' },
      { v: 'conversion', e: '💰', l: 'Drive sales',      d: 'Turn followers into paying customers' },
      { v: 'retention',  e: '❤️', l: 'Build loyalty',    d: 'Keep existing customers coming back' },
      { v: 'launch',     e: '🚀', l: 'Launch something', d: 'Announce a new product or offer' },
    ],
  },
  {
    id: 'permission_level', type: 'radio',
    layer: 'Strategic Intelligence', layerNum: 4, layerColor: '#3DB88A',
    title: 'Where does your brand stand in its category?',
    sub: 'Your strategic position determines which creative approaches are available.',
    unlock: 'Category-appropriate creative strategies and authority signals',
    options: [
      { v: 'category_leader', e: '👑', l: 'Category Leader',  d: 'Top brand — we define what good looks like' },
      { v: 'challenger',      e: '⚡', l: 'Challenger',       d: 'Growing fast, disrupting the dominant player' },
      { v: 'sme_local',       e: '🏠', l: 'Local / SME',      d: 'Community-rooted, personal trust is our edge' },
      { v: 'launch',          e: '🌱', l: 'New launch',       d: 'Still building audience and authority' },
      { v: 'purpose',         e: '🎯', l: 'Purpose-driven',   d: 'Mission and values come before product' },
      { v: 'institutional',   e: '🏛️', l: 'Institutional',   d: 'Trust-first — finance, health, government' },
    ],
  },
  {
    id: 'primary_channel', type: 'chips',
    layer: 'Strategic Intelligence', layerNum: 4, layerColor: '#3DB88A',
    title: 'Which platform is your strongest right now?',
    sub: 'Format, caption length, and hashtag strategy will all be optimised for this platform first.',
    unlock: 'Platform-native content formats and optimised post specs',
    options: [
      { v: 'Instagram', e: '📸', l: 'Instagram' },
      { v: 'Snapchat',  e: '👻', l: 'Snapchat' },
      { v: 'TikTok',    e: '🎵', l: 'TikTok' },
      { v: 'Twitter',   e: '𝕏',  l: 'X / Twitter' },
    ],
  },
  {
    id: 'primary_kpi_type', type: 'radio',
    layer: 'Strategic Intelligence', layerNum: 4, layerColor: '#3DB88A',
    title: 'What metric matters most to you?',
    sub: 'Every post will be scored and optimised against this number.',
    unlock: 'Posts evaluated against the metric that matters most to you',
    options: [
      { v: 'engagement', e: '💬', l: 'Engagement',  d: 'Likes, comments, saves — audience connection' },
      { v: 'conversion', e: '💳', l: 'Sales / DMs', d: 'Orders, DMs, link clicks — direct revenue' },
      { v: 'awareness',  e: '👁️', l: 'Reach',       d: 'Impressions, new followers, views' },
      { v: 'trust',      e: '🤝', l: 'Trust',       d: 'Saves, shares, repeat visitors' },
    ],
  },
  {
    id: 'brave_safe_default', type: 'boolean',
    layer: 'Strategic Intelligence', layerNum: 4, layerColor: '#3DB88A',
    title: 'How bold should content be by default?',
    sub: 'You can override any individual post. This is just the system\'s starting setting.',
    unlock: 'Controls how adventurous the AI gets with hooks and creative angles',
    trueLabel: '🔥 Bold & brave',   trueDesc: 'Push toward daring, unexpected creative choices',
    falseLabel: '🛡 Safe & steady', falseDesc: 'Stay close to what consistently works in your sector',
  },
  {
    id: 'cultural_tension_owned', type: 'textarea', optional: true,
    layer: 'Strategic Intelligence', layerNum: 4, layerColor: '#3DB88A',
    title: 'What cultural truth does your brand uniquely own?',
    sub: 'The specific insight about Saudi culture or daily life that only your brand can speak to with full authority.',
    unlock: 'Your exclusive creative territory — the most distinctive content you can produce',
    placeholder: 'e.g. "Real hospitality is never convenient" · "Homemade is a philosophy, not a category"',
    maxLength: 300, rows: 3,
  },

  // ══ Layer 2 — Owner Profile (Required) ════════════════════════════════════
  {
    id: 'way_of_speaking', type: 'radio',
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'How do you naturally communicate?',
    sub: 'Every caption will be written in your actual voice — not a generic brand voice.',
    unlock: 'Captions that sound like you wrote them yourself',
    options: [
      { v: 'formal',       e: '💼', l: 'Formal',        d: 'Precise, authoritative, professional' },
      { v: 'casual',       e: '😊', l: 'Casual',         d: 'Friendly, relaxed, like texting a friend' },
      { v: 'storytelling', e: '📖', l: 'Storytelling',   d: 'Narrative, emotional, takes you somewhere' },
      { v: 'direct',       e: '⚡', l: 'Direct',         d: 'Clear and brief — just the point, no fluff' },
    ],
  },
  {
    id: 'comfort_on_camera', type: 'radio',
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'Are you willing to appear in video content?',
    sub: 'The system plans your content calendar differently based on founder visibility.',
    unlock: 'Founder video slots correctly assigned or skipped in your calendar',
    options: [
      { v: 'willing',        e: '🎤', l: 'Yes, on camera',  d: 'Happy to appear — face-forward content' },
      { v: 'hesitant',       e: '🤔', l: 'Minimal',          d: 'Occasionally, but prefer to stay back' },
      { v: 'not_interested', e: '🙅', l: 'Never on screen',  d: 'Voice and text only — no face content' },
    ],
  },
  {
    id: 'content_preferences', type: 'chips', multi: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'Which content formats do you personally connect with?',
    sub: 'The calendar will lean toward formats you genuinely enjoy creating.',
    unlock: 'Calendar weighted toward content types you actually connect with',
    options: [
      { v: 'product_shots',     e: '📸', l: 'Product shots' },
      { v: 'behind_the_scenes', e: '🎬', l: 'Behind the scenes' },
      { v: 'owner_on_camera',   e: '🎤', l: 'Founder on camera' },
      { v: 'testimonials',      e: '💬', l: 'Customer stories' },
      { v: 'educational',       e: '📚', l: 'Educational' },
      { v: 'lifestyle',         e: '☀️', l: 'Lifestyle' },
      { v: 'reels_short_video', e: '▶️', l: 'Reels / video' },
      { v: 'carousels',         e: '🖼️', l: 'Carousels' },
      { v: 'occasions',         e: '🎉', l: 'Occasion content' },
    ],
  },
  {
    id: 'products_list', type: 'products',
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'What products or services do you actually sell?',
    sub: 'Add your main offerings — name and price. The AI uses these for every promotional post.',
    unlock: 'Product-specific captions, price anchoring, and accurate promotional content',
  },
  {
    id: 'founding_story', type: 'textarea',
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'Tell us how your brand started.',
    sub: 'The real version — what frustrated you, what you wanted to fix, what you couldn\'t find anywhere else.',
    unlock: 'Founder story posts, brand anniversary content, and behind-the-brand chains',
    placeholder: 'When did you start, where, and why? 2–4 sentences. Be specific.',
    maxLength: 1000, rows: 5,
  },

  // ══ Layer 2 — Owner Profile (Optional) ════════════════════════════════════
  {
    id: 'owner_values', type: 'textarea', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'What do you believe in as a business owner?',
    sub: 'What would you never compromise on? What principle guides every decision?',
    unlock: 'Brand manifesto content, purpose-led campaigns, values-forward posts',
    placeholder: 'e.g. I believe quality should be visible, not just claimed. We never cut corners on...',
    maxLength: 500, rows: 3,
  },
  {
    id: 'brand_goals', type: 'text', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'What are you trying to achieve in the next 12 months?',
    sub: 'A specific, concrete goal — the system orients content toward making this happen.',
    unlock: 'Goal-aligned content mix — more of what works toward your actual target',
    placeholder: 'e.g. Open a second branch in Jeddah · Grow online orders to 40% of revenue',
    maxLength: 300,
  },
  {
    id: 'cust_desc', type: 'textarea', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'Describe your ideal customer in your own words.',
    sub: 'Not demographics — describe them as a person. What do they care about, what do they do?',
    unlock: 'Hyper-specific audience targeting in every caption and visual brief',
    placeholder: 'e.g. Young Saudi professional, health-conscious, drinks coffee alone between meetings, orders food online.',
    maxLength: 400, rows: 3,
  },
  {
    id: 'cust_quote', type: 'text', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'What would your ideal customer say about your brand?',
    sub: 'One sentence — the review they\'d leave that would make you proud.',
    unlock: 'Customer voice used in testimonial content and social proof captions',
    placeholder: 'e.g. "This is the first healthy drink I actually crave"',
    maxLength: 200,
  },
  {
    id: 'respected_brands', type: 'text', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'Name 1–2 brands you genuinely admire (not competitors).',
    sub: 'Any industry, any country. Brands that do something you wish yours did.',
    unlock: 'Creative references and inspiration anchors for content direction',
    placeholder: 'e.g. Apple, Talabat, Almarai, Nike',
    maxLength: 200,
  },
  {
    id: 'respected_why', type: 'text', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'What do you admire about those brands specifically?',
    sub: 'One quality — what they do that you want to bring into your own brand.',
    unlock: 'Directional reference for creative approach and brand positioning',
    placeholder: 'e.g. Apple\'s ability to make simple things feel premium',
    maxLength: 300,
  },
  {
    id: 'vision_text', type: 'textarea', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'Where do you want this brand to be in 12 months?',
    sub: 'In your own words — how does the brand feel, who knows about it, what changed?',
    unlock: 'Vision-aligned content, brand aspiration posts, milestone storytelling',
    placeholder: 'e.g. People recommend Zoi to their friends without being asked. We\'re the go-to healthy drink people actually know by name.',
    maxLength: 500, rows: 3,
  },
  {
    id: 'hero_why', type: 'textarea', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'What\'s your hero product and why does it matter most?',
    sub: 'The one product you\'d put on a billboard. Why this one over everything else?',
    unlock: 'Hero product content chains, flagship posts, and feature storytelling',
    placeholder: 'e.g. The Mango Ice Tea — because it proves you don\'t have to choose between healthy and delicious.',
    maxLength: 400, rows: 3,
  },
  {
    id: 'metric', type: 'text', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'How do you personally know when a post has worked?',
    sub: 'Not the official KPI — how do YOU feel it?',
    unlock: 'Content success framing aligned to what actually matters to you',
    placeholder: 'e.g. When customers DM asking where to buy · When someone shares it without being asked',
    maxLength: 200,
  },
  {
    id: 'communication_style', type: 'text', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'Describe your communication style in your own words.',
    sub: 'How would a close friend describe the way you talk? One sentence.',
    unlock: 'Every caption sounds like it came from you — not a template',
    placeholder: 'e.g. Direct and warm — gets to the point but always with a personal touch',
    maxLength: 200,
  },
  {
    id: 'physical_appearance_notes', type: 'text', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'Any appearance notes for founder content direction?',
    sub: 'Optional — only used when the system generates visual briefs for founder content.',
    unlock: 'Accurate visual direction for any founder-facing content',
    placeholder: 'e.g. Always in thobe, classic style · Prefers no face shown',
    maxLength: 300,
  },
  {
    id: 'price_nums', type: 'sar_range', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'What\'s the actual price range of your products or services?',
    sub: 'Set your minimum and maximum price in SAR — aligns content tone to price positioning.',
    unlock: 'Correct price anchoring in promotional content and value messaging',
  },
  {
    id: 'sub_sector', type: 'text', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'More specifically, what niche are you in?',
    sub: 'Your main sector is already set — this refines it for more precise content.',
    unlock: 'Niche-specific content angles and positioning',
    placeholder: 'e.g. Healthy beverages · Artisan coffee · Fast-casual dining · Luxury skincare',
    maxLength: 100,
  },
  {
    id: 'founded_year', type: 'text', optional: true,
    layer: 'Owner Profile', layerNum: 2, layerColor: '#7C6AF5',
    title: 'What year was the brand founded?',
    sub: 'Used for anniversary content and brand-age context.',
    unlock: 'Anniversary posts and brand heritage storytelling',
    placeholder: 'e.g. 2021',
    maxLength: 4,
  },

  // ══ Layer 3 — Content Identity (Required) ═════════════════════════════════
  {
    id: 'caption_style', type: 'radio',
    layer: 'Content Identity', layerNum: 3, layerColor: '#E5667A',
    title: 'What caption format works best for your audience?',
    sub: 'Every generated caption will follow this pattern.',
    unlock: 'Every caption in the exact format your audience responds to',
    options: [
      { v: 'short_punchy',      e: '💥', l: 'Short & punchy',    d: '1–3 lines, direct impact' },
      { v: 'long_storytelling', e: '📜', l: 'Long storytelling', d: 'Narrative paragraphs, emotional depth' },
      { v: 'question_hook',     e: '❓', l: 'Question hook',     d: 'Opens with a question to pull readers in' },
      { v: 'cta_heavy',         e: '👆', l: 'CTA-heavy',         d: 'Always ends with a clear call to action' },
    ],
  },
  {
    id: 'formality_level', type: 'radio',
    layer: 'Content Identity', layerNum: 3, layerColor: '#E5667A',
    title: 'What formality level is right for your brand?',
    sub: 'Controls the register of every caption, description, and copy output.',
    unlock: 'Correct formality on every output — nothing too stiff or too casual',
    options: [
      { v: 'casual',      e: '😊', l: 'Casual',      d: 'Friendly, personal, like talking to a regular' },
      { v: 'semi_formal', e: '🤝', l: 'Semi-formal', d: 'Professional but approachable' },
      { v: 'formal',      e: '💼', l: 'Formal',      d: 'Authoritative, precise, institutional' },
    ],
  },
  {
    id: 'humor_tolerance', type: 'radio',
    layer: 'Content Identity', layerNum: 3, layerColor: '#E5667A',
    title: 'How much playfulness fits your brand?',
    sub: 'Affects every caption, hook, and creative angle the system generates.',
    unlock: 'Exactly the right amount of wit — never awkward, never too serious',
    options: [
      { v: 'none',     e: '🎩', l: 'None',     d: 'Serious and professional at all times' },
      { v: 'light',    e: '😌', l: 'Light',    d: 'Occasional warmth — a smile, not a joke' },
      { v: 'moderate', e: '😄', l: 'Moderate', d: 'Playful and witty — humor is part of the brand' },
    ],
  },
  {
    id: 'posting_rhythm', type: 'chips',
    layer: 'Content Identity', layerNum: 3, layerColor: '#E5667A',
    title: 'How often do you realistically want to post?',
    sub: 'The calendar is built around what you can actually sustain — not an ideal that burns you out.',
    unlock: 'Calendar matches your real capacity — no missed posts or overwhelm',
    options: [
      { v: 'daily',    e: '📅', l: 'Daily',         d: '7 posts/week' },
      { v: '3x_week',  e: '📆', l: '3× per week',   d: 'Mon / Wed / Fri rhythm' },
      { v: 'weekly',   e: '🗓️', l: 'Once a week',   d: '1 strong post/week' },
      { v: 'biweekly', e: '⏳', l: 'Every 2 weeks', d: 'Consistent but less frequent' },
      { v: 'monthly',  e: '🌙', l: 'Once a month',  d: 'High-impact monthly post' },
    ],
  },

  // ══ Layer 3 — Content Identity (Optional) ═════════════════════════════════
  {
    id: 'tagline', type: 'text', optional: true,
    layer: 'Content Identity', layerNum: 3, layerColor: '#E5667A',
    title: 'What\'s your brand tagline or slogan?',
    sub: 'Used verbatim across every caption, pitch, and content brief.',
    unlock: 'Your exact tagline in every caption, description, and content brief',
    placeholder: 'e.g. طعم البيت · Where Quality Meets Taste · أصيل ومميز',
    maxLength: 100,
  },
  {
    id: 'caption_ex', type: 'textarea', optional: true,
    layer: 'Content Identity', layerNum: 3, layerColor: '#E5667A',
    title: 'Share a real caption you\'ve written that felt right.',
    sub: 'A real example from your own posts. The system learns your exact voice from it.',
    unlock: 'Caption tone calibrated to your actual writing style, not a guess',
    placeholder: 'Paste a caption you\'ve written before — the more real, the better.',
    maxLength: 500, rows: 4,
  },
  {
    id: 'custom_restriction', type: 'textarea', optional: true,
    layer: 'Content Identity', layerNum: 3, layerColor: '#E5667A',
    title: 'Anything the system should never produce for your brand?',
    sub: 'Content directions, phrases, visual styles, or topics that are permanently off-limits.',
    unlock: 'Hard guardrails — the system will never cross these lines in any content',
    placeholder: 'e.g. Never mention competitors · No religious jokes · Avoid aggressive sales language',
    maxLength: 400, rows: 3,
  },
  {
    id: 'music_link', type: 'text', optional: true,
    layer: 'Content Identity', layerNum: 3, layerColor: '#E5667A',
    title: 'Share a song or playlist that sounds like your brand.',
    sub: 'A Spotify link, YouTube link, or just the song name.',
    unlock: 'Emotional tone and energy matched to your brand\'s music identity',
    placeholder: 'e.g. https://open.spotify.com/... · "Blinding Lights" by The Weeknd',
    maxLength: 300,
  },
]

// ── The fields the catalogue covers — used for coverage reporting ─────────────
const CATALOGUE_FIELD_IDS = new Set(CATALOGUE.map((q) => q.id))

// ── Helper: is a raw DB value considered "filled"? ────────────────────────────
function isFieldFilled(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false
  if (typeof value === 'boolean') return true   // false = answered, not empty
  if (typeof value === 'number') return true    // 0 = answered, not empty
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

// ── Layers for display ────────────────────────────────────────────────────────
const LAYERS = [
  { num: 4, label: 'Strategic Intelligence', color: '#3DB88A' },
  { num: 2, label: 'Owner Profile',          color: '#7C6AF5' },
  { num: 3, label: 'Content Identity',       color: '#E5667A' },
] as const

// ── Main component ────────────────────────────────────────────────────────────

export function InsightForm({
  brandId, slug, brandNameAr, brandNameEn, primaryColorHex,
  completenessScore, sector, arabicDialect, rawBrand,
}: InsightFormProps) {

  // Build initial answered/unanswered split from rawBrand — this is the dynamic part.
  // For every catalogue entry, check if rawBrand has a non-null value for that field.
  const [filledFields, setFilledFields] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    for (const entry of CATALOGUE) {
      init[entry.id] = rawBrand[entry.id] ?? null
    }
    return init
  })

  const [pending, startTransition] = useTransition()
  const [savedId, setSavedId]      = useState<string | null>(null)
  const [error, setError]          = useState<string | null>(null)
  const [showAnswered, setShowAnswered]  = useState(false)
  const [showOptional, setShowOptional] = useState(false)

  // Compute which questions to show based on current filledFields
  const unanswered = CATALOGUE.filter((q) => !isFieldFilled(filledFields[q.id]))
  const answered   = CATALOGUE.filter((q) =>  isFieldFilled(filledFields[q.id]))
  const requiredUnanswered = unanswered.filter((q) => !q.optional)
  const optionalUnanswered = unanswered.filter((q) =>  q.optional)
  const requiredDone = requiredUnanswered.length === 0

  // Enrichment % = answered / total catalogue entries
  const enrichmentPct = Math.round((answered.length / CATALOGUE.length) * 100)
  const accent = primaryColorHex ?? '#10b981'

  // Count DB fields that are null but NOT in the catalogue (auto-filled fields)
  const nullNotInCatalogue = Object.entries(rawBrand)
    .filter(([k, v]) => !CATALOGUE_FIELD_IDS.has(k) && !isFieldFilled(v) &&
      // Exclude system/internal fields that are never user-collectable
      !['place_id','postiz_workspace_id','vector_namespace','sector_baseline_id',
        'extraction_prefill','brand_reply_samples','posts_observed_count',
        'audience_gender_mix','lora_model_id','lora_trained_at',
        'lora_approved_content_types','calibration_ended_reason',
        'creative_formulas_approved','strategy_version','content_mix_ratios',
        'platform_weights','occasion_approach','business_events',
        'content_goal','archetype_secondary','onboarding_started_at',
        'onboarding_completed_at','bio_link','top_mentioned_accounts',
        'signature_phrases','signature_hashtags','brand_reply_samples',
      ].includes(k)
    ).map(([k]) => k)

  // Active question index within the current pending pool
  const [activeIdx, setActiveIdx] = useState(0)
  const pendingPool = requiredDone ? optionalUnanswered : requiredUnanswered
  const activeQ = pendingPool[Math.min(activeIdx, pendingPool.length - 1)] ?? null

  // Per-question local input state (pre-populate from rawBrand)
  const [answers, setAnswers] = useState<Record<string, string | string[] | boolean>>(() => {
    const init: Record<string, string | string[] | boolean> = {}
    for (const q of CATALOGUE) {
      const v = rawBrand[q.id]
      if (q.multi)               init[q.id] = Array.isArray(v) ? (v as string[]) : []
      else if (q.type === 'boolean') init[q.id] = typeof v === 'boolean' ? v : false
      else if (typeof v === 'number') init[q.id] = String(v)
      else                       init[q.id] = typeof v === 'string' ? v : ''
    }
    return init
  })

  function set(id: string, val: string | string[] | boolean) {
    setAnswers((p) => ({ ...p, [id]: val }))
  }
  function toggleChip(id: string, v: string, multi: boolean) {
    if (!multi) { set(id, v); return }
    const cur = (answers[id] as string[] | undefined) ?? []
    set(id, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])
  }
  function hasAnswer(q: CatalogueEntry): boolean {
    const v = answers[q.id]
    if (q.multi) return (v as string[]).length > 0
    if (q.type === 'boolean') return true
    return String(v ?? '').trim().length > 0
  }

  async function doSave(q: CatalogueEntry) {
    setError(null)
    const val = answers[q.id]
    const fd  = new FormData()
    if (q.multi)               { for (const v of val as string[]) fd.append(q.id, v) }
    else if (q.type === 'boolean') fd.set(q.id, String(val))
    else                       fd.set(q.id, String(val ?? ''))

    let res: InsightResult
    try { res = await saveField(slug, q.id, fd) }
    catch { res = { ok: false, error: 'Network error — please try again.' } }

    if (!res.ok) { setError(res.error ?? 'Save failed'); return }

    // Mark field as filled in local state — removes it from pending pool
    setFilledFields((prev) => ({
      ...prev,
      [q.id]: q.id === 'founded_year'
        ? (isNaN(Number(val)) ? null : Number(val))
        : q.type === 'boolean' ? val
        : q.multi ? (val as string[]).length ? val : null
        : String(val || '') || null,
    }))

    setSavedId(q.id)
    setTimeout(() => setSavedId(null), 2000)
    setActiveIdx(0)
  }
  function onSave(q: CatalogueEntry) { startTransition(() => doSave(q)) }

  const requiredTotal    = CATALOGUE.filter((q) => !q.optional).length
  const requiredAnswered = CATALOGUE.filter((q) => !q.optional && isFieldFilled(filledFields[q.id])).length

  // ── Fully done screen ───────────────────────────────────────────────────────
  if (requiredDone && optionalUnanswered.length === 0) {
    return (
      <div className="flex gap-6 lg:gap-8 items-start">
      <InsightSidebar
        slug={slug} brandId={brandId}
        completenessScore={completenessScore} enrichmentPct={enrichmentPct}
        totalQuestions={CATALOGUE.length} answeredCount={answered.length}
        requiredTotal={requiredTotal} requiredAnswered={requiredAnswered}
      />
      <div className="flex-1 min-w-0 space-y-5">
        <div className="rounded-2xl border border-(--success)/30 bg-(--success)/5 px-5 py-4 flex items-start gap-4">
          <span className="text-3xl mt-0.5">✅</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-(--success)">
              BrandDNA fully enriched — {enrichmentPct}%
            </h2>
            <p className="text-xs text-(--fg-muted) mt-1 leading-relaxed">
              All {answered.length} fields are saved. To update any value, go to{' '}
              <a href={`/${slug}/profile`} className="text-(--accent) hover:underline font-medium">
                your profile page
              </a>.
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold tabular-nums" style={{ color: accent }}>{enrichmentPct}%</p>
            <p className="text-[10px] text-(--fg-faint) uppercase tracking-widest">Enrichment</p>
          </div>
        </div>

        {LAYERS.map((layer) => {
          const layerQs = answered.filter((q) => q.layerNum === layer.num)
          if (layerQs.length === 0) return null
          return (
            <div key={layer.num} className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white shrink-0" style={{ background: layer.color }}>
                  {layer.num}
                </span>
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: layer.color }}>
                  Layer {layer.num} — {layer.label}
                </p>
              </div>
              {layerQs.map((q) => (
                <AnsweredRow key={q.id} q={q} value={filledFields[q.id]} />
              ))}
            </div>
          )
        })}
      </div>
      </div>
    )
  }

  // ── Main wizard ─────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-6 lg:gap-8 items-start">

    {/* ── Sidebar ── */}
    <InsightSidebar
      slug={slug}
      brandId={brandId}
      completenessScore={completenessScore}
      enrichmentPct={enrichmentPct}
      totalQuestions={CATALOGUE.length}
      answeredCount={answered.length}
      requiredTotal={requiredTotal}
      requiredAnswered={requiredAnswered}
    />

    {/* ── Main column ── */}
    <div className="flex-1 min-w-0 space-y-6">

      {/* Progress header */}
      <div className="rounded-2xl border border-(--border-subtle) bg-(--surface-2) p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-base font-bold text-white" style={{ background: accent }}>
              {(brandNameEn || brandNameAr).slice(0, 1)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-(--fg) truncate">{brandNameEn || brandNameAr}</p>
              <p className="text-xs text-(--fg-muted)">{sector} · {arabicDialect?.replace(/_/g, ' ')}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: accent }}>{enrichmentPct}%</p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-(--fg-faint) mt-0.5">Enrichment</p>
            </div>
            <div className="text-right border-l border-(--border-subtle) pl-4">
              <p className="text-2xl font-bold tabular-nums leading-none text-(--fg-muted)">{completenessScore}%</p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-(--fg-faint) mt-0.5">BrandDNA</p>
            </div>
          </div>
        </div>

        {/* Progress bars */}
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between text-[11px] text-(--fg-faint) mb-1">
              <span>Enrichment — {answered.length}/{CATALOGUE.length} questions answered</span>
              {requiredDone
                ? <span className="text-(--success) font-semibold">✓ All required answered</span>
                : <span>{requiredUnanswered.length} required remaining</span>
              }
            </div>
            <div className="h-2 rounded-full bg-(--surface-4) overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${enrichmentPct}%`, background: accent }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] text-(--fg-faint) mb-1">
              <span>BrandDNA completeness — 12 critical onboarding fields</span>
            </div>
            <div className="h-1.5 rounded-full bg-(--surface-4) overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700 ease-out bg-(--fg-faint)/40" style={{ width: `${completenessScore}%` }} />
            </div>
          </div>
        </div>

        {/* Layer chips */}
        <div className="flex flex-wrap gap-2">
          {LAYERS.map((layer) => {
            const layerAll = CATALOGUE.filter((q) => q.layerNum === layer.num)
            const layerReq = layerAll.filter((q) => !q.optional)
            const layerDone = layerAll.filter((q) => isFieldFilled(filledFields[q.id])).length
            const reqDone   = layerReq.filter((q) => isFieldFilled(filledFields[q.id])).length === layerReq.length
            return (
              <div key={layer.num}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border"
                style={{
                  borderColor: reqDone ? 'var(--success)' : layer.color + '50',
                  color:       reqDone ? 'var(--success)' : layer.color,
                  background:  reqDone ? 'rgba(61,184,138,0.08)' : layer.color + '15',
                }}
              >
                <span>{reqDone ? '✓' : `${layerDone}/${layerAll.length}`}</span>
                <span>Layer {layer.num} — {layer.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Active question */}
      {activeQ && (
        <QuestionCard
          key={activeQ.id}
          q={activeQ}
          value={answers[activeQ.id]}
          onChange={(v) => set(activeQ.id, v)}
          onChip={(v) => toggleChip(activeQ.id, v, !!activeQ.multi)}
          onSave={() => onSave(activeQ)}
          pending={pending}
          saved={savedId === activeQ.id}
          error={error}
          hasAnswer={hasAnswer(activeQ)}
          sector={sector}
        />
      )}

      {/* Upcoming navigator */}
      {pendingPool.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-(--fg-faint)">
            {requiredDone ? 'Optional — ' : 'Up next — '}{pendingPool.length - 1} more
          </p>
          <div className="flex flex-wrap gap-2">
            {pendingPool.slice(1).map((q, i) => (
              <button key={q.id} type="button" onClick={() => setActiveIdx(i + 1)}
                className={['flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
                  activeIdx === i + 1
                    ? 'border-(--accent) bg-(--accent-soft)/30 text-(--accent)'
                    : 'border-(--border-default) bg-(--surface-3) text-(--fg-muted) hover:text-(--fg)',
                ].join(' ')}
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: q.layerColor }} />
                {q.title.length > 40 ? q.title.slice(0, 38) + '…' : q.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Required done — offer optional questions */}
      {requiredDone && optionalUnanswered.length > 0 && !showOptional && (
        <div className="rounded-2xl border border-(--success)/30 bg-(--success)/5 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-sm font-bold text-(--success)">All required questions answered</p>
              <p className="text-xs text-(--fg-muted) mt-0.5">
                {optionalUnanswered.length} optional field{optionalUnanswered.length > 1 ? 's' : ''} remaining — these boost content accuracy further.
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setShowOptional(true)}
            className="text-xs font-semibold text-(--accent) hover:underline"
          >
            Answer optional questions → reach {Math.round(((answered.length + optionalUnanswered.length) / CATALOGUE.length) * 100)}% enrichment
          </button>
        </div>
      )}

      {requiredDone && optionalUnanswered.length > 0 && showOptional && pendingPool.length === 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-(--fg-faint)">
            Optional — {optionalUnanswered.length} more to boost enrichment
          </p>
          <div className="flex flex-wrap gap-2">
            {optionalUnanswered.map((q, i) => (
              <button key={q.id} type="button"
                onClick={() => { setShowOptional(false); setActiveIdx(i) }}
                className="flex items-center gap-1.5 rounded-full border border-(--border-default) bg-(--surface-3) px-3 py-1.5 text-xs font-medium text-(--fg-muted) hover:text-(--fg) transition-all"
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: q.layerColor }} />
                {q.title.length > 40 ? q.title.slice(0, 38) + '…' : q.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Answered review */}
      {answered.length > 0 && (
        <div className="space-y-2 border-t border-(--border-subtle) pt-4">
          <button type="button" onClick={() => setShowAnswered((x) => !x)}
            className="flex items-center gap-2 text-xs font-semibold text-(--fg-muted) hover:text-(--fg) transition-colors"
          >
            <span className={['inline-block transition-transform duration-200', showAnswered ? 'rotate-90' : ''].join(' ')}>▶</span>
            {showAnswered ? 'Hide' : 'Review'} {answered.length} answered question{answered.length > 1 ? 's' : ''}
          </button>
          {showAnswered && (
            <div className="space-y-2">
              {answered.map((q) => (
                <AnsweredRow key={q.id} q={q} value={filledFields[q.id]} />
              ))}
              <p className="text-xs text-(--fg-faint) pt-1">
                To update any answer, go to{' '}
                <a href={`/${slug}/profile`} className="text-(--accent) hover:underline">your profile page</a>.
              </p>
            </div>
          )}
        </div>
      )}

    </div>
    </div>
  )
}

// ── SarRangeInput — min/max SAR price range with visual slider ───────────────
// Serialises to "SAR {min}–{max}" matching the existing price_nums column format.

function parseSarRange(raw: string | null): { min: string; max: string } {
  if (!raw) return { min: '', max: '' }
  // Formats: "SAR 10–50", "SAR 10-50", "10–50", "starts from SAR 25"
  const rangeMatch = raw.match(/(\d[\d,.]*)[\s–—-]+(\d[\d,.]*)/)
  if (rangeMatch) return { min: rangeMatch[1]!.replace(/,/g, ''), max: rangeMatch[2]!.replace(/,/g, '') }
  const singleMatch = raw.match(/(\d[\d,.]*)/)
  if (singleMatch) return { min: singleMatch[1]!.replace(/,/g, ''), max: '' }
  return { min: '', max: '' }
}

// Common SAR price presets by tier — tapping a preset fills both fields
const SAR_PRESETS = [
  { label: 'Under 50',    min: '5',   max: '50'   },
  { label: '50–200',      min: '50',  max: '200'  },
  { label: '200–500',     min: '200', max: '500'  },
  { label: '500–2,000',   min: '500', max: '2000' },
  { label: 'Over 2,000',  min: '2000',max: ''     },
]

function SarRangeInput({
  value, onChange, layerColor,
}: { value: string; onChange: (v: string) => void; layerColor: string }) {
  const init = parseSarRange(value)
  const [min, setMin] = useState(init.min)
  const [max, setMax] = useState(init.max)

  // Sync back to parent as "SAR min - max" whenever either changes
  function sync(nextMin: string, nextMax: string) {
    setMin(nextMin); setMax(nextMax)
    if (!nextMin && !nextMax) { onChange(''); return }
    if (nextMin && !nextMax)  { onChange(`SAR ${nextMin}+`); return }
    onChange(`SAR ${nextMin} - SAR ${nextMax}`)
  }

  const minNum = Number(min) || 0
  const maxNum = Number(max) || 0
  const validRange = !min || !max || maxNum >= minNum

  function applyPreset(p: typeof SAR_PRESETS[0]) { sync(p.min, p.max) }

  return (
    <div className="space-y-4" dir="ltr">
      {/* Quick presets */}
      <div className="space-y-1.5">
        <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide font-medium">Quick select</p>
        <div className="flex flex-wrap gap-2">
          {SAR_PRESETS.map((p) => {
            const active = min === p.min && max === p.max
            return (
              <button key={p.label} type="button" onClick={() => applyPreset(p)}
                className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-all"
                style={active
                  ? { background: layerColor, borderColor: layerColor, color: '#fff' }
                  : { borderColor: layerColor + '40', color: 'var(--fg-muted)' }
                }>
                SAR {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Min / Max inputs */}
      <div className="flex items-center gap-3">
        <div className="flex-1 space-y-1">
          <p className="text-xs font-medium text-(--fg-muted)">From (SAR)</p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-(--fg-muted)">SAR</span>
            <input
              type="number" min={0} step={1} placeholder="0"
              value={min}
              onChange={(e) => sync(e.currentTarget.value, max)}
              className="w-full rounded-xl border border-(--border-default) bg-(--surface-3) pl-12 pr-4 py-3 text-sm font-mono text-(--fg) placeholder:text-(--fg-faint) focus:outline-none transition-colors"
              onFocus={(e) => { e.currentTarget.style.borderColor = layerColor + '80' }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = '' }}
            />
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 pt-5">
          <div className="h-px w-6 bg-(--border-subtle)" />
          <span className="text-xs text-(--fg-faint)">to</span>
        </div>

        <div className="flex-1 space-y-1">
          <p className="text-xs font-medium text-(--fg-muted)">To (SAR)</p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-(--fg-muted)">SAR</span>
            <input
              type="number" min={0} step={1} placeholder="max"
              value={max}
              onChange={(e) => sync(min, e.currentTarget.value)}
              className="w-full rounded-xl border border-(--border-default) bg-(--surface-3) pl-12 pr-4 py-3 text-sm font-mono text-(--fg) placeholder:text-(--fg-faint) focus:outline-none transition-colors"
              onFocus={(e) => { e.currentTarget.style.borderColor = layerColor + '80' }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = '' }}
            />
          </div>
        </div>
      </div>

      {/* Live preview + validation */}
      {(min || max) && (
        <div className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
          validRange
            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
            : 'border-red-500/30 bg-red-500/5 text-red-400'
        }`}>
          {validRange ? (
            <>
              <span>✓</span>
              <span>
                {min && max ? `SAR ${min} - SAR ${max}` : `SAR ${min}+`}
              </span>
            </>
          ) : (
            <>
              <span>✕</span>
              <span>Maximum must be greater than minimum</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── ProductsBuilder — structured name+price product list ─────────────────────
// Parses existing "Name — SAR Price\n..." strings back into items,
// renders as chips with inline price editing, serialises on change.

interface ProductItem { name: string; price: string }

function parseProductsText(raw: string): ProductItem[] {
  if (!raw?.trim()) return []
  return raw.split('\n').map((line) => {
    const clean = line.replace(/^[-•]\s*/, '').trim()
    const sarMatch = clean.match(/^(.+?)\s*—\s*SAR\s*([\d.]+)/)
    if (sarMatch) return { name: sarMatch[1]!.trim(), price: sarMatch[2]!.trim() }
    const dashMatch = clean.match(/^(.+?)\s*—\s*([\d.]+)/)
    if (dashMatch) return { name: dashMatch[1]!.trim(), price: dashMatch[2]!.trim() }
    return clean ? { name: clean, price: '' } : null
  }).filter((x): x is ProductItem => x !== null && x.name.length > 0)
}

function serialiseProducts(items: ProductItem[]): string {
  return items.map((p) => p.price ? `${p.name} — SAR ${p.price}` : p.name).join('\n')
}

// Sector-based quick-add suggestions
const SECTOR_SUGGESTIONS: Record<string, string[]> = {
  'F&B':             ['Signature dish', 'Family meal', 'Gift box', 'Daily special', 'Catering package'],
  'Retail':          ['Main product', 'Bundle pack', 'Gift set', 'Limited edition'],
  'Beauty_Wellness': ['Facial treatment', 'Massage session', 'Monthly membership', 'Gift voucher'],
  'Healthcare':      ['Consultation', 'Follow-up visit', 'Health package', 'Lab test'],
}
const FALLBACK_SUGGESTIONS = ['Main product', 'Service package', 'Premium option', 'Starter offer']

function ProductsBuilder({
  value, onChange, layerColor, sector,
}: {
  value: string; onChange: (v: string) => void; layerColor: string; sector: string
}) {
  const [items, setItems]     = useState<ProductItem[]>(() => parseProductsText(value))
  const [name, setName]       = useState('')
  const [price, setPrice]     = useState('')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const suggestions = SECTOR_SUGGESTIONS[sector] ?? FALLBACK_SUGGESTIONS

  function sync(next: ProductItem[]) {
    setItems(next)
    onChange(serialiseProducts(next))
  }

  function addItem() {
    const n = name.trim()
    if (!n) return
    sync([...items, { name: n, price: price.trim() }])
    setName(''); setPrice('')
  }

  function removeItem(i: number) { sync(items.filter((_, idx) => idx !== i)) }

  function updatePrice(i: number, p: string) {
    sync(items.map((item, idx) => idx === i ? { ...item, price: p } : item))
  }

  function addSuggestion(s: string) {
    if (items.some((p) => p.name.toLowerCase() === s.toLowerCase())) return
    sync([...items, { name: s, price: '' }])
  }

  return (
    <div className="space-y-3">
      {/* Existing items as chips */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, i) => (
            <div key={i} className="inline-flex items-center rounded-full border overflow-hidden text-sm"
              style={{ borderColor: layerColor + '50', background: layerColor + '12' }}>
              <span className="px-3 py-1.5 font-medium text-(--fg)">{item.name}</span>
              {/* Price badge — click to edit */}
              {editingIdx === i ? (
                <div className="flex items-center gap-1 border-l px-2 py-1" style={{ borderColor: layerColor + '40' }}>
                  <span className="text-[11px] text-(--fg-muted)">SAR</span>
                  <input autoFocus type="text" inputMode="decimal" value={item.price} dir="ltr"
                    onChange={(e) => updatePrice(i, e.currentTarget.value.replace(/[^0-9.]/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingIdx(null) }}
                    onBlur={() => setEditingIdx(null)}
                    className="w-14 bg-transparent text-sm text-(--fg) text-right focus:outline-none"
                    placeholder="0"
                  />
                </div>
              ) : (
                <button type="button" onClick={() => setEditingIdx(i)}
                  className="border-l px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10"
                  style={{ borderColor: layerColor + '40', color: item.price ? layerColor : 'var(--fg-faint)' }}>
                  {item.price ? `SAR ${item.price}` : 'add price'}
                </button>
              )}
              <button type="button" onClick={() => removeItem(i)}
                className="border-l px-2 py-1.5 text-(--fg-muted) hover:text-red-400 transition-colors text-sm"
                style={{ borderColor: layerColor + '40' }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Add new item row */}
      <div className="flex gap-2 items-center" dir="ltr">
        <input
          type="text" dir="auto" placeholder="Product or service name"
          value={name} onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
          className="flex-1 min-w-0 rounded-xl border border-(--border-default) bg-(--surface-3) px-3 py-2 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none transition-colors"
          onFocus={(e) => { e.currentTarget.style.borderColor = layerColor + '80' }}
          onBlur={(e)  => { e.currentTarget.style.borderColor = '' }}
        />
        <div className="flex items-center gap-1 rounded-xl border border-(--border-default) bg-(--surface-3) px-3 py-2 shrink-0"
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = layerColor + '80' }}
          onBlur={(e)  => { (e.currentTarget as HTMLElement).style.borderColor = '' }}>
          <span className="text-xs text-(--fg-muted) shrink-0">SAR</span>
          <input type="text" inputMode="decimal" dir="ltr" placeholder="0" value={price}
            onChange={(e) => setPrice(e.currentTarget.value.replace(/[^0-9.]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
            className="w-16 bg-transparent text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none text-right"
          />
        </div>
        <button type="button" onClick={addItem} disabled={!name.trim()}
          className="shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition-all disabled:opacity-30"
          style={{ background: layerColor, color: '#fff' }}>
          + Add
        </button>
      </div>

      {/* Quick-add suggestion chips */}
      {items.length < 8 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide font-medium">Quick add</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions
              .filter((s) => !items.some((p) => p.name.toLowerCase() === s.toLowerCase()))
              .map((s) => (
                <button key={s} type="button" onClick={() => addSuggestion(s)}
                  className="rounded-full border border-(--border-subtle) bg-(--surface-3) px-3 py-1 text-xs text-(--fg-muted) hover:text-(--fg) hover:border-(--border-strong) transition-colors">
                  + {s}
                </button>
              ))}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <p className="text-[11px] text-(--fg-faint)">{items.length} item{items.length !== 1 ? 's' : ''} · click a price to edit it</p>
      )}
    </div>
  )
}

// ── QuestionCard ──────────────────────────────────────────────────────────────

function QuestionCard({
  q, value, onChange, onChip, onSave, pending, saved, error, hasAnswer, sector,
}: {
  q: CatalogueEntry
  value: string | string[] | boolean | undefined
  onChange: (v: string | string[] | boolean) => void
  onChip: (v: string) => void
  onSave: () => void
  pending: boolean; saved: boolean; error: string | null; hasAnswer: boolean
  sector: string
}) {
  const str  = typeof value === 'string' ? value : ''
  const arr  = Array.isArray(value) ? value : []
  const bool = typeof value === 'boolean' ? value : false

  return (
    <div className="overflow-hidden rounded-2xl border-2 shadow-lg" style={{ borderColor: q.layerColor + '60' }}>
      {/* Layer banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
        style={{ background: q.layerColor + '18', borderBottom: `1px solid ${q.layerColor}30` }}>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: q.layerColor }}>
            {q.layerNum}
          </span>
          <span className="text-sm font-bold" style={{ color: q.layerColor }}>
            Layer {q.layerNum} — {q.layer}
          </span>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: q.layerColor + '25', color: q.layerColor }}>
          Unlocks: {q.unlock}
        </span>
      </div>

      {/* Body */}
      <div className="bg-(--surface-2) p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="text-lg font-bold text-(--fg) leading-snug">{q.title}</h3>
          <p className="text-sm text-(--fg-muted) mt-1.5 leading-relaxed">{q.sub}</p>
        </div>

        {q.type === 'radio' && q.options && (
          <div className="grid gap-3 sm:grid-cols-2">
            {q.options.map((opt) => (
              <label key={opt.v}
                className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all"
                style={str === opt.v ? { borderColor: q.layerColor, background: q.layerColor + '12', boxShadow: `0 0 0 1px ${q.layerColor}40` } : {}}
              >
                <input type="radio" name={q.id} value={opt.v} checked={str === opt.v} onChange={() => onChange(opt.v)} className="sr-only" />
                {opt.e && <span className="text-2xl shrink-0 mt-0.5 leading-none">{opt.e}</span>}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-(--fg)">{opt.l}</span>
                  {opt.d && <span className="text-xs text-(--fg-muted) mt-0.5 block">{opt.d}</span>}
                </span>
                {str === opt.v && <span className="shrink-0 text-lg font-bold" style={{ color: q.layerColor }}>✓</span>}
              </label>
            ))}
          </div>
        )}

        {q.type === 'chips' && q.options && (
          <div className="flex flex-wrap gap-2">
            {q.options.map((opt) => {
              const active = q.multi ? arr.includes(opt.v) : str === opt.v
              return (
                <button key={opt.v} type="button" onClick={() => onChip(opt.v)} aria-pressed={active}
                  className="flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all"
                  style={active ? { background: q.layerColor, borderColor: q.layerColor, color: '#fff' } : {}}
                >
                  {opt.e && <span className="text-base">{opt.e}</span>}
                  {opt.l}
                  {active && <span className="text-xs opacity-80">✓</span>}
                </button>
              )
            })}
            {q.multi && arr.length > 0 && (
              <p className="w-full text-xs mt-1" style={{ color: q.layerColor }}>{arr.length} selected</p>
            )}
          </div>
        )}

        {q.type === 'textarea' && (
          <div className="space-y-1.5">
            <textarea dir="auto" rows={q.rows ?? 4} maxLength={q.maxLength} placeholder={q.placeholder}
              value={str} onChange={(e) => onChange(e.currentTarget.value)}
              className="w-full rounded-xl border border-(--border-default) bg-(--surface-3) px-4 py-3 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none resize-none leading-relaxed transition-colors"
              onFocus={(e) => { e.currentTarget.style.borderColor = q.layerColor + '80' }}
              onBlur={(e)  => { e.currentTarget.style.borderColor = '' }}
            />
            {q.maxLength && <p className="text-right text-[11px] text-(--fg-faint)">{str.length}/{q.maxLength}</p>}
          </div>
        )}

        {q.type === 'text' && (
          <input type="text" dir="auto" maxLength={q.maxLength} placeholder={q.placeholder}
            value={str} onChange={(e) => onChange(e.currentTarget.value)}
            className="w-full rounded-xl border border-(--border-default) bg-(--surface-3) px-4 py-3 text-sm text-(--fg) placeholder:text-(--fg-faint) focus:outline-none transition-colors"
            onFocus={(e) => { e.currentTarget.style.borderColor = q.layerColor + '80' }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = '' }}
          />
        )}

        {q.type === 'boolean' && (
          <div className="grid grid-cols-2 gap-3">
            {([
              { val: true,  label: q.trueLabel!,  desc: q.trueDesc! },
              { val: false, label: q.falseLabel!, desc: q.falseDesc! },
            ] as const).map((opt) => (
              <label key={String(opt.val)} className="flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 transition-all"
                style={bool === opt.val ? { borderColor: q.layerColor, background: q.layerColor + '12', boxShadow: `0 0 0 1px ${q.layerColor}40` } : {}}
              >
                <input type="radio" name={q.id} checked={bool === opt.val} onChange={() => onChange(opt.val)} className="sr-only" />
                <span className="text-sm font-bold text-(--fg)">{opt.label}</span>
                <span className="text-xs text-(--fg-muted) leading-relaxed">{opt.desc}</span>
              </label>
            ))}
          </div>
        )}

        {q.type === 'products' && (
          <ProductsBuilder
            value={str}
            onChange={(v) => onChange(v)}
            layerColor={q.layerColor}
            sector={sector}
          />
        )}

        {q.type === 'sar_range' && (
          <SarRangeInput
            value={str}
            onChange={(v) => onChange(v)}
            layerColor={q.layerColor}
          />
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <span className="text-red-400 shrink-0">⚠</span>
            <p className="text-sm text-red-400 font-medium">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 pt-1 border-t border-(--border-subtle)">
          <p className="text-xs text-(--fg-faint)">Saves immediately and updates your BrandDNA</p>
          <button type="button" disabled={pending || !hasAnswer} onClick={onSave}
            className="flex shrink-0 items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={saved
              ? { background: 'rgba(61,184,138,0.15)', color: 'var(--success)', border: '1px solid rgba(61,184,138,0.3)' }
              : hasAnswer ? { background: q.layerColor, color: '#fff' }
              : { background: 'var(--surface-4)', color: 'var(--fg-faint)' }
            }
          >
            {pending ? (
              <><span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />Saving…</>
            ) : saved ? '✓ Saved' : 'Save & continue →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AnsweredRow — read-only ────────────────────────────────────────────────────

function AnsweredRow({ q, value }: { q: CatalogueEntry; value: unknown }) {
  let display = '—'
  if (Array.isArray(value))            display = (value as string[]).join(', ')
  else if (typeof value === 'boolean') display = value ? (q.trueLabel ?? 'Yes') : (q.falseLabel ?? 'No')
  else if (typeof value === 'number')  display = String(value)
  else if (typeof value === 'string' && value)
    display = value.length > 90 ? value.slice(0, 88) + '…' : value

  return (
    <div className="flex items-start gap-3 rounded-xl border border-(--border-subtle) bg-(--surface-2) px-4 py-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: q.layerColor }}>✓</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-(--fg) truncate">{q.title}</p>
        <p className="text-xs text-(--fg-muted) mt-0.5" dir="auto">{display}</p>
      </div>
    </div>
  )
}
