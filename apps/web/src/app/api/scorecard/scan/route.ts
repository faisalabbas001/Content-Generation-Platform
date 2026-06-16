// POST /api/scorecard/scan
// Ingests an Instagram handle, runs 5 scorers in parallel, persists to scoring schema.
// P95 target: < 90 seconds (maxDuration = 120 for safety).
// Rate limit: 3 free scans per IP per calendar month (spec §14.1).

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { normaliseHandle, ingestProfile } from '@/lib/scoring/ingestion'
import { runScoring } from '@/lib/scoring/aggregate'
import { findExistingScan, loadBenchmarks, persistScoreCard, populateCompetitors, checkRateLimit } from '@/lib/scoring/db'
import type { ScoringInput } from '@/lib/scoring/types'
import { DIMENSION_WEIGHTS } from '@/lib/scoring/types'

export const runtime   = 'nodejs'
export const dynamic   = 'force-dynamic'
export const maxDuration = 120

const RequestSchema = z.object({
  handle:    z.string().min(1).max(60),
  sector:    z.enum(['fnb', 'beauty', 'retail', 'other']).default('fnb'),
  force:     z.boolean().default(false),   // bypass 7-day cache
  scan_tier: z.enum(['free', 'paid', 'subscription']).default('free'),
})

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'validation_failed', issues: parsed.error.issues }, { status: 422 })
  }

  const { handle: rawHandle, sector, force, scan_tier } = parsed.data
  const handle = normaliseHandle(rawHandle)

  // ── Rate limiting — 3 free scans per IP per calendar month (spec §14.1) ────
  if (scan_tier === 'free') {
    const headersList = await headers()
    const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? headersList.get('x-real-ip')
      ?? '0.0.0.0'
    const allowed = await checkRateLimit(ip, 3)
    if (!allowed) {
      return NextResponse.json(
        { ok: false, error: 'rate_limited', message: 'Free plan allows 3 scans per month per IP. Please try again next month.' },
        { status: 429 },
      )
    }
  }

  // ── Cache check — skip if fresh scan exists and force=false ────────────────
  if (!force) {
    const existing = await findExistingScan(handle)
    if (existing) {
      return NextResponse.json({
        ok:         true,
        cached:     true,
        share_slug: existing.share_slug,
        score:      existing.overall_score,
        tier:       existing.tier,
        scanned_at: existing.scanned_at,
      })
    }
  }

  // ── Ingest ────────────────────────────────────────────────────────────────
  const ingested = await ingestProfile(handle)
  if (!ingested.ok) {
    console.error(`[scorecard/scan] ingest failed handle=${handle} error=${ingested.error} msg=${ingested.message}`)
    const statusMap: Record<string, number> = {
      private_account:       422,
      account_not_found:     404,
      rate_limited:          429,
      insufficient_posts:    422,
      scrape_failed:         502,
      apify_not_configured:  503,
    }
    return NextResponse.json(
      { ok: false, error: ingested.error, message: ingested.message },
      { status: statusMap[ingested.error] ?? 500 },
    )
  }

  const { profile, status: scanStatus } = ingested

  // ── Load benchmarks ───────────────────────────────────────────────────────
  const rawBenchmarks = await loadBenchmarks(sector)

  // Ensure all 5 dimension keys exist with defaults
  const benchmarks: ScoringInput['benchmarks'] = {
    visual_quality:      rawBenchmarks['visual_quality']      ?? {},
    cultural_fit:        rawBenchmarks['cultural_fit']        ?? {},
    posting_consistency: rawBenchmarks['posting_consistency'] ?? {},
    brand_coherence:     rawBenchmarks['brand_coherence']     ?? {},
    engagement_health:   rawBenchmarks['engagement_health']   ?? {},
  }

  const scoringInput: ScoringInput = { handle, profile, sector, benchmarks }

  // ── Run all 5 scorers ─────────────────────────────────────────────────────
  const scoring = await runScoring(scoringInput)

  // ── Persist ───────────────────────────────────────────────────────────────
  const expiryDays = scan_tier === 'subscription' ? 30 : scan_tier === 'paid' ? 30 : 7
  const card = await persistScoreCard({
    handle,
    brandNameEn:      profile.name ?? null,
    brandNameAr:      null,
    sector,
    city:             null,
    followersCount:   profile.followers_count,
    postsAnalyzed:    profile.posts.length,
    scoring,
    culturalDeepdive: scoring.cultural_deepdive ?? null,
    scanStatus,
    scanTier:         scan_tier,
    expiryDays,
  })

  // Populate competitor scores asynchronously (non-blocking — don't delay the response)
  populateCompetitors(card.id, handle, sector, null).catch(() => {})

  return NextResponse.json({
    ok:             true,
    cached:         false,
    share_slug:     card.share_slug,
    score:          scoring.overall_score,
    tier:           scoring.tier,
    posts_analyzed: profile.posts.length,
    scan_status:    scanStatus,
    scanned_at:     card.scanned_at,
    dimensions:     scoring.dimensions.map(d => ({
      key:   d.dimension,
      score: d.score,
      weight: DIMENSION_WEIGHTS[d.dimension],
    })),
  })
}
