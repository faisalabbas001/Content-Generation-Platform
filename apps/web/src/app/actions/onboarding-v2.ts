/**
 * Onboarding v2 — two-action flow with a live extraction stage in between.
 *
 * Flow:
 *   submitSeed       Step 1 — minimal extraction inputs (brand name + sources)
 *                    → INSERT brand_profiles with placeholder defaults,
 *                      fire N8N-A06 (background), set onboarding_status =
 *                      'extraction_pending'. UI then renders the live
 *                      extraction screen which polls /api/onboarding/
 *                      extraction-status until done.
 *
 *   submitFinal      Step 3 — everything else (voice + audience + intent +
 *                    occasions + logo + anti-attrs + differentiator +
 *                    brand_name_en). UPDATE brand_profiles with all final
 *                    values, set onboarding_status = 'submitted', fire
 *                    N8N-A03, redirect to /[slug]/processing.
 *
 * Step 2 is purely client-side animation + polling — no server action.
 *
 * Idempotency: submitSeed short-circuits if the user already owns a brand
 * (returns the existing one). submitFinal is keyed on brand_id + ownership
 * check, safe to retry.
 */
'use server'

import { cookies } from 'next/headers'
import { z } from 'zod'
import { serverComponentClient } from '@repo/db/client'
import { adminClient } from '@repo/db'
import { requireUser } from '@repo/auth/server'
import { generateSlug, nextCandidate, isReservedSlug } from '@repo/auth/slug'
import { uploadBrandLogo, uploadBrandLogoFromUrl, uploadBrandAssets, uploadBrandAssetsFromUrls } from '@/lib/storage'
import {
  triggerN8nA03Onboarding,
  triggerN8nA06Extraction,
  triggerN8nA07CompetitorExtraction,
} from '@/lib/n8n-outbound'
import { emitProcessingStage } from '@/lib/processing-stage'

// ─────────────────────────────────────────────────────────────────────
// Shared enums (mirror the DB enum types)
// ─────────────────────────────────────────────────────────────────────
const Sector       = z.enum(['F&B', 'Retail', 'Beauty_Wellness', 'Healthcare', 'Finance', 'Government', 'Other'])
const Dialect      = z.enum(['Najdi', 'Hejazi', 'Gulf', 'MSA_formal', 'MSA_accessible', 'Mixed'])
const Price        = z.enum(['budget', 'mid_market', 'premium', 'luxury'])
const Formality    = z.enum(['casual', 'semi_formal', 'formal'])
const Humor        = z.enum(['none', 'light', 'moderate'])
const Religious    = z.enum(['Low', 'Medium', 'High'])
const Bilingual    = z.enum(['arabic_only', 'arabic_primary', 'balanced', 'english_primary'])
const Relevance    = z.enum(['Critical', 'High', 'Medium', 'Low', 'Not_relevant'])
const Channel      = z.enum(['Instagram', 'Snapchat', 'TikTok', 'Twitter'])
const KpiType      = z.enum(['engagement', 'conversion', 'awareness', 'trust'])
const Intent       = z.enum([
  'launch',
  'grow',
  'defend',
  'harvest',
  'recover',
])
const ANTI_ATTRIBUTES = [
  'aggressive', 'western_casual', 'flashy', 'edgy', 'ironic',
  'formal_corporate', 'casual_humor', 'salesy',
] as const

// ─────────────────────────────────────────────────────────────────────
// Helpers (shared by both actions)
// ─────────────────────────────────────────────────────────────────────

async function userSupabase() {
  const store = await cookies()
  return serverComponentClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try { for (const c of toSet) store.set(c.name, c.value, c.options) } catch { /* read-only */ }
    },
  })
}

async function findUniqueSlug(
  supabase: Awaited<ReturnType<typeof userSupabase>>,
  input: { brand_name_en?: string | null; brand_name_ar: string },
) {
  let candidate = generateSlug(input)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (isReservedSlug(candidate)) { candidate = nextCandidate(candidate); continue }
    const { data } = await supabase
      .from('brand_profiles').select('brand_id')
      .eq('client_slug', candidate).maybeSingle()
    if (!data) return candidate
    candidate = nextCandidate(candidate)
  }
  throw new Error('Could not generate a unique slug after 8 attempts.')
}

function normalizeInstagramHandle(input: string | null): string | null {
  if (!input) return null
  let v = input.trim()
  if (!v) return null
  v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  v = v.replace(/^(?:m\.)?instagram\.com\//i, '').replace(/^@+/, '')
  v = v.split('?')[0]!.split('/')[0]!.trim()
  return v.length ? v : null
}

/** Derive individual occasion relevance fields from the ranked occasions array.
 *  First rank = 'High', subsequent = 'Medium'. Never downgrades an existing value.
 */
function occasionRelevanceFromRanked(ranked: string[]): Record<string, string> {
  const r: Record<string, string> = {}
  const rank = (label: string) => ranked.findIndex((o) => o.includes(label))
  const toLevel = (idx: number) => (idx === 0 ? 'High' : 'Medium')
  const ramIdx = ranked.findIndex((o) => o.includes('Ramadan') || o.includes('Eid Al-Fitr'))
  if (ramIdx !== -1) r.eid_fitr_relevance = toLevel(ramIdx)
  const adhaIdx = rank('Eid Al-Adha')
  if (adhaIdx !== -1) r.eid_adha_relevance = toLevel(adhaIdx)
  const natIdx = rank('National Day')
  if (natIdx !== -1) r.national_day_relevance = toLevel(natIdx)
  const foundIdx = rank('Founding Day')
  if (foundIdx !== -1) r.founding_day_relevance = toLevel(foundIdx)
  return r
}

function deterministicShard(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h) % 7
}

// ─────────────────────────────────────────────────────────────────────
// STEP 1 — Seed form: minimum needed to start extraction
// ─────────────────────────────────────────────────────────────────────

const SeedSchema = z.object({
  // brand_name_ar / sector / city_primary moved to Step 3 (auto-prefilled
  // from extraction). We seed placeholders here so DB NOT-NULLs are happy;
  // the user confirms / edits in Step 3 alongside the rest of the review.

  // Competitor handles — collected at Step 1 so A06 can extract them in
  // parallel with the brand's own sources (spec §3.2 Step 2).
  // Stored as JSON array in brand_profiles.competitor_handles_raw then
  // persisted to competitor_accounts after brand_id is known.
  competitor_ig_1: z.string().trim().optional().nullable().transform((v) => normalizeInstagramHandle(v ?? null)),
  competitor_ig_2: z.string().trim().optional().nullable().transform((v) => normalizeInstagramHandle(v ?? null)),
  competitor_ig_3: z.string().trim().optional().nullable().transform((v) => normalizeInstagramHandle(v ?? null)),

  instagram_handle: z
    .string().trim().nullable()
    .transform((v) => normalizeInstagramHandle(v))
    .refine((v) => v === null || /^[a-zA-Z0-9._]{1,30}$/.test(v), {
      message: 'Instagram handle must be 1-30 chars (letters, numbers, dot, underscore)',
    }),
  website_url: z
    .string().trim().nullable()
    .transform((v) => {
      if (!v || !v.length) return null
      const withProto = v.startsWith('http') ? v : `https://${v}`
      // Unwrap l.instagram.com / l.facebook.com link wrappers — users often
      // paste the URL from the IG bio "link-in-bio" tap which redirects.
      try {
        const u = new URL(withProto)
        if (u.hostname === 'l.instagram.com' || u.hostname === 'l.facebook.com') {
          const target = u.searchParams.get('u')
          if (target) {
            const decoded = decodeURIComponent(target)
            // strip fbclid / utm_* tracking junk
            const dt = new URL(decoded)
            for (const k of [...dt.searchParams.keys()]) {
              if (k === 'fbclid' || k === 'e' || k.startsWith('utm_')) dt.searchParams.delete(k)
            }
            return dt.toString().replace(/\?$/, '')
          }
        }
      } catch {
        // fall through, return as-is
      }
      return withProto
    })
    .refine((v) => v === null || /^https?:\/\/.+\..+/.test(v), { message: 'Invalid website URL' }),
  place_search_name: z.string().trim().nullable().transform((v) => v && v.length ? v : null),
  /** Optional city hint for Google Maps disambiguation. Not stored as
   *  city_primary — that's set in Step 3 after the LLM has had a look. */
  city_hint: z.string().trim().nullable().transform((v) => v && v.length ? v : null),
})

export interface SeedResult {
  ok: boolean
  error?: string
  brand_id?: string
  slug?: string
  extraction_kicked_off?: boolean
  /** True when at least one source was provided — UI shows extraction screen. */
  has_sources?: boolean
  /** Set when A06 trigger failed (webhook unreachable / 4xx / timeout).
   *  brand_id is still valid; user can still proceed manually. */
  trigger_error?: string | null
}

export async function submitSeed(formData: FormData): Promise<SeedResult> {
  const user = await requireUser({ next: '/onboarding-start' })

  const raw: Record<string, unknown> = {}
  for (const [k, v] of formData.entries()) {
    if (typeof v === 'string') raw[k] = v.trim() === '' ? null : v.trim()
  }
  const parsed = SeedSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: `${issue?.path.join('.') ?? 'form'}: ${issue?.message ?? 'invalid'}` }
  }
  const f = parsed.data
  const hasSources = !!(f.instagram_handle || f.website_url || f.place_search_name)
  const competitorHandles = [f.competitor_ig_1, f.competitor_ig_2, f.competitor_ig_3].filter(Boolean) as string[]

  const supabase = await userSupabase()

  // Idempotent — if the user already has a brand, decide what to do based on
  // its onboarding_status:
  //   • 'complete'                 → onboarding finished, this should never fire
  //   • 'submitted' / 'scraping' / 'dna_building' / 'memory_writing'
  //                                → A03 main pipeline is running. Don't re-fire.
  //                                  Just resume to the review form (stale brand).
  //   • anything else (extraction_*, failed, blocked)
  //                                → user is restarting Step 1. Re-fire A06 with
  //                                  the new sources, reset onboarding_status,
  //                                  update sources on the row.
  const existing = await supabase
    .from('brand_profiles')
    .select('brand_id, client_slug, onboarding_status')
    .eq('auth_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing.data?.brand_id) {
    const existingStatus = (existing.data as { onboarding_status: string }).onboarding_status
    const brandId = existing.data.brand_id as string
    const slug = existing.data.client_slug as string
    const POST_SUBMIT_STATES = ['submitted', 'scraping', 'dna_building', 'memory_writing', 'complete']
    if (POST_SUBMIT_STATES.includes(existingStatus)) {
      // Past Step 3 already — don't re-trigger anything, just let the UI route
      // the user to the appropriate page (caller decides).
      return {
        ok: true,
        brand_id: brandId, slug,
        extraction_kicked_off: false,
        has_sources: hasSources,
        trigger_error: null,
      }
    }

    // Resume from Step 1: clean stale extraction records from any prior run,
    // update sources, reset to pending, re-fire A06. Without this, the UI
    // polls and sees previous-run source_records → instantly auto-advances
    // before A06 has even started.
    await adminClient()
      .from('source_records')
      .delete()
      .eq('brand_id', brandId)
      .in('source_type', ['instagram', 'website', 'google_places'])

    await adminClient()
      .from('brand_profiles')
      .update({
        instagram_handle: f.instagram_handle,
        website_url:      f.website_url,
        onboarding_status: hasSources ? 'extraction_pending' : 'extraction_done',
      } as never)
      .eq('brand_id', brandId)

    let kicked = false
    let trigErr: string | null = null
    if (hasSources) {
      const t = await triggerN8nA06Extraction({
        brand_id: brandId, slug,
        instagram_handle: f.instagram_handle,
        website_url: f.website_url,
        place_search: { name: f.place_search_name ?? '', city: f.city_hint ?? '' },
      })
      kicked = t.ok
      if (!t.ok) {
        trigErr = t.error ?? `n8n returned status ${t.status ?? 'n/a'}`
        console.warn(`[seed:resume] A06 trigger FAILED brand=${brandId} status=${t.status} error=${t.error}`)
        await adminClient()
          .from('brand_profiles')
          .update({ onboarding_status: 'extraction_unavailable' } as never)
          .eq('brand_id', brandId)
      } else {
        console.info(`[seed:resume] A06 trigger ok brand=${brandId} status=${t.status}`)
      }
    }
    return {
      ok: true, brand_id: brandId, slug,
      extraction_kicked_off: kicked, has_sources: hasSources, trigger_error: trigErr,
    }
  }

  // Placeholder slug derived from a source (IG handle > website host > 'brand')
  // — the user can rename in Step 3 once we know the real brand_name_ar.
  const slugSeed =
    f.instagram_handle ??
    (f.website_url ? f.website_url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '').slice(0, 20) : null) ??
    'brand'
  const slug = await findUniqueSlug(supabase, { brand_name_ar: slugSeed })

  const { data: brand, error: insertErr } = await supabase
    .from('brand_profiles')
    .insert({
      // Placeholders — Step 3 prompts the user to replace these. DB has
      // NOT-NULLs so we have to seed something. Sector defaults to F&B
      // (most common); city to the hint if provided else Riyadh.
      brand_name_ar:       '(awaiting review)',
      brand_name_en:       null,
      sector:              'F&B',
      city_primary:        f.city_hint ?? 'Riyadh',
      instagram_handle:    f.instagram_handle,
      website_url:         f.website_url,
      // Placeholders — overwritten by submitFinal. DB has NOT-NULL constraints
      // on these so we seed sensible defaults.
      arabic_dialect:      'MSA_accessible',
      price_position:      'mid_market',
      formality_level:     'semi_formal',
      humor_tolerance:     'light',
      religious_sensitivity: 'Medium',
      bilingual_ratio:     'arabic_primary',
      brand_differentiator: '(awaiting review)',
      tone_anti_attribute_ids: [],
      primary_channel:     'Instagram',
      tier:                'free',
      pipeline_tier:       'Starter',
      batch_shard:         deterministicShard(slug),
      client_slug:         slug,
      auth_user_id:        user.id,
      onboarding_status:   hasSources ? 'extraction_pending' : 'extraction_done',
      onboarding_started_at: new Date().toISOString(),
      completeness_score:  10,
    } as never)
    .select('brand_id')
    .single()

  if (insertErr || !brand) {
    return { ok: false, error: insertErr?.message ?? 'insert_failed' }
  }
  const brandId = (brand as { brand_id: string }).brand_id

  // Persist competitor handles to competitor_accounts (Layer 5)
  if (competitorHandles.length > 0) {
    const competitorRows = competitorHandles.map((handle) => ({
      brand_id:          brandId,
      handle_instagram:  handle,
      display_name:      handle,
      tier:              'light',
      is_active:         true,
    }))
    await adminClient().from('competitor_accounts').insert(competitorRows as never).select()
      .then(({ error }) => { if (error) console.warn('[seed] competitor_accounts insert failed:', error.message) })
  }

  await emitProcessingStage({
    brand_id: brandId,
    stage: 'section_1_submitted',
    metadata: {
      city_hint: f.city_hint,
      has_instagram: !!f.instagram_handle,
      has_website: !!f.website_url,
      has_places: !!f.place_search_name,
    },
  })

  // Fire A06 if there's anything to scrape. The trigger reply ('ok') only
  // says n8n acknowledged the webhook — the workflow itself runs async and
  // posts stage callbacks back to /api/processing/stage. The UI screen polls
  // extraction-status to know when source_records actually land.
  let extraction_kicked_off = false
  let trigger_error: string | null = null
  if (hasSources) {
    const trigger = await triggerN8nA06Extraction({
      brand_id: brandId,
      slug,
      instagram_handle: f.instagram_handle,
      website_url: f.website_url,
      place_search: { name: f.place_search_name ?? '', city: f.city_hint ?? '' },
    })
    extraction_kicked_off = trigger.ok
    if (!trigger.ok) {
      trigger_error = trigger.error ?? `n8n returned status ${trigger.status ?? 'n/a'}`
      console.warn(
        `[seed] A06 trigger FAILED for brand=${brandId} request_id=${trigger.request_id} ` +
          `status=${trigger.status ?? 'n/a'} error=${trigger.error ?? 'unknown'}`,
      )
      // Mark as unavailable so the UI doesn't poll forever, BUT also surface
      // the failure to the user via the action result so they don't get
      // sent through silently with garbage data.
      await adminClient()
        .from('brand_profiles')
        .update({ onboarding_status: 'extraction_unavailable' } as never)
        .eq('brand_id', brandId)
    } else {
      console.info(
        `[seed] A06 trigger ok for brand=${brandId} request_id=${trigger.request_id} status=${trigger.status}`,
      )
    }
  }

  return {
    ok: true,
    brand_id: brandId,
    slug,
    extraction_kicked_off,
    has_sources: hasSources,
    trigger_error,
  }
}

// ─────────────────────────────────────────────────────────────────────
// STEP 3 — Final review form (slim — doc-aligned 20 questions)
//
// Per OGZ_COMPLETE_SYSTEM_DOCUMENT §3.1:
//   "The system asks ONLY what it needs and couldn't extract."
//
// Required fields (always ask — cannot be inferred safely):
//   brand_name_ar, sector, city_primary — confirm extraction
//   brand_differentiator  — "what makes you different"
//   tone_anti_attribute_ids — "what are you NOT"
//   religious_sensitivity — spec: "always asked — cannot infer safely"
//   intent_state          — primary goal for next 3 months
//
// Doc 20-question fields collected here when not extractable:
//   brand_name_en, arabic_dialect, primary_color_hex (confirm)
//   lifestyle, price_position, emotions, bilingual_ratio (doc Q7/8/9/13)
//   music, restrictions, occasions_ranked (doc Q11/12/14)
//   founding_story — spec Step 5 "first questions" — brief
//   goal, vision (doc Q16/19)
//   problems, anything (doc Q17/20)
//
// Everything else (Layer 2 owner profile depth, Layer 3 visual identity,
// Layer 4 permission level / cultural tension, archetype, posting rhythm,
// caption style, content mix) is inferred by COO from extraction data
// and written via Memory Controller. Not collected at onboarding.
// ─────────────────────────────────────────────────────────────────────

// Business event schema — spec §3.2 Step 4
const BusinessEventSchema = z.object({
  event_type:   z.enum(['product_launch', 'promotion', 'store_opening', 'event', 'avoid_period', 'other']),
  title:        z.string().trim().min(3).max(100),
  description:  z.string().trim().max(300).nullable().optional().transform((v) => v && v.length ? v : null),
  event_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

const OptStr = (max = 500) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v && v.length) ? v : null)
const OptArr = z.array(z.string()).default([])

const FinalSchema = z.object({
  brand_id: z.string().uuid(),

  // Business events — JSON-encoded array (spec §3.2 Step 4)
  business_events_json: z.string().optional().transform((v) => {
    if (!v) return []
    try { return JSON.parse(v) as unknown[] } catch { return [] }
  }),

  // ── CONFIRM (pre-filled from extraction, user corrects if wrong) ──
  brand_name_ar: z.string().trim().min(2, { message: 'Brand name (Arabic) is required' }),
  brand_name_en: OptStr(200),
  sector:        Sector,
  city_primary:  z.string().trim().min(2, { message: 'Primary city is required' }),
  arabic_dialect:    z.preprocess((v) => (v === '' ? null : v), Dialect.nullable()),
  primary_color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),

  // Lifecycle hint — passed from pre_fill, not user-entered
  lifecycle: OptStr(30),

  // ── ALWAYS ASK (cannot be inferred safely) ──────────────────────────
  brand_differentiator:    z.string().trim().min(10).max(500),
  tone_anti_attribute_ids: OptArr,
  religious_sensitivity:   Religious,
  intent_state:            Intent,
  // Critical confirm-block fields (pre-filled, always confirmed)
  primary_audience_gender: z.enum(['female_skewed', 'male_skewed', 'mixed']).nullable().optional(),
  ramadan_relevance:       z.preprocess((v) => (v === '' ? null : v), Relevance.nullable()),

  // ── DOC Q3 — founding story (spec Step 5 "first questions") ─────────
  founding_story: OptStr(1000),

  // ── DOC Q4 — platforms ───────────────────────────────────────────────
  platforms: OptArr,
  social:    OptStr(300),

  // ── DOC Q1 — name meaning ────────────────────────────────────────────
  name_meaning: OptStr(300),

  // ── DOC Q7 — lifestyle / customer scene ─────────────────────────────
  lifestyle: OptStr(50),
  cust_desc: OptStr(400),

  // ── DOC Q8 — price position ──────────────────────────────────────────
  price_position: z.preprocess((v) => (v === '' ? null : v), Price.nullable()),
  price_nums:     OptStr(60),

  // ── DOC Q9 — emotions (max 3) ────────────────────────────────────────
  emotions:   z.array(z.string()).max(3).default([]),
  cust_quote: OptStr(300),

  // ── DOC Q10 — archetype + caption example ────────────────────────────
  archetype_family: OptStr(50),
  caption_ex:       OptStr(500),

  // ── DOC Q11 — music / soundtrack ─────────────────────────────────────
  music:      OptStr(50),
  music_link: OptStr(200),

  // ── DOC Q12 — restrictions / never show ─────────────────────────────
  restrictions:       OptArr,
  custom_restriction: OptStr(200),

  // ── DOC Q13 — bilingual / language ──────────────────────────────────
  bilingual_ratio: z.preprocess((v) => (v === '' ? null : v), Bilingual.nullable()),
  tagline:         OptStr(100),

  // ── DOC Q14 — seasonal moments ranked ───────────────────────────────
  occasions_ranked: z.array(z.string()).max(9).default([]),
  custom_occasion:  OptStr(100),

  // ── DOC Q16 — content goal ───────────────────────────────────────────
  goal:   OptStr(50),
  metric: OptStr(100),

  // ── DOC Q17 — content problems ───────────────────────────────────────
  problems: OptArr,

  // ── DOC Q18 — products list ──────────────────────────────────────────
  products_list: OptStr(600),

  // ── DOC Q19/20 — vision + open notes ────────────────────────────────
  vision:      OptStr(50),
  vision_text: OptStr(500),
  anything:    OptStr(500),

  // ── DOC Q06 — brand references — DB column is text[] so we parse the
  // comma-joined string back into an array here. The form sends a single
  // comma-separated value; the DB stores it as a proper text[] array.
  brand_refs: z.string().trim().nullable().optional()
    .transform((v) => v && v.trim().length > 0
      ? v.split(',').map((s) => s.trim()).filter(Boolean)
      : null
    ),
})

export interface FinalResult {
  ok: boolean
  error?: string
  redirect_to?: string
}

export async function submitFinal(formData: FormData): Promise<FinalResult> {
  const user = await requireUser({ next: '/onboarding-start' })

  // ── DEV: Log all submitted form fields so you can inspect what was sent ──
  if (process.env.NODE_ENV !== 'production') {
    const logData: Record<string, unknown> = {}
    for (const [k, v] of formData.entries()) {
      if (k === 'logo' || k === 'brand_assets') continue // skip file blobs
      const existing = logData[k]
      if (existing !== undefined) {
        logData[k] = Array.isArray(existing) ? [...existing, v] : [existing, v]
      } else {
        logData[k] = v
      }
    }
    console.log('[submitFinal] FORM DATA RECEIVED:', JSON.stringify(logData, null, 2))
  }

  // Parse multi-value fields
  const MULTI_KEYS = new Set([
    'logo', 'ig_post_image_url', 'brand_assets',
    'tone_anti_attribute_ids', 'emotions', 'restrictions',
    'problems', 'occasions_ranked', 'platforms', 'competitor_ig',
  ])
  const raw: Record<string, unknown> = {}
  for (const [k, v] of formData.entries()) {
    if (MULTI_KEYS.has(k)) continue
    if (typeof v === 'string') raw[k] = v.trim() === '' ? null : v.trim()
  }
  raw.tone_anti_attribute_ids = formData.getAll('tone_anti_attribute_ids').map(String).filter(Boolean)
  raw.emotions                = formData.getAll('emotions').map(String).filter(Boolean)
  raw.restrictions            = formData.getAll('restrictions').map(String).filter(Boolean)
  raw.problems                = formData.getAll('problems').map(String).filter(Boolean)
  raw.occasions_ranked        = formData.getAll('occasions_ranked').map(String).filter(Boolean)
  raw.platforms               = formData.getAll('platforms').map(String).filter(Boolean)
  const competitorHandlesFromForm = formData.getAll('competitor_ig').map(String).filter(Boolean)

  const parsed = FinalSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: `${issue?.path.join('.') ?? 'form'}: ${issue?.message ?? 'invalid'}` }
  }
  const f = parsed.data

  const supabase = await userSupabase()

  // Verify ownership + read slug + seed fields from Step 1
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('brand_id, client_slug, auth_user_id, brand_name_ar, sector, city_primary, instagram_handle, website_url, formality_level, humor_tolerance, primary_channel, primary_kpi_type')
    .eq('brand_id', f.brand_id)
    .maybeSingle()
  if (!brand || (brand as { auth_user_id: string }).auth_user_id !== user.id) {
    return { ok: false, error: 'brand_not_found_or_not_owned' }
  }
  const slug = (brand as { client_slug: string }).client_slug
  const seed = brand as {
    brand_name_ar: string
    sector: string
    city_primary: string | null
    instagram_handle: string | null
    website_url: string | null
  }

  // Logo upload (best-effort).
  // Priority: 1) user-uploaded file, 2) auto-detected IG profile pic URL.
  // If both are absent, logo_url stays null and can be set later in settings.
  const logoEntry  = formData.get('logo')
  const igLogoUrl  = formData.get('ig_logo_url')
  const logoFile   = logoEntry instanceof File && logoEntry.size > 0 ? logoEntry : null
  let logoUrl: string | null = null

  if (logoFile) {
    const logoResult = await uploadBrandLogo(supabase, f.brand_id, logoFile)
    if (!logoResult.ok) {
      console.warn(`[final] logo upload failed: ${logoResult.error}`)
    } else if ('publicUrl' in logoResult && logoResult.publicUrl) {
      logoUrl = logoResult.publicUrl
    }
  } else if (typeof igLogoUrl === 'string' && igLogoUrl.trim()) {
    // No custom upload — download the auto-detected IG avatar server-side
    // (server fetch avoids Referer restriction from IG CDN) and store it.
    const logoResult = await uploadBrandLogoFromUrl(supabase, f.brand_id, igLogoUrl.trim())
    if (!logoResult.ok) {
      console.warn(`[final] ig_logo_url upload failed: ${logoResult.error}`)
    } else if (logoResult.publicUrl) {
      logoUrl = logoResult.publicUrl
    }
  }

  // Brand assets — two sources merged into one bundle:
  //   1. User-uploaded files (from the Tab 6 dropzone, up to 10)
  //   2. Auto-pulled Instagram post images from source_records.raw (ALL posts)
  // Both are uploaded to Supabase Storage so we only ever store our own URLs (Hard Rule #4).
  const assetEntries = formData.getAll('brand_assets')
  const assetFiles = assetEntries.filter((e): e is File => e instanceof File && e.size > 0).slice(0, 10)
  let brandAssetsBundle: Array<{ url: string; name: string; mime: string; size: number }> = []

  // IG post image URLs — passed as hidden inputs from the review form (pre-filled
  // from extraction-status). Using form data avoids a second DB read here.
  const igPostImageUrls = formData.getAll('ig_post_image_url')
    .map(String)
    .filter((u) => u.startsWith('http'))

  // Upload user files first
  if (assetFiles.length > 0) {
    const assetsResult = await uploadBrandAssets(supabase, f.brand_id, assetFiles)
    if (assetsResult.ok) {
      const items = assetsResult.urls
        .map((url, i) => ({
          url,
          name: assetFiles[i]?.name ?? '',
          mime: assetFiles[i]?.type ?? '',
          size: assetFiles[i]?.size ?? 0,
        }))
        .filter((b) => b.url)
      brandAssetsBundle.push(...items)
    } else {
      console.warn(`[final] brand_assets user upload errors:`, assetsResult.errors)
    }
  }

  // Upload all IG post images (all posts, no cap — best-effort per-image)
  if (igPostImageUrls.length > 0) {
    console.info(`[final] uploading ${igPostImageUrls.length} IG post images for brand ${f.brand_id}`)
    const igResult = await uploadBrandAssetsFromUrls(supabase, f.brand_id, igPostImageUrls)
    if (igResult.bundleItems.length > 0) {
      brandAssetsBundle.push(...igResult.bundleItems)
    }
    if (igResult.errors.length > 0) {
      console.warn(`[final] IG image upload partial errors (${igResult.errors.length}):`, igResult.errors.slice(0, 5))
    }
  }

  // Single UPDATE — only what the slim form collected
  const { error: updateErr } = await supabase
    .from('brand_profiles')
    .update({
      // Identity confirmed / corrected by user
      brand_name_ar:           f.brand_name_ar,
      brand_name_en:           f.brand_name_en ?? null,
      sector:                  f.sector,
      city_primary:            f.city_primary,
      arabic_dialect:          f.arabic_dialect ?? null,
      primary_color_hex:       f.primary_color_hex ?? null,
      // Lifecycle inferred from extraction (not user-editable)
      lifecycle:               f.lifecycle ?? null,
      // Always-ask fields
      brand_differentiator:    f.brand_differentiator,
      tone_anti_attribute_ids: f.tone_anti_attribute_ids,
      religious_sensitivity:   f.religious_sensitivity,
      intent_state:            f.intent_state,
      // Critical confirm-block fields
      ...(f.primary_audience_gender ? { primary_audience_gender: f.primary_audience_gender } : {}),
      ...(f.ramadan_relevance        ? { ramadan_relevance: f.ramadan_relevance }             : {}),
      // Doc Q3 founding story (spec Step 5 first question)
      founding_story:          f.founding_story ?? null,
      // Doc Q4 — platforms
      platforms:               f.platforms.length > 0 ? f.platforms : [],
      social:                  f.social ?? null,
      // Doc Q1 — name meaning
      name_meaning:            f.name_meaning ?? null,
      // Doc Q7 — lifestyle / customer
      lifestyle:               f.lifestyle ?? null,
      cust_desc:               f.cust_desc ?? null,
      // Doc Q8 — pricing
      price_position:          f.price_position ?? null,
      price_nums:              f.price_nums ?? null,
      // Doc Q9 — emotions + customer quote
      emotions:                f.emotions.length > 0 ? f.emotions : [],
      cust_quote:              f.cust_quote ?? null,
      // Doc Q10 — archetype + caption example
      archetype_family:        f.archetype_family ?? null,
      caption_ex:              f.caption_ex ?? null,
      // Doc Q11 — music
      music:                   f.music ?? null,
      music_link:              f.music_link ?? null,
      // Doc Q12 — restrictions
      restrictions:            f.restrictions,
      custom_restriction:      f.custom_restriction ?? null,
      // Doc Q13 — language
      bilingual_ratio:         f.bilingual_ratio ?? null,
      tagline:                 f.tagline ?? null,
      // Doc Q14 — occasions ranked + derive individual relevance fields
      occasions_ranked:        f.occasions_ranked,
      custom_occasion:         f.custom_occasion ?? null,
      ...occasionRelevanceFromRanked(f.occasions_ranked ?? []),
      // Doc Q16/17 — goal + problems
      goal:                    f.goal ?? null,
      metric:                  f.metric ?? null,
      problems:                f.problems,
      // Derive primary_kpi_type from intent_state so it's never null after onboarding.
      // intent_state is always collected (required field); primary_kpi_type is the
      // evidence-bundle-facing name COO uses for completeness scoring.
      primary_kpi_type: (() => {
        const intent = f.intent_state
        if (!intent) return null
        if (intent === 'harvest') return 'conversion'
        if (intent === 'defend')  return 'engagement'
        if (intent === 'recover') return 'trust'
        if (intent === 'grow')    return 'awareness'
        if (intent === 'launch')  return 'awareness'
        return 'engagement' // safe default
      })(),
      // Doc Q18 — products list
      products_list:           f.products_list ?? null,
      // Doc Q06 — brand references
      brand_refs:              f.brand_refs ?? null,
      // Doc Q19/20 — vision + anything
      vision:                  f.vision ?? null,
      vision_text:             f.vision_text ?? null,
      anything:                f.anything ?? null,
      // System
      onboarding_status:       'submitted',
      onboarding_completed_at: new Date().toISOString(),
      ...(logoUrl ? { logo_url: logoUrl } : {}),
      brand_assets_bundle:     brandAssetsBundle,
    } as never)
    .eq('brand_id', f.brand_id)
  if (updateErr) return { ok: false, error: updateErr.message }

  // ── Competitor handles sync — Q15 edits in review form ──────────────────
  // The user may have added or removed handles in Q15. Sync the final list
  // back to competitor_accounts: deactivate removed ones, insert new ones.
  if (competitorHandlesFromForm.length > 0) {
    const db = adminClient()
    const { data: existingComps } = await db
      .from('competitor_accounts' as never)
      .select('competitor_id, handle_instagram')
      .eq('brand_id' as never, f.brand_id)
      .eq('is_active' as never, true)
    const existing = ((existingComps ?? []) as unknown as { competitor_id: string; handle_instagram: string | null }[])
    const existingHandles = new Set(existing.map((c) => c.handle_instagram).filter(Boolean) as string[])
    const formHandles = new Set(competitorHandlesFromForm)

    // Deactivate removed
    const toDeactivate = existing.filter((c) => c.handle_instagram && !formHandles.has(c.handle_instagram))
    if (toDeactivate.length > 0) {
      await db.from('competitor_accounts' as never)
        .update({ is_active: false } as never)
        .in('competitor_id' as never, toDeactivate.map((c) => c.competitor_id))
    }
    // Insert newly added handles
    const toInsert = competitorHandlesFromForm.filter((h) => !existingHandles.has(h))
    if (toInsert.length > 0) {
      const { error: compErr } = await db.from('competitor_accounts' as never)
        .insert(toInsert.map((h) => ({
          brand_id:         f.brand_id,
          handle_instagram: h,
          display_name:     h,
          tier:             'light',
          is_active:        true,
        })) as never)
      if (compErr) console.warn('[final] competitor_accounts insert failed:', compErr.message)
      else console.info(`[final] competitor_accounts inserted ${toInsert.length} for brand=${f.brand_id}: ${toInsert.join(', ')}`)
    }
  }

  // ── Business events (spec §3.2 Step 4) ───────────────────────────────────
  const rawEvents = Array.isArray(f.business_events_json) ? f.business_events_json : []
  if (rawEvents.length > 0) {
    const validEvents = rawEvents
      .map((e) => BusinessEventSchema.safeParse(e))
      .filter((r) => r.success)
      .map((r) => ({
        brand_id:    f.brand_id,
        event_type:  (r as { data: { event_type: string } }).data.event_type,
        title:       (r as { data: { title: string } }).data.title,
        description: (r as { data: { description?: string | null } }).data.description ?? null,
        event_date:  (r as { data: { event_date?: string | null } }).data.event_date ?? null,
        end_date:    (r as { data: { end_date?: string | null } }).data.end_date ?? null,
        is_active:   true,
      }))
    if (validEvents.length > 0) {
      await adminClient().from('business_events').insert(validEvents as never)
        .then(({ error }) => { if (error) console.warn('[final] business_events insert failed:', error.message) })
    }
  }

  // Restore audience_profiles — gender_mix is a critical field for completeness scoring.
  // Use form-submitted primary_audience_gender if available, else default to 50/50.
  const genderMix = (() => {
    const g = f.primary_audience_gender
    if (g === 'female_skewed') return { female: 65, male: 35 }
    if (g === 'male_skewed')   return { female: 35, male: 65 }
    return { female: 50, male: 50 }
  })()
  await supabase.from('audience_profiles').upsert({
    brand_id:            f.brand_id,
    gender_mix:          genderMix,
    language_preference: f.bilingual_ratio ?? 'arabic_primary',
  } as never, { onConflict: 'brand_id' })

  // Create evidence_bundles for ALL 12 critical BrandDNA fields that were
  // submitted in this form. Without these, completeness_score stays at 10
  // (the submitSeed placeholder) until the COO pipeline runs — which may
  // be minutes or hours later. We write them now at 'explicitly_confirmed'
  // for fields the user typed, and 'inferred_medium' for fields pre-filled
  // from extraction. The COO pipeline can only upgrade these, never downgrade.
  void (async () => {
    try {
      const adb = adminClient()
      const { data: formSrc } = await adb.from('source_records')
        .select('source_id').eq('brand_id', f.brand_id).eq('source_type', 'form')
        .order('captured_at', { ascending: false }).limit(1).maybeSingle()
      if (!formSrc) return

      const srcIds = [formSrc.source_id]
      const now = new Date().toISOString()

      // Derive primary_channel from platforms if not already on brand row
      const primaryChannel = (() => {
        if ((seed as Record<string,unknown>).primary_channel) return (seed as Record<string,unknown>).primary_channel as string
        if (f.platforms?.includes('Instagram')) return 'Instagram'
        if (f.platforms?.length) return f.platforms[0]!
        return null
      })()

      // Derive primary_kpi_type from intent_state (same logic as brand_profiles update above)
      const primaryKpiType = (() => {
        const intent = f.intent_state
        if (!intent) return null
        if (intent === 'harvest') return 'conversion'
        if (intent === 'defend')  return 'engagement'
        if (intent === 'recover') return 'trust'
        if (intent === 'grow')    return 'awareness'
        if (intent === 'launch')  return 'awareness'
        return 'engagement'
      })()

      // Map critical field_name → { value, confidence }
      // 'explicitly_confirmed' = user typed/selected it directly in the form
      // 'inferred_medium'      = pre-filled from extraction, user didn't modify
      const criticalBundles: Array<{ field_name: string; value: unknown; confidence: string }> = [
        { field_name: 'arabic_dialect',          value: f.arabic_dialect,          confidence: f.arabic_dialect          ? 'explicitly_confirmed' : 'inferred_medium' },
        { field_name: 'brand_differentiator',    value: f.brand_differentiator,    confidence: 'explicitly_confirmed' },
        { field_name: 'price_position',          value: f.price_position,          confidence: f.price_position          ? 'explicitly_confirmed' : 'inferred_medium' },
        { field_name: 'primary_channel',         value: primaryChannel,            confidence: primaryChannel            ? 'inferred_medium' : '' },
        { field_name: 'ramadan_relevance',       value: f.ramadan_relevance,       confidence: f.ramadan_relevance       ? 'explicitly_confirmed' : 'inferred_medium' },
        { field_name: 'primary_audience_gender', value: f.primary_audience_gender, confidence: f.primary_audience_gender ? 'explicitly_confirmed' : 'inferred_medium' },
        { field_name: 'primary_kpi_type',        value: primaryKpiType,            confidence: primaryKpiType            ? 'inferred_medium' : '' },
        { field_name: 'religious_sensitivity',   value: f.religious_sensitivity,   confidence: 'explicitly_confirmed' },
        { field_name: 'tone_anti_attribute_ids', value: f.tone_anti_attribute_ids, confidence: f.tone_anti_attribute_ids?.length ? 'explicitly_confirmed' : 'inferred_medium' },
        { field_name: 'bilingual_ratio',         value: f.bilingual_ratio,         confidence: f.bilingual_ratio         ? 'explicitly_confirmed' : 'inferred_medium' },
        { field_name: 'archetype_primary',       value: f.archetype_family,        confidence: f.archetype_family        ? 'inferred_medium' : '' },
        { field_name: 'lifecycle_stage',         value: f.lifecycle,               confidence: f.lifecycle               ? 'inferred_medium' : '' },
      ]

      const rows = criticalBundles
        .filter(({ value, confidence }) => value != null && value !== '' && confidence !== '')
        .map(({ field_name, confidence }) => ({
          brand_id:                 f.brand_id,
          field_name,
          supporting_source_ids:   srcIds,
          contradicting_source_ids: [],
          agreement_ratio:         1.0,
          recency_score:           1.0,
          conflict_score:          0.0,
          field_confidence:        confidence,
          last_evaluated:          now,
        }))

      if (rows.length > 0) {
        const { error: ebErr } = await adb.from('evidence_bundles')
          .upsert(rows as never, { onConflict: 'brand_id,field_name', ignoreDuplicates: false })
        if (ebErr) console.warn('[final] evidence_bundles upsert failed:', ebErr.message)
        else console.info(`[final] evidence_bundles: ${rows.length} critical fields written for brand=${f.brand_id}`)
      }

      // Refresh completeness_score on brand_profiles so the profile page
      // immediately shows the correct % after onboarding completes.
      await adb.rpc('refresh_brand_completeness', { p_brand_id: f.brand_id }).then(({ error }) => {
        if (error) console.warn('[final] refresh_brand_completeness failed:', error.message)
      })
    } catch (e) {
      console.warn('[final] evidence_bundles write failed:', (e as Error).message)
    }
  })()

  // Seed visual_style_profiles so snapshot UI has something to show
  await adminClient().from('visual_style_profiles').upsert({
    brand_id:         f.brand_id,
    color_palette:    f.primary_color_hex ? [f.primary_color_hex] : [],
    style_descriptor: null,
    anti_emojis:      [],
    imagery_dos:      [],
    imagery_donts:    [],
    mood_keywords:    [],
  } as never, { onConflict: 'brand_id' })

  // Seed channel_profiles fallback (A06 will overwrite with richer data)
  await adminClient().from('channel_profiles').upsert({
    brand_id:    f.brand_id,
    channel:     'Instagram',
    handle:      seed.instagram_handle ?? null,
    profile_url: seed.instagram_handle ? `https://instagram.com/${seed.instagram_handle}` : null,
    is_business: false,
    is_verified: false,
    synced_at:   null,
  } as never, { onConflict: 'brand_id,channel' })

  // ── source_records — evidence row for COO confidence scoring ────────
  // COO reads this to compute confidence states. Without it, user-typed
  // fields can never reach `explicitly_confirmed`.
  await adminClient().from('source_records').insert({
    brand_id: f.brand_id,
    source_type: 'form',
    raw_payload: {
      flow_version: 'v3_slim',
      submitted_at: new Date().toISOString(),
      seed: {
        brand_name_ar:    seed.brand_name_ar,
        sector:           seed.sector,
        city_primary:     seed.city_primary,
        instagram_handle: seed.instagram_handle,
        website_url:      seed.website_url,
      },
      review: {
        brand_name_en:           f.brand_name_en,
        arabic_dialect:          f.arabic_dialect,
        primary_color_hex:       f.primary_color_hex,
        brand_differentiator:    f.brand_differentiator,
        tone_anti_attribute_ids: f.tone_anti_attribute_ids,
        religious_sensitivity:   f.religious_sensitivity,
        intent_state:            f.intent_state,
        primary_audience_gender: f.primary_audience_gender ?? null,
        ramadan_relevance:       f.ramadan_relevance ?? null,
        lifecycle:               f.lifecycle ?? null,
        founding_story:          f.founding_story ?? null,
        platforms:               f.platforms,
        social:                  f.social ?? null,
        lifestyle:               f.lifestyle ?? null,
        cust_desc:               f.cust_desc ?? null,
        name_meaning:            f.name_meaning ?? null,
        price_position:          f.price_position,
        price_nums:              f.price_nums ?? null,
        emotions:                f.emotions,
        cust_quote:              f.cust_quote ?? null,
        archetype_family:        f.archetype_family ?? null,
        caption_ex:              f.caption_ex ?? null,
        music:                   f.music ?? null,
        music_link:              f.music_link ?? null,
        restrictions:            f.restrictions,
        custom_restriction:      f.custom_restriction ?? null,
        bilingual_ratio:         f.bilingual_ratio ?? null,
        tagline:                 f.tagline ?? null,
        occasions_ranked:        f.occasions_ranked,
        custom_occasion:         f.custom_occasion ?? null,
        ...occasionRelevanceFromRanked(f.occasions_ranked ?? []),
        goal:                    f.goal ?? null,
        metric:                  f.metric ?? null,
        problems:                f.problems,
        products_list:           f.products_list ?? null,
        brand_refs:              f.brand_refs ?? null,
        vision:                  f.vision ?? null,
        vision_text:             f.vision_text ?? null,
        anything:                f.anything ?? null,
      },
      logo_uploaded: !!logoUrl,
    },
    recency_score: 1.0,
  } as never)

  await emitProcessingStage({
    brand_id: f.brand_id,
    stage: 'form_submitted',
    metadata: { intent: f.intent_state, completeness_estimate: 30 },
  })

  // ── onboarding_responses — per-question audit rows ────────────────
  // Restored in slim submitFinal. Maps form fields to stable question UUIDs
  // seeded in migration 0073 so /admin shows full answer history.
  // Best-effort — never blocks the pipeline.
  void (async () => {
    try {
      const admin = adminClient()
      const { data: questions } = await admin
        .from('onboarding_questions')
        .select('question_id, maps_to_field')
      const keyToId = new Map<string, string>()
      for (const q of (questions ?? []) as Array<{ question_id: string; maps_to_field: string }>) {
        keyToId.set(q.maps_to_field, q.question_id)
      }
      // Only fields the slim form actually collects — no Layer 2 depth fields
      const answers: Array<{ key: string; value: unknown; weight: number }> = [
        { key: 'brand_name_ar',           value: f.brand_name_ar,              weight: 1.0 },
        { key: 'brand_name_en',           value: f.brand_name_en,              weight: 1.0 },
        { key: 'sector',                  value: seed.sector,                  weight: 1.0 },
        { key: 'city_primary',            value: seed.city_primary,            weight: 1.0 },
        { key: 'arabic_dialect',          value: f.arabic_dialect,             weight: 1.0 },
        { key: 'brand_differentiator',    value: f.brand_differentiator,       weight: 1.0 },
        { key: 'religious_sensitivity',   value: f.religious_sensitivity,      weight: 1.0 },
        { key: 'intent_state',            value: f.intent_state,               weight: 1.0 },
        { key: 'primary_audience_gender', value: f.primary_audience_gender,    weight: 1.0 },
        { key: 'ramadan_relevance',       value: f.ramadan_relevance,          weight: 1.0 },
        { key: 'tone_anti_attribute_ids', value: f.tone_anti_attribute_ids,    weight: 1.0 },
        { key: 'primary_color_hex',       value: f.primary_color_hex,          weight: 1.0 },
        { key: 'bilingual_ratio',         value: f.bilingual_ratio,            weight: 0.9 },
        { key: 'price_position',          value: f.price_position,             weight: 0.9 },
        { key: 'lifestyle',               value: f.lifestyle,                  weight: 0.8 },
        { key: 'emotions',                value: f.emotions?.join(',') || null, weight: 0.8 },
        { key: 'music',                   value: f.music,                      weight: 0.7 },
        { key: 'restrictions',            value: f.restrictions?.join(',') || null, weight: 0.9 },
        { key: 'occasions_ranked',        value: f.occasions_ranked?.join(',') || null, weight: 0.8 },
        { key: 'goal',                    value: f.goal,                       weight: 0.9 },
        { key: 'vision',                  value: f.vision,                     weight: 0.8 },
        { key: 'founding_story',          value: f.founding_story,             weight: 0.9 },
        { key: 'instagram_handle',        value: seed.instagram_handle,        weight: 1.0 },
        { key: 'website_url',             value: seed.website_url,             weight: 1.0 },
        // Additional fields from all 5 form chapters
        { key: 'name_meaning',            value: f.name_meaning,               weight: 0.9 },
        { key: 'archetype_family',        value: f.archetype_family,           weight: 1.0 },
        { key: 'caption_ex',              value: f.caption_ex,                 weight: 0.8 },
        { key: 'lifecycle',               value: f.lifecycle,                  weight: 0.9 },
        { key: 'platforms',               value: f.platforms?.join(',') || null, weight: 1.0 },
        { key: 'primary_channel',         value: (f.platforms?.includes('Instagram') ? 'Instagram' : f.platforms?.[0]) ?? null, weight: 0.9 },
        { key: 'formality_level',         value: (seed as Record<string,unknown>).formality_level,  weight: 0.9 },
        { key: 'humor_tolerance',         value: (seed as Record<string,unknown>).humor_tolerance,  weight: 0.9 },
        { key: 'problems',                value: f.problems?.join('; ') || null, weight: 0.8 },
        { key: 'national_day_relevance',  value: occasionRelevanceFromRanked(f.occasions_ranked ?? []).national_day_relevance ?? null, weight: 0.8 },
        { key: 'brand_refs',              value: Array.isArray(f.brand_refs) ? f.brand_refs.join(', ') : null, weight: 0.7 },
      ]
      // Deduplicate by key — last entry wins. Prevents Postgres
      // "ON CONFLICT DO UPDATE command cannot affect row a second time".
      const deduped = new Map<string, (typeof answers)[0]>()
      for (const a of answers) deduped.set(a.key, a)
      const rows = Array.from(deduped.values())
        .filter((a) => a.value !== null && a.value !== undefined && a.value !== '' && keyToId.has(a.key))
        .map((a) => ({
          brand_id:          f.brand_id,
          question_id:       keyToId.get(a.key) as string,
          answer_raw:        String(a.value),
          answer_processed:  { value: a.value } as never,
          confidence_weight: a.weight,
          source:            'form',
        }))
      if (rows.length > 0) {
        const { error: orErr } = await admin.from('onboarding_responses')
          .upsert(rows as never, { onConflict: 'brand_id,question_id', ignoreDuplicates: false })
        if (orErr) console.warn('[final] onboarding_responses upsert failed:', orErr.message)
        else console.info(`[final] onboarding_responses: ${rows.length} rows written for brand=${f.brand_id}`)
      }
    } catch (e) {
      console.warn('[final] onboarding_responses write skipped:', (e as Error).message)
    }
  })()

  // Compute data_richness — tells COO how much extraction data is available.
  // 'form_only' = no social history at all → COO uses sector defaults heavily.
  // 'single_source' = only one scraper returned data.
  // 'partial' = 2 scrapers returned data.
  // 'rich' = all 3 sources returned data.
  const hasIg      = !!seed.instagram_handle
  const hasWeb     = !!seed.website_url
  const hasPlaces  = !!seed.brand_name_ar && seed.brand_name_ar !== '(awaiting review)'
  const sourceCount = [hasIg, hasWeb, hasPlaces].filter(Boolean).length
  const dataRichness: 'form_only' | 'single_source' | 'partial' | 'rich' =
    sourceCount === 0 ? 'form_only'
    : sourceCount === 1 ? 'single_source'
    : sourceCount === 2 ? 'partial'
    : 'rich'

  // Fire N8N-A03 — the main BrandDNA pipeline
  // Map occasions_ranked chip labels → CEO occasion_flag keys
  const OCCASION_MAP: Record<string, string> = {
    'Ramadan / Eid Al-Fitr': 'ramadan',
    'Eid Al-Adha':           'eid_al_adha',
    'Saudi National Day':    'national_day',
    'Founding Day':          'founding_day',
    "Mother's Day":          'mothers_day',
    'Back to School':        'back_to_school',
    "Valentine's Day":       'valentines_day',
    'Seasonal Offers':       'seasonal_offers',
  }
  const occasionFlags = (f.occasions_ranked ?? [])
    .map((o) => OCCASION_MAP[o])
    .filter(Boolean) as string[]

  const trigger = await triggerN8nA03Onboarding({
    flow_id:          'N8N-A03',
    brand_id:         f.brand_id,
    slug,
    instagram_handle: seed.instagram_handle ?? null,
    website_url:      seed.website_url ?? null,
    place_search:     { name: seed.brand_name_ar ?? '', city: seed.city_primary ?? '' },
    occasion_flags:   occasionFlags.length > 0 ? occasionFlags : ['none'],
    form_payload: {
      flow_version:  'v3_slim',
      submitted_at:  new Date().toISOString(),
      data_richness: dataRichness,
      seed: {
        brand_name_ar:    seed.brand_name_ar,
        sector:           seed.sector,
        city_primary:     seed.city_primary,
        instagram_handle: seed.instagram_handle,
        website_url:      seed.website_url,
      },
      review: {
        brand_name_en:           f.brand_name_en,
        arabic_dialect:          f.arabic_dialect,
        primary_color_hex:       f.primary_color_hex,
        brand_differentiator:    f.brand_differentiator,
        tone_anti_attribute_ids: f.tone_anti_attribute_ids,
        religious_sensitivity:   f.religious_sensitivity,
        intent_state:            f.intent_state,
        // CEO checks these — seeded at submitSeed, not re-entered in review form
        formality_level:         (seed as Record<string,unknown>).formality_level ?? 'semi_formal',
        humor_tolerance:         (seed as Record<string,unknown>).humor_tolerance ?? 'light',
        primary_channel:         (seed as Record<string,unknown>).primary_channel ?? 'Instagram',
        primary_kpi_type:        (seed as Record<string,unknown>).primary_kpi_type ?? null,
        lifecycle:               f.lifecycle ?? null,
        founding_story:          f.founding_story ?? null,
        name_meaning:            f.name_meaning ?? null,
        platforms:               f.platforms,
        lifestyle:               f.lifestyle ?? null,
        price_position:          f.price_position,
        emotions:                f.emotions,
        archetype_family:        f.archetype_family ?? null,
        caption_ex:              f.caption_ex ?? null,
        music:                   f.music ?? null,
        restrictions:            f.restrictions,
        bilingual_ratio:         f.bilingual_ratio ?? null,
        occasions_ranked:        f.occasions_ranked,
        ...occasionRelevanceFromRanked(f.occasions_ranked ?? []),
        goal:                    f.goal ?? null,
        brand_refs:              f.brand_refs ?? null,
        problems:                f.problems,
        vision:                  f.vision ?? null,
        anything:                f.anything ?? null,
      },
      logo_uploaded: !!logoUrl,
    },
  })
  if (!trigger.ok) {
    console.warn(
      `[final] N8N-A03 trigger failed for brand=${f.brand_id}: ` +
        `status=${trigger.status ?? 'n/a'} error=${trigger.error ?? 'unknown'}`,
    )
  } else {
    console.info(`[final] N8N-A03 trigger ok for brand=${f.brand_id}: status=${trigger.status}`)
  }

  // Fire A07 competitor extraction for any active competitor accounts.
  // Query AFTER the sync above so we get the final post-sync state.
  // Best-effort — never blocks onboarding completion.
  try {
    const { data: activeCompetitors, error: compQueryErr } = await adminClient()
      .from('competitor_accounts')
      .select('competitor_id, handle_instagram')
      .eq('brand_id', f.brand_id)
      .eq('is_active', true)
      .limit(5)
    if (compQueryErr) {
      console.warn(`[final] A07 competitor query failed brand=${f.brand_id}: ${compQueryErr.message}`)
    } else if (activeCompetitors && activeCompetitors.length > 0) {
      console.info(`[final] firing A07 for brand=${f.brand_id} with ${activeCompetitors.length} competitors: ${activeCompetitors.map(c => c.handle_instagram).join(', ')}`)
      const a07 = await triggerN8nA07CompetitorExtraction({
        brand_id:        f.brand_id,
        competitors:     activeCompetitors,
        extraction_type: 'light',
        triggered_by:    'A03',
      })
      if (!a07.ok) {
        console.warn(`[final] A07 trigger failed brand=${f.brand_id}: status=${a07.status ?? 'n/a'} error=${a07.error ?? 'unknown'}`)
      } else {
        console.info(`[final] A07 trigger ok brand=${f.brand_id}: status=${a07.status}`)
      }
    } else {
      console.info(`[final] A07 skipped brand=${f.brand_id}: no active competitors`)
    }
  } catch (a07Err) {
    console.warn(`[final] A07 exception brand=${f.brand_id}:`, a07Err)
  }

  return { ok: true, redirect_to: `/${slug}/processing` }
}
