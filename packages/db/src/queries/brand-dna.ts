/**
 * getBrandDna(client, brand_id) — fetch the FULL BrandDNA graph for one brand.
 *
 * Per Doc §4.1: BrandDNA is a distributed schema across 11 tables. This
 * function reads them all in parallel and returns a single typed DTO that
 * powers /snapshot, /profile, /dashboard, the admin debug view, and PDPL exports.
 *
 * RLS-correctness:
 *   - Pass `userClient` from getUserScopedClient() for client-facing pages —
 *     RLS auto-isolates by auth.uid().
 *   - Pass `adminClient()` from server-only admin tools — bypasses RLS.
 *   - Memory Controller's pg-bypass is NOT used here (read path only — RLS
 *     is the right guard).
 *
 * Performance: 10 queries fired in parallel via Promise.all. Postgres handles
 * them concurrently; total wall time ≈ slowest single query (~50-150ms).
 */
import { adminClient, isDbConfigured, type Db } from '../client'
import type {
  BrandProfile,
  BrandSnapshot,
  EvidenceBundle,
  ConfidenceMode,
  FieldConfidence,
  NegpatSeverity,
  Channel,
  AssetLibraryItem,
  BrandContentPattern,
  CompetitorSnapshot,
  CompetitorAccount,
} from '../types'

// ─────────────────────────────────────────────────────────────────────
// Public DTO — the canonical shape every consumer reads.
// ─────────────────────────────────────────────────────────────────────

export interface AudienceProfile {
  audience_id: string
  brand_id: string
  description_ar: string | null
  gender_mix: { female?: number; male?: number } | null
  age_range: { min?: number; max?: number } | null
  language_preference: 'arabic_only' | 'arabic_primary' | 'balanced' | 'english_primary' | null
  created_at: string
}

export interface VisualStyleProfile {
  style_id: string
  brand_id: string
  style_descriptor: string | null
  color_palette: string[] | null
  platform_specs: Record<string, unknown> | null
  // Layer 3 addition (migration 0086) — visual register classification
  style_register: 'traditional' | 'modern' | 'youth' | 'mixed' | null
  // Note: lora_reference, approved_examples, rejected_examples were
  // consolidated out of this table in migration 0088. LoRA lives on
  // brand_profiles; examples live in asset_library table.
  created_at: string
}

export interface ChannelProfile {
  channel_id: string
  brand_id: string
  channel: Channel
  handle: string | null
  followers_count: number | null
  engagement_rate: number | null
  synced_at: string | null
  posts_count_total: number | null
  is_business: boolean | null
  is_verified: boolean | null
  created_at: string
  postiz_channel_id: string | null
  // scrape-populated fields (may be absent on older rows)
  profile_url?: string | null
  full_name?: string | null
  biography?: string | null
  category?: string | null
  business_category?: string | null
  external_url?: string | null
  follows_count?: number | null
}

export interface NegativePattern {
  pattern_id: string
  brand_id: string
  pattern_text: string
  severity: NegpatSeverity
  reasoning: string | null
  source: string
  created_at: string
  updated_at: string
}

export interface GlobalNegativePattern {
  pattern_id: string
  pattern_text: string
  severity: NegpatSeverity
  category: string
  description: string | null
  is_active: boolean
  // Optional occasion window (migration 0081). null = always active;
  // e.g. 'ramadan' | 'ramadan_daylight'. select('*') populates it.
  occasion_scope?: string | null
  created_at: string
  updated_at: string
}

export interface OverrideRule {
  rule_id: string
  brand_id: string
  rule_key: string
  rule_value: unknown
  description: string | null
  reasoning: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SourceRecordSummary {
  source_type: string
  captured_at: string
  recency_score: number
}

export interface ConfidenceClassification {
  classification_id: string
  brand_id: string
  mode: ConfidenceMode
  reasons: unknown[]
  created_at: string
  superseded_at: string | null
}

export interface EvidenceSummary {
  total: number
  by_state: Record<FieldConfidence, number>
}

// v2 — creative direction layer (one row per brand from brand_method_profiles).
export interface MethodProfileSummary {
  voice_register: string
  diagnostic_pattern: string
  visual_idiom: string
  cadence_rule: string
  closing_pattern: string
  composition_blend: Record<string, string>
  composition_score: number
  creative_direction_text: string
  updated_at: string
}

export interface BrandDnaView {
  brand: BrandProfile
  audience: AudienceProfile | null
  visual_style: VisualStyleProfile | null
  channels: ChannelProfile[]
  evidence: {
    summary: EvidenceSummary
    bundles: EvidenceBundle[]
  }
  negative_patterns: NegativePattern[]
  global_negative_patterns: GlobalNegativePattern[]
  override_rules: OverrideRule[]
  sources: {
    count: number
    by_type: Record<string, number>
    recent: SourceRecordSummary[]
  }
  current_confidence: ConfidenceClassification | null
  latest_snapshot: BrandSnapshot | null
  // v2: creative direction (null until COO Pass 3 has written one)
  method_profile: MethodProfileSummary | null
  // Layer 3 — approved/rejected brand assets (migration 0077)
  assets: {
    approved: AssetLibraryItem[]
    rejected: AssetLibraryItem[]
    lora_candidates: AssetLibraryItem[]
  }
  // Layer 5 — competitor intelligence (migration 0076)
  competitors: {
    accounts: CompetitorAccount[]
    latest_snapshots: CompetitorSnapshot[]
  }
  // Layer 6 — content performance patterns (migration 0078)
  content_patterns: {
    winners: BrandContentPattern[]
    losers: BrandContentPattern[]
  }
  stats: {
    total_calendars_generated: number
    onboarding_status: string | null
    is_calibration_period: boolean
    calibration_ends_at: string | null
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public function
// ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the full BrandDNA for one brand. Returns null when the brand doesn't
 * exist or is invisible to the supplied client (e.g. wrong user via RLS).
 */
export async function getBrandDna(
  brand_id: string,
  client?: Db,
): Promise<BrandDnaView | null> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return null

  const [
    brand,
    audience,
    visual,
    channels,
    bundles,
    negatives,
    globalNegatives,
    overrides,
    sources,
    snapshot,
    confidence,
    methodProfile,
    assetRows,
    competitorAccountRows,
    competitorSnapshotRows,
    contentPatternRows,
  ] = await Promise.all([
    supabase.from('brand_profiles').select('*').eq('brand_id', brand_id).maybeSingle(),
    supabase.from('audience_profiles').select('*').eq('brand_id', brand_id).maybeSingle(),
    supabase.from('visual_style_profiles').select('*').eq('brand_id', brand_id).maybeSingle(),
    supabase.from('channel_profiles').select('*').eq('brand_id', brand_id).order('channel'),
    supabase.from('evidence_bundles').select('*').eq('brand_id', brand_id).order('field_name'),
    supabase.from('negative_patterns').select('*').eq('brand_id', brand_id).order('severity'),
    supabase.from('global_negative_patterns' as never).select('*').eq('is_active' as never, true).order('category' as never),
    supabase.from('override_rules').select('*').eq('brand_id', brand_id).eq('is_active' as never, true).order('rule_key'),
    // Read the view (not the raw table) so `recency_score` reflects the
    // live exponential decay computed via public.compute_recency_score().
    // Migration 0025 — the underlying `source_records.recency_score`
    // column is "as-captured" (always 1.0); the view returns the live
    // decayed value under the same column name.
    //
    // The `as never` cast on the relation name is required because
    // gen-types.ts deliberately skips views (Views: {} in the generated
    // types). We narrow the result with a type assertion below.
    supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('source_records_with_recency' as never)
      .select('source_type, captured_at, recency_score')
      .eq('brand_id' as never, brand_id)
      .order('captured_at' as never, { ascending: false })
      .limit(20),
    supabase
      .from('brand_snapshots')
      .select('*')
      .eq('brand_id', brand_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('confidence_classifications')
      .select('*')
      .eq('brand_id', brand_id)
      .is('superseded_at', null)
      .limit(1)
      .maybeSingle(),
    // v2 — creative direction layer
    supabase
      .from('brand_method_profiles')
      .select('*')
      .eq('brand_id', brand_id)
      .maybeSingle(),
    // Layer 3 — asset library (migration 0077): approved/rejected examples + LoRA candidates
    supabase
      .from('asset_library' as never)
      .select('*')
      .eq('brand_id' as never, brand_id)
      .order('uploaded_at' as never, { ascending: false })
      .limit(50),
    // Layer 5 — active competitor accounts (migration 0076)
    supabase
      .from('competitor_accounts' as never)
      .select('*')
      .eq('brand_id' as never, brand_id)
      .eq('is_active' as never, true)
      .order('added_at' as never, { ascending: true }),
    // Layer 5 — latest competitor snapshots (most recent 10)
    supabase
      .from('competitor_snapshots' as never)
      .select('*')
      .eq('brand_id' as never, brand_id)
      .order('extracted_at' as never, { ascending: false })
      .limit(10),
    // Layer 6 — active content performance patterns (migration 0078)
    supabase
      .from('brand_content_patterns' as never)
      .select('*')
      .eq('brand_id' as never, brand_id)
      .eq('is_active' as never, true)
      .order('first_observed_at' as never, { ascending: false }),
  ])

  if (brand.error || !brand.data) return null

  // Aggregate evidence summary in JS — cheap because there are only ~10 rows.
  const evidenceBundles = (bundles.data ?? []) as EvidenceBundle[]
  const byState: Record<string, number> = {}
  for (const b of evidenceBundles) {
    byState[b.field_confidence] = (byState[b.field_confidence] ?? 0) + 1
  }
  const evidenceSummary: EvidenceSummary = {
    total: evidenceBundles.length,
    by_state: {
      explicitly_confirmed: byState.explicitly_confirmed ?? 0,
      inferred_high:        byState.inferred_high ?? 0,
      inferred_medium:      byState.inferred_medium ?? 0,
      inferred_low:         byState.inferred_low ?? 0,
      rejected:             byState.rejected ?? 0,
      deprecated:           byState.deprecated ?? 0,
    },
  }

  // Source-records aggregations.
  // The view isn't in gen-types output so the runtime shape is asserted
  // against SourceRecordSummary directly. Two-step cast (unknown → SRS[])
  // because the inferred type from the `as never` from-clause is unrelated.
  const sourceRows = (sources.data ?? []) as unknown as SourceRecordSummary[]
  const bySourceType: Record<string, number> = {}
  for (const s of sourceRows) bySourceType[s.source_type] = (bySourceType[s.source_type] ?? 0) + 1

  const brandRow = brand.data as unknown as BrandProfile & { onboarding_status?: string | null }

  return {
    brand: brandRow,
    audience: (audience.data as AudienceProfile | null) ?? null,
    visual_style: (visual.data as VisualStyleProfile | null) ?? null,
    channels: (channels.data ?? []) as ChannelProfile[],
    evidence: { summary: evidenceSummary, bundles: evidenceBundles },
    negative_patterns: (negatives.data ?? []) as NegativePattern[],
    global_negative_patterns: (globalNegatives.data ?? []) as unknown as GlobalNegativePattern[],
    override_rules: (overrides.data ?? []) as OverrideRule[],
    sources: {
      count: sourceRows.length,
      by_type: bySourceType,
      recent: sourceRows.slice(0, 5),
    },
    current_confidence: (confidence.data as ConfidenceClassification | null) ?? null,
    latest_snapshot: (snapshot.data as BrandSnapshot | null) ?? null,
    method_profile: (methodProfile.data as MethodProfileSummary | null) ?? null,
    assets: (() => {
      const all = (assetRows.data ?? []) as unknown as AssetLibraryItem[]
      return {
        approved:       all.filter((a) => a.is_approved === true),
        rejected:       all.filter((a) => a.is_approved === false),
        lora_candidates: all.filter((a) => a.lora_training_candidate),
      }
    })(),
    competitors: {
      accounts:         (competitorAccountRows.data ?? []) as unknown as CompetitorAccount[],
      latest_snapshots: (competitorSnapshotRows.data ?? []) as unknown as CompetitorSnapshot[],
    },
    content_patterns: (() => {
      const all = (contentPatternRows.data ?? []) as unknown as BrandContentPattern[]
      return {
        winners: all.filter((p) => p.pattern_type === 'winner'),
        losers:  all.filter((p) => p.pattern_type === 'loser'),
      }
    })(),
    stats: {
      total_calendars_generated: brandRow.total_calendars_generated ?? 0,
      onboarding_status: brandRow.onboarding_status ?? null,
      is_calibration_period: brandRow.is_calibration_period ?? true,
      calibration_ends_at: brandRow.calibration_ends_at ?? null,
    },
  }
}

export interface BrandDnaEvent {
  event_id: string
  event_type: string
  event_data: Record<string, unknown>
  created_at: string
}

/** Last N events from branddna_event_log for the profile history section. */
export async function getRecentBrandEvents(
  brand_id: string,
  limit = 20,
  client?: Db,
): Promise<BrandDnaEvent[]> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return []
  const { data } = await supabase
    .from('branddna_event_log')
    .select('event_id, event_type, event_data, created_at')
    .eq('brand_id', brand_id)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as BrandDnaEvent[]
}

/** Fetch all global negative patterns (admin: all rows; public: active only). */
export async function getAllGlobalNegativePatterns(
  client?: Db,
  activeOnly = true,
): Promise<GlobalNegativePattern[]> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return []
  let q = (supabase.from('global_negative_patterns' as never) as unknown as {
    select: (cols: string) => unknown
  }).select('*') as ReturnType<typeof supabase.from>
  if (activeOnly) q = q.eq('is_active' as never, true)
  const { data } = await q.order('category' as never).order('severity' as never)
  return (data ?? []) as unknown as GlobalNegativePattern[]
}

/** Convenience: fetch by slug (resolves slug → brand_id then calls getBrandDna). */
export async function getBrandDnaBySlug(slug: string, client?: Db): Promise<BrandDnaView | null> {
  const supabase = client ?? (isDbConfigured() ? adminClient() : null)
  if (!supabase) return null
  const { data, error } = await supabase
    .from('brand_profiles')
    .select('brand_id')
    .eq('client_slug', slug)
    .maybeSingle()
  if (error || !data) return null
  return getBrandDna((data as { brand_id: string }).brand_id, supabase)
}
