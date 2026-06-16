/**
 * /[slug]/snapshot — the public-facing Brand Snapshot Card.
 *
 * Renders the FULL BrandDNA (Doc §8.4 screen 4) using one canonical
 * `getBrandDnaBySlug()` query. Replaces the previous version that only read
 * 2 of the 11 BrandDNA tables.
 *
 * What's shown:
 *   1. Header strip — logo, brand name (Arabic), sector / city / dialect
 *   2. Hero stats — completeness, dialect status, current confidence mode
 *   3. Voice & tone — top tones from snapshot_data + anti-attributes
 *   4. Visual style — color palette swatches + style descriptor
 *   5. Audience — gender mix breakdown
 *   6. Channels — Instagram followers + engagement
 *   7. Saudi occasions — relevance per occasion
 *   8. Evidence summary — chips per confidence state, link to /profile for details
 *
 * RLS path: getUserScopedClient() — RLS guarantees the user only sees their
 * own brand. requireBrandAccess() above already verified ownership.
 */
import { notFound } from 'next/navigation'
import Image from 'next/image'
import { brandDnaQ } from '@repo/db'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { ARCHETYPE_DEFINITIONS, type Archetype } from '@repo/core'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { LinkButton } from '@repo/ui/button'
import { Progress } from '@repo/ui/progress'
import { BrandDirectionCard } from '@repo/ui/admin/brand-direction-card'
import { getServerT } from '@/lib/i18n-server'
import { StrategyReviewCta } from './strategy-cta'

export const dynamic = 'force-dynamic'

const OCCASION_FIELDS = [
  { key: 'ramadan_relevance',      label: 'Ramadan' },
  { key: 'eid_fitr_relevance',     label: 'Eid Al-Fitr' },
  { key: 'eid_adha_relevance',     label: 'Eid Al-Adha' },
  { key: 'national_day_relevance', label: 'Saudi National Day' },
  { key: 'founding_day_relevance', label: 'Founding Day' },
] as const

export default async function SnapshotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { t } = await getServerT()
  const brandHeader = await getBrandForCurrentUser(slug)
  if (!brandHeader) notFound()

  const userClient = await getUserScopedClient()
  const dna = await brandDnaQ.getBrandDna(brandHeader.brand_id, userClient)
  if (!dna) notFound()

  const { brand, audience, visual_style, channels, evidence, latest_snapshot, current_confidence } = dna

  // Surface dialect_confirmed flag from the snapshot OR derive it from evidence.
  const snapshotData = (latest_snapshot?.snapshot_data ?? {}) as Record<string, unknown>
  const dialectConfirmed =
    typeof snapshotData.dialect_confirmed === 'boolean'
      ? (snapshotData.dialect_confirmed as boolean)
      : evidence.bundles.some(
          (b) =>
            b.field_name === 'arabic_dialect' &&
            (b.field_confidence === 'explicitly_confirmed' || b.field_confidence === 'inferred_high'),
        )

  const completeness = brand.completeness_score
  const tones = (snapshotData.tones as string[] | undefined) ?? []
  const visualStyleText =
    visual_style?.style_descriptor ?? (snapshotData.visual_style as string | undefined) ?? null

  // Calibration period — spec §3.3: first 90 days are explicit with the client
  const isCalibration = (brand as unknown as Record<string, unknown>).is_calibration_period === true
  const calibEndsAt   = (brand as unknown as Record<string, unknown>).calibration_ends_at as string | null
  const now           = new Date()
  const calibDaysLeft = calibEndsAt
    ? Math.max(0, Math.ceil((new Date(calibEndsAt).getTime() - now.getTime()) / 86_400_000))
    : null

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t('snapshot.eyebrow')}
        title={t('snapshot.title')}
        subtitle={t('snapshot.subtitle')}
        action={<LinkButton href={`/${slug}/calendar`}>{t('common.openCalendarArrow')}</LinkButton>}
      />

      {/* ── Strategy review CTA — shown once after A03 completes, until approved ── */}
      {(brand.strategy_version ?? 0) === 0 && (
        <StrategyReviewCta slug={slug} brandId={brand.brand_id} />
      )}

      {/* ── Calibration period banner (spec §3.3) ───────────────────── */}
      {isCalibration && (
        <div className="rounded-(--r-lg) border border-amber-500/20 bg-amber-500/8 px-4 py-3 flex items-start gap-3">
          <span className="mt-0.5 text-amber-400 text-base shrink-0">⏳</span>
          <div className="min-w-0">
            <p className="font-semibold text-(--fg) text-sm">
              الفترة التجريبية
              {calibDaysLeft !== null && (
                <span className="font-normal text-amber-400 ms-1">— {calibDaysLeft} يوم متبقي</span>
              )}
            </p>
            <p className="text-(--fg-muted) text-xs mt-0.5 leading-relaxed">
              أول 90 يوم هي فترة المعايرة. النظام يتعلّم من أداء المحتوى ويُحسّن التوصيات تدريجياً مع تراكم البيانات.
            </p>
            <p className="text-amber-400/70 text-[11px] mt-1">
              Calibration period — recommendations sharpen as performance data accumulates.
            </p>
          </div>
        </div>
      )}

      {/* ── 1. Header strip — logo + identity ───────────────────────────── */}
      <Card>
        <CardBody className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <BrandLogo url={brand.logo_url} brandNameAr={brand.brand_name_ar} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 dir="rtl" className="font-display text-2xl font-semibold text-(--fg)">
                {brand.brand_name_ar}
              </h2>
              {brand.brand_name_en && (
                <span className="text-sm text-(--fg-muted)">{brand.brand_name_en}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="accent">{brand.sector}</Badge>
              {brand.city_primary && <Badge tone="outline">{brand.city_primary}</Badge>}
              {brand.arabic_dialect && (
                <Badge tone={dialectConfirmed ? 'success' : 'warning'} dot>
                  {brand.arabic_dialect}
                  {dialectConfirmed ? ' ✓' : ' ?'}
                </Badge>
              )}
              {current_confidence?.mode && <Badge tone="info">Mode: {current_confidence.mode}</Badge>}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── v2: Creative direction (archetype × stage × intent + method profile) ── */}
      <BrandDirectionCard
        archetype_primary={brand.archetype_primary as string | null}
        archetype_secondary={brand.archetype_secondary as string | null}
        lifecycle_stage={brand.lifecycle_stage as string | null}
        intent_state={brand.intent_state as string | null}
        method_profile={dna.method_profile}
        archetype_blurb={
          brand.archetype_primary
            ? ARCHETYPE_DEFINITIONS[brand.archetype_primary as Archetype]?.blurb_en
            : undefined
        }
      />

      {/* ── 2. Hero stats: completeness, dialect, evidence summary ──────── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div><CardTitle>{t('snapshot.dialectCard')}</CardTitle></div>
            <Badge tone={dialectConfirmed ? 'success' : 'warning'} dot>
              {dialectConfirmed ? t('snapshot.dialectConfirmed') : t('snapshot.dialectNeedsConfirm')}
            </Badge>
          </CardHeader>
          <CardBody>
            <div className="font-display text-3xl font-semibold tracking-tight text-(--fg)">
              {brand.arabic_dialect ?? '—'}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-(--fg-muted)">
              {t('snapshot.dialectExplanation')}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>{t('snapshot.completenessCard')}</CardTitle></div></CardHeader>
          <CardBody className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-semibold tracking-tight text-(--accent)">
                {completeness}
              </span>
              <span className="text-sm text-(--fg-muted)">{t('snapshot.outOf100')}</span>
            </div>
            <Progress value={completeness} tone="accent" />
            <p className="text-xs text-(--fg-muted)">{t('snapshot.readyHint')}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Evidence summary</CardTitle></div></CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <ConfidenceChip count={evidence.summary.by_state.explicitly_confirmed} label="confirmed" tone="success" />
              <ConfidenceChip count={evidence.summary.by_state.inferred_high}       label="high"      tone="success" />
              <ConfidenceChip count={evidence.summary.by_state.inferred_medium}     label="medium"    tone="info" />
              <ConfidenceChip count={evidence.summary.by_state.inferred_low}        label="low"       tone="warning" />
              <ConfidenceChip count={evidence.summary.by_state.deprecated}          label="stale"     tone="outline" />
            </div>
            <p className="mt-3 text-xs text-(--fg-muted)">
              {evidence.summary.total} of 10 critical fields evaluated.
              {' '}
              <a className="font-medium text-(--accent) hover:underline" href={`/${slug}/profile`}>
                See per-field detail →
              </a>
            </p>
          </CardBody>
        </Card>
      </div>

      {/* ── 3. Voice + Visual style ─────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>{t('snapshot.tonesCard')}</CardTitle></div></CardHeader>
          <CardBody className="space-y-4">
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-(--fg-muted)">Top tones</div>
              <div className="flex flex-wrap gap-2">
                {tones.length > 0
                  ? tones.map((tone) => <Badge key={tone} tone="accent">{tone}</Badge>)
                  : <span className="text-sm text-(--fg-faint)">No tones detected yet</span>}
              </div>
            </div>
            {(() => {
              // tone_anti_attribute_ids is added by migration 0014 but isn't yet
              // in the hand-maintained BrandProfile type. Read it via a record cast.
              const anti = (brand as unknown as { tone_anti_attribute_ids?: string[] | null }).tone_anti_attribute_ids
              if (!anti || anti.length === 0) return null
              return (
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-(--fg-muted)">Avoid these</div>
                  <div className="flex flex-wrap gap-2">
                    {anti.map((tone: string) => (
                      <Badge key={tone} tone="danger">{tone}</Badge>
                    ))}
                  </div>
                </div>
              )
            })()}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>{t('snapshot.visualAndAudienceCard')}</CardTitle></div></CardHeader>
          <CardBody className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-(--fg-muted)">Visual style</div>
              <p className="mt-1 text-sm leading-relaxed text-(--fg)">
                {visualStyleText ?? <span className="text-(--fg-faint)">Not yet inferred</span>}
              </p>
            </div>
            <ColorPalette
              palette={visual_style?.color_palette ?? null}
              primary={brand.primary_color_hex ?? null}
            />
            <div>
              <div className="text-xs uppercase tracking-wide text-(--fg-muted)">Differentiator</div>
              <p className="mt-1 text-sm leading-relaxed text-(--fg)">
                {brand.brand_differentiator ?? '—'}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* ── 4. Audience + channels ──────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle>Audience</CardTitle></div></CardHeader>
          <CardBody className="space-y-3 text-sm">
            {audience ? (
              <>
                <GenderMix mix={audience.gender_mix ?? null} />
                {audience.description_ar && (
                  <p dir="rtl" className="text-(--fg)">{audience.description_ar}</p>
                )}
                <Row label="Language preference" value={audience.language_preference ?? '—'} />
              </>
            ) : (
              <p className="text-(--fg-faint)">No audience profile yet — fill in via onboarding.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div><CardTitle>Channels</CardTitle></div></CardHeader>
          <CardBody className="space-y-3 text-sm">
            {channels.length === 0 ? (
              <p className="text-(--fg-faint)">No channels connected.</p>
            ) : (
              <ul className="space-y-2">
                {channels.map((c) => (
                  <li key={c.channel_id} className="flex items-center justify-between border-b border-(--border-subtle) pb-2 last:border-0 last:pb-0">
                    <div>
                      <div className="font-medium text-(--fg)">{c.channel}</div>
                      {c.handle && <div className="text-xs text-(--fg-muted)">@{c.handle}</div>}
                    </div>
                    <div className="text-end text-xs">
                      {c.followers_count !== null && <div className="text-(--fg)">{formatNumber(c.followers_count)} followers</div>}
                      {c.engagement_rate !== null && (
                        <div className="text-(--fg-muted)">{(c.engagement_rate * 100).toFixed(1)}% engagement</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── 5. Saudi occasions ──────────────────────────────────────────── */}
      <Card>
        <CardHeader><div><CardTitle>Saudi occasion priorities</CardTitle></div></CardHeader>
        <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {OCCASION_FIELDS.map((o) => {
            const val = (brand as unknown as Record<string, string | null>)[o.key]
            return (
              <div key={o.key} className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) px-3 py-2">
                <div className="text-xs text-(--fg-muted)">{o.label}</div>
                <div className="mt-0.5 text-sm font-medium text-(--fg)">{val ?? '—'}</div>
              </div>
            )
          })}
        </CardBody>
      </Card>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function BrandLogo({ url, brandNameAr }: { url: string | null; brandNameAr: string }) {
  if (!url) {
    return (
      <div
        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) font-display text-2xl text-(--fg-muted)"
        aria-label="No logo"
      >
        {brandNameAr.slice(0, 1)}
      </div>
    )
  }
  // Use plain <img> for external Supabase Storage URLs to avoid Next image-domain config friction.
  // The bucket is public so caching is fine without a signed URL.
  return (
    <Image
      src={url}
      alt={brandNameAr}
      width={80}
      height={80}
      unoptimized
      className="h-20 w-20 shrink-0 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) object-contain"
    />
  )
}

function ConfidenceChip({ count, label, tone }: { count: number; label: string; tone: 'success' | 'warning' | 'info' | 'outline' }) {
  if (count === 0) return null
  return <Badge tone={tone} size="sm">{count} {label}</Badge>
}

function ColorPalette({ palette, primary }: { palette: string[] | null; primary: string | null }) {
  const colors = palette && palette.length > 0 ? palette : primary ? [primary] : []
  if (colors.length === 0) return null
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wide text-(--fg-muted)">Color palette</div>
      <div className="flex flex-wrap gap-2">
        {colors.map((hex) => (
          <div key={hex} className="flex items-center gap-1.5 rounded-(--r-sm) border border-(--border-subtle) bg-(--surface-2) px-2 py-1 text-xs">
            <span className="h-4 w-4 rounded-sm border border-(--border-subtle)" style={{ backgroundColor: hex }} aria-hidden />
            <span className="font-mono text-(--fg-muted)">{hex.toUpperCase()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GenderMix({ mix }: { mix: { female?: number; male?: number } | null }) {
  if (!mix) return <p className="text-(--fg-faint)">Not set</p>
  const female = Math.round((mix.female ?? 0) * (mix.female && mix.female > 1 ? 1 : 100))
  const male = Math.round((mix.male ?? 0) * (mix.male && mix.male > 1 ? 1 : 100))
  // gender_mix may be stored as either {female:0.6, male:0.4} OR {female:60, male:40}. Normalise.
  const f = mix.female && mix.female <= 1 ? Math.round(mix.female * 100) : Math.round(mix.female ?? female)
  const m = mix.male && mix.male <= 1 ? Math.round(mix.male * 100) : Math.round(mix.male ?? male)
  return (
    <div>
      <div className="mb-1.5 text-xs uppercase tracking-wide text-(--fg-muted)">Gender mix</div>
      <div className="flex h-6 overflow-hidden rounded-(--r-sm) border border-(--border-subtle)">
        <div className="bg-(--accent)/70" style={{ width: `${f}%` }} title={`Female ${f}%`} />
        <div className="bg-(--info)/70" style={{ width: `${m}%` }} title={`Male ${m}%`} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-(--fg-muted)">
        <span>♀ {f}%</span>
        <span>♂ {m}%</span>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-(--fg-muted)">{label}</span>
      <span className="font-medium text-(--fg)">{value}</span>
    </div>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
