import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getScoreCardBySlug } from '@/lib/scoring/db'
import { DIMENSION_LABELS } from '@/lib/scoring/types'
import type { ScoreDimension } from '@repo/db'
import { ReportClient } from './_client'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const full = await getScoreCardBySlug(slug)
  if (!full) return { title: 'Report Not Found' }
  const { card } = full
  const name = card.brand_name_en ?? card.handle
  return {
    title: `${name} — Full Brand Report | OGz AI`,
    description: `90-day action plan for ${name}. Score ${card.overall_score}/100 across 5 dimensions.`,
  }
}

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
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

  // Compute 90-day target score
  const targetScore = Math.min(100, card.overall_score + 39)
  const leaderComp = competitors.find(c => c.rank === 1 && !c.is_focal_brand)
  const leaderGap = leaderComp ? leaderComp.competitor_score - card.overall_score : null

  // Build dimension data with labels
  const dimensionData = dimensions.map(d => {
    const key = d.dimension as ScoreDimension
    const labels = DIMENSION_LABELS[key]
    const dimFindings = findings.filter(f => f.dimension === key)
    const dimAction = actions.find(a => a.dimension === key)
    return {
      key,
      name_en: labels?.en ?? key,
      name_ar: labels?.ar ?? key,
      short_en: key === 'visual_quality' ? 'VQ' : key === 'cultural_fit' ? 'CF' : key === 'posting_consistency' ? 'PC' : key === 'brand_coherence' ? 'BC' : 'EH',
      weight: d.weight,
      score: d.score,
      benchmark: d.benchmark ?? null,
      findings: dimFindings.map(f => ({ finding_en: f.finding_en, finding_ar: f.finding_ar, severity: f.severity })),
      action: dimAction ? {
        workflow_id: dimAction.workflow_id,
        label_en: dimAction.action_label_en,
        label_ar: dimAction.action_label_ar,
        estimated_lift: dimAction.estimated_lift,
        timeframe_weeks: dimAction.timeframe_weeks,
        icon_emoji: dimAction.icon_emoji ?? null,
      } : null,
    }
  })

  // Generate 3-phase 90-day plan from the actions
  const sortedActions = [...actions].sort((a, b) => b.estimated_lift - a.estimated_lift)
  const phase1Actions = sortedActions.slice(0, 4)
  const phase2Actions = sortedActions.slice(4, 8)
  const phase3Actions = sortedActions.slice(8)

  const totalLift = actions.reduce((s, a) => s + a.estimated_lift, 0)
  const phase1Lift = phase1Actions.reduce((s, a) => s + a.estimated_lift, 0)
  const phase2Lift = phase2Actions.reduce((s, a) => s + a.estimated_lift, 0)
  const phase3Lift = phase3Actions.reduce((s, a) => s + a.estimated_lift, 0)

  return (
    <ReportClient
      card={{
        handle: card.handle,
        name_en: card.brand_name_en ?? null,
        name_ar: card.brand_name_ar ?? null,
        sector_label_en: sl.en,
        sector_label_ar: sl.ar,
        city: card.location_city ?? null,
        neighborhood: card.location_neighborhood ?? null,
        followers_count: card.followers_count ?? 0,
        overall_score: card.overall_score,
        score_tier: card.tier,
        scanned_at: card.scanned_at,
        share_slug: card.share_slug,
        posts_analyzed: card.posts_analyzed,
      }}
      dimensions={dimensionData}
      competitors={competitors.map(c => ({
        name: c.competitor_name,
        handle: c.competitor_handle,
        score: c.competitor_score,
        tier: c.tier,
        location_en: c.location_label_en ?? null,
        location_ar: c.location_label_ar ?? null,
        rank: c.rank,
        is_focal: c.is_focal_brand,
      }))}
      plan={{
        current_score: card.overall_score,
        target_score: targetScore,
        total_lift: totalLift,
        leader_gap: leaderGap,
        leader_name: leaderComp?.competitor_name ?? null,
        phases: [
          {
            num: 1, weeks: '1–30', title_en: 'Foundation', title_ar: 'الأساس',
            desc_en: 'Fix the critical gaps dragging your score down the most.',
            desc_ar: 'أصلح الفجوات الحرجة التي تخفض نقاطك أكثر من غيرها.',
            actions: phase1Actions.map(a => ({ label_en: a.action_label_en, label_ar: a.action_label_ar, lift: a.estimated_lift, workflow_id: a.workflow_id, icon: a.icon_emoji })),
            score_after: Math.min(100, card.overall_score + phase1Lift),
          },
          {
            num: 2, weeks: '31–60', title_en: 'Growth', title_ar: 'النمو',
            desc_en: 'Build momentum with consistent brand signals and audience targeting.',
            desc_ar: 'ابنِ الزخم بإشارات علامة تجارية ثابتة واستهداف للجمهور.',
            actions: phase2Actions.map(a => ({ label_en: a.action_label_en, label_ar: a.action_label_ar, lift: a.estimated_lift, workflow_id: a.workflow_id, icon: a.icon_emoji })),
            score_after: Math.min(100, card.overall_score + phase1Lift + phase2Lift),
          },
          {
            num: 3, weeks: '61–90', title_en: 'Market Leadership', title_ar: 'ريادة السوق',
            desc_en: 'Compound the gains and defend your position in the local market.',
            desc_ar: 'ضاعف المكاسب وحافظ على مكانتك في السوق المحلية.',
            actions: phase3Actions.map(a => ({ label_en: a.action_label_en, label_ar: a.action_label_ar, lift: a.estimated_lift, workflow_id: a.workflow_id, icon: a.icon_emoji })),
            score_after: Math.min(100, card.overall_score + phase1Lift + phase2Lift + phase3Lift),
          },
        ],
      }}
    />
  )
}
