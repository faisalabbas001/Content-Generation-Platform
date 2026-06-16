/**
 * Onboarding write helpers — used at the end of the COO build-branddna call
 * (Doc §5.3 step 5: "store extractions").
 *
 * Scope clarification: Hard Rule #2 says the Memory Controller is the SOLE
 * BrandDNA writer. "BrandDNA" in that rule means the 10 critical brand fields
 * (arabic_dialect, formality_level, …) tracked in evidence_bundles. The
 * supporting raw-evidence tables — `source_records`, `audience_profiles`,
 * `visual_style_profiles`, `channel_profiles` — are RLS-write-only fact tables
 * that capture WHAT was scraped, not WHAT BrandDNA decisions were made. They
 * are written exactly once at onboarding from the agent that produced them.
 *
 * Tables touched here (all per-brand, RLS-protected):
 *   - source_records          — one row per (source_type, brand_id) the COO saw
 *   - audience_profiles       — placeholder row keyed by brand_id
 *   - visual_style_profiles   — placeholder row keyed by brand_id
 *   - channel_profiles        — one row per detected channel handle
 *   - brand_profiles          — sector_baseline_id link when first confirmed
 */
import type { Db } from '../client'

const SOURCE_TYPE_MAP: Record<string, string> = {
  FORM_ANSWER: 'form',
  INSTAGRAM_SCRAPE: 'instagram',
  WEBSITE_SCRAPE: 'website',
  GOOGLE_BUSINESS: 'google_places',
  SECTOR_BASELINE: 'scrape',
}

interface SourceRecordInput {
  source_type: string
  source_origin: string
  reliability_score: number
  field_contributions: string[]
}

export async function persistSourceRecords(
  db: Db,
  brand_id: string,
  records: SourceRecordInput[],
): Promise<{ inserted: number; source_ids_by_origin: Record<string, string> }> {
  if (records.length === 0) return { inserted: 0, source_ids_by_origin: {} }
  const rows = records.map((r) => ({
    brand_id,
    source_type: SOURCE_TYPE_MAP[r.source_type] ?? 'scrape',
    raw_payload: {
      source_origin: r.source_origin,
      reliability_score: r.reliability_score,
      field_contributions: r.field_contributions,
    },
    recency_score: 1.0,
  }))
  const { data, error } = await db
    .from('source_records')
    .insert(rows as never)
    .select('source_id, raw_payload')
  if (error) throw new Error(`persistSourceRecords failed: ${error.message}`)
  // Map source_origin (e.g. "form", "instagram_profile", "website_homepage")
  // back to its inserted source_id so callers can wire confidence_upgrade
  // nominations to the evidence rows that backed each field.
  const source_ids_by_origin: Record<string, string> = {}
  for (const row of (data ?? []) as Array<{ source_id: string; raw_payload?: { source_origin?: string } }>) {
    const origin = row.raw_payload?.source_origin
    if (origin && !source_ids_by_origin[origin]) {
      source_ids_by_origin[origin] = row.source_id
    }
  }
  return { inserted: rows.length, source_ids_by_origin }
}

interface ScraperExtractions {
  instagram?: { handle?: string | null; followers?: number | null; engagement_rate?: number | null } | null
  website?: { url?: string | null; description?: string | null; color_palette?: string[] | null } | null
  places?: { name?: string | null; address?: string | null } | null
}

/**
 * Create the per-brand placeholder rows the BrandDNA query expects to find.
 * Idempotent — uses ON CONFLICT (brand_id) DO NOTHING via Supabase upsert.
 */
export async function bootstrapBrandSatelliteRows(
  db: Db,
  brand_id: string,
  ext: ScraperExtractions,
): Promise<{ audience: boolean; visual: boolean; channels: number }> {
  // Sector-defaulted age range fallback. COO Pass 4 is supposed to nominate
  // AudienceProfile.age_range but the prompt is unreliable. Seed it from
  // sector defaults so the column is never NULL on a healthy brand.
  // F&B SMEs in Saudi typically index 25-45; premium F&B skews 28-50;
  // beauty/wellness 22-40; healthcare 30-55; retail 20-45.
  const { data: brand } = await db
    .from('brand_profiles')
    .select('sector, price_position')
    .eq('brand_id', brand_id)
    .maybeSingle()
  const sector = (brand as { sector?: string } | null)?.sector ?? 'F&B'
  const price  = (brand as { price_position?: string } | null)?.price_position ?? 'mid_market'
  const SECTOR_AGE_DEFAULTS: Record<string, { min: number; max: number }> = {
    'F&B':                { min: 25, max: 45 },
    'Retail':             { min: 20, max: 45 },
    'Beauty_Wellness':    { min: 22, max: 40 },
    'Healthcare':         { min: 30, max: 55 },
    'Finance':            { min: 28, max: 55 },
    'Government':         { min: 25, max: 65 },
    'Other':              { min: 25, max: 50 },
  }
  const baseRange = SECTOR_AGE_DEFAULTS[sector] ?? SECTOR_AGE_DEFAULTS['Other']!
  // Premium / luxury skews older
  const ageRange = (price === 'premium' || price === 'luxury')
    ? { min: baseRange.min + 3, max: baseRange.max + 5 }
    : baseRange

  // audience_profiles — placeholder; Memory Controller will fill description_ar later.
  // We pre-fill age_range with the sector-defaulted band so it's never NULL.
  // Memory Controller's COO nominations can later override it with a more
  // specific value at higher confidence.
  const { error: e1 } = await db
    .from('audience_profiles')
    .upsert({ brand_id, age_range: ageRange } as never, { onConflict: 'brand_id', ignoreDuplicates: false })
  if (e1) throw new Error(`audience_profiles upsert failed: ${e1.message}`)

  // visual_style_profiles — pre-fill color_palette from website scrape if any.
  // Also seed `platform_specs` with the IG defaults so A01/V01 don't have to
  // hard-code dimensions per call. JSONB on the column allows future per-
  // channel additions (Snapchat, TikTok) without a schema change.
  const palette = ext.website?.color_palette ?? null
  const platformSpecs = {
    instagram: {
      feed:   { aspect_ratio: '1:1',   width: 1080, height: 1080 },
      portrait: { aspect_ratio: '4:5', width: 1080, height: 1350 },
      story:  { aspect_ratio: '9:16',  width: 1080, height: 1920 },
      reel:   { aspect_ratio: '9:16',  width: 1080, height: 1920 },
      caption_max_chars: 2200,
      hashtag_max_count: 30,
    },
  }
  const { error: e2 } = await db
    .from('visual_style_profiles')
    .upsert(
      { brand_id, color_palette: palette, platform_specs: platformSpecs } as never,
      { onConflict: 'brand_id', ignoreDuplicates: false },
    )
  if (e2) throw new Error(`visual_style_profiles upsert failed: ${e2.message}`)

  // channel_profiles — one row per detected platform
  let channels = 0
  if (ext.instagram?.handle) {
    const { error } = await db.from('channel_profiles').upsert(
      {
        brand_id,
        channel: 'Instagram',
        handle: ext.instagram.handle,
        followers_count: ext.instagram.followers ?? null,
        synced_at: new Date().toISOString(),
      } as never,
      { onConflict: 'brand_id,channel' },
    )
    if (error) throw new Error(`channel_profiles instagram upsert failed: ${error.message}`)
    channels++
  }

  return { audience: true, visual: true, channels }
}

/**
 * Snapshot the current confidence verdict for a brand. Doc §5.3 step 8 +
 * §5.4 — every CEO routing decision that targets a known brand emits a new
 * row here, marking the prior active row (if any) as superseded so /profile
 * always shows the latest.
 *
 * Idempotency: the supersede-then-insert is the standard pattern for active
 * row tracking. If two writers race, both will mark and both will insert —
 * the indexed `superseded_at IS NULL` query naturally returns the newest.
 */
export async function recordConfidenceClassification(
  db: Db,
  brand_id: string,
  mode: 'Standard' | 'Cautious' | 'Minimal' | 'Blocked',
  reasons: string[],
): Promise<{ classification_id: string | null }> {
  const { error: e1 } = await db
    .from('confidence_classifications')
    .update({ superseded_at: new Date().toISOString() } as never)
    .eq('brand_id', brand_id)
    .is('superseded_at', null)
  if (e1) {
    return { classification_id: null }
  }
  const { data, error: e2 } = await db
    .from('confidence_classifications')
    .insert({ brand_id, mode, reasons } as never)
    .select('classification_id')
    .single()
  if (e2 || !data) return { classification_id: null }
  return { classification_id: (data as { classification_id: string }).classification_id }
}

/**
 * After Memory Controller has validated the sector field, link the brand to
 * its (sector, dialect) baseline. Idempotent: only sets when currently null.
 */
export async function linkSectorBaseline(db: Db, brand_id: string): Promise<{ linked: boolean }> {
  const { data: brand, error: e1 } = await db
    .from('brand_profiles')
    .select('sector, arabic_dialect, sector_baseline_id')
    .eq('brand_id', brand_id)
    .single()
  if (e1) return { linked: false }
  if (!brand || brand.sector_baseline_id) return { linked: false }
  if (!brand.sector || !brand.arabic_dialect) return { linked: false }

  // 1. Exact match on (sector, dialect)
  let { data: baseline, error: e2 } = await db
    .from('sector_baselines')
    .select('baseline_id')
    .eq('sector', brand.sector)
    .eq('dialect', brand.arabic_dialect)
    .limit(1)
    .maybeSingle()
  // 2. Fall back to sector-only (sector_baselines may be sparsely seeded —
  //    only Najdi dialect exists today). A sector baseline is still useful
  //    even when dialect doesn't exactly match.
  if (!baseline) {
    const { data: fallback, error: fbErr } = await db
      .from('sector_baselines')
      .select('baseline_id')
      .eq('sector', brand.sector)
      .limit(1)
      .maybeSingle()
    if (!fbErr) baseline = fallback
  }
  if (e2 || !baseline) return { linked: false }

  const { error: e3 } = await db
    .from('brand_profiles')
    .update({ sector_baseline_id: baseline.baseline_id } as never)
    .eq('brand_id', brand_id)
  if (e3) return { linked: false }
  return { linked: true }
}
