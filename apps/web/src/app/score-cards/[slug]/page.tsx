import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getScoreCardBySlug } from '@/lib/scoring/db'
import { DIMENSION_LABELS } from '@/lib/scoring/types'
import type { ScoreDimension } from '@repo/db'
import { ScoreCardClient } from './_client'

export const dynamic = 'force-dynamic'

// ── Exported type so _client.tsx can import it ────────────────────────────────
export interface ScoreCardPageData {
  slug: string
  brand: {
    handle: string
    name_en: string | null
    name_ar: string | null
    sector_label_en: string
    sector_label_ar: string
    city: string | null
    neighborhood: string | null
    followers_count: number
  }
  overall_score: number
  score_tier: string
  score_status?: string
  competitors: Array<{
    name: string; handle: string; score: number; tier: string
    location_label_en: string | null; location_label_ar: string | null
    distance_meters: number | null; rank: number; is_focal: boolean
  }>
  dimensions: Array<{
    key: string; name_en: string; name_ar: string
    weight: number; score: number; benchmark: number | null
    submetrics: Record<string, unknown>
    findings: Array<{ finding_en: string; finding_ar: string; severity: string }>
    action: {
      workflow_id: string; icon_emoji: string | null
      label_en: string; label_ar: string
      estimated_lift: number; timeframe_weeks: number
    } | null
  }>
  cultural_deepdive: {
    language_breakdown: Record<string, number>
    occasions: Array<{ key: string; status: 'hit' | 'late' | 'miss' }>
    dialect_multiplier: number | null
    dialect_multiplier_note_en: string
    dialect_multiplier_note_ar: string
  } | null
  methodology: {
    posts_analyzed: number
    last_refresh: string
    vision_pipeline: string
    nlp_pipeline: string
    benchmark_dataset_size: number
  }
}

// ── Metadata ──────────────────────────────────────────────────────────────────
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const full = await getScoreCardBySlug(slug)
  if (!full) return { title: 'Score Card Not Found' }
  const { card } = full
  const name = card.brand_name_en ?? card.handle
  return {
    title: `${name} — Brand Score ${card.overall_score}/100 | OGz AI`,
    description: `@${card.handle} scored ${card.overall_score}/100. Visual quality, cultural fit, posting consistency, brand coherence & engagement health.`,
    openGraph: {
      title: `${name} scores ${card.overall_score}/100`,
      description: `See how ${name} compares to Saudi competitors.`,
    },
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function ScoreCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const full = await getScoreCardBySlug(slug)
  if (!full) notFound()

  const { card, dimensions, findings, actions, competitors } = full

  const sectorLabels: Record<string, { en: string; ar: string }> = {
    fnb:    { en: 'Food & Beverage', ar: 'مطاعم ومقاهي' },
    beauty: { en: 'Beauty & Wellness', ar: 'تجميل وعناية' },
    retail: { en: 'Retail', ar: 'تجزئة' },
    other:  { en: 'Other', ar: 'أخرى' },
  }
  const sl = sectorLabels[card.sector] ?? { en: card.sector, ar: card.sector }

  const data: ScoreCardPageData = {
    slug,
    brand: {
      handle:          card.handle,
      name_en:         card.brand_name_en ?? null,
      name_ar:         card.brand_name_ar ?? null,
      sector_label_en: sl.en,
      sector_label_ar: sl.ar,
      city:            card.location_city ?? null,
      neighborhood:    card.location_neighborhood ?? null,
      followers_count: card.followers_count ?? 0,
    },
    overall_score: card.overall_score,
    score_tier:    card.tier,
    score_status:  card.score_status ?? 'complete',

    competitors: competitors.map(c => ({
      name:             c.competitor_name,
      handle:           c.competitor_handle,
      score:            c.competitor_score,
      tier:             c.tier,
      location_label_en: c.location_label_en ?? null,
      location_label_ar: c.location_label_ar ?? null,
      distance_meters:  c.distance_meters ?? null,
      rank:             c.rank,
      is_focal:         c.is_focal_brand,
    })),

    dimensions: dimensions.map(d => {
      const key    = d.dimension as ScoreDimension
      const labels = DIMENSION_LABELS[key]
      const dimFindings = findings.filter(f => f.dimension === key)
      const dimAction   = actions.find(a => a.dimension === key)
      return {
        key,
        name_en:    labels?.en ?? key,
        name_ar:    labels?.ar ?? key,
        weight:     d.weight,
        score:      d.score,
        benchmark:  d.benchmark ?? null,
        submetrics: (d.submetrics ?? {}) as Record<string, unknown>,
        findings:   dimFindings.map(f => ({ finding_en: f.finding_en, finding_ar: f.finding_ar, severity: f.severity })),
        action:     dimAction ? {
          workflow_id:     dimAction.workflow_id,
          icon_emoji:      dimAction.icon_emoji ?? null,
          label_en:        dimAction.action_label_en,
          label_ar:        dimAction.action_label_ar,
          estimated_lift:  dimAction.estimated_lift,
          timeframe_weeks: dimAction.timeframe_weeks,
        } : null,
      }
    }),

    cultural_deepdive: (() => {
      const raw = (card as unknown as Record<string, unknown>).cultural_deepdive
      if (!raw || typeof raw !== 'object') return null
      const cd = raw as Record<string, unknown>
      return {
        language_breakdown: (cd['language_breakdown'] as Record<string,number>) ?? {},
        occasions:          (cd['occasions'] as Array<{key:string;status:'hit'|'late'|'miss'}>) ?? [],
        dialect_multiplier: cd['dialect_multiplier'] as number | null,
        dialect_multiplier_note_en: (cd['dialect_multiplier_note_en'] as string) ?? '',
        dialect_multiplier_note_ar: (cd['dialect_multiplier_note_ar'] as string) ?? '',
      }
    })(),

    methodology: {
      posts_analyzed:         card.posts_analyzed,
      last_refresh:           card.scanned_at,
      vision_pipeline:        'Claude Haiku 4.5 · Vision',
      nlp_pipeline:           'DeepSeek V3',
      benchmark_dataset_size: 1247,
    },
  }

  return <ScoreCardClient data={data} />
}
