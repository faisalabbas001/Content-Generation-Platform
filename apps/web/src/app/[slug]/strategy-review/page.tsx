/**
 * /[slug]/strategy-review — Strategy Draft Review (spec §3.2 Step 8)
 *
 * Shows the complete BrandDNA strategy built by COO — all 6 layers:
 * Identity · Three-Axis framework · Creative Direction · Content Strategy ·
 * Audience · Visual Identity · Voice Rules
 */
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { adminClient } from '@repo/db'
import { getBrandForCurrentUser } from '@repo/auth/server'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { LinkButton } from '@repo/ui/button'
import { ApproveStrategyButton } from './approve-strategy-button'
import { StrengthenCard } from './strengthen-card'

export const dynamic = 'force-dynamic'

const CRITICAL_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'arabic_dialect',          label: 'Arabic Dialect' },
  { key: 'brand_differentiator',    label: 'Brand Differentiator' },
  { key: 'price_position',          label: 'Price Position' },
  { key: 'primary_channel',         label: 'Primary Channel' },
  { key: 'ramadan_relevance',       label: 'Ramadan Relevance' },
  { key: 'primary_audience_gender', label: 'Audience Gender' },
  { key: 'primary_kpi_type',        label: 'Primary KPI' },
  { key: 'religious_sensitivity',   label: 'Religious Sensitivity' },
  { key: 'tone_anti_attribute_ids', label: 'Tone Anti-attributes' },
  { key: 'bilingual_ratio',         label: 'Bilingual Ratio' },
  { key: 'archetype_primary',       label: 'Brand Archetype' },
  { key: 'lifecycle_stage',         label: 'Lifecycle Stage' },
]

const OCCASION_LABELS: Record<string, string> = {
  ramadan: 'Ramadan', eid_fitr: 'Eid Al-Fitr', eid_adha: 'Eid Al-Adha',
  national_day: 'Saudi National Day', founding_day: 'Founding Day',
  mothers_day: "Mother's Day", back_to_school: 'Back to School',
  valentines_day: "Valentine's Day", seasonal_offers: 'Seasonal Offers',
}

const APPROACH_LABELS: Record<string, string> = {
  high_priority: 'High Priority', medium_priority: 'Medium Priority',
  low_priority: 'Low Priority', full: 'Full', reduced: 'Reduced', skip: 'Skip',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-(--fg-muted) mb-1 uppercase tracking-wide font-medium">{label}</p>
      <div className="text-sm text-(--fg)">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = title.toLowerCase().replace(/\s+/g, '-')
  return (
    <Card id={id}>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  )
}

export default async function StrategyReviewPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const brandHeader = await getBrandForCurrentUser(slug)
  if (!brandHeader) notFound()

  const db = adminClient()

  const [
    { data: brand },
    { data: methodProfile },
    { data: audienceProfile },
    { data: visualStyle },
    { data: negativePatterns },
    { data: qualifiedBundles },
  ] = await Promise.all([
    db.from('brand_profiles').select('*').eq('brand_id', brandHeader.brand_id as string).maybeSingle(),
    db.from('brand_method_profiles').select('*').eq('brand_id', brandHeader.brand_id as string).maybeSingle(),
    db.from('audience_profiles').select('*').eq('brand_id', brandHeader.brand_id as string).maybeSingle(),
    db.from('visual_style_profiles').select('*').eq('brand_id', brandHeader.brand_id as string).maybeSingle(),
    db.from('negative_patterns').select('pattern_text, severity').eq('brand_id', brandHeader.brand_id as string).order('severity', { ascending: false }),
    db.from('evidence_bundles').select('field_name, field_confidence').eq('brand_id', brandHeader.brand_id as string).in('field_confidence', ['inferred_medium', 'inferred_high', 'explicitly_confirmed']),
  ])

  if (!brand) notFound()

  const b   = brand as unknown as Record<string, unknown>
  const mp  = methodProfile as Record<string, unknown> | null
  const ap  = audienceProfile as Record<string, unknown> | null
  const vs  = visualStyle as Record<string, unknown> | null

  // if (b.onboarding_status === 'complete' && Number(b.strategy_version ?? 0) >= 1) {
  //   redirect(`/${slug}/dashboard`)
  // }

  // ── Completeness — use DB completeness_score as authoritative source ──────────
  // evidence_bundles only tells us WHICH critical fields have confident evidence.
  // The DB completeness_score column is computed by COO and is the single source
  // of truth — don't re-derive it from brand_profiles columns (that inflates it).
  const qualifiedEvidenceKeys = new Set(
    (qualifiedBundles ?? [])
      .map((r) => (r as { field_name: string }).field_name)
      .filter((name) => CRITICAL_FIELDS.some((f) => f.key === name)) // only critical fields
  )
  // A critical field is "missing" if it has no qualifying evidence bundle
  const missingFields = CRITICAL_FIELDS.filter((f) => !qualifiedEvidenceKeys.has(f.key))
  // Use the DB-computed score — this matches what snapshot/profile shows
  const completenessScore = Number(b.completeness_score ?? 0)

  // ── Composition matrix for the brand's three-axis tuple ─────────────────────
  const archetype  = String(b.archetype_primary ?? '')
  const lifecycle  = String(b.lifecycle_stage   ?? '')
  const intent     = String(b.intent_state      ?? '')
  let compositionMatrix: Record<string, unknown> | null = null
  if (archetype && lifecycle && intent) {
    const { data: cm } = await db
      .from('composition_matrix')
      .select('recommended_method,is_hybrid_recommended,hybrid_composition,authenticity_score,vulnerability_score,diagnostic_score,metaphor_score,paradox_score,heritage_score')
      .eq('archetype' as never, archetype)
      .eq('lifecycle_stage' as never, lifecycle)
      .eq('intent_state' as never, intent)
      .maybeSingle()
    compositionMatrix = cm as Record<string, unknown> | null
  }

  // ── Sector baseline ──────────────────────────────────────────────────────────
  const brandDialect = String(b.arabic_dialect ?? 'MSA_accessible')
  const { data: baselineExact } = await db.from('sector_baselines')
    .select('recommended_content_mix, top_performing_tones, worst_performing_tones')
    .eq('sector' as never, String(b.sector ?? '')).eq('dialect' as never, brandDialect).maybeSingle()
  const { data: baselineFallback } = !baselineExact
    ? await db.from('sector_baselines').select('recommended_content_mix, top_performing_tones, worst_performing_tones')
      .eq('sector' as never, String(b.sector ?? '')).eq('dialect' as never, 'MSA_accessible').maybeSingle()
    : { data: null }
  const baseline = (baselineExact ?? baselineFallback) as Record<string, unknown> | null

  const contentMix       = (b.content_mix_ratios as Record<string, number> | null) ?? {}
  const platformWeights  = (b.platform_weights as Record<string, number> | null) ?? {}
  const occasionApproach = (b.occasion_approach as Record<string, string> | null) ?? {}
  const compositionBlend = (mp?.composition_blend as Record<string, string> | null) ?? {}
  const hybridTop3       = ((compositionMatrix?.hybrid_composition as Record<string, unknown> | null)?.top_3 as Array<{method: string; score: number}> | null) ?? []

  const METHOD_SCORES = compositionMatrix ? [
    { method: 'Authenticity', score: Number(compositionMatrix.authenticity_score ?? 0) },
    { method: 'Heritage',     score: Number(compositionMatrix.heritage_score     ?? 0) },
    { method: 'Vulnerability',score: Number(compositionMatrix.vulnerability_score?? 0) },
    { method: 'Diagnostic',   score: Number(compositionMatrix.diagnostic_score   ?? 0) },
    { method: 'Metaphor',     score: Number(compositionMatrix.metaphor_score     ?? 0) },
    { method: 'Paradox',      score: Number(compositionMatrix.paradox_score      ?? 0) },
  ].sort((a, b) => b.score - a.score) : []

  // ── BrandDNA Insight missing count (mirrors layout.tsx allInsightFields) ──
  const INSIGHT_FIELDS = [
    'goal_phase','permission_level','primary_channel','primary_kpi_type',
    'brave_safe_default','way_of_speaking','comfort_on_camera',
    'content_preferences','products_list','founding_story',
    'caption_style','formality_level','humor_tolerance','posting_rhythm',
    'cultural_tension_owned','owner_values','brand_goals','cust_desc',
    'cust_quote','respected_brands','respected_why','vision_text',
    'hero_why','metric','communication_style','tagline','caption_ex',
    'custom_restriction','price_nums','sub_sector','founded_year','music_link',
  ]
  const insightMissingCount = INSIGHT_FIELDS.filter(f => {
    const v = b[f]
    if (v === null || v === undefined || v === '') return true
    if (Array.isArray(v)) return (v as unknown[]).length === 0
    return false
  }).length

  return (
    <div className="min-h-screen">
      {/* ── Full-bleed hero header ─────────────────────────────────────────── */}
      <div className="border-b border-(--border-subtle) bg-(--surface-2) px-4 sm:px-6 py-6 sm:py-8">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-(--fg-muted) mb-1">Final Step · Strategy Review</p>
            <h1 className="text-3xl font-display font-bold text-(--fg) leading-tight">
              {String(b.brand_name_ar ?? '')}
              {!!b.brand_name_en && <span className="text-(--fg-muted) font-normal text-2xl ms-2">/ {String(b.brand_name_en)}</span>}
            </h1>
            <p className="text-sm text-(--fg-muted) mt-1">
              {String(b.sector ?? '')} · {String(b.city_primary ?? '')} ·{' '}
              <span className={completenessScore === 100 ? 'text-(--success) font-medium' : 'text-(--warning) font-medium'}>
                BrandDNA {completenessScore}% complete
              </span>
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href={`/${slug}/snapshot`}
              className="rounded-full border border-(--border) px-4 py-2 text-xs font-medium text-(--fg-muted) hover:text-(--fg) hover:border-(--border-strong) transition-colors"
            >
              View full BrandDNA →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Two-column layout ──────────────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 flex flex-col lg:flex-row gap-6 lg:gap-8 items-start lg:pb-8 pb-24">

        {/* ── Main content column ────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* Mobile-only strengthen + action card */}
          <div className="lg:hidden space-y-3">
            <StrengthenCard
              slug={slug}
              insightMissingCount={insightMissingCount}
              missingCriticalFields={missingFields}
              completenessScore={completenessScore}
            />
            <div className="rounded-(--r-lg) border-2 border-(--accent) bg-(--bg) p-4 space-y-3">
              <div>
                <p className="text-sm font-bold text-(--fg)">Approve This Strategy</p>
                <p className="text-xs text-(--fg-muted)">Starts calendar generation immediately</p>
              </div>
              <ApproveStrategyButton brandId={brandHeader.brand_id as string} slug={slug} />
              <LinkButton href={`/${slug}/profile`} variant="secondary" className="text-xs w-full justify-center">Edit BrandDNA</LinkButton>
            </div>
          </div>

          {/* Inline critical-fields gap banner (mobile / when sidebar hidden) */}
          {missingFields.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-(--r-md) border border-(--danger)/30 bg-(--danger)/5 px-4 py-3">
              <span className="text-xs font-semibold text-(--danger) shrink-0">
                {missingFields.length} critical field{missingFields.length !== 1 ? 's' : ''} missing:
              </span>
              {missingFields.map((f) => (
                <Badge key={f.key} tone="danger" size="sm">{f.label}</Badge>
              ))}
            </div>
          )}

      {/* ══ 1. BRAND OVERVIEW ════════════════════════════════════════════════ */}
      <Section title="Brand Overview">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Row label="Brand Name">
            <span className="font-semibold">{String(b.brand_name_ar ?? '')}
            {b.brand_name_en ? <span className="text-(--fg-muted) font-normal"> / {String(b.brand_name_en)}</span> : null}
            </span>
          </Row>
          <Row label="Sector"><Badge tone="neutral">{String(b.sector ?? '—')}</Badge></Row>
          <Row label="City"><Badge tone="neutral">{String(b.city_primary ?? '—')}</Badge></Row>
          {!!b.sub_sector && <Row label="Sub-sector"><Badge tone="neutral">{String(b.sub_sector)}</Badge></Row>}
          {!!b.price_position && <Row label="Price Position"><Badge tone="neutral">{String(b.price_position).replace(/_/g,' ')}</Badge></Row>}
          {!!b.primary_channel && <Row label="Primary Channel"><Badge tone="neutral">{String(b.primary_channel)}</Badge></Row>}
          {!!b.arabic_dialect && <Row label="Arabic Dialect"><Badge tone="neutral">{String(b.arabic_dialect).replace(/_/g,' ')}</Badge></Row>}
          {!!b.bilingual_ratio && <Row label="Language Mix"><Badge tone="neutral">{String(b.bilingual_ratio).replace(/_/g,' ')}</Badge></Row>}
          {!!b.religious_sensitivity && <Row label="Religious Sensitivity"><Badge tone={b.religious_sensitivity === 'High' ? 'warning' : 'neutral'}>{String(b.religious_sensitivity)}</Badge></Row>}
          {!!b.ramadan_relevance && <Row label="Ramadan Relevance"><Badge tone={b.ramadan_relevance === 'High' ? 'success' : 'neutral'}>{String(b.ramadan_relevance)}</Badge></Row>}
        </div>
        {!!b.brand_differentiator && (
          <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-4 py-3">
            <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Brand Differentiator</p>
            <p className="text-sm text-(--fg) italic">&ldquo;{String(b.brand_differentiator)}&rdquo;</p>
          </div>
        )}
        {!!b.cultural_tension_owned && (
          <Row label="Cultural Tension Owned">
            <span className="italic">{String(b.cultural_tension_owned)}</span>
          </Row>
        )}
        {Array.isArray(b.emotions) && (b.emotions as string[]).length > 0 && (
          <Row label="Emotions to Evoke">
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {(b.emotions as string[]).map(e => <Badge key={e} tone="accent" size="sm">{e}</Badge>)}
            </div>
          </Row>
        )}
      </Section>

      {/* ══ 2. THREE-AXIS FRAMEWORK ══════════════════════════════════════════ */}
      <Section title="Three-Axis Creative Framework">
        <p className="text-xs text-(--fg-muted)">
          The intersection of archetype, lifecycle, and intent defines every creative decision —
          which methods to use, how to open posts, how to close them, and what register to hold.
        </p>

        {/* Three axes */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-(--r-md) border border-(--accent)/40 bg-(--accent-soft)/10 px-4 py-3 text-center">
            <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Archetype</p>
            <p className="text-base font-bold text-(--fg)">{archetype || '—'}</p>
            {!!b.archetype_secondary && (
              <p className="text-[11px] text-(--fg-muted) mt-0.5">Secondary: {String(b.archetype_secondary)}</p>
            )}
            {!!b.archetype_family && (
              <p className="text-[11px] text-(--fg-muted)">Family: {String(b.archetype_family)}</p>
            )}
          </div>
          <div className="rounded-(--r-md) border border-(--border) bg-(--surface-3) px-4 py-3 text-center">
            <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Lifecycle Stage</p>
            <p className="text-base font-bold text-(--fg) capitalize">{lifecycle || '—'}</p>
          </div>
          <div className="rounded-(--r-md) border border-(--border) bg-(--surface-3) px-4 py-3 text-center">
            <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Intent State</p>
            <p className="text-base font-bold text-(--fg) capitalize">{intent || '—'}</p>
          </div>
        </div>

        {/* Composition matrix result */}
        {compositionMatrix && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-(--fg-muted) uppercase tracking-wide">Composition Matrix Result</p>
              <Badge tone={compositionMatrix.is_hybrid_recommended ? 'warning' : 'success'}>
                {compositionMatrix.is_hybrid_recommended ? 'Hybrid Method' : `Pure: ${String(compositionMatrix.recommended_method)}`}
              </Badge>
            </div>

            {/* Method scores bar chart */}
            <div className="space-y-2">
              {METHOD_SCORES.map(({ method, score }) => {
                const isWinner = hybridTop3.some(h => h.method === method) || String(compositionMatrix.recommended_method) === method
                return (
                  <div key={method} className="flex items-center gap-3">
                    <span className={`w-24 text-xs shrink-0 ${isWinner ? 'text-(--fg) font-semibold' : 'text-(--fg-muted)'}`}>{method}</span>
                    <div className="flex-1 rounded-full bg-(--surface-3) h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${isWinner ? 'bg-(--accent)' : 'bg-(--border)'}`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                    <span className={`w-8 text-xs text-right ${isWinner ? 'text-(--accent) font-semibold' : 'text-(--fg-muted)'}`}>{score}</span>
                    {isWinner && <span className="text-[10px] text-(--accent) font-medium">✓ used</span>}
                  </div>
                )
              })}
            </div>

            {/* Hybrid composition breakdown */}
            {hybridTop3.length > 0 && (
              <div className="rounded-(--r-sm) bg-(--surface-3) border border-(--border-subtle) px-3 py-2 text-xs text-(--fg-muted)">
                <strong className="text-(--fg)">Hybrid blend:</strong>{' '}
                {hybridTop3.map((h, i) => `${h.method} (${h.score})`).join(' · ')}
                {mp && Object.keys(compositionBlend).length > 0 && (
                  <span className="ml-2">— voice/diagnostic/cadence → {compositionBlend.voice}, visual → {compositionBlend.visual}, closing → {compositionBlend.closing}</span>
                )}
              </div>
            )}

            {mp?.composition_score != null && (
              <Row label="Composition Score">
                <Badge tone={Number(mp.composition_score) >= 75 ? 'success' : Number(mp.composition_score) >= 60 ? 'warning' : 'danger'}>
                  {Number(mp.composition_score)}/100 — {Number(mp.composition_score) < 60 ? 'flagged for review' : Number(mp.composition_score) < 75 ? 'acceptable' : 'strong'}
                </Badge>
              </Row>
            )}
          </div>
        )}
      </Section>

      {/* ══ 3. CREATIVE DIRECTION ════════════════════════════════════════════ */}
      {mp && (
        <Section title="Creative Direction Brief">
          {!!mp.creative_direction_text && (
            <div className="rounded-(--r-md) border border-(--accent)/30 bg-(--accent-soft)/10 px-4 py-4">
              <p className="text-sm text-(--fg) leading-relaxed whitespace-pre-line">{String(mp.creative_direction_text)}</p>
            </div>
          )}

          {/* 5 method anatomy components */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {!!mp.voice_register && (
              <div className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Voice Register</p>
                <p className="text-sm font-semibold text-(--fg)">{String(mp.voice_register).replace(/_/g,' ')}</p>
                {compositionBlend.voice && <p className="text-[10px] text-(--fg-muted) mt-0.5">Method: {compositionBlend.voice}</p>}
              </div>
            )}
            {!!mp.diagnostic_pattern && (
              <div className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Opening Pattern</p>
                <p className="text-sm font-semibold text-(--fg)">{String(mp.diagnostic_pattern).replace(/_/g,' ')}</p>
                {compositionBlend.diagnostic && <p className="text-[10px] text-(--fg-muted) mt-0.5">Method: {compositionBlend.diagnostic}</p>}
              </div>
            )}
            {!!mp.visual_idiom && (
              <div className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Visual Idiom</p>
                <p className="text-sm font-semibold text-(--fg)">{String(mp.visual_idiom).replace(/_/g,' ')}</p>
                {compositionBlend.visual && <p className="text-[10px] text-(--fg-muted) mt-0.5">Method: {compositionBlend.visual}</p>}
              </div>
            )}
            {!!mp.cadence_rule && (
              <div className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Posting Cadence</p>
                <p className="text-sm font-semibold text-(--fg)">{String(mp.cadence_rule).replace(/_/g,' ')}</p>
                {compositionBlend.cadence && <p className="text-[10px] text-(--fg-muted) mt-0.5">Method: {compositionBlend.cadence}</p>}
              </div>
            )}
            {!!mp.closing_pattern && (
              <div className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3) px-3 py-2.5">
                <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Closing / CTA</p>
                <p className="text-sm font-semibold text-(--fg)">{String(mp.closing_pattern).replace(/_/g,' ')}</p>
                {compositionBlend.closing && <p className="text-[10px] text-(--fg-muted) mt-0.5">Method: {compositionBlend.closing}</p>}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ══ 4. STRATEGIC POSITION ════════════════════════════════════════════ */}
      <Section title="Strategic Position">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {!!b.permission_level && (
            <Row label="Permission Level">
              <Badge tone="neutral">{String(b.permission_level).replace(/_/g,' ')}</Badge>
            </Row>
          )}
          {!!b.goal_phase && (
            <Row label="Goal Phase">
              <Badge tone="accent">{String(b.goal_phase)}</Badge>
            </Row>
          )}
          {!!b.intent_state && (
            <Row label="Intent State">
              <Badge tone="neutral" >{String(b.intent_state).replace(/_/g,' ')}</Badge>
            </Row>
          )}
          <Row label="Content Tone">
            <Badge tone={b.brave_safe_default ? 'warning' : 'neutral'}>
              {b.brave_safe_default ? 'Brave default' : 'Safe default'}
            </Badge>
          </Row>
          {!!b.primary_kpi_type && (
            <Row label="Primary KPI">
              <Badge tone="neutral">{String(b.primary_kpi_type).replace(/_/g,' ')}</Badge>
            </Row>
          )}
          {!!b.posting_rhythm && (
            <Row label="Posting Rhythm">
              <Badge tone="neutral">{String(b.posting_rhythm)}</Badge>
            </Row>
          )}
          {!!b.caption_style && (
            <Row label="Caption Style">
              <Badge tone="neutral">{String(b.caption_style).replace(/_/g,' ')}</Badge>
            </Row>
          )}
        </div>
        {!!b.cultural_tension_owned && (
          <Row label="Cultural Tension Owned">
            <span className="italic text-sm">&ldquo;{String(b.cultural_tension_owned)}&rdquo;</span>
          </Row>
        )}
        {Array.isArray(b.creative_formulas_approved) && (b.creative_formulas_approved as string[]).length > 0 && (
          <Row label="Approved Creative Formulas">
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {(b.creative_formulas_approved as string[]).map(f => <Badge key={f} tone="success" size="sm">{f.replace(/_/g,' ')}</Badge>)}
            </div>
          </Row>
        )}
      </Section>

      {/* ══ 5. CONTENT STRATEGY ══════════════════════════════════════════════ */}
      <Section title="Content Strategy">
        {/* Content mix */}
        {Object.keys(contentMix).length > 0 && (
          <div>
            <p className="text-xs text-(--fg-muted) uppercase tracking-wide font-medium mb-2">Monthly Content Mix</p>
            <div className="space-y-2">
              {Object.entries(contentMix).map(([type, pct]) => {
                const pctNum = Number(pct) <= 1 ? Math.round(Number(pct) * 100) : Math.round(Number(pct))
                const sectorPct = (baseline?.recommended_content_mix as Record<string,number> | null)?.[type]
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className="w-28 text-xs text-(--fg) capitalize shrink-0">{type.replace(/_/g, ' ')}</span>
                    <div className="flex-1 rounded-full bg-(--surface-3) h-2">
                      <div className="rounded-full bg-(--accent) h-2" style={{ width: `${pctNum}%` }} />
                    </div>
                    <span className="w-10 text-xs text-(--fg-muted) text-right shrink-0">{pctNum}%</span>
                    {sectorPct !== undefined && sectorPct !== pct && (
                      <span className="text-[10px] text-(--fg-faint) shrink-0">sector: {sectorPct}%</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Platform weights */}
        {Object.keys(platformWeights).length > 0 && (
          <div>
            <p className="text-xs text-(--fg-muted) uppercase tracking-wide font-medium mb-2">Platform Weights</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(platformWeights).map(([platform, weight]) => (
                <div key={platform} className="rounded-(--r-sm) border border-(--border) bg-(--surface-3) px-3 py-1.5 text-sm flex items-center gap-2">
                  <span className="font-medium">{platform}</span>
                  <span className="text-(--fg-muted)">{Number(weight) <= 1 ? Math.round(Number(weight) * 100) : Math.round(Number(weight))}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Occasions */}
        {Object.keys(occasionApproach).length > 0 && (
          <div>
            <p className="text-xs text-(--fg-muted) uppercase tracking-wide font-medium mb-2">Saudi Occasions Approach</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(occasionApproach).map(([occasion, approach]) => (
                <div key={occasion} className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3) px-3 py-2">
                  <p className="text-xs text-(--fg-muted) mb-1">{OCCASION_LABELS[occasion] ?? occasion.replace(/_/g,' ')}</p>
                  <Badge tone={approach === 'high_priority' || approach === 'full' ? 'success' : approach === 'medium_priority' || approach === 'reduced' ? 'warning' : 'neutral'} size="sm">
                    {APPROACH_LABELS[approach] ?? String(approach)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ranked occasions from form */}
        {Array.isArray(b.occasions_ranked) && (b.occasions_ranked as string[]).length > 0 && (
          <Row label="Top Occasions (ranked)">
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {(b.occasions_ranked as string[]).map((occ, i) => (
                <span key={occ} className="inline-flex items-center gap-1 rounded-full border border-(--border) bg-(--surface-3) px-2.5 py-0.5 text-xs">
                  <span className="text-(--accent) font-bold">#{i+1}</span> {occ}
                </span>
              ))}
            </div>
          </Row>
        )}

        {/* Sector tones */}
        {baseline && (
          <div className="grid grid-cols-2 gap-3">
            {Array.isArray((baseline as Record<string,unknown>).top_performing_tones) && (
              <div>
                <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1.5">Top tones in sector</p>
                <div className="flex flex-wrap gap-1">
                  {((baseline as Record<string,unknown>).top_performing_tones as string[]).slice(0,4).map(t => (
                    <Badge key={t} tone="success" size="sm">{t.replace(/_/g,' ')}</Badge>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray((baseline as Record<string,unknown>).worst_performing_tones) && (
              <div>
                <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1.5">Avoid in sector</p>
                <div className="flex flex-wrap gap-1">
                  {((baseline as Record<string,unknown>).worst_performing_tones as string[]).slice(0,4).map(t => (
                    <Badge key={t} tone="danger" size="sm">{t.replace(/_/g,' ')}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ══ 6. TARGET AUDIENCE ═══════════════════════════════════════════════ */}
      {ap && (
        <Section title="Target Audience">
          {!!ap.description_ar && (
            <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-4 py-3">
              <p className="text-sm text-(--fg)" dir="rtl">{String(ap.description_ar)}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {!!ap.gender_mix && (
              <Row label="Gender Mix">
                {(ap.gender_mix as Record<string,number>).female ?? 50}% F / {(ap.gender_mix as Record<string,number>).male ?? 50}% M
              </Row>
            )}
            {!!ap.age_range && (
              <Row label="Age Range">
                {(ap.age_range as Record<string,number>).min}–{(ap.age_range as Record<string,number>).max} yrs
              </Row>
            )}
            {!!ap.language_preference && (
              <Row label="Language"><Badge tone="neutral">{String(ap.language_preference).replace(/_/g,' ')}</Badge></Row>
            )}
            {!!ap.audience_location_primary && (
              <Row label="Location"><Badge tone="neutral">{String(ap.audience_location_primary)}</Badge></Row>
            )}
          </div>
          {!!b.lifestyle && (
            <Row label="Lifestyle Scene"><Badge tone="neutral">{String(b.lifestyle).replace(/_/g,' ')}</Badge></Row>
          )}
          {!!b.cust_desc && (
            <Row label="Customer Description">
              <span className="text-sm">{String(b.cust_desc)}</span>
            </Row>
          )}
          {!!b.cust_quote && (
            <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) px-4 py-3">
              <p className="text-[10px] text-(--fg-muted) uppercase tracking-wide font-medium mb-1">Customer Voice</p>
              <p className="text-sm text-(--fg) italic">&ldquo;{String(b.cust_quote)}&rdquo;</p>
            </div>
          )}
        </Section>
      )}

      {/* ══ 7. VISUAL IDENTITY ═══════════════════════════════════════════════ */}
      {vs && (
        <Section title="Visual Identity">
          {!!vs.style_descriptor && (
            <p className="text-sm text-(--fg)">{String(vs.style_descriptor)}</p>
          )}
          <div className="flex flex-wrap gap-6">
            {Array.isArray(vs.color_palette) && (vs.color_palette as string[]).length > 0 && (
              <div>
                <p className="text-xs text-(--fg-muted) uppercase tracking-wide font-medium mb-2">Color Palette</p>
                <div className="flex gap-2">
                  {(vs.color_palette as string[]).map((hex) => (
                    <div key={hex} className="flex flex-col items-center gap-1">
                      <div className="h-8 w-8 rounded-full border border-(--border)" style={{ backgroundColor: hex }} />
                      <span className="text-[10px] text-(--fg-muted) font-mono">{hex}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-4">
              {!!vs.aspect_ratio_primary && (
                <Row label="Format"><Badge tone="neutral">{String(vs.aspect_ratio_primary)}</Badge></Row>
              )}
              {!!vs.style_register && (
                <Row label="Style Register"><Badge tone="neutral">{String(vs.style_register).replace(/_/g,' ')}</Badge></Row>
              )}
              {vs.has_arabic_overlay !== null && vs.has_arabic_overlay !== undefined && (
                <Row label="Arabic Overlay"><Badge tone={vs.has_arabic_overlay ? 'success' : 'neutral'}>{vs.has_arabic_overlay ? 'Yes' : 'No'}</Badge></Row>
              )}
            </div>
          </div>
          {!!b.music && (
            <Row label="Brand Energy / Soundtrack">
              <Badge tone="neutral">{String(b.music)} {b.music_link ? `— ${String(b.music_link)}` : ''}</Badge>
            </Row>
          )}
        </Section>
      )}

      {/* ══ 8. BRAND VOICE RULES ════════════════════════════════════════════ */}
      <Section title="Brand Voice Rules">
        {/* Anti-attributes */}
        {Array.isArray(b.tone_anti_attribute_ids) && (b.tone_anti_attribute_ids as string[]).length > 0 && (
          <div>
            <p className="text-xs text-(--fg-muted) uppercase tracking-wide font-medium mb-2">This Brand Must Never Sound Like</p>
            <div className="flex flex-wrap gap-1.5">
              {(b.tone_anti_attribute_ids as string[]).map((attr) => (
                <Badge key={attr} tone="danger">{attr.replace(/_/g,' ')}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Restrictions */}
        {Array.isArray(b.restrictions) && (b.restrictions as string[]).length > 0 && (
          <div>
            <p className="text-xs text-(--fg-muted) uppercase tracking-wide font-medium mb-2">Content Restrictions</p>
            <div className="flex flex-wrap gap-1.5">
              {(b.restrictions as string[]).map((r) => (
                <Badge key={r} tone="warning">{r}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Negative patterns */}
        {negativePatterns && negativePatterns.length > 0 && (
          <div>
            <p className="text-xs text-(--fg-muted) uppercase tracking-wide font-medium mb-2">Policy Rules (auto-enforced on every post)</p>
            <div className="space-y-1.5">
              {(negativePatterns as Array<{pattern_text: string; severity: string}>).map((p, i) => (
                <div key={i} className="flex items-start gap-2 rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-3) px-3 py-2">
                  <Badge tone={p.severity === 'HARD_BLOCK' ? 'danger' : 'warning'} size="sm">
                    {p.severity === 'HARD_BLOCK' ? 'Block' : 'Warn'}
                  </Badge>
                  <p className="text-xs text-(--fg)">{p.pattern_text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

        {/* end main content */}
        </div>

        {/* ── Sticky right sidebar ───────────────────────────────────────── */}
        <aside className="w-72 shrink-0 sticky top-[7.5rem] space-y-4 hidden lg:block">

          {/* Strengthen BrandDNA — animated card, shown FIRST to drive enrichment */}
          <StrengthenCard
            slug={slug}
            insightMissingCount={insightMissingCount}
            missingCriticalFields={missingFields}
            completenessScore={completenessScore}
          />

          {/* Approve card — below Strengthen so user enriches first */}
          <div className="rounded-(--r-lg) border-2 border-(--accent) bg-(--bg) p-5 space-y-4 shadow-lg shadow-(--accent)/10">
            {/* BrandDNA strength ring + score */}
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0">
                <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-(--border)" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3"
                    strokeDasharray={`${Math.min(completenessScore, 100) * 0.94} 94`}
                    className={completenessScore >= 100 ? 'text-(--success)' : 'text-(--warning)'}
                    strokeLinecap="round" />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-(--fg)">{completenessScore}%</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-(--fg)">BrandDNA Strength</p>
                <p className="text-[11px] text-(--fg-muted)">
                  {missingFields.length === 0 ? 'All critical fields confirmed' : `${missingFields.length} critical field${missingFields.length !== 1 ? 's' : ''} not confirmed`}
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <p className="font-bold text-(--fg) text-sm">Approve This Strategy</p>
              <p className="text-xs text-(--fg-muted) leading-relaxed">
                Locks strategy and starts generating your first content calendar.
              </p>
            </div>

            <ApproveStrategyButton brandId={brandHeader.brand_id as string} slug={slug} />

            <LinkButton href={`/${slug}/profile`} variant="secondary" className="w-full justify-center text-xs">
              Edit BrandDNA first
            </LinkButton>
          </div>

          {/* Quick nav */}
          <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide font-medium text-(--fg-muted) mb-2">Jump to section</p>
            <nav className="space-y-0.5">
              {['Brand Overview','Three-Axis Framework','Creative Direction','Strategic Position','Content Strategy','Target Audience','Visual Identity','Brand Voice Rules'].map((s) => (
                <a key={s} href={`#${s.toLowerCase().replace(/\s+/g,'-')}`}
                  className="block text-xs text-(--fg-muted) hover:text-(--fg) py-0.5 transition-colors">
                  {s}
                </a>
              ))}
            </nav>
          </div>

        </aside>

      </div>{/* end two-column */}

      {/* ── Mobile CTA bar (shown below lg) ──────────────────────────────── */}
      <div className="lg:hidden sticky bottom-0 z-20 border-t border-(--border-subtle) bg-(--bg)/95 backdrop-blur-xl px-4 py-3 flex gap-3">
        <ApproveStrategyButton brandId={brandHeader.brand_id as string} slug={slug} />
        {insightMissingCount > 0 && (
          <Link
            href={`/${slug}/brand-insight`}
            className="flex items-center gap-1.5 rounded-(--r-md) border border-(--warning)/60 bg-(--warning-soft)/30 px-3 py-2 text-xs font-semibold text-(--fg)"
          >
            ⚡ Strengthen BrandDNA
            <span className="rounded-full bg-(--warning)/20 px-1.5 text-[10px] font-bold text-(--warning)">{insightMissingCount}</span>
          </Link>
        )}
        <LinkButton href={`/${slug}/profile`} variant="secondary" className="text-xs">Edit</LinkButton>
      </div>

    </div>
  )
}
