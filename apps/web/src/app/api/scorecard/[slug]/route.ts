// GET /api/scorecard/[slug]
// Returns the full scorecard JSON for the share page.

import { NextResponse } from 'next/server'
import { getScoreCardBySlug } from '@/lib/scoring/db'
import { DIMENSION_LABELS } from '@/lib/scoring/types'
import type { ScoreDimension } from '@repo/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  if (!slug) return NextResponse.json({ ok: false, error: 'missing_slug' }, { status: 400 })

  const full = await getScoreCardBySlug(slug)
  if (!full) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })

  const { card, dimensions, findings, actions, competitors } = full

  // ── Build output JSON matching spec §8 ─────────────────────────────────────
  const output = {
    schema_version: '1.0',
    score_card_id:  card.id,
    share_slug:     card.share_slug,
    scanned_at:     card.scanned_at,
    score_status:   card.score_status,

    brand: {
      handle:         card.handle,
      name_en:        card.brand_name_en,
      name_ar:        card.brand_name_ar,
      sector:         card.sector,
      sector_label_en: sectorLabel(card.sector, 'en'),
      sector_label_ar: sectorLabel(card.sector, 'ar'),
      city:           card.location_city,
      neighborhood:   card.location_neighborhood,
      followers_count: card.followers_count,
    },

    overall_score: card.overall_score,
    score_tier:    card.tier,

    competitors: competitors.map(c => ({
      name:             c.competitor_name,
      handle:           c.competitor_handle,
      score:            c.competitor_score,
      tier:             c.tier,
      location_label_en: c.location_label_en,
      location_label_ar: c.location_label_ar,
      distance_meters:  c.distance_meters,
      rank:             c.rank,
      is_focal:         c.is_focal_brand,
    })),

    dimensions: dimensions.map(d => {
      const key = d.dimension as ScoreDimension
      const labels = DIMENSION_LABELS[key]
      const dimFindings = findings.filter(f => f.dimension === key)
      const dimAction   = actions.find(a => a.dimension === key)
      return {
        key,
        name_en:              labels?.en,
        name_ar:              labels?.ar,
        weight:               d.weight,
        weight_description_en: labels?.desc_en,
        weight_description_ar: labels?.desc_ar,
        score:                d.score,
        tier:                 scoreTier(d.score),
        benchmark:            d.benchmark,
        submetrics:           d.submetrics,
        findings:             dimFindings.map(f => ({
          finding_en:      f.finding_en,
          finding_ar:      f.finding_ar,
          evidence_count:  f.evidence_count,
          evidence_total:  f.evidence_total,
          benchmark_count: f.benchmark_count,
          severity:        f.severity,
        })),
        action: dimAction ? {
          workflow_id:      dimAction.workflow_id,
          icon_emoji:       dimAction.icon_emoji,
          label_en:         dimAction.action_label_en,
          label_ar:         dimAction.action_label_ar,
          estimated_lift:   dimAction.estimated_lift,
          timeframe_weeks:  dimAction.timeframe_weeks,
        } : null,
      }
    }),

    cultural_deepdive: (card as unknown as Record<string, unknown>).cultural_deepdive ?? null,

    methodology: {
      posts_analyzed:        card.posts_analyzed,
      vision_pipeline:       'Claude Haiku 4.5 · Vision classifier',
      nlp_pipeline:          'DeepSeek V3 · OGz dialect model',
      benchmark_dataset_size: 1247,
      benchmark_sector:      card.sector,
      weights:               { vq: 0.20, cf: 0.30, pc: 0.15, bc: 0.20, eh: 0.15 },
      last_refresh:          card.scanned_at,
      formula:               'Σ(dim × weight)',
    },
  }

  return NextResponse.json(output)
}

function scoreTier(score: number): 'low' | 'mid' | 'high' {
  return score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low'
}

function sectorLabel(sector: string, lang: 'en' | 'ar'): string {
  const labels: Record<string, { en: string; ar: string }> = {
    fnb:    { en: 'Food & Beverage', ar: 'مطاعم ومقاهي' },
    beauty: { en: 'Beauty & Wellness', ar: 'تجميل وعناية' },
    retail: { en: 'Retail', ar: 'تجزئة' },
    other:  { en: 'Other', ar: 'أخرى' },
  }
  return labels[sector]?.[lang] ?? sector
}
