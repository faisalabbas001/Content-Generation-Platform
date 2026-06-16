import Link from 'next/link'
import { notFound } from 'next/navigation'
import { adminClient, brandDnaQ, brandsQ, calendarsQ, isDbConfigured } from '@repo/db'
import type { BrandProfile, CompetitorAccount, CompetitorSnapshot, BrandContentPattern } from '@repo/db/types'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { LinkButton } from '@repo/ui/button'
import { DataTable } from '@repo/ui/data-table'
import { EmptyState } from '@repo/ui/empty-state'
import { BrandDirectionCard } from '@repo/ui/admin/brand-direction-card'
import { ArrowUpRight, Sparkles } from '@repo/ui/icons'
import { getServerT } from '@/lib/i18n-server'
import { confidenceLabel, confidenceTone, formatDate, formatDateOnly, tierLabel } from '@/lib/format'

export const dynamic = 'force-dynamic'

// ── Display maps ─────────────────────────────────────────────────────────────

const PERMISSION_LEVEL_COLORS: Record<string, string> = {
  category_leader: '#C9A84C',
  challenger:      '#7C6AF5',
  institutional:   '#3DB88A',
  purpose:         '#E5667A',
  launch:          '#60A5FA',
  sme_local:       '#F59E0B',
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  product: 'Product', lifestyle: 'Lifestyle', occasion: 'Occasion',
  brand_story: 'Brand Story', founder: 'Founder', behind_scenes: 'Behind the Scenes',
  educational: 'Educational', testimonial: 'Testimonial', promotional: 'Promotional', ugc: 'UGC',
}

const OCCASION_LABELS: Record<string, string> = {
  ramadan: 'Ramadan', eid_fitr: 'Eid Al-Fitr', eid_adha: 'Eid Al-Adha',
  national_day: 'National Day', founding_day: 'Founding Day',
  mothers_day: "Mother's Day", back_to_school: 'Back to School',
  valentines_day: "Valentine's Day", seasonal_offers: 'Seasonal Offers',
}

const OCCASION_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  high_priority: 'success', full: 'success',
  medium_priority: 'warning', reduced: 'warning',
  low_priority: 'neutral', skip: 'neutral',
}

const PATTERN_TRIGGER_LABELS: Record<string, string> = {
  '3x_above_avg': '3× above avg',
  '0.3x_avg': '0.3× avg',
  saves_spike: 'saves spike',
  shares_spike: 'shares spike',
  completion_drop: 'completion drop',
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function AdminClientDetail({
  params,
}: {
  params: Promise<{ brand_id: string }>
}) {
  const { brand_id } = await params
  const { locale, t } = await getServerT()
  if (!isDbConfigured()) notFound()

  const db = adminClient()

  const { data: brand } = await db
    .from('brand_profiles')
    .select('*')
    .eq('brand_id', brand_id)
    .maybeSingle()
  if (!brand) notFound()
  const typedBrand = brand as BrandProfile
  const b = brand as unknown as Record<string, unknown>

  // Parallel data fetch — DNA + calendars + evidence + strategy supplements
  const [dna, bundles, calendars, businessEventsRaw, strategyHistoryRaw, contentPatternsRaw] = await Promise.all([
    brandDnaQ.getBrandDna(brand_id, db),
    brandsQ.getEvidenceBundlesForBrand(brand_id),
    calendarsQ.getCalendarsForBrand(brand_id),
    db.from('business_events' as never)
      .select('event_id, event_type, title, description, event_date, end_date, is_active')
      .eq('brand_id' as never, brand_id)
      .eq('is_active' as never, true)
      .order('event_date' as never, { ascending: true })
      .limit(8),
    db.from('strategy_updates_log' as never)
      .select('strategy_version, changed_fields, change_summary, trigger_type, created_at')
      .eq('brand_id' as never, brand_id)
      .order('created_at' as never, { ascending: false })
      .limit(5),
    db.from('brand_content_patterns' as never)
      .select('*')
      .eq('brand_id' as never, brand_id)
      .eq('is_active' as never, true)
      .order('first_observed_at' as never, { ascending: false }),
  ])

  const businessEvents = (businessEventsRaw.data ?? []) as Array<{
    event_id: string; event_type: string; title: string
    description: string | null; event_date: string; end_date: string | null
  }>
  const strategyHistory = (strategyHistoryRaw.data ?? []) as Array<{
    strategy_version: number; changed_fields: string[]
    change_summary: string | null; trigger_type: string | null; created_at: string
  }>
  const allPatterns = (contentPatternsRaw.data ?? []) as unknown as BrandContentPattern[]
  const winners = allPatterns.filter((p) => p.pattern_type === 'winner')
  const losers  = allPatterns.filter((p) => p.pattern_type === 'loser')

  const contentMix       = (b.content_mix_ratios  as Record<string, number> | null) ?? {}
  const platformWeights  = (b.platform_weights     as Record<string, number> | null) ?? {}
  const occasionApproach = (b.occasion_approach    as Record<string, string> | null) ?? {}

  const displayName = locale === 'en' && typedBrand.brand_name_en
    ? typedBrand.brand_name_en
    : typedBrand.brand_name_ar

  const strategyVersion = Number(b.strategy_version ?? 0)

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t('adminClientDetail.eyebrow')}
        title={displayName}
        subtitle={`${typedBrand.sector} · ${typedBrand.arabic_dialect ?? '—'} · ${typedBrand.city_primary ?? '—'}`}
        action={
          <div className="flex flex-wrap gap-2">
            <LinkButton
              href={`/${typedBrand.client_slug}/dashboard`}
              variant="secondary"
              trailingIcon={<ArrowUpRight size={14} />}
            >
              {t('adminClientDetail.viewDashboard')}
            </LinkButton>
            <LinkButton
              href={`/admin/branddna/${typedBrand.brand_id}`}
              variant="outline"
              leadingIcon={<Sparkles size={14} />}
            >
              {t('adminClientDetail.viewBrandDna')}
            </LinkButton>
          </div>
        }
      />

      {/* ── Basics + Evidence ───────────────────────────────────────── */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader><div><CardTitle>{t('adminBrandDna.basics')}</CardTitle></div></CardHeader>
          <CardBody className="space-y-2.5 text-sm">
            <Row label={t('adminBrandDna.labels.sector')}        value={typedBrand.sector} />
            <Row label={t('adminBrandDna.labels.dialect')}       value={typedBrand.arabic_dialect ?? '—'} />
            <Row label={t('adminBrandDna.labels.city')}          value={typedBrand.city_primary ?? '—'} />
            <Row label={t('adminBrandDna.labels.pricePosition')} value={typedBrand.price_position ?? '—'} />
            <Row label={t('adminBrandDna.labels.channel')}       value={typedBrand.primary_channel ?? '—'} />
            <Row label={t('adminBrandDna.labels.tier')}          value={<Badge tone={typedBrand.tier === 'free' ? 'outline' : 'accent'} size="sm">{tierLabel(typedBrand.tier, t)}</Badge>} />
            <Row label={t('adminBrandDna.labels.completeness')}  value={<span className="font-mono">{typedBrand.completeness_score}%</span>} />
            <Row label="Archetype"       value={typedBrand.archetype_primary ?? '—'} />
            <Row label="Archetype 2°"    value={typedBrand.archetype_secondary ?? '—'} />
            <Row label="Lifecycle"       value={typedBrand.lifecycle_stage ?? '—'} />
            <Row label="Intent"          value={typedBrand.intent_state ?? '—'} />
            <Row label="KPI"             value={typedBrand.primary_kpi_type ?? '—'} />
            <Row label="Ramadan"         value={typedBrand.ramadan_relevance ?? '—'} />
            <Row label="Formality"       value={typedBrand.formality_level ?? '—'} />
            <Row label="Humor"           value={typedBrand.humor_tolerance ?? '—'} />
            {!!(b.posting_rhythm) && <Row label="Post rhythm" value={String(b.posting_rhythm).replace(/_/g,' ')} />}
            {!!(b.caption_style)  && <Row label="Caption style" value={String(b.caption_style).replace(/_/g,' ')} />}
            {!!(b.tagline)        && <Row label="Tagline" value={String(b.tagline)} />}
            <Row label="Permission"      value={
              b.permission_level
                ? <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: PERMISSION_LEVEL_COLORS[String(b.permission_level)] ?? '#888' }}
                    />
                    {String(b.permission_level).replace(/_/g, ' ')}
                  </span>
                : '—'
            } />
            <Row label="Goal Phase"      value={String(b.goal_phase ?? '—')} />
            <Row label="Strategy v"      value={strategyVersion > 0 ? `v${strategyVersion}` : <Badge tone="warning" size="sm">pending</Badge>} />
            <Row label="Calibration"     value={
              typedBrand.is_calibration_period
                ? <Badge tone="warning" size="sm" dot>active</Badge>
                : <Badge tone="success" size="sm">done</Badge>
            } />
            <Row label="Sector baseline" value={typedBrand.sector_baseline_id ? <span className="font-mono text-xs">{typedBrand.sector_baseline_id.slice(0, 8)}…</span> : <Badge tone="warning" size="sm">unlinked</Badge>} />
            <Row label="Vector ns"       value={typedBrand.vector_namespace ? <span className="font-mono text-xs">{typedBrand.vector_namespace}</span> : <Badge tone="warning" size="sm">unset</Badge>} />
            <Row label="Created"         value={<span className="text-xs text-(--fg-muted)">{formatDate(typedBrand.created_at, locale)}</span>} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>{t('adminBrandDna.evidenceTitle')}</CardTitle></div></CardHeader>
          <CardBody className="p-0">
            <DataTable
              rows={bundles}
              density="compact"
              columns={[
                { key: 'field', header: t('adminBrandDna.field'),      render: (b) => <span className="font-medium text-(--fg)">{b.field_name}</span> },
                { key: 'conf',  header: t('adminBrandDna.confidence'), render: (b) => <Badge tone={confidenceTone(b.field_confidence)} size="sm">{confidenceLabel(b.field_confidence, t)}</Badge> },
                { key: 'a',     header: t('adminBrandDna.agreement'),  render: (b) => <span className="font-mono text-(--fg-subtle)">{(b.agreement_ratio * 100).toFixed(0)}%</span>, align: 'end' },
                { key: 'r',     header: t('adminBrandDna.recency'),    render: (b) => <span className="font-mono text-(--fg-subtle)">{(b.recency_score * 100).toFixed(0)}%</span>, align: 'end' },
              ]}
              empty={t('adminBrandDna.noEvidence')}
            />
          </CardBody>
        </Card>
      </div>

      {/* ── STRATEGY SECTION ────────────────────────────────────────── */}
      <AdminSectionDivider label="Strategy" />

      {/* Creative direction */}
      <BrandDirectionCard
        archetype_primary={typedBrand.archetype_primary ?? null}
        archetype_secondary={typedBrand.archetype_secondary ?? null}
        lifecycle_stage={typedBrand.lifecycle_stage ?? null}
        intent_state={typedBrand.intent_state ?? null}
        method_profile={dna?.method_profile ?? null}
        detailed={true}
        title="Creative Direction (Layer 3)"
      />

      {/* ── Owner Insights (from brand-insight wizard) ──────────────── */}
      {!!(b.products_list || b.hero_why || b.cust_desc || b.cust_quote ||
          b.respected_brands || b.vision_text || b.metric ||
          b.caption_ex || b.custom_restriction || b.music_link ||
          b.price_nums || b.sub_sector || b.founded_year) && (
        <>
          <AdminSectionDivider label="Owner Insights" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {!!b.price_nums       && <Row label="Price Range"    value={String(b.price_nums)} />}
            {!!b.sub_sector       && <Row label="Sub-sector"     value={String(b.sub_sector)} />}
            {!!b.founded_year     && <Row label="Founded"        value={String(b.founded_year)} />}
            {!!b.metric           && <Row label="Success Metric" value={String(b.metric)} />}
            {!!b.music_link       && <Row label="Music Ref"      value={String(b.music_link)} />}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {!!b.products_list && (
              <Card>
                <CardHeader><div><CardTitle>Products & Services</CardTitle></div></CardHeader>
                <CardBody><p className="text-xs text-(--fg) whitespace-pre-line leading-relaxed">{String(b.products_list)}</p></CardBody>
              </Card>
            )}
            {!!b.hero_why && (
              <Card>
                <CardHeader><div><CardTitle>Hero Product — Why</CardTitle></div></CardHeader>
                <CardBody><p className="text-xs text-(--fg) leading-relaxed">{String(b.hero_why)}</p></CardBody>
              </Card>
            )}
            {!!b.cust_desc && (
              <Card>
                <CardHeader><div><CardTitle>Ideal Customer</CardTitle></div></CardHeader>
                <CardBody><p className="text-xs text-(--fg) leading-relaxed">{String(b.cust_desc)}</p></CardBody>
              </Card>
            )}
            {!!b.cust_quote && (
              <Card>
                <CardHeader><div><CardTitle>Customer Quote</CardTitle></div></CardHeader>
                <CardBody><p className="text-xs text-(--fg) italic">"{String(b.cust_quote)}"</p></CardBody>
              </Card>
            )}
            {!!b.vision_text && (
              <Card>
                <CardHeader><div><CardTitle>Vision Statement</CardTitle></div></CardHeader>
                <CardBody><p className="text-xs text-(--fg) leading-relaxed">{String(b.vision_text)}</p></CardBody>
              </Card>
            )}
            {!!b.respected_brands && (
              <Card>
                <CardHeader><div><CardTitle>Admired Brands</CardTitle></div></CardHeader>
                <CardBody>
                  <p className="text-xs font-medium text-(--fg)">{String(b.respected_brands)}</p>
                  {!!b.respected_why && <p className="text-xs text-(--fg-muted) mt-1">{String(b.respected_why)}</p>}
                </CardBody>
              </Card>
            )}
            {!!b.custom_restriction && (
              <Card>
                <CardHeader><div><CardTitle>Content Guardrails</CardTitle></div></CardHeader>
                <CardBody><p className="text-xs text-(--danger) leading-relaxed">{String(b.custom_restriction)}</p></CardBody>
              </Card>
            )}
            {!!b.caption_ex && (
              <Card>
                <CardHeader><div><CardTitle>Caption Example</CardTitle></div></CardHeader>
                <CardBody><p className="text-xs text-(--fg) italic">"{String(b.caption_ex)}"</p></CardBody>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Brand differentiator + cultural tension */}
      {!!(b.brand_differentiator || b.cultural_tension_owned) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {!!b.brand_differentiator && (
            <Card>
              <CardHeader><div><CardTitle>Brand Differentiator</CardTitle></div></CardHeader>
              <CardBody>
                <p className="text-sm text-(--fg) leading-relaxed" dir="auto">{String(b.brand_differentiator)}</p>
              </CardBody>
            </Card>
          )}
          {!!b.cultural_tension_owned && (
            <Card>
              <CardHeader><div><CardTitle>Cultural Tension Owned</CardTitle></div></CardHeader>
              <CardBody>
                <p className="text-sm text-(--fg) leading-relaxed" dir="auto">{String(b.cultural_tension_owned)}</p>
                <p className="mt-2 text-xs text-(--fg-faint)">Exclusive to this brand in {String(b.sector ?? '')} / {String(b.city_primary ?? '')}</p>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Content mix + platform weights side by side */}
      {(Object.keys(contentMix).length > 0 || Object.keys(platformWeights).length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.keys(contentMix).length > 0 && (
            <Card>
              <CardHeader><div><CardTitle>Content Mix</CardTitle></div></CardHeader>
              <CardBody className="space-y-2.5">
                {Object.entries(contentMix)
                  .sort(([, a], [, b]) => Number(b) - Number(a))
                  .map(([type, raw]) => {
                    const val = Number(raw) <= 1 ? Math.round(Number(raw) * 100) : Math.round(Number(raw))
                    return (
                      <div key={type} className="flex items-center gap-2">
                        <span className="w-28 text-xs text-(--fg) shrink-0">
                          {CONTENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}
                        </span>
                        <div className="flex-1 rounded-full bg-(--surface-3) h-1.5 overflow-hidden">
                          <div className="h-full rounded-full bg-(--accent)" style={{ width: `${val}%` }} />
                        </div>
                        <span className="w-8 text-xs text-(--fg-muted) text-right tabular-nums">{val}%</span>
                      </div>
                    )
                  })}
              </CardBody>
            </Card>
          )}

          {Object.keys(platformWeights).length > 0 && (
            <Card>
              <CardHeader><div><CardTitle>Platform Weights</CardTitle></div></CardHeader>
              <CardBody className="space-y-2.5">
                {Object.entries(platformWeights)
                  .sort(([, a], [, b]) => Number(b) - Number(a))
                  .map(([platform, raw]) => {
                    const val = Number(raw) <= 1 ? Math.round(Number(raw) * 100) : Math.round(Number(raw))
                    return (
                      <div key={platform} className="flex items-center gap-2">
                        <span className="w-24 text-xs text-(--fg) shrink-0">{platform}</span>
                        <div className="flex-1 rounded-full bg-(--surface-3) h-1.5 overflow-hidden">
                          <div className="h-full rounded-full bg-(--accent)" style={{ width: `${val}%` }} />
                        </div>
                        <span className="w-8 text-xs text-(--fg-muted) text-right tabular-nums">{val}%</span>
                      </div>
                    )
                  })}
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Occasions approach */}
      {Object.keys(occasionApproach).length > 0 && (
        <Card>
          <CardHeader><div><CardTitle>Saudi Occasions Approach</CardTitle></div></CardHeader>
          <CardBody>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {Object.entries(occasionApproach).map(([occ, approach]) => (
                <div key={occ} className="rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-2) px-3 py-2">
                  <p className="text-xs font-medium text-(--fg) mb-1">
                    {OCCASION_LABELS[occ] ?? occ.replace(/_/g, ' ')}
                  </p>
                  <Badge tone={OCCASION_TONE[approach] ?? 'neutral'} size="sm">
                    {approach.replace(/_/g, ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Brave/safe + owner context */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-(--fg-faint) mb-2">Content Tone Default</p>
            <Badge tone={b.brave_safe_default ? 'warning' : 'neutral'}>
              {b.brave_safe_default ? '🔥 Brave' : '🛡 Safe'}
            </Badge>
          </CardBody>
        </Card>
        {!!b.religious_sensitivity && (
          <Card>
            <CardBody className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-(--fg-faint) mb-2">Religious Sensitivity</p>
              <Badge tone={
                b.religious_sensitivity === 'High' ? 'danger' :
                b.religious_sensitivity === 'Medium' ? 'warning' : 'neutral'
              }>{String(b.religious_sensitivity)}</Badge>
            </CardBody>
          </Card>
        )}
        {!!b.bilingual_ratio && (
          <Card>
            <CardBody className="p-4">
              <p className="text-[11px] uppercase tracking-wide text-(--fg-faint) mb-2">Bilingual Ratio</p>
              <Badge tone="outline">{String(b.bilingual_ratio).replace(/_/g, ' ')}</Badge>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Business events */}
      {businessEvents.length > 0 && (
        <Card>
          <CardHeader><div><CardTitle>Business Events</CardTitle></div></CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-(--border-subtle)">
              {businessEvents.map((ev) => (
                <li key={ev.event_id} className="flex items-start gap-4 px-5 py-3">
                  <div className="flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-(--r-sm) bg-(--accent-soft)/30 text-center">
                    <span className="text-[9px] font-bold text-(--accent) uppercase leading-none">
                      {new Date(ev.event_date).toLocaleString('en-SA', { month: 'short' })}
                    </span>
                    <span className="font-mono text-xs font-bold text-(--fg) leading-none">
                      {new Date(ev.event_date).getDate()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-(--fg)">{ev.title}</p>
                    {ev.description && (
                      <p className="text-xs text-(--fg-muted) line-clamp-1">{ev.description}</p>
                    )}
                    <Badge tone="outline" size="sm" className="mt-1">{ev.event_type.replace(/_/g, ' ')}</Badge>
                  </div>
                  <span className="text-xs text-(--fg-faint) whitespace-nowrap">
                    {formatDateOnly(ev.event_date, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Strategy history */}
      {strategyHistory.length > 0 && (
        <Card>
          <CardHeader>
            <div><CardTitle>Strategy Update Log</CardTitle></div>
            <Badge tone="neutral" size="sm">v{strategyVersion}</Badge>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-(--border-subtle)">
              {strategyHistory.map((h, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--surface-3) font-mono text-[10px] text-(--fg-muted)">
                    {h.strategy_version}
                  </span>
                  <div className="flex-1 min-w-0">
                    {h.change_summary && (
                      <p className="text-xs text-(--fg)">{h.change_summary}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {h.trigger_type && (
                        <Badge tone="outline" size="sm">{h.trigger_type.replace(/_/g, ' ')}</Badge>
                      )}
                      {h.changed_fields?.slice(0, 4).map((f) => (
                        <span key={f} className="font-mono text-[10px] text-(--fg-faint)">{f}</span>
                      ))}
                    </div>
                    <p className="text-[10px] text-(--fg-faint) mt-1">{formatDateOnly(h.created_at, locale)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* ── COMPETITORS ─────────────────────────────────────────────── */}
      {dna && dna.competitors.accounts.length > 0 && (
        <>
          <AdminSectionDivider label="Layer 5 — Competitors" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(dna.competitors.accounts as CompetitorAccount[]).map((account) => {
              const snap = (dna.competitors.latest_snapshots as CompetitorSnapshot[]).find(
                (s) => s.competitor_id === account.competitor_id,
              ) ?? null

              return (
                <Card key={account.competitor_id}>
                  <CardBody className="p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-(--fg)">{account.display_name ?? '—'}</p>
                        {account.handle_instagram && (
                          <p className="font-mono text-xs text-(--fg-muted)">@{account.handle_instagram}</p>
                        )}
                      </div>
                      <Badge tone={account.tier === 'deep' ? 'accent' : 'outline'} size="sm">
                        {account.tier}
                      </Badge>
                    </div>
                    {snap && (
                      <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-(--border-subtle) text-xs">
                        {snap.estimated_engagement_rate != null && (
                          <div>
                            <p className="text-[10px] text-(--fg-faint)">Engagement</p>
                            <p className="font-mono font-semibold text-(--fg)">{(snap.estimated_engagement_rate * 100).toFixed(1)}%</p>
                          </div>
                        )}
                        {snap.posting_frequency_per_week != null && (
                          <div>
                            <p className="text-[10px] text-(--fg-faint)">Posts/week</p>
                            <p className="font-mono font-semibold text-(--fg)">{snap.posting_frequency_per_week}</p>
                          </div>
                        )}
                        {snap.gaps_identified && snap.gaps_identified.length > 0 && (
                          <div className="col-span-2 mt-1">
                            <p className="text-[10px] text-(--fg-faint) mb-0.5">Gaps</p>
                            {snap.gaps_identified.slice(0, 1).map((g, i) => (
                              <p key={i} className="text-xs text-(--success) truncate">↗ {g}</p>
                            ))}
                          </div>
                        )}
                        {snap.threats_identified && snap.threats_identified.length > 0 && (
                          <div className="col-span-2">
                            <p className="text-[10px] text-(--fg-faint) mb-0.5">Threats</p>
                            {snap.threats_identified.slice(0, 1).map((g, i) => (
                              <p key={i} className="text-xs text-(--danger) truncate">⚠ {g}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardBody>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {/* ── PERFORMANCE PATTERNS ────────────────────────────────────── */}
      {(winners.length > 0 || losers.length > 0) && (
        <>
          <AdminSectionDivider label="Layer 6 — Performance Patterns" />
          <div className="grid gap-4 sm:grid-cols-2">
            {winners.length > 0 && (
              <Card>
                <CardHeader>
                  <div><CardTitle>Winners</CardTitle></div>
                  <Badge tone="success" size="sm">{winners.length}</Badge>
                </CardHeader>
                <CardBody className="p-0">
                  <ul className="divide-y divide-(--border-subtle)">
                    {winners.map((p) => <AdminPatternRow key={p.pattern_id} pattern={p} tone="success" />)}
                  </ul>
                </CardBody>
              </Card>
            )}
            {losers.length > 0 && (
              <Card>
                <CardHeader>
                  <div><CardTitle>Losers</CardTitle></div>
                  <Badge tone="danger" size="sm">{losers.length}</Badge>
                </CardHeader>
                <CardBody className="p-0">
                  <ul className="divide-y divide-(--border-subtle)">
                    {losers.map((p) => <AdminPatternRow key={p.pattern_id} pattern={p} tone="danger" />)}
                  </ul>
                </CardBody>
              </Card>
            )}
          </div>
        </>
      )}

      {/* ── INSTAGRAM SIGNALS (migration 0094) ─────────────────────── */}
      {!!(b.bio_text || b.bio_link || b.followers_count != null || b.ig_post_count != null ||
          b.avg_engagement_rate != null || b.posting_frequency_per_week != null ||
          b.primary_content_format || b.caption_avg_length != null ||
          b.top_hashtags || b.top_mentioned_accounts ||
          b.signature_phrases || b.brand_reply_samples || b.content_type_distribution ||
          b.products_list || b.cust_desc) && (
        <>
          <AdminSectionDivider label="Extraction Signals" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Instagram analytics */}
            {!!(b.bio_text || b.bio_link || b.followers_count != null || b.ig_post_count != null ||
                b.avg_engagement_rate != null || b.posting_frequency_per_week != null ||
                b.primary_content_format || b.caption_avg_length != null) && (
              <Card>
                <CardHeader><div><CardTitle>Instagram Account</CardTitle></div></CardHeader>
                <CardBody className="space-y-2 text-sm">
                  {b.followers_count != null && <Row label="Followers" value={<span className="font-mono">{Number(b.followers_count).toLocaleString()}</span>} />}
                  {b.ig_post_count != null && <Row label="Posts" value={<span className="font-mono">{String(b.ig_post_count)}</span>} />}
                  {b.avg_engagement_rate != null && <Row label="Engagement" value={<span className="font-mono">{(Number(b.avg_engagement_rate) * 100).toFixed(2)}%</span>} />}
                  {b.posting_frequency_per_week != null && <Row label="Posts/week" value={<span className="font-mono">{String(b.posting_frequency_per_week)}</span>} />}
                  {b.caption_avg_length != null && <Row label="Caption avg len" value={<span className="font-mono">{String(b.caption_avg_length)} chars</span>} />}
                  {!!b.primary_content_format && <Row label="Primary format" value={String(b.primary_content_format).replace(/_/g, ' ')} />}
                  {!!b.bio_text && (
                    <div className="pt-1 border-t border-(--border-subtle)">
                      <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1">Bio</p>
                      <p className="text-xs text-(--fg) leading-relaxed">{String(b.bio_text)}</p>
                      {!!b.bio_link && <p className="text-xs text-(--accent) mt-0.5 truncate">{String(b.bio_link)}</p>}
                    </div>
                  )}
                </CardBody>
              </Card>
            )}
            {/* Content patterns */}
            {!!(b.top_hashtags || b.top_mentioned_accounts || b.content_type_distribution) && (
              <Card>
                <CardHeader><div><CardTitle>Content Patterns</CardTitle></div></CardHeader>
                <CardBody className="space-y-3 text-sm">
                  {Array.isArray(b.top_hashtags) && (b.top_hashtags as string[]).length > 0 && (
                    <div>
                      <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1.5">Top Hashtags</p>
                      <div className="flex flex-wrap gap-1">
                        {(b.top_hashtags as string[]).slice(0, 8).map((h: string) => (
                          <span key={h} className="rounded-full bg-(--surface-3) px-2 py-0.5 text-[11px] font-mono text-(--fg-muted)">{h}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {Array.isArray(b.top_mentioned_accounts) && (b.top_mentioned_accounts as string[]).length > 0 && (
                    <div>
                      <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1.5">Top Mentions</p>
                      <div className="flex flex-wrap gap-1">
                        {(b.top_mentioned_accounts as string[]).slice(0, 6).map((a: string) => (
                          <span key={a} className="rounded-full bg-(--accent-soft)/20 px-2 py-0.5 text-[11px] text-(--accent)">@{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {!!(b.content_type_distribution && typeof b.content_type_distribution === 'object') && (
                    <div>
                      <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1.5">Type Distribution</p>
                      <div className="space-y-1">
                        {Object.entries(b.content_type_distribution as Record<string, number>)
                          .sort(([, a], [, bv]) => bv - a).slice(0, 5)
                          .map(([type, pct]) => {
                            const val = Number(pct) <= 1 ? Math.round(Number(pct) * 100) : Math.round(Number(pct))
                            return (
                              <div key={type} className="flex items-center gap-2">
                                <span className="w-20 text-[11px] text-(--fg) shrink-0 truncate">{type.replace(/_/g, ' ')}</span>
                                <div className="flex-1 rounded-full bg-(--surface-3) h-1.5 overflow-hidden">
                                  <div className="h-full rounded-full bg-(--accent)" style={{ width: `${Math.min(100, val)}%` }} />
                                </div>
                                <span className="text-[11px] text-(--fg-muted) w-7 text-right tabular-nums">{val}%</span>
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            )}
            {/* Extracted copy signals */}
            {!!(b.signature_phrases || b.brand_reply_samples || b.products_list || b.cust_desc) && (
              <Card>
                <CardHeader><div><CardTitle>Extracted Copy</CardTitle></div></CardHeader>
                <CardBody className="space-y-3 text-sm">
                  {!!b.products_list && (
                    <div>
                      <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1">Products / Services</p>
                      <p className="text-xs text-(--fg) leading-relaxed whitespace-pre-line line-clamp-4">{String(b.products_list)}</p>
                    </div>
                  )}
                  {!!b.cust_desc && (
                    <div>
                      <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1">Customer Description</p>
                      <p className="text-xs text-(--fg) leading-relaxed">{String(b.cust_desc)}</p>
                    </div>
                  )}
                  {Array.isArray(b.signature_phrases) && (b.signature_phrases as string[]).length > 0 && (
                    <div>
                      <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1">Signature Phrases</p>
                      {(b.signature_phrases as string[]).slice(0, 4).map((p: string, i: number) => (
                        <p key={i} className="text-xs text-(--fg) italic">"{p}"</p>
                      ))}
                    </div>
                  )}
                  {Array.isArray(b.brand_reply_samples) && (b.brand_reply_samples as string[]).length > 0 && (
                    <div>
                      <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1">Reply Samples</p>
                      {(b.brand_reply_samples as string[]).slice(0, 3).map((r: string, i: number) => (
                        <p key={i} className="text-xs text-(--fg)">"{r}"</p>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            )}
          </div>
        </>
      )}

      {/* ── LORA + CALIBRATION ─────────────────────────────────────────── */}
      {!!(typedBrand.lora_training_status || typedBrand.is_calibration_period) && (
        <>
          <AdminSectionDivider label="Model & Calibration" />
          <div className="grid gap-4 sm:grid-cols-2">
            {!!typedBrand.lora_training_status && (
              <Card>
                <CardHeader>
                  <div><CardTitle>LoRA Visual Model</CardTitle></div>
                  <Badge tone={
                    typedBrand.lora_training_status === 'ready' ? 'success' :
                    typedBrand.lora_training_status === 'training' ? 'warning' :
                    typedBrand.lora_training_status === 'failed' ? 'danger' : 'neutral'
                  } size="sm">{typedBrand.lora_training_status.replace(/_/g, ' ')}</Badge>
                </CardHeader>
                <CardBody className="space-y-2 text-sm">
                  {typedBrand.lora_model_id && <Row label="Model ID" value={<span className="font-mono text-xs truncate max-w-32">{typedBrand.lora_model_id}</span>} />}
                  {typedBrand.lora_training_photo_count != null && <Row label="Training photos" value={<span className="font-mono">{String(typedBrand.lora_training_photo_count)}</span>} />}
                  {typedBrand.lora_trained_at && <Row label="Trained at" value={formatDateOnly(typedBrand.lora_trained_at, locale)} />}
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader>
                <div><CardTitle>Calibration</CardTitle></div>
                <Badge tone={typedBrand.is_calibration_period ? 'warning' : 'success'} size="sm" dot>
                  {typedBrand.is_calibration_period ? 'Active' : 'Complete'}
                </Badge>
              </CardHeader>
              <CardBody className="space-y-2 text-sm">
                {typedBrand.is_calibration_period && typedBrand.calibration_ends_at && (() => {
                  const daysLeft = Math.max(0, Math.ceil((new Date(typedBrand.calibration_ends_at).getTime() - Date.now()) / 86_400_000))
                  return <Row label="Days left" value={<span className="font-mono">{String(daysLeft)}</span>} />
                })()}
                {typedBrand.calibration_ends_at && <Row label="Ends at" value={formatDateOnly(typedBrand.calibration_ends_at, locale)} />}
                {typedBrand.calibration_ended_reason && <Row label="Ended reason" value={typedBrand.calibration_ended_reason.replace(/_/g, ' ')} />}
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {/* ── CALENDARS ───────────────────────────────────────────────── */}
      <AdminSectionDivider label="Calendars" />
      <Card>
        <CardHeader><div><CardTitle>{t('adminClientDetail.calendarsCard')}</CardTitle></div></CardHeader>
        <CardBody className="p-0">
          {calendars.length === 0 ? (
            <EmptyState title={t('adminClientDetail.noCalendars')} />
          ) : (
            <ul className="divide-y divide-(--border-subtle)">
              {calendars.map((c) => (
                <li key={c.calendar_id} className="flex items-center gap-4 px-5 py-3.5">
                  <span className="font-mono text-(--fg-subtle)">{c.month}</span>
                  <Badge tone={c.status === 'delivered' ? 'success' : 'warning'} size="sm" dot>
                    {c.status === 'delivered' ? t('calendar.delivered_') : t('calendar.draft')}
                  </Badge>
                  <span className="text-xs text-(--fg-muted)">{formatDateOnly(c.delivered_at, locale)}</span>
                  <Link
                    href={`/${typedBrand.client_slug}/calendar/${c.month}`}
                    className="ms-auto text-xs font-medium text-(--accent) hover:underline"
                  >
                    {t('common.openCalendar')} →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

// ── Sub-components (module-scoped) ────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-(--border-subtle) pb-2 last:border-0 last:pb-0">
      <span className="text-(--fg-muted)">{label}</span>
      <span className="font-medium text-(--fg)">{value}</span>
    </div>
  )
}

function AdminSectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="rounded-full bg-(--surface-3) px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-(--fg-faint)">
        {label}
      </span>
      <div className="flex-1 h-px bg-(--border-subtle)" />
    </div>
  )
}

function AdminPatternRow({ pattern, tone }: { pattern: BrandContentPattern; tone: 'success' | 'danger' }) {
  const trigger = PATTERN_TRIGGER_LABELS[pattern.trigger_signal] ?? pattern.trigger_signal
  const engRate = pattern.avg_engagement_rate != null
    ? `${(pattern.avg_engagement_rate * 100).toFixed(1)}%`
    : null
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'success' ? 'bg-(--success)' : 'bg-(--danger)'}`} />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-medium text-(--fg)">
            {String(pattern.content_type ?? '—').replace(/_/g, ' ')}
          </span>
          {!!pattern.formula_used && (
            <span className="font-mono text-[10px] text-(--fg-faint)">{pattern.formula_used}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-(--fg-muted) mt-0.5">
          <span>{trigger}</span>
          {engRate && <span>{engRate} avg</span>}
          {pattern.sample_count != null && <span>{Number(pattern.sample_count)}×</span>}
        </div>
      </div>
    </li>
  )
}
