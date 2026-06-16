/**
 * /[slug]/strategy — Complete Brand Strategy Page
 *
 * Surfaces every strategic layer in one place for the brand owner:
 *   Layer 1  — Identity (name, sector, dialect, audience, visual)
 *   Layer 2  — Owner profile (founding story, goals, vision)
 *   Layer 3  — Creative identity (method profile, archetypes, visual style)
 *   Layer 4  — Strategic intelligence (permission level, goal phase,
 *               content mix, platform weights, occasion approach,
 *               cultural tension, business events)
 *   Layer 5  — Competitive landscape (competitors + latest signals)
 *   Layer 6  — Performance patterns (winners + losers learned from content)
 *
 * Data source: getBrandDna() — 10 parallel queries, same DTO used by /snapshot.
 * RLS: user-scoped client → Supabase row-level isolation.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { brandDnaQ, adminClient } from '@repo/db'
import type { CompetitorAccount, CompetitorSnapshot, BrandContentPattern } from '@repo/db/types'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { LinkButton } from '@repo/ui/button'
import { Progress } from '@repo/ui/progress'
import { BrandDirectionCard } from '@repo/ui/admin/brand-direction-card'
import { ArrowUpRight } from '@repo/ui/icons'
import { getServerT } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

// ── Display maps ─────────────────────────────────────────────────────────────

const PERMISSION_LEVEL_MAP: Record<string, { label: string; desc: string; color: string }> = {
  category_leader: { label: 'Category Leader',   desc: 'Dominant brand in the sector — sets the agenda.',        color: '#C9A84C' },
  challenger:      { label: 'Challenger',         desc: 'Disrupting the dominant player with a sharp point.',     color: '#7C6AF5' },
  institutional:   { label: 'Institutional',      desc: 'Trusted authority — credibility and consistency.',       color: '#3DB88A' },
  purpose:         { label: 'Purpose-Driven',     desc: 'Mission and values front and center.',                   color: '#E5667A' },
  launch:          { label: 'Launch',             desc: 'New to market — building awareness from zero.',          color: '#60A5FA' },
  sme_local:       { label: 'SME / Local',        desc: 'Community-rooted, personal trust with local audience.',  color: '#F59E0B' },
}

const GOAL_PHASE_MAP: Record<string, { label: string; desc: string }> = {
  awareness:  { label: 'Awareness',   desc: 'Growing reach — putting the brand in front of new audiences.' },
  conversion: { label: 'Conversion',  desc: 'Turning followers into customers with direct action triggers.' },
  retention:  { label: 'Retention',   desc: 'Deepening loyalty and repeat engagement with existing audience.' },
  launch:     { label: 'Launch',      desc: 'Announcing the brand to the world for the first time.' },
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  product:          'Product',
  lifestyle:        'Lifestyle',
  occasion:         'Occasion',
  brand_story:      'Brand Story',
  founder:          'Founder',
  behind_scenes:    'Behind the Scenes',
  educational:      'Educational',
  testimonial:      'Testimonial',
  promotional:      'Promotional',
  ugc:              'User Content',
}

const OCCASION_LABELS: Record<string, string> = {
  ramadan:          'Ramadan',
  eid_fitr:         'Eid Al-Fitr',
  eid_adha:         'Eid Al-Adha',
  national_day:     'Saudi National Day',
  founding_day:     'Founding Day',
  mothers_day:      "Mother's Day",
  back_to_school:   'Back to School',
  valentines_day:   "Valentine's Day",
  seasonal_offers:  'Seasonal Offers',
  new_year:         'New Year',
}

const OCCASION_APPROACH_MAP: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  high_priority:    { label: 'High Priority',    tone: 'success' },
  full:             { label: 'Full Campaign',     tone: 'success' },
  medium_priority:  { label: 'Medium Priority',  tone: 'warning' },
  reduced:          { label: 'Reduced',          tone: 'warning' },
  low_priority:     { label: 'Low Priority',     tone: 'neutral' },
  skip:             { label: 'Skip',             tone: 'neutral' },
}

const LIFECYCLE_MAP: Record<string, { label: string; desc: string }> = {
  pre_launch: { label: 'Pre-Launch',   desc: 'Building groundwork before going public.' },
  launch:     { label: 'Launch',       desc: 'Entering the market — first impressions.' },
  growth:     { label: 'Growth',       desc: 'Expanding audience and share of voice.' },
  maturity:   { label: 'Maturity',     desc: 'Defending position, deepening loyalty.' },
  recovery:   { label: 'Recovery',     desc: 'Rebuilding after a setback or repositioning.' },
}

const INTENT_MAP: Record<string, { label: string; desc: string }> = {
  launch:   { label: 'Launch',   desc: 'Announce and establish presence.' },
  grow:     { label: 'Grow',     desc: 'Expand reach and new-audience acquisition.' },
  defend:   { label: 'Defend',   desc: 'Protect market share from competitor pressure.' },
  harvest:  { label: 'Harvest',  desc: 'Extract maximum value from existing position.' },
  recover:  { label: 'Recover',  desc: 'Rebuild trust and re-establish relevance.' },
}

const PATTERN_TRIGGER_LABELS: Record<string, string> = {
  '3x_above_avg':      '3× above average engagement',
  '0.3x_avg':          'Significantly below average',
  saves_spike:         'Saves spike',
  shares_spike:        'Shares spike',
  completion_drop:     'Completion rate dropped',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(v: number): string {
  // values may be 0–1 or 0–100 depending on source
  return `${v <= 1 ? Math.round(v * 100) : Math.round(v)}%`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-SA', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function StrategyPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { locale } = await getServerT()
  const brandHeader = await getBrandForCurrentUser(slug)
  if (!brandHeader) notFound()

  const userClient = await getUserScopedClient()
  const dna = await brandDnaQ.getBrandDna(brandHeader.brand_id, userClient)
  if (!dna) notFound()

  const db = adminClient()

  // Business events — not in getBrandDna DTO, fetch separately
  const { data: businessEventsRaw } = await db
    .from('business_events' as never)
    .select('event_id, event_type, title, description, event_date, end_date, is_active')
    .eq('brand_id' as never, brandHeader.brand_id)
    .eq('is_active' as never, true)
    .order('event_date' as never, { ascending: true })
    .limit(10)
  const businessEvents = (businessEventsRaw ?? []) as Array<{
    event_id: string; event_type: string; title: string
    description: string | null; event_date: string; end_date: string | null; is_active: boolean
  }>

  // Strategy update history
  const { data: strategyHistoryRaw } = await db
    .from('strategy_updates_log' as never)
    .select('strategy_version, changed_fields, change_summary, trigger_type, created_at')
    .eq('brand_id' as never, brandHeader.brand_id)
    .order('created_at' as never, { ascending: false })
    .limit(5)
  const strategyHistory = (strategyHistoryRaw ?? []) as Array<{
    strategy_version: number; changed_fields: string[]
    change_summary: string | null; trigger_type: string | null; created_at: string
  }>

  const {
    brand, audience, visual_style, channels,
    method_profile, competitors, content_patterns, stats,
  } = dna

  // Use brand directly — it is already a typed BrandProfile. The fields below
  // are JSONB / optional columns not yet in the generated type, so we cast once
  // at extraction points rather than casting the whole object.
  const bAny = brand as unknown as Record<string, unknown>

  const contentMix       = (bAny.content_mix_ratios  as Record<string, number> | null) ?? {}
  const platformWeights  = (bAny.platform_weights     as Record<string, number> | null) ?? {}
  const occasionApproach = (bAny.occasion_approach    as Record<string, string> | null) ?? {}

  const permLevel  = PERMISSION_LEVEL_MAP[brand.permission_level ?? ''] ?? null
  const goalPhase  = GOAL_PHASE_MAP[brand.goal_phase ?? ''] ?? null
  const lifecycle  = LIFECYCLE_MAP[brand.lifecycle_stage ?? ''] ?? null
  const intent     = INTENT_MAP[brand.intent_state ?? ''] ?? null

  const igChannel   = channels.find((c) => c.channel === 'Instagram') ?? null
  const displayName = locale === 'en' && brand.brand_name_en ? brand.brand_name_en : brand.brand_name_ar

  const isCalibration = stats.is_calibration_period
  const calibDaysLeft = stats.calibration_ends_at
    ? Math.max(0, Math.ceil((new Date(stats.calibration_ends_at).getTime() - Date.now()) / 86_400_000))
    : null

  const strategyVersion = Number((bAny.strategy_version as number | null) ?? 0)

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Brand Strategy"
        title={`${displayName} — Strategy`}
        subtitle="Your complete brand strategy across all layers — identity, creative direction, content mix, competitive positioning, and performance patterns."
        action={
          <LinkButton href={`/${slug}/snapshot`} variant="secondary" trailingIcon={<ArrowUpRight size={14} />}>
            Full BrandDNA
          </LinkButton>
        }
      />

      {/* ── Calibration banner ──────────────────────────────────────── */}
      {isCalibration && (
        <div className="rounded-(--r-lg) border border-amber-500/20 bg-amber-500/8 px-4 py-3 flex items-center gap-3">
          <span className="text-amber-400 text-base shrink-0">⏳</span>
          <div className="min-w-0">
            <p className="font-semibold text-(--fg) text-sm">
              Calibration Period
              {calibDaysLeft !== null && <span className="font-normal text-amber-400 ms-1">— {calibDaysLeft} days remaining</span>}
            </p>
            <p className="text-(--fg-muted) text-xs mt-0.5">
              The system is learning from your content during the first 90 days. Strategy recommendations will sharpen automatically as performance data accumulates.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1 — Brand Identity (Layer 1)
      ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader label="Layer 1" title="Brand Identity" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoCard label="Brand Name (Arabic)" value={brand.brand_name_ar} dir="rtl" />
        <InfoCard label="Brand Name (English)" value={brand.brand_name_en ?? '—'} />
        <InfoCard label="Sector" value={brand.sector ?? '—'} accent />
        <InfoCard label="Primary City" value={brand.city_primary ?? '—'} />
        <InfoCard label="Arabic Dialect" value={brand.arabic_dialect ?? '—'} />
        <InfoCard label="Price Position" value={brand.price_position ?? '—'} />
        <InfoCard label="Primary Channel" value={brand.primary_channel ?? '—'} />
        <InfoCard label="Primary KPI" value={brand.primary_kpi_type ?? '—'} />
        <InfoCard label="Religious Sensitivity" value={brand.religious_sensitivity ?? '—'} />
        <InfoCard label="Bilingual Ratio" value={brand.bilingual_ratio ?? '—'} />
        <InfoCard label="Ramadan Relevance" value={brand.ramadan_relevance ?? '—'} />
        {audience?.gender_mix && (() => {
          const gm = audience.gender_mix as Record<string, number>
          const f = gm.female ?? gm.female_pct
          const m = gm.male ?? gm.male_pct
          if (f == null && m == null) return null
          const fp = f != null ? (f <= 1 ? Math.round(f * 100) : Math.round(f)) : null
          const mp = m != null ? (m <= 1 ? Math.round(m * 100) : Math.round(m)) : null
          return <InfoCard label="Primary Audience" value={fp != null && mp != null ? `${fp}% Female · ${mp}% Male` : '—'} />
        })()}
      </div>

      {/* Brand differentiator */}
      {brand.brand_differentiator && (
        <Card>
          <CardHeader><div><CardTitle>What Makes You Different</CardTitle></div></CardHeader>
          <CardBody>
            <p className="text-sm text-(--fg) leading-relaxed" dir="auto">
              {brand.brand_differentiator}
            </p>
          </CardBody>
        </Card>
      )}

      {/* Audience profile */}
      {audience && (
        <Card>
          <CardHeader><div><CardTitle>Target Audience</CardTitle></div></CardHeader>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {audience.description_ar && (
              <div className="sm:col-span-2">
                <p className="text-xs text-(--fg-muted) mb-1">Description</p>
                <p className="text-sm text-(--fg) leading-relaxed" dir="rtl">{audience.description_ar}</p>
              </div>
            )}
            {audience.gender_mix && (
              <div>
                <p className="text-xs text-(--fg-muted) mb-2">Gender Mix</p>
                <div className="space-y-1.5">
                  {audience.gender_mix.female != null && (
                    <BarRow label="Female" value={audience.gender_mix.female} color="var(--accent)" />
                  )}
                  {audience.gender_mix.male != null && (
                    <BarRow label="Male" value={audience.gender_mix.male} color="var(--fg-muted)" />
                  )}
                </div>
              </div>
            )}
            {audience.age_range && (audience.age_range.min != null || audience.age_range.max != null) && (
              <div>
                <p className="text-xs text-(--fg-muted) mb-1">Age Range</p>
                <p className="text-lg font-semibold text-(--fg)">
                  {audience.age_range.min ?? '?'} – {audience.age_range.max ?? '?'}
                  <span className="text-xs font-normal text-(--fg-muted) ms-1">years</span>
                </p>
              </div>
            )}
            {audience.language_preference && (
              <div>
                <p className="text-xs text-(--fg-muted) mb-1">Language Preference</p>
                <Badge tone="outline">{audience.language_preference.replace(/_/g, ' ')}</Badge>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Visual identity */}
      {visual_style && (
        <Card>
          <CardHeader><div><CardTitle>Visual Identity</CardTitle></div></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {visual_style.style_register && (
                <div>
                  <p className="text-xs text-(--fg-muted) mb-1">Style Register</p>
                  <Badge tone="accent">{visual_style.style_register}</Badge>
                </div>
              )}
              {brand.primary_color_hex && (
                <div>
                  <p className="text-xs text-(--fg-muted) mb-2">Primary Colour</p>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-6 w-6 rounded-full border border-(--border-subtle)"
                      style={{ background: brand.primary_color_hex }}
                    />
                    <span className="font-mono text-xs text-(--fg)">{brand.primary_color_hex}</span>
                  </div>
                </div>
              )}
            </div>
            {visual_style.color_palette && visual_style.color_palette.length > 0 && (
              <div>
                <p className="text-xs text-(--fg-muted) mb-2">Colour Palette</p>
                <div className="flex flex-wrap gap-2">
                  {visual_style.color_palette.map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="h-5 w-5 rounded border border-(--border-subtle)" style={{ background: c }} />
                      <span className="font-mono text-[11px] text-(--fg-muted)">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {visual_style.style_descriptor && (
              <div>
                <p className="text-xs text-(--fg-muted) mb-1">Style Description</p>
                <p className="text-sm text-(--fg)">{visual_style.style_descriptor}</p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Instagram presence */}
      {igChannel && (
        <Card>
          <CardHeader><div><CardTitle>Instagram Presence</CardTitle></div></CardHeader>
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <BigStat label="Followers" value={igChannel.followers_count?.toLocaleString() ?? '—'} />
            <BigStat label="Engagement Rate" value={igChannel.engagement_rate != null ? `${(igChannel.engagement_rate * 100).toFixed(1)}%` : '—'} />
            <BigStat label="Total Posts" value={igChannel.posts_count_total?.toLocaleString() ?? '—'} />
            {igChannel.handle && (
              <div className="sm:col-span-3">
                <p className="text-xs text-(--fg-muted) mb-1">Handle</p>
                <span className="font-mono text-sm text-(--fg)">@{igChannel.handle}</span>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2 — Owner Profile (Layer 2)
      ═══════════════════════════════════════════════════════════════ */}
      {!!(brand.founding_story || brand.owner_values || brand.way_of_speaking || brand.comfort_on_camera ||
          (bAny.vision as string | null) || (bAny.vision_text as string | null) ||
          (bAny.products_list as string | null) || (bAny.hero_why as string | null) ||
          (bAny.cust_desc as string | null) || (bAny.respected_brands as string | null)) && (
        <>
          <SectionHeader label="Layer 2" title="Owner Profile" />

          {/* Identity quick-facts grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {brand.way_of_speaking && <InfoCard label="Way of Speaking" value={brand.way_of_speaking.replace(/_/g, ' ')} />}
            {brand.comfort_on_camera && <InfoCard label="Comfort on Camera" value={brand.comfort_on_camera.replace(/_/g, ' ')} />}
            {(bAny.vision as string | null) && <InfoCard label="12-Month Vision" value={String(bAny.vision).replace(/_/g, ' ')} />}
            {brand.communication_style && <InfoCard label="Communication Style" value={brand.communication_style} />}
            {(bAny.price_nums as string | null) && <InfoCard label="Price Range" value={String(bAny.price_nums)} />}
            {(bAny.sub_sector as string | null) && <InfoCard label="Sub-sector" value={String(bAny.sub_sector)} />}
            {(bAny.founded_year as number | null) && <InfoCard label="Founded" value={String(bAny.founded_year)} />}
            {(bAny.metric as string | null) && <InfoCard label="How I Measure Success" value={String(bAny.metric)} />}
          </div>

          {/* Content preferences */}
          {Array.isArray(brand.content_preferences) && (brand.content_preferences as string[]).length > 0 && (
            <Card>
              <CardHeader><div><CardTitle>Content Format Preferences</CardTitle></div></CardHeader>
              <CardBody>
                <div className="flex flex-wrap gap-2">
                  {(brand.content_preferences as string[]).map((p) => (
                    <span key={p} className="rounded-full border border-(--border-default) bg-(--surface-3) px-3 py-1 text-xs font-medium text-(--fg)">
                      {p.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Products & Services */}
          {(bAny.products_list as string | null) && (
            <Card>
              <CardHeader><div><CardTitle>Products & Services</CardTitle></div></CardHeader>
              <CardBody>
                <p className="text-sm text-(--fg) leading-relaxed whitespace-pre-line" dir="auto">{String(bAny.products_list)}</p>
              </CardBody>
            </Card>
          )}

          {/* Long-form text cards in 2-col grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            {brand.founding_story && (
              <Card>
                <CardHeader><div><CardTitle>Founding Story</CardTitle></div></CardHeader>
                <CardBody><p className="text-sm text-(--fg) leading-relaxed" dir="auto">{brand.founding_story}</p></CardBody>
              </Card>
            )}
            {(bAny.hero_why as string | null) && (
              <Card>
                <CardHeader><div><CardTitle>Hero Product — Why</CardTitle></div></CardHeader>
                <CardBody><p className="text-sm text-(--fg) leading-relaxed" dir="auto">{String(bAny.hero_why)}</p></CardBody>
              </Card>
            )}
            {(bAny.cust_desc as string | null) && (
              <Card>
                <CardHeader><div><CardTitle>Ideal Customer</CardTitle></div></CardHeader>
                <CardBody><p className="text-sm text-(--fg) leading-relaxed" dir="auto">{String(bAny.cust_desc)}</p></CardBody>
              </Card>
            )}
            {(bAny.cust_quote as string | null) && (
              <Card>
                <CardHeader><div><CardTitle>Customer Quote</CardTitle></div></CardHeader>
                <CardBody>
                  <p className="text-sm text-(--fg) leading-relaxed italic" dir="auto">"{String(bAny.cust_quote)}"</p>
                </CardBody>
              </Card>
            )}
            {brand.brand_goals && (
              <Card>
                <CardHeader><div><CardTitle>Business Goals</CardTitle></div></CardHeader>
                <CardBody><p className="text-sm text-(--fg) leading-relaxed" dir="auto">{brand.brand_goals}</p></CardBody>
              </Card>
            )}
            {(bAny.vision_text as string | null) && (
              <Card>
                <CardHeader><div><CardTitle>Vision Statement</CardTitle></div></CardHeader>
                <CardBody><p className="text-sm text-(--fg) leading-relaxed" dir="auto">{String(bAny.vision_text)}</p></CardBody>
              </Card>
            )}
            {brand.owner_values && (
              <Card>
                <CardHeader><div><CardTitle>Owner Values</CardTitle></div></CardHeader>
                <CardBody><p className="text-sm text-(--fg) leading-relaxed" dir="auto">{brand.owner_values}</p></CardBody>
              </Card>
            )}
            {(bAny.respected_brands as string | null) && (
              <Card>
                <CardHeader><div><CardTitle>Admired Brands</CardTitle></div></CardHeader>
                <CardBody>
                  <p className="text-sm font-medium text-(--fg)">{String(bAny.respected_brands)}</p>
                  {(bAny.respected_why as string | null) && (
                    <p className="text-xs text-(--fg-muted) mt-1">{String(bAny.respected_why)}</p>
                  )}
                </CardBody>
              </Card>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3 — Creative Identity (Layer 3)
      ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader label="Layer 3" title="Creative Identity" />

      {/* Content style fields from brand-insight */}
      {!!(brand.caption_style || brand.posting_rhythm || brand.formality_level ||
          brand.humor_tolerance || (bAny.tagline as string | null) ||
          (bAny.music_link as string | null) || (bAny.custom_restriction as string | null) ||
          (bAny.caption_ex as string | null)) && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {brand.caption_style && <InfoCard label="Caption Style" value={brand.caption_style.replace(/_/g, ' ')} />}
            {brand.posting_rhythm && <InfoCard label="Posting Rhythm" value={brand.posting_rhythm.replace(/_/g, ' ')} />}
            {brand.formality_level && <InfoCard label="Formality Level" value={brand.formality_level.replace(/_/g, ' ')} />}
            {brand.humor_tolerance && <InfoCard label="Humor Tolerance" value={brand.humor_tolerance.replace(/_/g, ' ')} />}
            {(bAny.tagline as string | null) && <InfoCard label="Brand Tagline" value={String(bAny.tagline)} />}
            {(bAny.music_link as string | null) && <InfoCard label="Music Reference" value={String(bAny.music_link)} />}
          </div>
          {/* Content guardrails + caption example */}
          <div className="grid gap-4 sm:grid-cols-2">
            {(bAny.custom_restriction as string | null) && (
              <Card>
                <CardHeader><div><CardTitle>Content Guardrails</CardTitle></div></CardHeader>
                <CardBody>
                  <p className="text-sm text-(--danger) leading-relaxed" dir="auto">{String(bAny.custom_restriction)}</p>
                  <p className="text-xs text-(--fg-faint) mt-1">The system will never produce content that crosses these lines.</p>
                </CardBody>
              </Card>
            )}
            {(bAny.caption_ex as string | null) && (
              <Card>
                <CardHeader><div><CardTitle>Caption Example</CardTitle></div></CardHeader>
                <CardBody>
                  <p className="text-sm text-(--fg) leading-relaxed italic" dir="auto">"{String(bAny.caption_ex)}"</p>
                  <p className="text-xs text-(--fg-faint) mt-1">A real caption the owner wrote — used to calibrate voice.</p>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      )}

      <BrandDirectionCard
        archetype_primary={brand.archetype_primary ?? null}
        archetype_secondary={brand.archetype_secondary ?? null}
        lifecycle_stage={brand.lifecycle_stage ?? null}
        intent_state={brand.intent_state ?? null}
        method_profile={method_profile}
        detailed={false}
        title="Creative Direction"
      />

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4 — Strategic Intelligence (Layer 4)
      ═══════════════════════════════════════════════════════════════ */}
      <SectionHeader label="Layer 4" title="Strategic Intelligence" />

      {/* Permission level + lifecycle + intent — the strategic triangle */}
      <div className="grid gap-4 sm:grid-cols-3">
        {permLevel && (
          <Card>
            <CardBody className="p-5">
              <div
                className="mb-3 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-black"
                style={{ background: permLevel.color }}
              >
                {permLevel.label}
              </div>
              <p className="text-xs text-(--fg-muted) leading-relaxed">{permLevel.desc}</p>
              <p className="mt-2 text-[11px] text-(--fg-faint) uppercase tracking-wide">Permission Level</p>
            </CardBody>
          </Card>
        )}
        {lifecycle && (
          <Card>
            <CardBody className="p-5">
              <Badge tone="outline" className="mb-3">{lifecycle.label}</Badge>
              <p className="text-xs text-(--fg-muted) leading-relaxed">{lifecycle.desc}</p>
              <p className="mt-2 text-[11px] text-(--fg-faint) uppercase tracking-wide">Brand Lifecycle</p>
            </CardBody>
          </Card>
        )}
        {intent && (
          <Card>
            <CardBody className="p-5">
              <Badge tone="info" className="mb-3">{intent.label}</Badge>
              <p className="text-xs text-(--fg-muted) leading-relaxed">{intent.desc}</p>
              <p className="mt-2 text-[11px] text-(--fg-faint) uppercase tracking-wide">Content Intent</p>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Goal phase */}
      {goalPhase && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Current Goal Phase</CardTitle>
            </div>
            <Badge tone="accent">{goalPhase.label}</Badge>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-(--fg-muted)">{goalPhase.desc}</p>
            {brand.brave_safe_default != null && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-(--fg-muted)">Content tone default:</span>
                <Badge tone={brand.brave_safe_default ? 'warning' : 'neutral'}>
                  {brand.brave_safe_default ? '🔥 Brave' : '🛡 Safe'}
                </Badge>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Cultural tension */}
      {brand.cultural_tension_owned && (
        <Card>
          <CardHeader><div><CardTitle>Cultural Tension Owned</CardTitle></div></CardHeader>
          <CardBody>
            <p className="text-sm text-(--fg) leading-relaxed" dir="auto">
              {brand.cultural_tension_owned}
            </p>
            <p className="mt-2 text-xs text-(--fg-muted)">
              This is the specific cultural insight your brand claims. No other brand in the same
              sector and city can own the same tension.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Content mix */}
      {Object.keys(contentMix).length > 0 && (
        <Card>
          <CardHeader><div><CardTitle>Content Mix</CardTitle></div></CardHeader>
          <CardBody className="space-y-3">
            {Object.entries(contentMix)
              .sort(([, a], [, b]) => Number(b) - Number(a))
              .map(([type, rawPct]) => {
                const value = Number(rawPct) <= 1 ? Math.round(Number(rawPct) * 100) : Math.round(Number(rawPct))
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className="w-32 text-xs text-(--fg) shrink-0">
                      {CONTENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}
                    </span>
                    <div className="flex-1 rounded-full bg-(--surface-3) h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-(--accent)"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                    <span className="w-9 text-xs text-(--fg-muted) text-right tabular-nums">{value}%</span>
                  </div>
                )
              })}
            <p className="text-xs text-(--fg-muted) border-t border-(--border-subtle) pt-2">
              How your posts are distributed across content types each month.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Platform weights */}
      {Object.keys(platformWeights).length > 0 && (
        <Card>
          <CardHeader><div><CardTitle>Platform Weights</CardTitle></div></CardHeader>
          <CardBody>
            <div className="space-y-3">
              {Object.entries(platformWeights)
                .sort(([, a], [, b]) => Number(b) - Number(a))
                .map(([platform, rawWeight]) => {
                  const value = Number(rawWeight) <= 1 ? Math.round(Number(rawWeight) * 100) : Math.round(Number(rawWeight))
                  return (
                    <div key={platform} className="flex items-center gap-3">
                      <span className="w-28 text-xs text-(--fg) shrink-0">{platform}</span>
                      <div className="flex-1 rounded-full bg-(--surface-3) h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${value}%`, background: 'var(--accent)' }}
                        />
                      </div>
                      <span className="w-9 text-xs text-(--fg-muted) text-right tabular-nums">{value}%</span>
                    </div>
                  )
                })}
            </div>
            <p className="text-xs text-(--fg-muted) border-t border-(--border-subtle) pt-2 mt-3">
              Effort allocation across platforms. Higher weight = more posts + more production budget.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Saudi occasions approach */}
      {Object.keys(occasionApproach).length > 0 && (
        <Card>
          <CardHeader><div><CardTitle>Saudi Occasions Approach</CardTitle></div></CardHeader>
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(occasionApproach).map(([occasion, approach]) => {
                const ap = OCCASION_APPROACH_MAP[approach] ?? { label: approach, tone: 'neutral' as const }
                return (
                  <div
                    key={occasion}
                    className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) px-3 py-2.5"
                  >
                    <p className="text-xs font-semibold text-(--fg) mb-1">
                      {OCCASION_LABELS[occasion] ?? occasion.replace(/_/g, ' ')}
                    </p>
                    <Badge tone={ap.tone} size="sm">{ap.label}</Badge>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-(--fg-muted) border-t border-(--border-subtle) pt-2 mt-3">
              How the system weights your content calendar around Saudi cultural occasions.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Business events */}
      {businessEvents.length > 0 && (
        <Card>
          <CardHeader><div><CardTitle>Upcoming Business Events</CardTitle></div></CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-(--border-subtle)">
              {businessEvents.map((ev) => (
                <li key={ev.event_id} className="flex items-start gap-4 px-5 py-3.5">
                  <div className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-(--r-sm) bg-(--accent-soft)/30 text-center">
                    <span className="text-[10px] font-bold text-(--accent) uppercase leading-none">
                      {new Date(ev.event_date).toLocaleString('en-SA', { month: 'short' })}
                    </span>
                    <span className="font-mono text-sm font-bold text-(--fg) leading-none">
                      {new Date(ev.event_date).getDate()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-(--fg)">{ev.title}</p>
                    {ev.description && (
                      <p className="text-xs text-(--fg-muted) mt-0.5 line-clamp-2">{ev.description}</p>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <Badge tone="outline" size="sm">{ev.event_type.replace(/_/g, ' ')}</Badge>
                      {ev.end_date && (
                        <span className="text-[11px] text-(--fg-faint)">until {formatDate(ev.end_date)}</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Strategy version history */}
      {strategyHistory.length > 0 && (
        <Card>
          <CardHeader>
            <div><CardTitle>Strategy History</CardTitle></div>
            <Badge tone="neutral" size="sm">v{strategyVersion}</Badge>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-(--border-subtle)">
              {strategyHistory.map((h, i) => (
                <li key={i} className="flex items-start gap-4 px-5 py-3.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--surface-3) font-mono text-xs text-(--fg-muted)">
                    v{h.strategy_version}
                  </span>
                  <div className="flex-1 min-w-0">
                    {h.change_summary && (
                      <p className="text-sm text-(--fg)">{h.change_summary}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {h.trigger_type && (
                        <Badge tone="outline" size="sm">{h.trigger_type.replace(/_/g, ' ')}</Badge>
                      )}
                      {h.changed_fields?.slice(0, 3).map((f) => (
                        <span key={f} className="text-[11px] text-(--fg-faint) font-mono">{f}</span>
                      ))}
                      {(h.changed_fields?.length ?? 0) > 3 && (
                        <span className="text-[11px] text-(--fg-faint)">+{h.changed_fields.length - 3} more</span>
                      )}
                    </div>
                    <p className="text-[11px] text-(--fg-faint) mt-1">{formatDate(h.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5 — Competitive Landscape (Layer 5)
      ═══════════════════════════════════════════════════════════════ */}
      {competitors.accounts.length > 0 && (
        <>
          <SectionHeader label="Layer 5" title="Competitive Landscape" />

          <div className="grid gap-4 sm:grid-cols-2">
            {(competitors.accounts as CompetitorAccount[]).map((account) => {
              const snap = (competitors.latest_snapshots as CompetitorSnapshot[]).find(
                (s) => s.competitor_id === account.competitor_id,
              ) ?? null

              return (
                <Card key={account.competitor_id}>
                  <CardBody className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-(--fg) text-sm">
                          {account.display_name ?? '—'}
                        </p>
                        {account.handle_instagram && (
                          <p className="font-mono text-xs text-(--fg-muted)">
                            @{account.handle_instagram}
                          </p>
                        )}
                      </div>
                      <Badge tone={account.tier === 'deep' ? 'accent' : 'outline'} size="sm">
                        {account.tier}
                      </Badge>
                    </div>

                    {snap && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-(--border-subtle)">
                        {snap.estimated_engagement_rate != null && (
                          <MiniStat label="Engagement" value={`${(snap.estimated_engagement_rate * 100).toFixed(1)}%`} />
                        )}
                        {snap.posting_frequency_per_week != null && (
                          <MiniStat label="Posts/week" value={String(snap.posting_frequency_per_week)} />
                        )}
                        {snap.top_performing_tones && snap.top_performing_tones.length > 0 && (
                          <div className="col-span-2">
                            <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1">Top tones</p>
                            <div className="flex flex-wrap gap-1">
                              {snap.top_performing_tones.slice(0, 3).map((tone) => (
                                <span key={tone} className="rounded-full bg-(--surface-3) px-2 py-0.5 text-[11px] text-(--fg-muted)">
                                  {tone}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {snap.gaps_identified && snap.gaps_identified.length > 0 && (
                          <div className="col-span-2">
                            <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1">Gaps you can exploit</p>
                            <div className="space-y-1">
                              {snap.gaps_identified.slice(0, 2).map((gap, i) => (
                                <p key={i} className="text-xs text-(--success)">↗ {gap}</p>
                              ))}
                            </div>
                          </div>
                        )}
                        {snap.threats_identified && snap.threats_identified.length > 0 && (
                          <div className="col-span-2">
                            <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide mb-1">Threats to watch</p>
                            <div className="space-y-1">
                              {snap.threats_identified.slice(0, 2).map((threat, i) => (
                                <p key={i} className="text-xs text-(--danger)">⚠ {threat}</p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {!snap && (
                      <p className="text-xs text-(--fg-faint)">No extraction data yet.</p>
                    )}
                  </CardBody>
                </Card>
              )
            })}
          </div>

          <div className="text-right">
            <Link href={`/${slug}/competitors`} className="text-xs font-medium text-(--accent) hover:underline">
              Manage competitors →
            </Link>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 6 — Performance Patterns (Layer 6)
      ═══════════════════════════════════════════════════════════════ */}
      {(content_patterns.winners.length > 0 || content_patterns.losers.length > 0) && (
        <>
          <SectionHeader label="Layer 6" title="Performance Patterns" />

          {content_patterns.winners.length > 0 && (
            <Card>
              <CardHeader>
                <div><CardTitle>What's Working</CardTitle></div>
                <Badge tone="success" size="sm">{content_patterns.winners.length} pattern{content_patterns.winners.length > 1 ? 's' : ''}</Badge>
              </CardHeader>
              <CardBody className="p-0">
                <ul className="divide-y divide-(--border-subtle)">
                  {(content_patterns.winners as BrandContentPattern[]).map((p) => (
                    <PatternRow key={p.pattern_id} pattern={p} tone="success" />
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {content_patterns.losers.length > 0 && (
            <Card>
              <CardHeader>
                <div><CardTitle>What to Avoid</CardTitle></div>
                <Badge tone="danger" size="sm">{content_patterns.losers.length} pattern{content_patterns.losers.length > 1 ? 's' : ''}</Badge>
              </CardHeader>
              <CardBody className="p-0">
                <ul className="divide-y divide-(--border-subtle)">
                  {(content_patterns.losers as BrandContentPattern[]).map((p) => (
                    <PatternRow key={p.pattern_id} pattern={p} tone="danger" />
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {/* ── BrandDNA Completeness ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div><CardTitle>BrandDNA Completeness</CardTitle></div>
          <span className="font-mono text-lg font-semibold text-(--accent)">{brand.completeness_score}%</span>
        </CardHeader>
        <CardBody className="space-y-3">
          <Progress value={brand.completeness_score} />
          <p className="text-xs text-(--fg-muted)">
            A higher completeness score means more accurate content generation and tighter
            strategic targeting. Fill in missing fields from your profile to improve.
          </p>
          <div className="flex gap-2 flex-wrap">
            <LinkButton href={`/${slug}/profile`} variant="secondary" size="sm">
              Edit Profile
            </LinkButton>
            <LinkButton href={`/${slug}/snapshot`} variant="ghost" size="sm">
              View Full BrandDNA
            </LinkButton>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

// ── Sub-components (module-scoped — stable identity) ────────────────────────

function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="rounded-full bg-(--surface-3) px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-(--fg-faint)">
        {label}
      </span>
      <h2 className="text-base font-semibold text-(--fg)">{title}</h2>
      <div className="flex-1 h-px bg-(--border-subtle)" />
    </div>
  )
}

function InfoCard({ label, value, dir, accent }: { label: string; value: string; dir?: 'rtl' | 'ltr'; accent?: boolean }) {
  return (
    <div className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-(--fg-faint) mb-1">{label}</p>
      <p
        className={`text-sm font-semibold ${accent ? 'text-(--accent)' : 'text-(--fg)'}`}
        dir={dir}
      >
        {value}
      </p>
    </div>
  )
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-(--fg-muted) mb-1">{label}</p>
      <p className="font-display text-2xl font-semibold text-(--fg)">{value}</p>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-(--fg-faint) uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-(--fg)">{value}</p>
    </div>
  )
}

function BarRow({ label, value, color }: { label: string; value: number; color: string }) {
  const pctVal = value <= 1 ? Math.round(value * 100) : Math.round(value)
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-xs text-(--fg-muted) shrink-0">{label}</span>
      <div className="flex-1 rounded-full bg-(--surface-3) h-1.5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pctVal}%`, background: color }} />
      </div>
      <span className="w-8 text-xs text-(--fg-muted) text-right tabular-nums">{pctVal}%</span>
    </div>
  )
}

function PatternRow({ pattern, tone }: { pattern: BrandContentPattern; tone: 'success' | 'danger' }) {
  const trigger = PATTERN_TRIGGER_LABELS[pattern.trigger_signal] ?? pattern.trigger_signal
  const engRate = pattern.avg_engagement_rate != null
    ? `${(pattern.avg_engagement_rate * 100).toFixed(1)}%`
    : null
  return (
    <li className="flex items-start gap-4 px-5 py-3.5">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone === 'success' ? 'bg-(--success)' : 'bg-(--danger)'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-sm font-medium text-(--fg)">
            {pattern.content_type.replace(/_/g, ' ')}
          </span>
          {pattern.formula_used && (
            <span className="font-mono text-[11px] text-(--fg-faint)">{pattern.formula_used}</span>
          )}
          {pattern.register_used && (
            <Badge tone="outline" size="sm">{pattern.register_used}</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-(--fg-muted)">
          {trigger && <span>{trigger}</span>}
          {engRate && <span>avg {engRate} eng.</span>}
          <span>{pattern.sample_count} posts</span>
          <span>{Math.round(pattern.confidence * 100)}% confidence</span>
        </div>
      </div>
    </li>
  )
}
