/**
 * Appliers for the two ANONYMOUS-signal nomination types (Layer 2 + Layer 3).
 *
 * Per Doc §4.4 these tables have ZERO foreign keys to brand_profiles. We rely
 * on validateAnonymousSignal() in validate.ts to guarantee no PII is in the
 * payload before this module ever sees it.
 *
 * Update strategy (Doc §4.5 "How BrandDNA Learns"):
 *   sector_signal:
 *     UPDATE sector_baselines
 *       SET top_performing_tones[…]
 *       WHERE sector + dialect match
 *     If the (sector, dialect) row doesn't exist yet → insert with sample 1.
 *
 *   global_signal:
 *     UPSERT content_performance_patterns
 *       grouped by (sector, dialect, occasion, content_type, objective)
 *     The metric we accumulate: approval_rate, revision_rate, hard_block_rate
 *     using a rolling-average formula that includes sample_size.
 */
import type { Db } from '@repo/db/client'
import type { SectorSignalData, GlobalSignalData } from './types'

interface ApplyOk {
  ok: true
  applied_to: string
}
interface ApplyFail {
  ok: false
  reason: string
}
type ApplyResult = ApplyOk | ApplyFail

// ─────────────────────────────────────────────────────────────────────────
// 5. sector_signal — Layer 2 (sector_baselines)
// ─────────────────────────────────────────────────────────────────────────
export async function applySectorSignal(db: Db, data: SectorSignalData): Promise<ApplyResult> {
  // Find the row keyed by (sector, dialect). The 0003_seed_baselines.sql seed
  // pre-loads three rows; everything else creates on demand.
  const { data: existing, error: e1 } = await db
    .from('sector_baselines')
    .select('baseline_id, sample_size, top_performing_tones, worst_performing_tones, occasion_insights')
    .eq('sector', data.sector)
    .eq('dialect', data.dialect)
    .limit(1)
  if (e1) return { ok: false, reason: `read sector_baselines failed: ${e1.message}` }

  const newSample = ((existing?.[0]?.sample_size as number | undefined) ?? 0) + 1

  // Pull tones into either top_performing_tones or worst_performing_tones
  // based on the outcome. JSONB shape per Doc §4.3:
  //   [{ tone_id: "warm_casual", approval_rate: 0.91, sample: 234 }, ...]
  const top = ((existing?.[0]?.top_performing_tones ?? []) as unknown) as ToneEntry[]
  const worst = ((existing?.[0]?.worst_performing_tones ?? []) as unknown) as ToneEntry[]
  if (data.tone) {
    if (data.outcome === 'approved') updateToneList(top, data.tone, true)
    else if (data.outcome === 'hard_blocked' || data.outcome === 'revised') updateToneList(worst, data.tone, false)
  }

  const occasion_insights = ((existing?.[0]?.occasion_insights ?? {}) as unknown) as Record<string, OccasionInsight>
  if (data.occasion && data.confidence_score !== undefined) {
    const cur = occasion_insights[data.occasion] ?? { avg_score: 0, samples: 0 }
    const nextSamples = cur.samples + 1
    cur.avg_score = (cur.avg_score * cur.samples + data.confidence_score) / nextSamples
    cur.samples = nextSamples
    if (data.content_type) cur.best_type = data.content_type
    occasion_insights[data.occasion] = cur
  }

  if (existing && existing.length > 0) {
    const { error } = await db
      .from('sector_baselines')
      .update({
        sample_size: newSample,
        top_performing_tones: top,
        worst_performing_tones: worst,
        occasion_insights,
        last_updated: new Date().toISOString(),
      } as never)
      .eq('baseline_id', existing[0]!.baseline_id as string)
    if (error) return { ok: false, reason: `update sector_baselines failed: ${error.message}` }
    return { ok: true, applied_to: `sector_baselines.${data.sector}.${data.dialect}` }
  }

  // First time we see this (sector, dialect) — insert.
  const { error } = await db.from('sector_baselines').insert({
    sector: data.sector,
    dialect: data.dialect,
    sample_size: 1,
    top_performing_tones: top,
    worst_performing_tones: worst,
    occasion_insights,
    last_updated: new Date().toISOString(),
  } as never)
  if (error) return { ok: false, reason: `insert sector_baselines failed: ${error.message}` }
  return { ok: true, applied_to: `sector_baselines.${data.sector}.${data.dialect} (created)` }
}

// ─────────────────────────────────────────────────────────────────────────
// 6. global_signal — Layer 3 (content_performance_patterns)
// ─────────────────────────────────────────────────────────────────────────
export async function applyGlobalSignal(db: Db, data: GlobalSignalData): Promise<ApplyResult> {
  // Group key per Doc §4.4: (sector, dialect, occasion, content_type, objective).
  // Phase 1 doesn't ship objective in the signal — we use 'unknown' until CIO
  // computes it in Phase 2.
  const occasion = data.occasion ?? 'none'
  const content_type = data.content_type ?? 'unknown'
  const objective = 'unknown'

  const { data: existing, error: e1 } = await db
    .from('content_performance_patterns')
    .select('pattern_id, sample_size, approval_rate, revision_rate, hard_block_rate, avg_confidence')
    .eq('sector', data.sector)
    .eq('dialect', data.dialect)
    .eq('occasion', occasion)
    .eq('content_type', content_type)
    .eq('objective', objective)
    .limit(1)
  if (e1) return { ok: false, reason: `read content_performance_patterns failed: ${e1.message}` }

  const prev = (existing?.[0] as PatternRow | undefined) ?? null
  const oldN = prev?.sample_size ?? 0
  const newN = oldN + 1
  const approvedDelta = data.outcome === 'approved' ? 1 : 0
  const revisedDelta = data.outcome === 'revised' ? 1 : 0
  const blockedDelta = data.outcome === 'hard_blocked' ? 1 : 0
  const confDelta = data.confidence_score ?? 0

  const next = {
    approval_rate:    rollingMean(prev?.approval_rate ?? 0,    oldN, approvedDelta, newN),
    revision_rate:    rollingMean(prev?.revision_rate ?? 0,    oldN, revisedDelta,  newN),
    hard_block_rate:  rollingMean(prev?.hard_block_rate ?? 0,  oldN, blockedDelta,  newN),
    avg_confidence:   rollingMean(prev?.avg_confidence ?? 0,   oldN, confDelta,     newN),
    sample_size: newN,
    last_updated: new Date().toISOString(),
  }

  if (prev) {
    const { error } = await db
      .from('content_performance_patterns')
      .update(next as never)
      .eq('pattern_id', prev.pattern_id)
    if (error) return { ok: false, reason: `update content_performance_patterns failed: ${error.message}` }
    return { ok: true, applied_to: `content_performance_patterns[${data.sector}/${data.dialect}/${occasion}/${content_type}]` }
  }

  const { error } = await db.from('content_performance_patterns').insert({
    sector: data.sector,
    dialect: data.dialect,
    occasion,
    content_type,
    objective,
    ...next,
  } as never)
  if (error) return { ok: false, reason: `insert content_performance_patterns failed: ${error.message}` }
  return { ok: true, applied_to: `content_performance_patterns[${data.sector}/${data.dialect}/${occasion}/${content_type}] (created)` }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

interface ToneEntry { tone_id: string; approval_rate: number; sample: number }
interface OccasionInsight { avg_score: number; samples: number; best_type?: string }
interface PatternRow {
  pattern_id: string
  sample_size: number
  approval_rate: number | null
  revision_rate: number | null
  hard_block_rate: number | null
  avg_confidence: number | null
}

function updateToneList(list: ToneEntry[], tone: string, success: boolean): void {
  const existing = list.find((t) => t.tone_id === tone)
  if (existing) {
    const next = existing.sample + 1
    existing.approval_rate = (existing.approval_rate * existing.sample + (success ? 1 : 0)) / next
    existing.sample = next
  } else {
    list.push({ tone_id: tone, approval_rate: success ? 1 : 0, sample: 1 })
  }
}

/** Rolling mean: prev mean over `oldN` samples + new value `delta` → mean over `newN`. */
function rollingMean(prev: number, oldN: number, delta: number, newN: number): number {
  if (newN === 0) return 0
  return (prev * oldN + delta) / newN
}
