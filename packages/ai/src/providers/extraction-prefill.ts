/**
 * Extraction Pre-fill agent — Claude Haiku 4.5 with vision.
 *
 * One LLM call that converts the full extraction payload (raw IG + posts +
 * post images + website + Places) into pre-fill defaults for every editable
 * field on the Step-3 review form.
 *
 * Why a separate agent (not COO):
 *   • COO writes BrandDNA — protected behind the Memory Controller (Hard
 *     Rule #2). Pre-fills are ephemeral defaults, not BrandDNA.
 *   • COO is Sonnet-tier reasoning. This is bounded classification — Haiku
 *     is the right tool.
 *
 * Vision: we fetch up to 6 IG-CDN images (profile pic + top 5 post
 * thumbnails) server-side, base64-encode them, and attach as vision blocks
 * alongside the JSON payload. This grounds colour / visual-subject /
 * audience-skew decisions in actual pixels rather than guessing from
 * captions. Vision adds ~3K tokens/image but Haiku 4.5 is cheap enough that
 * one call per onboarding stays well under $0.05.
 *
 * Cost guard: caller skips invocation when `hasUsableExtractionData()` is
 * false (all 3 lanes empty). Returns an all-null prefill in that case so
 * the review form shows blank fields the user fills by hand.
 */
import { z } from 'zod'
import type { Db } from '@repo/db/client'
import { loadPrompt } from '../prompts'
import { parseStructuredJson } from '../json'
import { withRetryAndLogging } from '../retry'
import { getAnthropicClient, priceClaudeUsage, type ClaudeModel } from './anthropic'

const PREFILL_MODEL: ClaudeModel = 'claude-haiku-4-5-20251001'
const PREFILL_MAX_TOKENS = 2048
const MAX_VISION_IMAGES   = 6
const IMAGE_FETCH_TIMEOUT_MS = 5000
/** Max image size we'll send to Haiku — Anthropic accepts up to 5MB but
 *  IG CDN thumbs are ~150–400KB so we cap at 1MB to leave headroom. */
const MAX_IMAGE_BYTES = 1_000_000

// ── Enums ───────────────────────────────────────────────────────────

export const SectorEnum     = z.enum(['F&B', 'Retail', 'Beauty_Wellness', 'Healthcare', 'Finance', 'Government', 'Other'])
export const CityEnum       = z.enum(['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar', 'Tabuk', 'Abha', 'Other'])
export const DialectEnum    = z.enum(['Najdi', 'Hejazi', 'Gulf', 'MSA_formal', 'MSA_accessible', 'Mixed'])
export const FormalityEnum  = z.enum(['casual', 'semi_formal', 'formal'])
export const HumorEnum      = z.enum(['none', 'light', 'moderate'])
export const ReligiousEnum  = z.enum(['Low', 'Medium', 'High'])
export const BilingualEnum  = z.enum(['arabic_only', 'arabic_primary', 'balanced', 'english_primary'])
export const PriceEnum      = z.enum(['budget', 'mid_market', 'premium', 'luxury'])
export const ChannelEnum    = z.enum(['Instagram', 'Snapchat', 'TikTok', 'Twitter'])
export const KpiEnum        = z.enum(['engagement', 'conversion', 'awareness', 'trust'])
export const IntentEnum     = z.enum(['launch', 'grow', 'defend', 'harvest', 'recover'])
export const LifecycleEnum  = z.enum(['pre_launch', 'launch', 'growth', 'maturity', 'recovery'])
export const RelevanceEnum  = z.enum(['Critical', 'High', 'Medium', 'Low', 'Not_relevant'])
export const CadenceEnum    = z.enum(['daily', 'several_per_week', 'weekly', 'sporadic', 'dormant'])
export const AntiAttrEnum       = z.enum(['aggressive', 'western_casual', 'flashy', 'edgy', 'ironic', 'formal_corporate', 'casual_humor', 'salesy'])
export const ArchetypeFamilyEnum = z.enum(['hero', 'caregiver', 'explorer', 'creator'])
export const ArchetypePrimaryEnum = z.enum([
  'hero_hero','hero_outlaw','hero_magician',
  'care_caregiver','care_ruler','care_everyman',
  'exp_explorer','exp_sage','exp_jester',
  'crt_creator','crt_lover','crt_innocent',
])
export const LifestyleEnum      = z.enum(['family_home','coffee_solo','mall_friends','gym','gathering','outdoor'])
export const MusicEnum          = z.enum(['acoustic','arabic','pop','cinematic','lofi','energy'])
export const GoalEnum           = z.enum(['orders','awareness','launch','community','trust'])
export const EmotionEnum        = z.enum([
  'Inspired','Proud','Calm','Excited','Nostalgic','Trusted',
  'Delighted','Empowered','Curious','Warm','Energized','Secure',
  'Bold','Playful','Sophisticated','Motivated','Grateful','Happy',
  'Refreshed','Connected','Joyful','Reassured',
])
const ConfidenceEnum        = z.enum(['high', 'medium', 'low'])
const HexColor              = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

// ── Schema (covers every field on the v6 form) ────────────────────────

export const ExtractionPrefillSchema = z.object({
  // Identity
  brand_name_en:          z.string().min(1).max(200).nullable(),
  business_category:      z.string().min(1).max(120).nullable(),
  sector_hint:            SectorEnum.nullable(),
  city_hint:              CityEnum.nullable(),
  // Voice
  arabic_dialect:         DialectEnum.nullable(),
  formality_level:        FormalityEnum.nullable(),
  humor_tolerance:        HumorEnum.nullable(),
  religious_sensitivity:  ReligiousEnum.nullable(),
  bilingual_ratio:        BilingualEnum.nullable(),
  price_position:         PriceEnum.nullable(),
  tone_anti_attribute_ids: z.array(AntiAttrEnum).max(3).default([]),
  brand_differentiator:   z.string().min(1).max(240).nullable(),
  primary_color_hex:      HexColor.nullable(),
  // Strategy
  primary_channel:        ChannelEnum.nullable(),
  primary_kpi_type:       KpiEnum.nullable(),
  intent_state:           IntentEnum.nullable(),
  lifecycle_stage_hint:   LifecycleEnum.nullable(),
  audience_female_pct:    z.number().int().min(0).max(100).nullable(),
  audience_male_pct:      z.number().int().min(0).max(100).nullable(),
  // Saudi occasions
  ramadan_relevance:      RelevanceEnum.nullable(),
  eid_fitr_relevance:     RelevanceEnum.nullable(),
  eid_adha_relevance:     RelevanceEnum.nullable(),
  national_day_relevance: RelevanceEnum.nullable(),
  founding_day_relevance: RelevanceEnum.nullable(),
  // Other
  online_native:          z.boolean().nullable(),
  has_holding_page:       z.boolean().nullable(),
  posting_cadence_hint:   CadenceEnum.nullable(),
  // v6 extended fields
  archetype_family:       ArchetypeFamilyEnum.nullable().default(null),
  archetype_primary:      ArchetypePrimaryEnum.nullable().default(null),
  lifestyle:              LifestyleEnum.nullable().default(null),
  music:                  MusicEnum.nullable().default(null),
  goal:                   GoalEnum.nullable().default(null),
  emotions:               z.array(EmotionEnum).max(3).default([]),
  restrictions:           z.array(z.string()).max(5).default([]),
  occasions_ranked:       z.array(z.string()).max(3).default([]),
  confidence:             z.record(ConfidenceEnum).default({}),
})
export type ExtractionPrefill = z.infer<typeof ExtractionPrefillSchema>

// ── Cost guard ──────────────────────────────────────────────────────

export interface ExtractionPrefillInput {
  brand_id: string
  /** FULL untouched IG Apify response (details + posts + latestPosts) or null. */
  instagram: unknown | null
  /** FULL Apify Website Crawler output (pages with metadata + markdown) or null. */
  website:   unknown | null
  /** Google Places candidate or null. */
  places:    unknown | null
  /** Numeric signals derived from IG (mirrors what the normaliser computes). */
  signals: {
    followers_count:    number | null
    post_count_total:   number | null
    post_frequency_30d: number | null
    account_age_months: number | null
  }
}

export function hasUsableExtractionData(input: ExtractionPrefillInput): boolean {
  const igOk     = !!input.instagram && hasContent(input.instagram, ['details', 'posts'])
  const webOk    = !!input.website   && hasContent(input.website,   ['pages'])
  const placesOk = !!input.places    && hasContent(input.places,    ['candidate'])
  return igOk || webOk || placesOk
}

function hasContent(obj: unknown, keys: string[]): boolean {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  return keys.some((k) => {
    const v = o[k]
    if (v == null) return false
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === 'object') return Object.keys(v).length > 0
    return true
  })
}

// ── Call ────────────────────────────────────────────────────────────

export interface ExtractionPrefillOptions {
  flow_id: string
  brand_id: string
  db: Db | null
  /** When provided, used to load sector baseline defaults for no-history brands. */
  sector?: string | null
}

export interface ExtractionPrefillResult {
  prefill: ExtractionPrefill
  ran: boolean
  skipped_reason?: string
}

export async function runExtractionPrefill(
  input: ExtractionPrefillInput,
  opts: ExtractionPrefillOptions,
): Promise<ExtractionPrefillResult> {
  if (!hasUsableExtractionData(input)) {
    // No social history — load sector baseline defaults so the form shows
    // meaningful starting points instead of blank fields (spec §3.3).
    const sectorPrefill = opts.sector && opts.db
      ? await sectorDefaultPrefill(opts.sector, opts.db)
      : emptyPrefill()
    console.info(
      `[extraction-prefill] SKIP brand=${opts.brand_id} reason=no_usable_data` +
      ` sector=${opts.sector ?? 'none'} sector_defaults=${sectorPrefill !== null ? 'applied' : 'empty'}`,
    )
    return {
      prefill: sectorPrefill,
      ran: false,
      skipped_reason: opts.sector ? 'no_usable_data_sector_defaults_applied' : 'no_usable_data',
    }
  }

  const system = loadPrompt('EXTRACTION_PREFILL_SYSTEM_PROMPT')
  const client = getAnthropicClient()

  // Build the full text payload — pass the rich extraction shape, lightly
  // trimmed only to drop noise (signed CDN audio URLs, nested debug blobs).
  const trimmedIg  = trimInstagram(input.instagram)
  const trimmedWeb = trimWebsite(input.website)
  const userPayload = {
    instagram:     trimmedIg.payload,
    website:       trimmedWeb,
    places:        input.places,
    signals:       input.signals,
    media_signals: trimmedIg.media_signals,
    display_urls:  trimmedIg.display_urls,
  }

  // Fetch the images Haiku will see. Best-effort — failures don't block
  // the call, we just send fewer images. IG CDN refuses cross-origin
  // requests with a Referer; skip the header.
  const imageBlocks = await fetchImagesAsBlocks(trimmedIg.display_urls.slice(0, MAX_VISION_IMAGES))
  console.info(
    `[extraction-prefill] vision brand=${opts.brand_id} ` +
    `requested=${trimmedIg.display_urls.length} loaded=${imageBlocks.length}`,
  )

  const t0 = Date.now()
  const result = await withRetryAndLogging(
    {
      flow_id: opts.flow_id,
      brand_id: opts.brand_id,
      node_name: 'extraction_prefill',
      db: opts.db,
    },
    async () => {
      const response = await client.messages.create({
        model: PREFILL_MODEL,
        max_tokens: PREFILL_MAX_TOKENS,
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{
          role: 'user',
          content: [
            // The structured data payload first.
            { type: 'text', text: JSON.stringify(userPayload) },
            // Then the images so the prompt's "you will receive vision
            // blocks" instruction is honoured.
            ...imageBlocks,
          ],
        }],
      })

      const cost = priceClaudeUsage(PREFILL_MODEL, {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      })

      const text = extractText(response.content)
      const parsed = parseStructuredJson(text, ExtractionPrefillSchema)

      const tokIn     = response.usage.input_tokens
      const tokOut    = response.usage.output_tokens
      const tokCached = response.usage.cache_read_input_tokens    ?? 0
      const tokWrite  = response.usage.cache_creation_input_tokens ?? 0
      const p = { input: 0.8, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 }
      return {
        result:          parsed,
        cost_usd:        cost,
        agent:           'ExtractionPrefill',
        provider:        'anthropic',
        model:           PREFILL_MODEL,
        tokens_in:       tokIn,
        tokens_out:      tokOut,
        tokens_cached:   tokCached,
        cost_usd_input:  Number(((tokIn    / 1_000_000) * p.input).toFixed(6)),
        cost_usd_output: Number(((tokOut   / 1_000_000) * p.output).toFixed(6)),
        cost_usd_cached: Number(((tokCached / 1_000_000) * p.cacheRead + (tokWrite / 1_000_000) * p.cacheWrite).toFixed(6)),
        payload: {
          model: PREFILL_MODEL,
          tokens_in:       tokIn,
          tokens_out:      tokOut,
          images_attached: imageBlocks.length,
          cache_read:      tokCached,
          cache_write:     tokWrite,
        },
      }
    },
  )

  const elapsed = Date.now() - t0
  const filled = countFilled(result)
  console.info(
    `[extraction-prefill] OK brand=${opts.brand_id} filled=${filled}/35 ` +
    `images=${imageBlocks.length} in ${elapsed}ms`,
  )

  // ── Deterministic signal enrichment (no LLM cost) ─────────────────────────
  // These fields are objective counts from the scraper — no model inference
  // needed. Overwrite LLM guesses with hard numbers where available.
  // These land in extraction_prefill JSONB on brand_profiles and are later
  // picked up by COO build-branddna to nominate via Memory Controller.
  const ms = trimmedIg.media_signals
  const igDetails = trimmedIg.payload && typeof trimmedIg.payload === 'object'
    ? (trimmedIg.payload as Record<string, unknown>).details as Record<string, unknown> | null
    : null

  const analyticsSignals: Record<string, unknown> = {}

  if (igDetails) {
    const fc = igDetails.followers_count
    if (typeof fc === 'number' && fc > 0) analyticsSignals.followers_count = fc
    const pc = igDetails.posts_count_total
    if (typeof pc === 'number') analyticsSignals.ig_post_count = pc
    const verified = igDetails.is_verified
    if (typeof verified === 'boolean') analyticsSignals.ig_verified = verified
    const isBiz = igDetails.is_business_account
    if (typeof isBiz === 'boolean') analyticsSignals.account_type = isBiz ? 'business' : 'personal'
    const bio = igDetails.biography
    if (typeof bio === 'string' && bio.length > 0) analyticsSignals.bio_text = bio.slice(0, 500)
    const extUrl = igDetails.external_url
    if (typeof extUrl === 'string' && extUrl.length > 0) analyticsSignals.bio_link = extUrl
  }

  // Engagement rate — compute from media_signals (likes+comments / followers)
  // The normaliser doesn't expose engagement_rate directly in signals;
  // approximate it from the scraped post data instead.
  if (igDetails && typeof igDetails.followers_count === 'number' && igDetails.followers_count > 0) {
    const posts = trimmedIg.payload && typeof trimmedIg.payload === 'object'
      ? ((trimmedIg.payload as Record<string, unknown>).posts as Record<string, unknown>[] | null) ?? []
      : []
    if (posts.length > 0) {
      const totalLikes    = posts.reduce((s, p) => s + (Number(p.likes    ?? 0)), 0)
      const totalComments = posts.reduce((s, p) => s + (Number(p.comments ?? 0)), 0)
      const avgEngagement = ((totalLikes + totalComments) / posts.length) / igDetails.followers_count
      if (avgEngagement > 0) analyticsSignals.avg_engagement_rate = Math.round(avgEngagement * 10000) / 10000
    }
  }

  // Posting frequency from signals
  if (typeof input.signals?.post_frequency_30d === 'number' && input.signals.post_frequency_30d > 0) {
    analyticsSignals.posting_frequency_per_week = Math.round((input.signals.post_frequency_30d / 4.33) * 100) / 100
  }

  // Content format distribution from media_signals
  const imgPct  = (ms.image_post_pct    as number | null) ?? 0
  const vidPct  = (ms.video_post_pct    as number | null) ?? 0
  const carPct  = (ms.carousel_post_pct as number | null) ?? 0
  const reelCnt = (ms.reel_count        as number | null) ?? 0
  if (imgPct > 0 || vidPct > 0 || carPct > 0) {
    const maxPct = Math.max(imgPct, vidPct, carPct)
    analyticsSignals.primary_content_format =
      maxPct === reelCnt  ? 'reel'
      : maxPct === vidPct ? 'video'
      : maxPct === carPct ? 'carousel'
      : 'image'
    analyticsSignals.content_type_distribution = {
      image: imgPct / 100,
      video: vidPct / 100,
      carousel: carPct / 100,
    }
  }

  // Caption analytics
  const captionLen = ms.avg_caption_length_chars as number | null
  if (typeof captionLen === 'number' && captionLen > 0) {
    // Convert chars to approximate word count (avg Arabic word ~5 chars)
    analyticsSignals.caption_avg_length = Math.round(captionLen / 5)
  }

  const topHashtags = ms.top_hashtags as string[] | null
  if (Array.isArray(topHashtags) && topHashtags.length > 0) {
    analyticsSignals.top_hashtags = topHashtags.slice(0, 10)
  }

  const topMentions = ms.top_mentions as string[] | null
  if (Array.isArray(topMentions) && topMentions.length > 0) {
    analyticsSignals.top_mentioned_accounts = topMentions.slice(0, 8)
  }

  // Visual signals
  const domAspect = ms.dominant_aspect_ratio as string | null
  if (domAspect) {
    analyticsSignals.aspect_ratio_primary =
      domAspect === 'portrait'  ? '4:5'
      : domAspect === 'landscape' ? '16:9'
      : '1:1'
  }

  // Arabic overlay detection from religious_markers / caption language signals
  const arabicPct = ms.arabic_char_pct as number | null
  if (typeof arabicPct === 'number') {
    analyticsSignals.has_arabic_overlay = arabicPct > 30
  }

  // Merge analytics signals into the prefill result (non-destructive — only
  // set where the LLM left a null or where we have harder numbers)
  const enrichedResult = { ...result, ...analyticsSignals }

  return { prefill: enrichedResult as typeof result, ran: true }
}

// ── Sector defaults fallback (no-history brands) ─────────────────────────────
// When a brand has no social media history, load the sector_baselines row and
// map it to ExtractionPrefill defaults. This ensures new brands start with
// meaningful suggestions rather than blank fields (spec §3.3).

const SECTOR_OCCASION_DEFAULTS: Record<string, Partial<ExtractionPrefill>> = {
  'F&B': {
    ramadan_relevance:      'Critical',
    eid_fitr_relevance:     'High',
    eid_adha_relevance:     'High',
    national_day_relevance: 'High',
    founding_day_relevance: 'Medium',
    audience_female_pct:    45,
    audience_male_pct:      55,
    primary_kpi_type:       'awareness',
    intent_state:           'grow',
  },
  'Retail': {
    ramadan_relevance:      'Critical',
    eid_fitr_relevance:     'Critical',
    eid_adha_relevance:     'High',
    national_day_relevance: 'High',
    founding_day_relevance: 'Medium',
    audience_female_pct:    55,
    audience_male_pct:      45,
    primary_kpi_type:       'conversion',
    intent_state:           'grow',
  },
  'Beauty_Wellness': {
    ramadan_relevance:      'High',
    eid_fitr_relevance:     'Critical',
    eid_adha_relevance:     'High',
    national_day_relevance: 'Medium',
    founding_day_relevance: 'Low',
    audience_female_pct:    75,
    audience_male_pct:      25,
    primary_kpi_type:       'awareness',
    intent_state:           'grow',
  },
  'Healthcare': {
    ramadan_relevance:      'Medium',
    eid_fitr_relevance:     'Low',
    eid_adha_relevance:     'Low',
    national_day_relevance: 'Medium',
    founding_day_relevance: 'Low',
    audience_female_pct:    50,
    audience_male_pct:      50,
    primary_kpi_type:       'trust',
    intent_state:           'grow',
  },
}

async function sectorDefaultPrefill(sector: string, db: Db): Promise<ExtractionPrefill> {
  const base = emptyPrefill()
  try {
    // Load top-performing tones from sector_baselines for the most common dialect
    const { data: baseline } = await db
      .from('sector_baselines')
      .select('recommended_content_mix, top_performing_tones, confidence_benchmarks')
      .eq('sector' as never, sector)
      .eq('dialect' as never, 'MSA_accessible')
      .maybeSingle()

    const sectorOverrides = SECTOR_OCCASION_DEFAULTS[sector] ?? {}

    return {
      ...base,
      ...sectorOverrides,
      sector_hint:           sector as ExtractionPrefill['sector_hint'],
      lifecycle_stage_hint:  'launch',   // new brand = launch stage
      intent_state:          sectorOverrides.intent_state ?? 'launch',
      // Surface top tone from sector baseline as a confidence hint
      confidence: {
        sector_hint:          'medium',
        ramadan_relevance:    'medium',
        eid_fitr_relevance:   'medium',
        lifecycle_stage_hint: 'high',
      },
    }
  } catch (err) {
    console.warn('[extraction-prefill] sectorDefaultPrefill failed:', err instanceof Error ? err.message : String(err))
    return base
  }
}

// ── Empty / counters ────────────────────────────────────────────────

function emptyPrefill(): ExtractionPrefill {
  return {
    brand_name_en:          null,
    business_category:      null,
    sector_hint:            null,
    city_hint:              null,
    arabic_dialect:         null,
    formality_level:        null,
    humor_tolerance:        null,
    religious_sensitivity:  null,
    bilingual_ratio:        null,
    price_position:         null,
    tone_anti_attribute_ids: [],
    brand_differentiator:   null,
    primary_color_hex:      null,
    primary_channel:        null,
    primary_kpi_type:       null,
    intent_state:           null,
    lifecycle_stage_hint:   null,
    audience_female_pct:    null,
    audience_male_pct:      null,
    ramadan_relevance:      null,
    eid_fitr_relevance:     null,
    eid_adha_relevance:     null,
    national_day_relevance: null,
    founding_day_relevance: null,
    online_native:          null,
    has_holding_page:       null,
    posting_cadence_hint:   null,
    archetype_family:       null,
    archetype_primary:      null,
    lifestyle:              null,
    music:                  null,
    goal:                   null,
    emotions:               [],
    restrictions:           [],
    occasions_ranked:       [],
    confidence:             {},
  }
}

function countFilled(p: ExtractionPrefill): number {
  const arrKeys = new Set(['tone_anti_attribute_ids','emotions','restrictions','occasions_ranked'])
  let n = 0
  for (const [k, v] of Object.entries(p)) {
    if (k === 'confidence') continue
    if (arrKeys.has(k)) { if ((v as unknown[]).length > 0) n++; continue }
    if (v !== null && v !== undefined) n++
  }
  return n
}

// ── Image fetcher ────────────────────────────────────────────────────

import type Anthropic from '@anthropic-ai/sdk'

async function fetchImagesAsBlocks(urls: string[]): Promise<Anthropic.ImageBlockParam[]> {
  if (urls.length === 0) return []
  const results = await Promise.allSettled(urls.map(fetchOne))
  const blocks: Anthropic.ImageBlockParam[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) blocks.push(r.value)
  }
  return blocks
}

async function fetchOne(url: string): Promise<Anthropic.ImageBlockParam | null> {
  // IG CDN refuses requests that carry a Referer pointing anywhere but IG;
  // our server-side fetch sends none by default, which is what we want.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), IMAGE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; OGz Studios/1.0)',
        accept: 'image/jpeg,image/png,image/webp,*/*;q=0.8',
      },
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? 'image/jpeg'
    if (!ct.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_IMAGE_BYTES) return null
    // Anthropic accepts only jpeg/png/gif/webp.
    const mediaType = (() => {
      if (ct.includes('jpeg'))  return 'image/jpeg'
      if (ct.includes('png'))   return 'image/png'
      if (ct.includes('webp'))  return 'image/webp'
      if (ct.includes('gif'))   return 'image/gif'
      return 'image/jpeg'
    })() as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') },
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Trimmers ────────────────────────────────────────────────────────

interface TrimmedInstagram {
  payload: unknown
  media_signals: Record<string, unknown>
  display_urls: string[]
}

/**
 * Pass the FULL useful IG payload — everything that influences a brand
 * decision. Drop only fields that are pure noise: signed CDN audio URLs
 * (expire fast, useless for reasoning), debug objects, deeply-nested base64
 * blobs.
 */
function trimInstagram(ig: unknown): TrimmedInstagram {
  if (!ig || typeof ig !== 'object') {
    return { payload: null, media_signals: {}, display_urls: [] }
  }
  const o = ig as Record<string, unknown>
  const details = (o.details as Record<string, unknown> | null) ?? null
  const posts   = Array.isArray(o.posts) ? (o.posts as Record<string, unknown>[]) : []

  // Per-post compact shape — keep everything that helps reasoning.
  const compactPosts = posts.slice(0, 30).map((p) => {
    const w = (p.dimensionsWidth  as number | undefined) ?? null
    const h = (p.dimensionsHeight as number | undefined) ?? null
    const aspect =
      w == null || h == null ? null
      : Math.abs(w - h) <= 4 ? 'square'
      : h > w * 1.2 ? 'portrait'
      : w > h * 1.2 ? 'landscape'
      : 'square'
    return {
      caption:                p.caption,
      hashtags:               p.hashtags,
      mentions:               p.mentions,
      likes:                  p.likesCount,
      comments:               p.commentsCount,
      timestamp:              p.timestamp,
      type:                   p.type,
      product_type:           p.productType,
      dimensions:             { w, h, aspect },
      video_duration_seconds: p.videoDuration,
      has_carousel:           Array.isArray(p.childPosts) && (p.childPosts as unknown[]).length > 0,
      display_url:            p.displayUrl,
      // Keep the latest comments — they reveal brand-reply tone (formality,
      // humor) and how customers refer to the brand. Trim to 3 per post.
      latest_comments: Array.isArray(p.latestComments)
        ? (p.latestComments as Record<string, unknown>[]).slice(0, 3).map((c) => ({
            owner: c.ownerUsername,
            text: c.text,
          }))
        : [],
    }
  })

  // Pre-aggregate signals so the model doesn't have to compute them.
  const total = compactPosts.length || 1
  const imageCount    = compactPosts.filter((p) => p.type === 'Image').length
  const videoCount    = compactPosts.filter((p) => p.type === 'Video').length
  const carouselCount = compactPosts.filter((p) => p.type === 'Sidecar' || p.has_carousel).length
  const reelCount     = compactPosts.filter((p) => p.product_type === 'clips').length
  const igtvCount     = compactPosts.filter((p) => p.product_type === 'igtv').length
  const aspects       = compactPosts.map((p) => p.dimensions.aspect).filter(Boolean) as string[]
  const aspectCounts: Record<string, number> = {}
  for (const a of aspects) aspectCounts[a] = (aspectCounts[a] ?? 0) + 1
  const dominantAspect = Object.entries(aspectCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const allCaptions = compactPosts.map((p) => String(p.caption ?? '')).filter(Boolean)
  const arabicChars = allCaptions.reduce((n, c) => n + (c.match(/[؀-ۿ]/g)?.length ?? 0), 0)
  const latinChars  = allCaptions.reduce((n, c) => n + (c.match(/[A-Za-z]/g)?.length ?? 0), 0)
  const totalChars  = arabicChars + latinChars || 1
  const avgCaptionLen = allCaptions.length
    ? Math.round(allCaptions.reduce((n, c) => n + c.length, 0) / allCaptions.length)
    : 0
  const captionsWithArabic  = allCaptions.filter((c) => /[؀-ۿ]/.test(c)).length
  const captionsWithEnglish = allCaptions.filter((c) => /[A-Za-z]/.test(c)).length
  const captionsWithEmoji   = allCaptions.filter((c) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(c)).length

  const hashCounts: Record<string, number> = {}
  const mentCounts: Record<string, number> = {}
  for (const p of compactPosts) {
    for (const h of (Array.isArray(p.hashtags) ? p.hashtags : []) as string[]) hashCounts[h] = (hashCounts[h] ?? 0) + 1
    for (const m of (Array.isArray(p.mentions) ? p.mentions : []) as string[]) mentCounts[m] = (mentCounts[m] ?? 0) + 1
  }
  const topHashtags = Object.entries(hashCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([h]) => h)
  const topMentions = Object.entries(mentCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m]) => m)

  // Religious + occasion signals — surface explicit phrases for the model.
  const captionBlob = allCaptions.join(' ').toLowerCase()
  const religiousMarkers = {
    has_alhamdulillah:    /الحمدلله|الحمد لله|alhamdulillah/i.test(captionBlob),
    has_inshallah:        /إن شاء الله|انشاءالله|inshallah/i.test(captionBlob),
    mentions_ramadan:     /رمضان|ramadan/i.test(captionBlob),
    mentions_eid:         /عيد|eid/i.test(captionBlob),
    mentions_national_day:/اليوم الوطني|national day/i.test(captionBlob),
    mentions_founding_day:/يوم التأسيس|founding day/i.test(captionBlob),
  }

  // Display URLs for vision (profile pic + 5 top posts by likes).
  const display_urls: string[] = []
  const profilePic = (details?.profilePicUrlHD as string | undefined) ?? (details?.profilePicUrl as string | undefined)
  if (profilePic) display_urls.push(profilePic)
  const sortedByLikes = [...compactPosts].sort((a, b) => Number(b.likes ?? 0) - Number(a.likes ?? 0))
  for (const p of sortedByLikes.slice(0, 5)) {
    if (typeof p.display_url === 'string') display_urls.push(p.display_url)
  }

  return {
    payload: {
      details: details ? {
        username:              details.username,
        full_name:             details.fullName,
        biography:             details.biography,
        followers_count:       details.followersCount,
        follows_count:         details.followsCount,
        posts_count_total:     details.postsCount,
        is_business_account:   details.isBusinessAccount,
        is_verified:           details.verified,
        is_private:            details.private,
        joined_recently:       details.joinedRecently,
        business_category:     details.businessCategoryName,
        external_url:          details.externalUrl,
        external_url_label:    Array.isArray(details.externalUrls) && details.externalUrls.length > 0
          ? (details.externalUrls as Record<string, unknown>[])[0]?.title
          : null,
        highlight_reel_count:  details.highlightReelCount,
      } : null,
      posts: compactPosts,
    },
    media_signals: {
      image_post_pct:           Math.round((imageCount    / total) * 100),
      video_post_pct:           Math.round((videoCount    / total) * 100),
      carousel_post_pct:        Math.round((carouselCount / total) * 100),
      reel_count:               reelCount,
      igtv_count:               igtvCount,
      avg_caption_length_chars: avgCaptionLen,
      pct_captions_with_arabic:  Math.round((captionsWithArabic  / total) * 100),
      pct_captions_with_english: Math.round((captionsWithEnglish / total) * 100),
      pct_captions_with_emoji:   Math.round((captionsWithEmoji   / total) * 100),
      arabic_char_pct:           Math.round((arabicChars / totalChars) * 100),
      english_char_pct:          Math.round((latinChars  / totalChars) * 100),
      top_hashtags:              topHashtags,
      top_mentions:              topMentions,
      dominant_aspect_ratio:     dominantAspect,
      religious_markers:         religiousMarkers,
    },
    display_urls,
  }
}

function trimWebsite(web: unknown): unknown {
  if (!web || typeof web !== 'object') return null
  const o = web as Record<string, unknown>
  const pages = Array.isArray(o.pages) ? (o.pages as Record<string, unknown>[]) : []
  return {
    pages_count: pages.length,
    pages: pages.slice(0, 5).map((p) => {
      const meta = (p.metadata as Record<string, unknown> | null) ?? {}
      return {
        url:               p.url,
        title:             meta.title,
        description:       meta.description,
        canonical_url:     meta.canonicalUrl,
        language:          meta.languageCode,
        // Keep JSON-LD verbatim — schema.org gives clean structured signals.
        json_ld:           meta.jsonLd,
        og:                meta.openGraph,
        // 2KB excerpt is enough to ground brand voice without bloating tokens.
        markdown_excerpt:  typeof p.markdown === 'string' ? (p.markdown as string).slice(0, 2000) : null,
      }
    }),
  }
}

function extractText(content: Anthropic.ContentBlock[]): string {
  for (const block of content) {
    if (block.type === 'text') return block.text
  }
  throw new Error('extraction-prefill response had no text block')
}
