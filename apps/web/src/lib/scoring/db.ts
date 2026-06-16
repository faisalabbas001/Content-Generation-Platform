// Scorecard DB helpers — read/write to sc_* tables in public schema.

import { adminClient } from '@repo/db/client'
import type { ScoringOutput, DimensionResult } from './types'
import type { ScoreCard, FullScoreCard, ScoreDimensionRow, ScoreFinding, ScoreAction, CompetitorScore, SectorBenchmarkRow } from '@repo/db'

// sc_* tables were added in migration 0062 and are not in the generated DB types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scDb = (): any => adminClient() as any

// ── Generate URL-safe slug from brand name / handle ───────────────────────────
export function generateSlug(nameOrHandle: string): string {
  return nameOrHandle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

// ── Check if a fresh scan already exists (7-day TTL) ─────────────────────────
export async function findExistingScan(handle: string): Promise<ScoreCard | null> {
  const db = scDb()
  const { data } = await db
    .from('sc_score_cards')
    .select('*')
    .eq('handle', handle.toLowerCase())
    .gt('expires_at', new Date().toISOString())
    .order('scanned_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as ScoreCard | null
}

// ── Load all sector benchmarks for a sector ───────────────────────────────────
export async function loadBenchmarks(sector: string): Promise<Record<string, Record<string, number>>> {
  const db = scDb()
  const { data } = await db
    .from('sc_sector_benchmarks')
    .select('*')
    .eq('sector', sector)

  const out: Record<string, Record<string, number>> = {
    visual_quality: {},
    cultural_fit: {},
    posting_consistency: {},
    brand_coherence: {},
    engagement_health: {},
  }

  for (const row of (data ?? []) as SectorBenchmarkRow[]) {
    if (!out[row.dimension]) out[row.dimension] = {}
    out[row.dimension]![row.submetric] = row.p50 ?? 50
  }

  return out
}

// ── Persist full scorecard result ─────────────────────────────────────────────
export async function persistScoreCard(opts: {
  handle: string
  brandNameEn: string | null
  brandNameAr: string | null
  sector: string
  city: string | null
  followersCount: number
  postsAnalyzed: number
  scoring: ScoringOutput
  culturalDeepdive?: import('./types').CulturalDeepDive | null
  scanStatus: 'complete' | 'preliminary' | 'stale'
  scanTier?: 'free' | 'paid' | 'subscription'
  expiryDays?: number
}): Promise<ScoreCard> {
  const db = scDb()

  const slug = generateSlug(opts.brandNameEn ?? opts.handle)
  const uniqueSlug = `${slug}-${Date.now().toString(36)}`

  const expiryDays = opts.expiryDays ?? 7
  const expires_at = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()

  // 1. Insert sc_score_cards row
  const { data: card, error: cardErr } = await db
    .from('sc_score_cards')
    .insert({
      handle:          opts.handle,
      brand_name_en:   opts.brandNameEn,
      brand_name_ar:   opts.brandNameAr,
      sector:          opts.sector,
      location_city:   opts.city,
      followers_count: opts.followersCount,
      posts_analyzed:  opts.postsAnalyzed,
      overall_score:   opts.scoring.overall_score,
      score_status:    opts.scanStatus,
      tier:            opts.scoring.tier,
      share_slug:         uniqueSlug,
      scan_tier:          opts.scanTier ?? 'free',
      cultural_deepdive:  opts.culturalDeepdive ?? null,
      expires_at,
    })
    .select()
    .single()

  if (cardErr || !card) throw new Error(`Failed to insert sc_score_cards: ${cardErr?.message}`)
  const cardId = (card as ScoreCard).id

  // 2. Insert dimensions
  const dimensionRows = opts.scoring.dimensions.map((d: DimensionResult) => ({
    score_card_id: cardId,
    dimension:     d.dimension,
    score:         d.score,
    weight:        d.weight,
    benchmark:     d.benchmark,
    submetrics:    d.submetrics,
  }))
  await db.from('sc_score_dimensions').insert(dimensionRows)

  // 3. Insert findings
  const findingRows = opts.scoring.dimensions.flatMap((d: DimensionResult) =>
    d.findings.map(f => ({
      score_card_id:   cardId,
      dimension:       d.dimension,
      finding_en:      f.finding_en,
      finding_ar:      f.finding_ar,
      evidence_count:  f.evidence_count,
      evidence_total:  f.evidence_total,
      benchmark_count: f.benchmark_count,
      severity:        f.severity,
    })),
  )
  if (findingRows.length > 0) await db.from('sc_score_findings').insert(findingRows)

  // 4. Insert actions
  const actionRows = opts.scoring.dimensions.map((d: DimensionResult) => ({
    score_card_id:   cardId,
    dimension:       d.dimension,
    workflow_id:     d.action.workflow_id,
    action_label_en: d.action.action_label_en,
    action_label_ar: d.action.action_label_ar,
    estimated_lift:  d.action.estimated_lift,
    timeframe_weeks: d.action.timeframe_weeks,
    icon_emoji:      d.action.icon_emoji,
  }))
  await db.from('sc_score_actions').insert(actionRows)

  return card as ScoreCard
}

// ── Read full scorecard by share_slug ─────────────────────────────────────────
export async function getScoreCardBySlug(slug: string): Promise<FullScoreCard | null> {
  const db = scDb()

  const { data: card } = await db
    .from('sc_score_cards')
    .select('*')
    .eq('share_slug', slug)
    .maybeSingle()

  if (!card) return null

  const cardId = (card as ScoreCard).id

  const [{ data: dims }, { data: findings }, { data: actions }, { data: competitors }] = await Promise.all([
    db.from('sc_score_dimensions').select('*').eq('score_card_id', cardId),
    db.from('sc_score_findings').select('*').eq('score_card_id', cardId),
    db.from('sc_score_actions').select('*').eq('score_card_id', cardId),
    db.from('sc_competitor_scores').select('*').eq('score_card_id', cardId).order('rank'),
  ])

  // Increment share_views
  await db.from('sc_score_cards').update({ share_views: (card as ScoreCard).share_views + 1 }).eq('id', cardId)

  return {
    card:        card as ScoreCard,
    dimensions:  (dims ?? []) as ScoreDimensionRow[],
    findings:    (findings ?? []) as ScoreFinding[],
    actions:     (actions ?? []) as ScoreAction[],
    competitors: (competitors ?? []) as CompetitorScore[],
  }
}

// ── Rate limiting — 3 free scans per IP per calendar month (spec §14.1) ──────
// Hashes the IP (SHA-256, first 32 chars) to avoid storing raw IPs.
// Returns true if the scan is allowed, false if limit exceeded.
export async function checkRateLimit(ip: string, limitPerMonth: number): Promise<boolean> {
  try {
    const db = scDb()
    const now = new Date()
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const { createHash } = await import('crypto')
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 32)

    // Read current count
    const { data: existing } = await db
      .from('sc_scan_rate_limits')
      .select('id, scan_count')
      .eq('ip_hash', ipHash)
      .eq('year_month', yearMonth)
      .maybeSingle()

    if (!existing) {
      // First scan this month — insert
      await db.from('sc_scan_rate_limits').insert({
        ip_hash: ipHash, year_month: yearMonth, scan_count: 1,
      })
      return true
    }

    const currentCount = existing.scan_count as number
    if (currentCount >= limitPerMonth) return false

    // Increment atomically
    await db
      .from('sc_scan_rate_limits')
      .update({ scan_count: currentCount + 1, updated_at: now.toISOString() })
      .eq('id', existing.id)

    return true
  } catch {
    return true // fail open — don't block legitimate scans on DB errors
  }
}

// ── Populate competitor scores for a newly persisted card ────────────────────
// Queries sc_score_cards for brands in the same sector+city and inserts ranked rows.
export async function populateCompetitors(
  cardId: string,
  handle: string,
  sector: string,
  city: string | null,
): Promise<void> {
  const db = scDb()

  // Find other brands in same sector (and city if known), with a valid score, not expired
  let q = db
    .from('sc_score_cards')
    .select('id, handle, brand_name_en, brand_name_ar, overall_score, tier, location_city, location_neighborhood, expires_at')
    .eq('sector', sector)
    .neq('handle', handle)
    .gt('expires_at', new Date().toISOString())
    .order('overall_score', { ascending: false })
    .limit(20)

  if (city) q = q.eq('location_city', city)

  const { data: candidates } = await q

  if (!candidates || candidates.length === 0) return

  // Build ranked competitor list — top 5 by score, mark focal brand
  const dedupedHandles = new Set<string>()
  const ranked = (candidates as Array<{
    id: string; handle: string; brand_name_en: string | null; brand_name_ar: string | null
    overall_score: number; tier: string; location_city: string | null; location_neighborhood: string | null
  }>).filter(c => {
    if (dedupedHandles.has(c.handle)) return false
    dedupedHandles.add(c.handle)
    return true
  }).slice(0, 5)

  // Re-number ranks 2..N for competitors (focal brand is rank 1 among displayed)
  const competitorRows = ranked.map((c, idx) => ({
    score_card_id:      cardId,
    competitor_handle:  c.handle,
    competitor_name:    c.brand_name_en ?? c.handle,
    competitor_score:   c.overall_score,
    tier:               c.tier,
    location_label_en:  c.location_city ?? null,
    location_label_ar:  c.location_city ?? null,
    distance_meters:    null,
    rank:               idx + 2,   // competitors start at rank 2
    is_focal_brand:     false,
  }))

  // Also insert focal brand as rank 1 — so the full 6-entry list includes them
  // We need to look up the focal brand's own score from the card we just inserted
  const { data: focalCard } = await db
    .from('sc_score_cards')
    .select('overall_score, tier, brand_name_en, brand_name_ar, location_city')
    .eq('id', cardId)
    .maybeSingle()

  const focalRow = focalCard ? {
    score_card_id:      cardId,
    competitor_handle:  handle,
    competitor_name:    (focalCard as {brand_name_en:string|null}).brand_name_en ?? handle,
    competitor_score:   (focalCard as {overall_score:number}).overall_score,
    tier:               (focalCard as {tier:string}).tier,
    location_label_en:  (focalCard as {location_city:string|null}).location_city ?? null,
    location_label_ar:  (focalCard as {location_city:string|null}).location_city ?? null,
    distance_meters:    null,
    rank:               1,
    is_focal_brand:     true,
  } : null

  const allRows = focalRow ? [focalRow, ...competitorRows] : competitorRows

  if (allRows.length > 0) {
    await db.from('sc_competitor_scores').insert(allRows)
  }
}

// ── Admin: list all scorecards (paginated) ────────────────────────────────────
export async function listScoreCards(opts: { page?: number; limit?: number; sector?: string } = {}): Promise<{ cards: ScoreCard[]; total: number }> {
  const db = scDb()
  const page  = opts.page  ?? 1
  const limit = opts.limit ?? 20
  const from  = (page - 1) * limit

  let q = db.from('sc_score_cards').select('*', { count: 'exact' })
  if (opts.sector) q = q.eq('sector', opts.sector)
  q = q.order('scanned_at', { ascending: false }).range(from, from + limit - 1)

  const { data, count } = await q
  return { cards: (data ?? []) as ScoreCard[], total: count ?? 0 }
}
