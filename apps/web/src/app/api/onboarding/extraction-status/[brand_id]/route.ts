/**
 * GET /api/onboarding/extraction-status/[brand_id]
 *
 * Polled by the live extraction screen + read once by the review form to
 * pre-fill values. Returns:
 *
 *   {
 *     onboarding_status,
 *     sources_present:  { instagram, website, places },
 *     source_status:    per-source 'pending' | 'done' | 'unavailable' | 'skipped',
 *     pre_fill: {
 *       // Identity
 *       brand_name_en, business_category, sector_hint,
 *       // Voice
 *       dialect_hint, color_palette, primary_color_hex,
 *       differentiator_seed,
 *       // Strategy hints
 *       lifecycle_stage_hint, online_native, has_holding_page,
 *       // Raw signals
 *       account_age_months, post_count, post_frequency_30d,
 *       rating, user_ratings_total, formatted_address
 *     }
 *   }
 *
 * The pre_fill object is a hint, not authoritative — the review form uses
 * each value as a default but lets the user override anything.
 */
import { NextResponse } from 'next/server'
import { adminClient } from '@repo/db'
import { requireUser } from '@repo/auth/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SourceRow {
  source_type: string
  raw_payload: Record<string, unknown>
  // Migration 0028 — explicit split columns. Nullable on rows older than 0028.
  branch:     string | null
  skipped:    boolean | null
  raw:        Record<string, unknown> | null
  normalised: Record<string, unknown> | null
}

type SourceStatus = 'pending' | 'done' | 'unavailable' | 'skipped'

interface ExtractionPreFill {
  // Identity
  brand_name_en: string | null
  business_category: string | null
  sector_hint: string | null
  // Voice
  dialect_hint: string | null
  color_palette: string[] | null
  primary_color_hex: string | null
  differentiator_seed: string | null
  /** Where the differentiator seed came from — informs the badge tooltip. */
  differentiator_source:
    | 'instagram_bio' | 'website_meta' | 'website_og'
    | 'instagram_caption' | 'website_jsonld' | null
  // Strategy
  lifecycle_stage_hint: string | null
  online_native: boolean
  has_holding_page: boolean
  // City hint (LLM-derived from Places address / captions)
  city_hint:             string | null
  // Voice/identity hints (LLM pre-fill — review form uses as defaults)
  formality_level:       string | null
  humor_tolerance:       string | null
  religious_sensitivity: string | null
  bilingual_ratio:       string | null
  price_position:        string | null
  tone_anti_attribute_ids: string[]
  primary_channel:       string | null
  primary_kpi_type:      string | null
  intent_state:          string | null
  posting_cadence_hint:  string | null
  // Phase 1 gap fields (added migration 0060)
  sub_sector_hint:          string | null
  region_primary_hint:      string | null
  founded_year_hint:        number | null
  tone_register_hint:       string | null
  communication_style_hint: string | null
  brand_goals_hint:         string | null
  posting_rhythm_hint:      string | null
  caption_style_hint:       string | null
  // Audience mix
  audience_female_pct:   number | null
  audience_male_pct:     number | null
  // Saudi occasions
  ramadan_relevance:      string | null
  eid_fitr_relevance:     string | null
  eid_adha_relevance:     string | null
  national_day_relevance: string | null
  founding_day_relevance: string | null
  // Instagram profile signals (v2)
  ig_username: string | null
  ig_full_name: string | null
  ig_followers_count: number | null
  ig_follows_count: number | null
  ig_posts_count_total: number | null
  ig_profile_pic_url: string | null
  ig_is_verified: boolean
  ig_is_business_account: boolean
  ig_external_url: string | null
  // All IG post image URLs extracted from the raw Apify payload (displayUrl per post)
  ig_post_image_urls: string[]
  // Website signals (v2 — Apify Website Content Crawler)
  website_url: string | null
  website_page_count: number | null
  website_language: string | null
  website_og_image: string | null
  website_canonical_url: string | null
  // Engagement baselines (v2 — from brand_post_observations via RPC)
  engagement_baseline_likes: number | null
  engagement_baseline_comments: number | null
  engagement_baseline_views: number | null
  posts_observed_count: number | null
  signature_hashtags: string[]
  signature_phrases: string[]
  brand_reply_samples_count: number | null
  // Raw signals (debug / display)
  account_age_months: number | null
  post_count: number | null
  post_frequency_30d: number | null
  rating: number | null
  user_ratings_total: number | null
  formatted_address: string | null
}

// ─── Heuristics ───────────────────────────────────────────────────────

/** Map a Google Places type list → our 7 sectors. Best-effort. */
function inferSectorFromPlaceTypes(types: string[] | undefined): string | null {
  if (!Array.isArray(types) || types.length === 0) return null
  const set = new Set(types.map((t) => t.toLowerCase()))
  if (set.has('restaurant') || set.has('cafe') || set.has('bakery') || set.has('food') || set.has('meal_takeaway')) return 'F&B'
  if (set.has('beauty_salon') || set.has('spa') || set.has('hair_care')) return 'Beauty_Wellness'
  if (set.has('hospital') || set.has('doctor') || set.has('dentist') || set.has('pharmacy') || set.has('health')) return 'Healthcare'
  if (set.has('bank') || set.has('atm') || set.has('finance') || set.has('insurance_agency')) return 'Finance'
  if (set.has('local_government_office') || set.has('city_hall')) return 'Government'
  if (set.has('store') || set.has('clothing_store') || set.has('shopping_mall') || set.has('shoe_store')) return 'Retail'
  return null
}

/** Quick dialect signal from caption sample. NOT authoritative — COO Pass 2
 *  does the real classification. We just suggest a default the user can flip. */
function inferDialectHint(captions: string[]): string | null {
  if (!captions || captions.length === 0) return null
  const blob = captions.join(' ').slice(0, 8000)
  // Najdi markers (very rough — يا حلو، وش، تكفون)
  if (/\b(وش|تكفون|أبي|أبغى|ايش\s+هذا)\b/.test(blob)) return 'Najdi'
  // Hejazi (إيش، كيدا، عشان كذا)
  if (/\b(إيش|كيدا|كده|ليش\s+كذا)\b/.test(blob)) return 'Hejazi'
  // English-heavy
  const arabicChars = (blob.match(/[؀-ۿ]/g) ?? []).length
  const latinChars  = (blob.match(/[A-Za-z]/g) ?? []).length
  if (arabicChars === 0 && latinChars > 100) return 'MSA_accessible'
  // Default — most safe choice
  return 'MSA_accessible'
}

/**
 * Lifecycle stage hint from Instagram signals.
 *
 * Returns one of the 5 doc-canonical lifecycle stages:
 *   pre_launch | launch | growth | maturity | recovery
 *
 * Inputs:
 *   • ageMonths            — months since the OLDEST post in the 50-post sample
 *   • sampleCount          — how many posts the scrape returned (max 50)
 *   • freq30d              — posts in the last 30 days
 *   • totalPostsCount      — Apify 'details' field — total posts on the account
 *   • followersCount       — Apify 'details' field
 *
 * Heuristic (per Framework v2 § Axis 2):
 *   - pre_launch:  no public footprint at all (account doesn't exist yet)
 *   - launch:      very young (0-12m) or very few posts (<30)
 *   - growth:      12-36m old, accelerating, <50k followers
 *   - maturity:    36m+ OR 50k+ followers
 *   - recovery:    silent for 30 days BUT has substantial history
 */
function inferLifecycleHint(
  ageMonths: number | null,
  sampleCount: number | null,
  freq30d: number | null,
  totalPostsCount: number | null,
  followersCount: number | null,
): 'pre_launch' | 'launch' | 'growth' | 'maturity' | 'recovery' | null {
  const age = ageMonths ?? 0
  const totalPosts = totalPostsCount ?? sampleCount ?? 0
  const followers = followersCount ?? 0

  if (age === 0 && totalPosts === 0 && followers === 0) return null

  // Recovery — gone quiet despite substantial history (re-engagement after dormancy)
  if ((freq30d ?? 0) === 0 && totalPosts > 50 && age >= 12) return 'recovery'

  // Launch — young or sparse (0-12 months per doc)
  if (age < 12 || totalPosts < 30) return 'launch'

  // Maturity — large account or very old (3+ years per doc)
  if (followers >= 50_000 || age >= 36) return 'maturity'

  // Growth — default for active 12-36m accounts
  return 'growth'
}

/** Validate "#RRGGBB" — used to pick a sane default colour from the palette. */
function isHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s)
}

// ─── Handler ──────────────────────────────────────────────────────────

export async function GET(_req: Request, ctx: { params: Promise<{ brand_id: string }> }) {
  const user = await requireUser({ next: '/onboarding-start' })
  const { brand_id } = await ctx.params

  const db = adminClient()
  // Pull the v2 enrichment fields written by /api/extraction/persist-ig
  // (engagement baselines + signatures) so the live extraction screen and
  // the Step 3 review form can show them. Using `select('*')` avoids
  // typed-column-list inference issues when the generated types lag.
  const { data: brand, error: e1 } = await db
    .from('brand_profiles')
    .select('*')
    .eq('brand_id', brand_id)
    .maybeSingle()
  if (e1) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  if (!brand || (brand as { auth_user_id?: string }).auth_user_id !== user.id) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  const brandRow = brand as unknown as {
    brand_id: string
    auth_user_id: string
    onboarding_status: string
    brand_name_ar: string | null
    sector: string | null
    city_primary: string | null
    instagram_handle: string | null
    website_url: string | null
    engagement_baseline_likes: number | null
    engagement_baseline_comments: number | null
    engagement_baseline_views: number | null
    posts_observed_count: number | null
    signature_hashtags: string[] | null
    signature_phrases: string[] | null
    brand_reply_samples: string[] | null
    extraction_prefill: {
      brand_name_en?:           string | null
      business_category?:       string | null
      sector_hint?:             string | null
      city_hint?:               string | null
      arabic_dialect?:          string | null
      formality_level?:         string | null
      humor_tolerance?:         string | null
      religious_sensitivity?:   string | null
      bilingual_ratio?:         string | null
      price_position?:          string | null
      tone_anti_attribute_ids?: string[]
      brand_differentiator?:    string | null
      primary_color_hex?:       string | null
      primary_channel?:         string | null
      primary_kpi_type?:        string | null
      intent_state?:            string | null
      lifecycle_stage_hint?:    string | null
      audience_female_pct?:     number | null
      audience_male_pct?:       number | null
      ramadan_relevance?:       string | null
      eid_fitr_relevance?:      string | null
      eid_adha_relevance?:      string | null
      national_day_relevance?:  string | null
      founding_day_relevance?:  string | null
      online_native?:           boolean | null
      has_holding_page?:        boolean | null
      posting_cadence_hint?:    string | null
      // v6 extended fields
      archetype_family?:        string | null
      archetype_primary?:       string | null
      lifestyle?:               string | null
      music?:                   string | null
      goal?:                    string | null
      emotions?:                string[] | null
      restrictions?:            string[] | null
      occasions_ranked?:        string[] | null
      sub_sector_hint?:          string | null
      region_primary_hint?:      string | null
      founded_year_hint?:        number | null
      tone_register_hint?:       string | null
      communication_style_hint?: string | null
      brand_goals_hint?:         string | null
      posting_rhythm_hint?:      string | null
      caption_style_hint?:       string | null
      confidence?:              Record<string, 'high' | 'medium' | 'low'>
    } | null
  }

  // What sources did the user provide?
  const provided = {
    instagram: !!brandRow.instagram_handle,
    website:   !!brandRow.website_url,
    places:    true, // we always try Places (best-effort)
  }

  // Read source_records produced by A06
  const { data: sources, error: e2 } = await db
    .from('source_records')
    .select('source_type, raw_payload, branch, skipped, raw, normalised')
    .eq('brand_id', brand_id)
    .in('source_type', ['instagram', 'website', 'google_places'])
    .order('captured_at', { ascending: false })
  if (e2) return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })

  const present  = { instagram: false, website: false, places: false }
  const sourceStatus: Record<'instagram' | 'website' | 'places', SourceStatus> = {
    instagram: provided.instagram ? 'pending' : 'skipped',
    website:   provided.website   ? 'pending' : 'skipped',
    places:    'pending',
  }
  const preFill: ExtractionPreFill = {
    brand_name_en: null,
    business_category: null,
    sector_hint: null,
    dialect_hint: null,
    color_palette: null,
    primary_color_hex: null,
    differentiator_seed: null,
    differentiator_source: null,
    lifecycle_stage_hint: null,
    online_native: false,
    has_holding_page: false,
    city_hint:             null,
    formality_level:       null,
    humor_tolerance:       null,
    religious_sensitivity: null,
    bilingual_ratio:       null,
    price_position:        null,
    tone_anti_attribute_ids: [],
    primary_channel:       null,
    primary_kpi_type:      null,
    intent_state:          null,
    posting_cadence_hint:  null,
    sub_sector_hint:          null,
    region_primary_hint:      null,
    founded_year_hint:        null,
    tone_register_hint:       null,
    communication_style_hint: null,
    brand_goals_hint:         null,
    posting_rhythm_hint:      null,
    caption_style_hint:       null,
    audience_female_pct:   null,
    audience_male_pct:     null,
    ramadan_relevance:      null,
    eid_fitr_relevance:     null,
    eid_adha_relevance:     null,
    national_day_relevance: null,
    founding_day_relevance: null,
    ig_username: null,
    ig_full_name: null,
    ig_followers_count: null,
    ig_follows_count: null,
    ig_posts_count_total: null,
    ig_profile_pic_url: null,
    ig_is_verified: false,
    ig_is_business_account: false,
    ig_external_url: null,
    ig_post_image_urls: [],
    website_url: null,
    website_page_count: null,
    website_language: null,
    website_og_image: null,
    website_canonical_url: null,
    engagement_baseline_likes: null,
    engagement_baseline_comments: null,
    engagement_baseline_views: null,
    posts_observed_count: null,
    signature_hashtags: [],
    signature_phrases: [],
    brand_reply_samples_count: null,
    account_age_months: null,
    post_count: null,
    post_frequency_30d: null,
    rating: null,
    user_ratings_total: null,
    formatted_address: null,
  }

  for (const row of (sources ?? []) as SourceRow[]) {
    // Read from explicit columns (0028); fall back to legacy raw_payload.data
    // for rows written before that migration. `data` here is the COMPACT
    // normalised view used by the status route — not the full raw Apify blob.
    const payload = (row.raw_payload as { branch?: string; data?: Record<string, unknown>; skipped?: boolean; normalised?: Record<string, unknown> }) ?? {}
    const data: Record<string, unknown> | null =
      row.normalised ?? payload.normalised ?? payload.data ?? null
    const isSkipped = row.skipped ?? payload.skipped ?? false

    if (isSkipped) {
      if (row.source_type === 'instagram')      sourceStatus.instagram = 'skipped'
      else if (row.source_type === 'website')   sourceStatus.website   = 'skipped'
      else if (row.source_type === 'google_places') sourceStatus.places = 'skipped'
      continue
    }

    if (row.source_type === 'instagram' && data) {
      present.instagram = true
      sourceStatus.instagram = 'done'
      const sig = data.lifecycle_signals as {
        account_age_months?: number
        post_count?: number
        post_count_total?: number
        post_frequency_30d?: number
        followers_count?: number
      } | undefined
      if (sig) {
        preFill.account_age_months = sig.account_age_months ?? null
        preFill.post_count = sig.post_count ?? null
        preFill.post_frequency_30d = sig.post_frequency_30d ?? null
      }

      // Profile (details) — present when Apify returned details rows.
      const profile = data.profile as {
        username?: string | null
        full_name?: string | null
        biography?: string | null
        followers_count?: number | null
        follows_count?: number | null
        posts_count_total?: number | null
        profile_pic_url?: string | null
        is_private?: boolean
        is_verified?: boolean
        is_business_account?: boolean
        business_category?: string | null
        external_url?: string | null
      } | null | undefined
      if (profile) {
        preFill.ig_username           = profile.username ?? null
        preFill.ig_full_name          = profile.full_name ?? null
        preFill.ig_followers_count    = profile.followers_count ?? null
        preFill.ig_follows_count      = profile.follows_count ?? null
        preFill.ig_posts_count_total  = profile.posts_count_total ?? null
        preFill.ig_profile_pic_url    = profile.profile_pic_url ?? null
        preFill.ig_is_verified        = !!profile.is_verified
        preFill.ig_is_business_account= !!profile.is_business_account
        preFill.ig_external_url       = profile.external_url ?? null
        // Strongest brand-name signal — IG full_name is the brand's preferred display name.
        if (!preFill.brand_name_en && profile.full_name) {
          preFill.brand_name_en = profile.full_name
        }
        // IG business category beats Places types (more brand-specific).
        if (profile.business_category) {
          preFill.business_category = profile.business_category
        }
        // IG biography is the BEST differentiator seed — it's how the brand
        // describes itself in their own words.
        if (profile.biography && profile.biography.trim().length >= 20) {
          preFill.differentiator_seed = profile.biography.trim().slice(0, 480)
          preFill.differentiator_source = 'instagram_bio'
        }
      }

      // Extract all post image URLs from the raw Apify blob (displayUrl per post)
      // These are passed to the review form so the user can see their IG images
      // before submitting, and so submitFinal can upload them to Storage.
      const rawIg = (row.raw as Record<string, unknown> | null) ?? {}
      const rawPosts: unknown[] =
        (rawIg.instagram as { posts?: unknown[] } | undefined)?.posts ??
        (rawIg.posts as unknown[] | undefined) ??
        []
      for (const post of rawPosts) {
        const p = post as { displayUrl?: string; display_url?: string }
        const url = p.displayUrl ?? p.display_url
        if (typeof url === 'string' && url.startsWith('http')) {
          preFill.ig_post_image_urls.push(url)
        }
      }

      // Dialect heuristic from caption sample
      const captions = (data.captions_for_dialect as string[] | undefined) ?? []
      const dHint = inferDialectHint(captions)
      if (dHint) preFill.dialect_hint = dHint
      // Caption fallback for differentiator (only if biography wasn't usable)
      const sample = (data.posts_sample as Array<{ caption?: string }> | undefined) ?? []
      const firstCaption = sample.map((s) => s.caption || '').find((c) => c.length > 30)
      if (firstCaption && !preFill.differentiator_seed) {
        preFill.differentiator_seed = firstCaption.slice(0, 240)
        preFill.differentiator_source = 'instagram_caption'
      }
    } else if (row.source_type === 'website' && data) {
      present.website = true
      sourceStatus.website = 'done'
      const w = data as {
        url?: string | null
        title?: string | null
        meta_description?: string | null
        og_description?: string | null
        og_image?: string | null
        canonical_url?: string | null
        language?: string | null
        page_count?: number | null
        reason?: string | null
        structured_data_org?: Record<string, unknown> | null
      }
      preFill.has_holding_page = w.reason === 'holding_page'
      preFill.website_url = w.url ?? null
      preFill.website_page_count = w.page_count ?? null
      preFill.website_language = w.language ?? null
      preFill.website_og_image = w.og_image ?? null
      preFill.website_canonical_url = w.canonical_url ?? null

      // brand_name_en from <title> — strip any " | Brand", " - Tagline" etc.
      if (!preFill.brand_name_en && w.title) {
        const title = w.title.split(/[\|–\-]/)[0]?.trim() ?? null
        if (title && title.length > 1 && title.length < 80) preFill.brand_name_en = title
      }

      // JSON-LD Organization / LocalBusiness — strongest structured signal.
      // Extract `name` (better brand_name_en), `description` (differentiator
      // seed), `@type` → sector hint.
      const org = w.structured_data_org as {
        name?: string
        legalName?: string
        description?: string
        '@type'?: string | string[]
      } | null | undefined
      if (org) {
        // brand_name from JSON-LD overrides title parse (more accurate)
        const ldName = (org.legalName || org.name || '').trim()
        if (ldName && ldName.length > 1 && ldName.length < 80) {
          preFill.brand_name_en = ldName
        }
        // sector hint from @type if not already set
        const typeArr = Array.isArray(org['@type']) ? org['@type'] : (org['@type'] ? [org['@type']] : [])
        if (!preFill.sector_hint) {
          const ts = typeArr.map(String)
          if (ts.some((t) => /Restaurant|FoodEstablishment|Cafe|Bakery/i.test(t))) preFill.sector_hint = 'F&B'
          else if (ts.some((t) => /BeautySalon|HealthAndBeautyBusiness|HairSalon/i.test(t))) preFill.sector_hint = 'Beauty_Wellness'
          else if (ts.some((t) => /MedicalBusiness|Hospital|Pharmacy|MedicalClinic|Dentist/i.test(t))) preFill.sector_hint = 'Healthcare'
          else if (ts.some((t) => /FinancialService|BankOrCreditUnion|InsuranceAgency/i.test(t))) preFill.sector_hint = 'Finance'
          else if (ts.some((t) => /GovernmentOrganization|GovernmentOffice/i.test(t))) preFill.sector_hint = 'Government'
          else if (ts.some((t) => /Store|Shop|RetailStore|ClothingStore/i.test(t))) preFill.sector_hint = 'Retail'
        }
        // Differentiator from JSON-LD description (highly trusted).
        if (org.description && org.description.length > 20) {
          const currentSrc = preFill.differentiator_source
          // JSON-LD beats everything except IG bio (the brand's own voice).
          if (currentSrc === null || currentSrc === 'instagram_caption' || currentSrc === 'website_meta' || currentSrc === 'website_og') {
            preFill.differentiator_seed = org.description.slice(0, 240)
            preFill.differentiator_source = 'website_jsonld'
          }
        }
      }

      // Differentiator seed precedence (no JSON-LD case):
      //   IG bio > JSON-LD desc > website meta > website og > IG caption.
      const currentSrc = preFill.differentiator_source
      const weakerThanWebsiteMeta = currentSrc === null || currentSrc === 'instagram_caption'
      if (weakerThanWebsiteMeta && w.meta_description && w.meta_description.length > 20) {
        preFill.differentiator_seed = w.meta_description.slice(0, 240)
        preFill.differentiator_source = 'website_meta'
      } else if (weakerThanWebsiteMeta && w.og_description && w.og_description.length > 20) {
        preFill.differentiator_seed = w.og_description.slice(0, 240)
        preFill.differentiator_source = 'website_og'
      }
    } else if (row.source_type === 'google_places') {
      // Normalised places shape (post-0028) is { candidate, online_native }.
      // Legacy rows had `data` BE the candidate directly — handle both.
      const placesNorm = data as { candidate?: Record<string, unknown> | null; online_native?: boolean } | null
      const candidate = placesNorm?.candidate !== undefined ? placesNorm.candidate : (data as Record<string, unknown> | null)
      if (candidate) {
        present.places = true
        sourceStatus.places = 'done'
        const p = candidate as { name?: string; rating?: number; user_ratings_total?: number; formatted_address?: string; types?: string[] }
        preFill.rating = p.rating ?? null
        preFill.user_ratings_total = p.user_ratings_total ?? null
        preFill.formatted_address = p.formatted_address ?? null
        if (!preFill.brand_name_en && p.name) preFill.brand_name_en = p.name
        const sectorFromTypes = inferSectorFromPlaceTypes(p.types)
        if (sectorFromTypes) preFill.sector_hint = sectorFromTypes
        if (Array.isArray(p.types) && p.types.length > 0) {
          preFill.business_category = p.types[0]?.replace(/_/g, ' ') ?? null
        }
      } else {
        sourceStatus.places = 'unavailable'
        preFill.online_native = true
      }
    }
  }

  // Mark sources unavailable if the brand says extraction is done but no row landed
  if (
    brandRow.onboarding_status === 'extraction_done' ||
    brandRow.onboarding_status === 'extraction_unavailable'
  ) {
    if (sourceStatus.instagram === 'pending') sourceStatus.instagram = 'unavailable'
    if (sourceStatus.website   === 'pending') sourceStatus.website   = 'unavailable'
    if (sourceStatus.places    === 'pending') sourceStatus.places    = 'unavailable'
  }

  // Lifecycle hint — derived from IG signals (now also uses followers + total post count)
  preFill.lifecycle_stage_hint = inferLifecycleHint(
    preFill.account_age_months,
    preFill.post_count,
    preFill.post_frequency_30d,
    preFill.ig_posts_count_total,
    preFill.ig_followers_count,
  )

  // ── LLM pre-fill overlay ────────────────────────────────────────────
  // The Haiku 4.5 pre-fill (written by /api/extraction/run via @repo/ai
  // extractionPrefill) takes precedence on the SOFT fields — sector hint,
  // dialect hint, lifecycle stage, business category cleanup, differentiator
  // seed, brand-name disambiguation, online-native / holding-page flags.
  // The LLM saw all 3 sources together and won't fall for "None,Product/service"
  // garbage or pick a sector from a 3-caption regex. When the LLM left a field
  // null (no justified value), we fall back to whatever the heuristic produced
  // — which is also often null, leaving the user to type it.
  //
  // Hard facts (followers, ig_username, ratings, addresses, post counts) are
  // always heuristic — never round-tripped through an LLM.
  const llm = brandRow.extraction_prefill ?? null
  if (llm) {
    if (llm.brand_name_en        != null) preFill.brand_name_en        = llm.brand_name_en
    if (llm.business_category    != null) preFill.business_category    = llm.business_category
    if (llm.sector_hint          != null) preFill.sector_hint          = llm.sector_hint
    if (llm.city_hint            != null) preFill.city_hint            = llm.city_hint
    if (llm.arabic_dialect       != null) preFill.dialect_hint         = llm.arabic_dialect
    if (llm.lifecycle_stage_hint != null) preFill.lifecycle_stage_hint = llm.lifecycle_stage_hint
    if (llm.brand_differentiator != null) {
      preFill.differentiator_seed   = llm.brand_differentiator
      preFill.differentiator_source = 'instagram_bio'
    }
    if (llm.online_native    != null) preFill.online_native    = llm.online_native
    if (llm.has_holding_page != null) preFill.has_holding_page = llm.has_holding_page
    if (llm.formality_level       != null) preFill.formality_level       = llm.formality_level
    if (llm.humor_tolerance       != null) preFill.humor_tolerance       = llm.humor_tolerance
    if (llm.religious_sensitivity != null) preFill.religious_sensitivity = llm.religious_sensitivity
    if (llm.bilingual_ratio       != null) preFill.bilingual_ratio       = llm.bilingual_ratio
    if (llm.price_position        != null) preFill.price_position        = llm.price_position
    if (Array.isArray(llm.tone_anti_attribute_ids) && llm.tone_anti_attribute_ids.length > 0) {
      preFill.tone_anti_attribute_ids = llm.tone_anti_attribute_ids
    }
    if (llm.primary_channel       != null) preFill.primary_channel       = llm.primary_channel
    if (llm.primary_kpi_type      != null) preFill.primary_kpi_type      = llm.primary_kpi_type
    if (llm.intent_state          != null) preFill.intent_state          = llm.intent_state
    if (llm.posting_cadence_hint  != null) preFill.posting_cadence_hint  = llm.posting_cadence_hint
    if (typeof llm.audience_female_pct === 'number') preFill.audience_female_pct = llm.audience_female_pct
    if (typeof llm.audience_male_pct   === 'number') preFill.audience_male_pct   = llm.audience_male_pct
    if (llm.ramadan_relevance      != null) preFill.ramadan_relevance      = llm.ramadan_relevance
    if (llm.eid_fitr_relevance     != null) preFill.eid_fitr_relevance     = llm.eid_fitr_relevance
    if (llm.eid_adha_relevance     != null) preFill.eid_adha_relevance     = llm.eid_adha_relevance
    if (llm.national_day_relevance != null) preFill.national_day_relevance = llm.national_day_relevance
    if (llm.founding_day_relevance != null) preFill.founding_day_relevance = llm.founding_day_relevance
    // LLM-suggested colour — used only when Sharp didn't extract one.
    if (llm.primary_color_hex && !preFill.primary_color_hex) {
      preFill.primary_color_hex = llm.primary_color_hex
    }
    // Phase 1 gap fields (migration 0060)
    // v6 extended fields — ExtractionPreFill is a local type; cast via unknown
    const pf = preFill as unknown as Record<string, unknown>
    if (llm.archetype_family  != null) pf.archetype_family  = llm.archetype_family
    if (llm.archetype_primary != null) pf.archetype_primary = llm.archetype_primary
    if (llm.lifestyle         != null) pf.lifestyle         = llm.lifestyle
    if (llm.music             != null) pf.music             = llm.music
    if (llm.goal              != null) pf.goal              = llm.goal
    if (Array.isArray(llm.emotions)         && llm.emotions.length > 0)         pf.emotions         = llm.emotions
    if (Array.isArray(llm.restrictions)     && llm.restrictions.length > 0)     pf.restrictions     = llm.restrictions
    if (Array.isArray(llm.occasions_ranked) && llm.occasions_ranked.length > 0) pf.occasions_ranked = llm.occasions_ranked
    if (llm.sub_sector_hint          != null) preFill.sub_sector_hint          = llm.sub_sector_hint
    if (llm.region_primary_hint      != null) preFill.region_primary_hint      = llm.region_primary_hint
    if (typeof llm.founded_year_hint === 'number') preFill.founded_year_hint   = llm.founded_year_hint
    if (llm.tone_register_hint       != null) preFill.tone_register_hint       = llm.tone_register_hint
    if (llm.communication_style_hint != null) preFill.communication_style_hint = llm.communication_style_hint
    if (llm.brand_goals_hint         != null) preFill.brand_goals_hint         = llm.brand_goals_hint
    if (llm.posting_rhythm_hint      != null) preFill.posting_rhythm_hint      = llm.posting_rhythm_hint
    if (llm.caption_style_hint       != null) preFill.caption_style_hint       = llm.caption_style_hint
  }

  // ── v2 enrichment from brand_profiles ────────────────────────────
  // Engagement baselines + signatures + brand reply count, populated by
  // /api/extraction/persist-ig after A06's IG normaliser. These let the
  // review-form show the user "we found this brand averages 380 likes/post,
  // their signature hashtag is #مننا_ويفهم_جونا" — strong onboarding affordance.
  preFill.engagement_baseline_likes    = brandRow.engagement_baseline_likes
  preFill.engagement_baseline_comments = brandRow.engagement_baseline_comments
  preFill.engagement_baseline_views    = brandRow.engagement_baseline_views
  preFill.posts_observed_count         = brandRow.posts_observed_count
  preFill.signature_hashtags           = brandRow.signature_hashtags ?? []
  preFill.signature_phrases            = brandRow.signature_phrases ?? []
  preFill.brand_reply_samples_count    = (brandRow.brand_reply_samples ?? []).length

  // Color palette — load from visual_style_profiles (written by persist-ig via Sharp
  // pixel extraction). This is pixel-accurate and more reliable than the LLM's guess.
  // Use it to override the LLM's primary_color_hex suggestion.
  {
    const { data: vsp } = await db
      .from('visual_style_profiles')
      .select('color_palette')
      .eq('brand_id', brand_id)
      .maybeSingle()
    const sharpPalette = ((vsp as { color_palette?: unknown } | null)?.color_palette ?? []) as unknown[]
    const validPalette = sharpPalette.filter(isHexColor)
    if (validPalette.length > 0) {
      preFill.color_palette = validPalette
      // Override LLM primary_color_hex with the first Sharp-extracted color — pixel-accurate
      preFill.primary_color_hex = validPalette[0] ?? null
    } else if (Array.isArray(preFill.color_palette)) {
      preFill.color_palette = preFill.color_palette.filter(isHexColor)
      if (preFill.color_palette.length === 0) preFill.color_palette = null
      else preFill.primary_color_hex = preFill.color_palette[0] ?? null
    }
  }

  // Seed values currently on brand_profiles. The review form prefills its
  // controlled inputs from these when they aren't placeholder values, so a
  // user who navigates back to Step 3 keeps what they already typed.
  const PLACEHOLDER_NAME = '(awaiting review)'
  const seed = {
    brand_name_ar: brandRow.brand_name_ar && brandRow.brand_name_ar !== PLACEHOLDER_NAME ? brandRow.brand_name_ar : null,
    sector:        brandRow.sector ?? null,
    city_primary:  brandRow.city_primary ?? null,
  }

  // Competitor handles stored in competitor_accounts during submitSeed.
  // Returned so Q15 in the review form can display them as editable chips
  // instead of a static "collected in Step 1" message.
  const { data: competitorRows } = await db
    .from('competitor_accounts' as never)
    .select('competitor_id, handle_instagram, display_name')
    .eq('brand_id' as never, brand_id)
    .eq('is_active' as never, true)
    .order('added_at' as never, { ascending: true })
  const competitors = ((competitorRows ?? []) as unknown as Array<{
    competitor_id: string; handle_instagram: string | null; display_name: string | null
  }>).map((r) => ({
    competitor_id:    r.competitor_id,
    handle_instagram: r.handle_instagram ?? '',
    display_name:     r.display_name ?? '',
  })).filter((c) => c.handle_instagram)

  return NextResponse.json({
    ok: true,
    brand_id,
    onboarding_status: brandRow.onboarding_status,
    sources_present: present,
    source_status: sourceStatus,
    seed,
    pre_fill: preFill,
    competitors,
  })
}
