import { adminClient, isDbConfigured } from '../client'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChainRow {
  chain_id: string
  chain_ulid: string | null
  family: string
  schema_version: number
  name_en: string
  name_ar: string
  purpose: string | null
  fal_model_primary: string
  fal_model_secondary: string | null
  prompt_template: string
  negative_prompt: string | null
  // i2v animation instruction + Saudi cultural localization note (migration 0109)
  video_motion_prompt: string | null
  saudi_adaptation: string | null
  input_schema: Record<string, unknown>
  output_type: 'image' | 'video' | 'carousel' | 'audio' | 'mixed'
  output_width: number | null
  output_height: number | null
  output_duration_s: number | null
  aspect_ratio: string | null
  eligible_sectors: string[] | null
  excluded_sectors: string[] | null
  eligible_occasions: string[] | null
  excluded_occasions: string[] | null
  quality_tiers: ('starter' | 'growth' | 'enterprise')[]
  min_maturity_days: number
  cultural_constraints: Record<string, unknown>
  anti_patterns: string[] | null
  cost_estimate_usd: number | null
  latency_estimate_s: number | null
  best_for_cd_brains: string[] | null
  provenance_source: string | null
  provenance_confirmer: string | null
  provenance_confidence: 'experimental' | 'inferred' | 'confirmed' | null
  provenance_scope: string | null
  requires_ref_img: boolean
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  // Added by migration 0099
  style_affinity: 'traditional' | 'modern' | 'youth' | 'mixed' | null
  platform_tags: string[] | null
  // Selection signals read by the LLM chain selector (ceo/match-chain): brand-intent
  // affinity + a free-text frequency cap (e.g. "3-5 per week"). Editable in admin.
  intent: string[] | null
  frequency: string | null
  // Added by migration 0112 — declares how the prompt_template relates to the brief.
  // 'scene': template is a standalone scene (fallback when no DeepSeek brief).
  // 'style_wrapper': template wraps {base_visual_brief}; brief is always the authority.
  // 'slot_fill': template uses {product_descriptor} etc.; brief wins when present.
  template_mode: 'scene' | 'style_wrapper' | 'slot_fill'
}

export interface ChainBrandOverride {
  id: string
  chain_id: string
  brand_id: string
  prompt_suffix: string | null
  negative_prompt_override: string | null
  fal_model_override: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ChainInsert {
  chain_id: string
  chain_ulid?: string | null
  family: string
  schema_version?: number
  name_en: string
  name_ar: string
  purpose?: string | null
  fal_model_primary: string
  fal_model_secondary?: string | null
  prompt_template: string
  negative_prompt?: string | null
  video_motion_prompt?: string | null
  saudi_adaptation?: string | null
  input_schema?: Record<string, unknown>
  output_type?: ChainRow['output_type']
  output_width?: number | null
  output_height?: number | null
  output_duration_s?: number | null
  aspect_ratio?: string | null
  eligible_sectors?: string[] | null
  excluded_sectors?: string[] | null
  eligible_occasions?: string[] | null
  excluded_occasions?: string[] | null
  quality_tiers?: ('starter' | 'growth' | 'enterprise')[]
  min_maturity_days?: number
  cultural_constraints?: Record<string, unknown>
  anti_patterns?: string[] | null
  cost_estimate_usd?: number | null
  latency_estimate_s?: number | null
  best_for_cd_brains?: string[] | null
  provenance_source?: string | null
  provenance_confirmer?: string | null
  provenance_confidence?: ChainRow['provenance_confidence']
  provenance_scope?: string | null
  is_active?: boolean
  notes?: string | null
  style_affinity?: ChainRow['style_affinity']
  platform_tags?: string[] | null
  intent?: string[] | null
  frequency?: string | null
  template_mode?: ChainRow['template_mode']
}

export type ChainUpdate = Partial<Omit<ChainInsert, 'chain_id'>>

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function listChains(
  filters: {
    family?: string
    output_type?: string
    is_active?: boolean
    search?: string
  } = {},
  opts: { limit?: number; offset?: number } = {},
): Promise<{ rows: ChainRow[]; total: number }> {
  if (!isDbConfigured()) return { rows: [], total: 0 }
  const db = adminClient()
  const limit = opts.limit ?? 100
  const offset = opts.offset ?? 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (db as any).from('chains').select('*', { count: 'exact' })
  if (filters.family)      q = q.eq('family', filters.family)
  if (filters.output_type) q = q.eq('output_type', filters.output_type)
  if (typeof filters.is_active === 'boolean') q = q.eq('is_active', filters.is_active)
  if (filters.search) {
    const s = `%${filters.search}%`
    q = q.or(`name_en.ilike.${s},name_ar.ilike.${s},chain_id.ilike.${s},purpose.ilike.${s}`)
  }

  const { data, count, error } = await q
    .order('family', { ascending: true })
    .order('chain_id', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) throw error
  return { rows: (data ?? []) as ChainRow[], total: count ?? 0 }
}

export async function getChain(chainId: string): Promise<ChainRow | null> {
  if (!isDbConfigured()) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any)
    .from('chains')
    .select('*')
    .eq('chain_id', chainId)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as ChainRow | null
}

/**
 * Auto-select the best active chain for a given generation context.
 * Returns null when no eligible chain matches — caller falls back to
 * standard model routing.
 */
export async function resolveChain(ctx: {
  chain_id?: string | null
  sector: string
  occasion?: string | null
  quality_tier: string
  maturity_days: number
  output_type?: string
}): Promise<ChainRow | null> {
  if (!isDbConfigured()) return null
  const db = adminClient()

  // If an explicit chain_id is supplied, look it up directly
  if (ctx.chain_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (db as any)
      .from('chains')
      .select('*')
      .eq('chain_id', ctx.chain_id)
      .eq('is_active', true)
      .maybeSingle()
    return (data ?? null) as ChainRow | null
  }

  // Otherwise auto-select: fetch all active chains and filter in-process
  // (Supabase doesn't support array-containment + null-check in one query cleanly)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (db as any)
    .from('chains')
    .select('*')
    .eq('is_active', true)
    .lte('min_maturity_days', ctx.maturity_days)
    .contains('quality_tiers', [ctx.quality_tier])

  if (ctx.output_type) q = q.eq('output_type', ctx.output_type)

  const { data } = await q.order('cost_estimate_usd', { ascending: true })
  if (!data) return null

  const candidates = (data as ChainRow[]).filter((c) => {
    // Sector eligibility
    if (c.eligible_sectors && !c.eligible_sectors.includes(ctx.sector)) return false
    if (c.excluded_sectors && c.excluded_sectors.includes(ctx.sector)) return false
    // Occasion eligibility
    if (ctx.occasion) {
      if (c.eligible_occasions && !c.eligible_occasions.includes(ctx.occasion)) return false
      if (c.excluded_occasions && c.excluded_occasions.includes(ctx.occasion)) return false
    }
    return true
  })

  return candidates[0] ?? null
}

// ─── Deterministic per-slot chain selection (Doc §9.5 — no LLM) ──────────────
//
// keep this occasion normalizer in sync with normalizeOccasion() in
// @repo/core/schemas/calendar-plan.ts. Duplicated here because @repo/db does not
// depend on @repo/core.
function normalizeOccasionToken(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (!s || s === 'none') return null
  if (s.includes('ramadan')) return 'ramadan'
  if (s.includes('eid')) return 'eid'
  if (s.includes('national_day')) return 'national_day'
  if (s.includes('founding_day')) return 'founding_day'
  return null
}

// Doc §9.5 score constants
// OCCASION_BOOST is intentionally LARGER than the max approval-score gap so a chain
// explicitly tagged for the active occasion (per chain.md: V01=Ramadan, V04=Occasion
// Announcement) reliably WINS during its occasion — even against an evergreen chain
// with a perfect track record. Worst-case gap = rival full approval (brand 40 +
// platform 30 = 70) vs an occasion chain on neutral defaults (20 + 15 = 35) → 35.
// +45 clears that margin so "the occasion video IS the occasion video" (chain.md
// intent), while still letting a genuinely dominant chain stay competitive on the
// rare both-maxed case. (Was +20, which let a 100%-approval generic chain edge out
// the occasion chain — technically valid §9.5 math but against the doc's naming.)
const OCCASION_BOOST = 45   // chains tagged for the active occasion get +45

// Style-register match (0-30 pts, §9.5 component 1).
// Exact match → 30. Chain is register-agnostic (null affinity) → 15 (neutral).
// Mismatch → 0.
function styleMatchScore(
  chainStyleAffinity: string | null | undefined,
  brandStyleRegister: string | null | undefined,
): number {
  if (!chainStyleAffinity) return 15   // agnostic chain — neutral
  if (!brandStyleRegister) return 15   // brand style unknown — neutral
  return chainStyleAffinity === brandStyleRegister ? 30 : 0
}

// Brand historical approval score (0-40 pts, §9.5 component 2).
// Sourced from brand_chain_approval_rate view. No history → 20 (neutral mid).
function brandApprovalScore(ratePct: number | null | undefined): number {
  if (ratePct == null) return 20
  return Math.min(40, Math.round((ratePct / 100) * 40))
}

// Platform-wide approval score (0-30 pts, §9.5 component 3).
// Sourced from chain_platform_approval_rate view. No data → 15 (neutral).
function platformApprovalScore(ratePct: number | null | undefined): number {
  if (ratePct == null) return 15
  return Math.min(30, Math.round((ratePct / 100) * 30))
}

// Intent-state affinity boost (0-15 pts) — GROWTH DNA, Chain Library "INTENT STATES".
// The chains table has no explicit intent column, so we derive affinity from the
// chain family + name keywords. Each brand intent_state favours the content shapes
// that grow it: a 'grow' brand favours hero/lifestyle/social-proof; a 'launch' brand
// favours new-arrival/reveal; 'defend'/'harvest' favour offer/promo/price. This only
// re-ranks (max +15) — it never eliminates a chain.
const INTENT_KEYWORDS: Record<string, RegExp> = {
  launch:  /(launch|new[ _-]?arrival|reveal|unbox|teaser|announc)/i,
  grow:    /(hero|lifestyle|social[ _-]?proof|testimonial|behind|story|ugc|context)/i,
  defend:  /(offer|promo|price|deal|bundle|comparison|before[ _-]?after|cta|booking)/i,
  harvest: /(offer|promo|price|deal|bundle|hero|product)/i,
  recover: /(social[ _-]?proof|testimonial|behind|authentic|ugc|story)/i,
}
function intentBoost(
  chain: { family?: string | null; name_en?: string | null; purpose?: string | null },
  intent_state: string | null | undefined,
): number {
  if (!intent_state) return 0
  const re = INTENT_KEYWORDS[intent_state.trim().toLowerCase()]
  if (!re) return 0
  const hay = `${chain.family ?? ''} ${chain.name_en ?? ''} ${chain.purpose ?? ''}`
  return re.test(hay) ? 15 : 0
}

export interface ScoredChain {
  chain: ChainRow
  score: number
  score_breakdown: {
    occasion_boost:    number
    style_match:       number
    brand_approval:    number
    platform_approval: number
    intent_boost:      number
  }
}

/**
 * Deterministically pick the top-N active chains for ONE calendar slot.
 * Pure math — NO LLM (Doc §9.5).
 *
 * FILTER  sector + platform + output_type + quality_tier + maturity +
 *         occasion exclusions + cultural safety gate  => 8-15 eligible
 * BOOST   active occasion tagged chains: +20
 * SCORE   style register match (0-30) + brand approval (0-40) + platform (0-30)
 * SELECT  top N returned (default 3)
 *
 * Returns [] when nothing eligible matches.
 */
export async function selectChainsForSlot(ctx: {
  sector: string
  occasionFamily: string | null
  quality_tier: string
  maturity_days: number
  is_starter: boolean
  is_conservative?: boolean
  output_type?: 'image' | 'video'
  style_register?: string | null
  primary_channel?: string | null
  brand_id?: string | null
  topN?: number
  // Brand growth DNA — SOFT signals (boost ranking, never hard-filter).
  intent_state?: string | null
  price_position?: string | null
  archetype?: string | null
}): Promise<ScoredChain[]> {
  if (!isDbConfigured()) return []
  const db = adminClient()
  const topN = ctx.topN ?? 3

  // Push cheap filters to Supabase; sector/occasion/cultural run in-process
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (db as any)
    .from('chains')
    .select('*')
    .eq('is_active', true)
    .lte('min_maturity_days', ctx.maturity_days)
    .contains('quality_tiers', [ctx.quality_tier])
  if (ctx.output_type) q = q.eq('output_type', ctx.output_type)

  const { data: rawChains } = await q
  if (!rawChains || (rawChains as ChainRow[]).length === 0) return []

  // platform_tags uses lowercase tokens; brand primary_channel is title-case
  const channelToken = ctx.primary_channel?.toLowerCase().replace(/\s+/g, '') ?? null

  const eligible = (rawChains as ChainRow[]).filter((c) => {
    // Sector hard filter
    if (c.eligible_sectors && !c.eligible_sectors.includes(ctx.sector)) return false
    if (c.excluded_sectors  &&  c.excluded_sectors.includes(ctx.sector)) return false

    // Platform match (null platform_tags = all platforms)
    if (c.platform_tags && c.platform_tags.length > 0 && channelToken) {
      if (!c.platform_tags.includes(channelToken)) return false
    }

    // Occasion exclusion
    if (c.excluded_occasions && ctx.occasionFamily) {
      if (c.excluded_occasions.some((o) => normalizeOccasionToken(o) === ctx.occasionFamily)) return false
    }

    // Cultural safety gate: starter AND conservative brands skip flagged chains.
    //
    // IMPORTANT (video fix, June 2026): only TRUE hard-sensitivity flags eliminate a
    // chain here. requires_wardrobe_check / requires_gesture_check are "verify-later"
    // markers — under the generate-then-flag policy the post is still produced and
    // force-routed to /admin/qa for human review, so eliminating the chain outright
    // was wrong. Doing so left free/Starter brands with ZERO eligible video chains
    // (V05 — the only starter-tier video — carries requires_wardrobe_check), so the
    // video/image division silently produced no videos at all. We now keep those
    // chains and let the human-override gate handle the wardrobe/gesture review.
    if (ctx.is_starter || ctx.is_conservative) {
      const cc = (c.cultural_constraints ?? {}) as Record<string, unknown>
      if (cc.high_gender_sensitivity || cc.high_religious_sensitivity) return false
      // Static images additionally respect the verify-later flags (cheap to skip,
      // many alternatives exist); video keeps them (few chains, review handles it).
      if (c.output_type !== 'video' && (cc.requires_wardrobe_check || cc.requires_gesture_check)) return false
    }

    // Video guard
    if (c.output_type === 'video' && (!c.fal_model_secondary || !c.prompt_template)) return false

    return true
  })

  if (eligible.length === 0) return []

  // Fetch approval data for eligible chains (two parallel view queries)
  const eligibleIds = eligible.map((c) => c.chain_id)

  const [brandApprovalRes, platformApprovalRes] = await Promise.all([
    ctx.brand_id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (db as any)
          .from('brand_chain_approval_rate')
          .select('chain_id, approval_rate_pct')
          .eq('brand_id', ctx.brand_id)
          .in('chain_id', eligibleIds)
      : Promise.resolve({ data: [] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any)
      .from('chain_platform_approval_rate')
      .select('chain_id, approval_rate_pct')
      .in('chain_id', eligibleIds),
  ])

  type ApprovalRow = { chain_id: string; approval_rate_pct: number | null }
  const brandMap = new Map<string, ApprovalRow>(
    ((brandApprovalRes.data ?? []) as ApprovalRow[]).map((r) => [r.chain_id, r]),
  )
  const platformMap = new Map<string, ApprovalRow>(
    ((platformApprovalRes.data ?? []) as ApprovalRow[]).map((r) => [r.chain_id, r]),
  )

  const scored: ScoredChain[] = eligible.map((c) => {
    const explicitOccasion =
      ctx.occasionFamily != null &&
      Array.isArray(c.eligible_occasions) &&
      c.eligible_occasions.length > 0 &&
      c.eligible_occasions.some((o) => normalizeOccasionToken(o) === ctx.occasionFamily)

    const occasion_boost    = explicitOccasion ? OCCASION_BOOST : 0
    const style_match       = styleMatchScore(c.style_affinity, ctx.style_register)
    const brand_approval    = brandApprovalScore(brandMap.get(c.chain_id)?.approval_rate_pct)
    const platform_approval = platformApprovalScore(platformMap.get(c.chain_id)?.approval_rate_pct)
    const intent_boost      = intentBoost(c, ctx.intent_state)
    const score             = occasion_boost + style_match + brand_approval + platform_approval + intent_boost

    return { chain: c, score, score_breakdown: { occasion_boost, style_match, brand_approval, platform_approval, intent_boost } }
  })

  // Sort: highest score first; tie → lower cost; tie → chain_id lexicographic
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ca = a.chain.cost_estimate_usd ?? Number.POSITIVE_INFINITY
    const cb = b.chain.cost_estimate_usd ?? Number.POSITIVE_INFINITY
    if (ca !== cb) return ca - cb
    return a.chain.chain_id < b.chain.chain_id ? -1 : a.chain.chain_id > b.chain.chain_id ? 1 : 0
  })

  return scored.slice(0, topN)
}

/**
 * Backward-compatible single-chain wrapper. Returns the top-scoring chain or
 * null when nothing eligible matches.
 */
export async function selectChainForSlot(ctx: {
  sector: string
  occasionFamily: string | null
  quality_tier: string
  maturity_days: number
  is_starter: boolean
  is_conservative?: boolean
  output_type?: 'image' | 'video'
  style_register?: string | null
  primary_channel?: string | null
  brand_id?: string | null
}): Promise<ChainRow | null> {
  const results = await selectChainsForSlot({ ...ctx, topN: 1 })
  return results[0]?.chain ?? null
}

export async function getBrandOverride(
  chainId: string,
  brandId: string,
): Promise<ChainBrandOverride | null> {
  if (!isDbConfigured()) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any)
    .from('chain_brand_overrides')
    .select('*')
    .eq('chain_id', chainId)
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as ChainBrandOverride | null
}

export async function listBrandOverrides(chainId: string): Promise<ChainBrandOverride[]> {
  if (!isDbConfigured()) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any)
    .from('chain_brand_overrides')
    .select('*')
    .eq('chain_id', chainId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ChainBrandOverride[]
}

export async function upsertChain(row: ChainInsert): Promise<ChainRow> {
  if (!isDbConfigured()) throw new Error('DB not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any)
    .from('chains')
    .upsert(row, { onConflict: 'chain_id' })
    .select()
    .single()
  if (error) throw error
  return data as ChainRow
}

export async function updateChain(chainId: string, patch: ChainUpdate): Promise<ChainRow> {
  if (!isDbConfigured()) throw new Error('DB not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any)
    .from('chains')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('chain_id', chainId)
    .select()
    .single()
  if (error) throw error
  return data as ChainRow
}

export async function deleteChain(chainId: string): Promise<void> {
  if (!isDbConfigured()) throw new Error('DB not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (adminClient() as any)
    .from('chains')
    .delete()
    .eq('chain_id', chainId)
  if (error) throw error
}

export async function upsertBrandOverride(
  row: Omit<ChainBrandOverride, 'id' | 'created_at' | 'updated_at'>,
): Promise<ChainBrandOverride> {
  if (!isDbConfigured()) throw new Error('DB not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any)
    .from('chain_brand_overrides')
    .upsert(row, { onConflict: 'chain_id,brand_id' })
    .select()
    .single()
  if (error) throw error
  return data as ChainBrandOverride
}

export async function deleteBrandOverride(id: string): Promise<void> {
  if (!isDbConfigured()) throw new Error('DB not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (adminClient() as any)
    .from('chain_brand_overrides')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function getChainFamilies(): Promise<string[]> {
  if (!isDbConfigured()) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient() as any)
    .from('chains')
    .select('family')
    .order('family')
  if (!data) return []
  return [...new Set((data as { family: string }[]).map((r) => r.family))]
}

/**
 * Render a chain's prompt_template by substituting {variable} placeholders
 * with values from the context map. Unknown variables are left as-is.
 *
 * Seeds in 0071 use single-brace syntax: {product_descriptor}
 */
export function renderPromptTemplate(
  template: string,
  context: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const val = context[key]
    return val != null && val !== '' ? val : match
  })
}
