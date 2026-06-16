/**
 * /[slug]/processing — the loading screen shown while N8N-A03 runs.
 *
 * Renders a server-rendered shell + a client-side <ProcessingTracker /> that:
 *   - subscribes to brand_snapshots realtime updates for this brand
 *   - shows step-by-step progress (form → scraping → COO → memory → snapshot)
 *   - auto-redirects to /[slug]/snapshot when the FULL snapshot lands
 *   - shows a 10-min timeout banner if nothing arrives (Doc §8.4)
 *
 * Auth: layout already enforces requireBrandAccess(slug). We re-fetch the
 * brand row server-side so we can pass brand_id + initial state to the
 * client component (avoids a client round-trip for the lookup).
 */
import { notFound } from 'next/navigation'
import { PageHeader } from '@repo/ui/page-header'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { adminClient } from '@repo/db'
import { snapshotsQ } from '@repo/db'
import { getServerT } from '@/lib/i18n-server'
import { ProcessingTracker } from './tracker'

export const dynamic = 'force-dynamic'

export default async function ProcessingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { t } = await getServerT()

  const brand = await getBrandForCurrentUser(slug)
  if (!brand) notFound()

  const brandRow = brand as unknown as {
    brand_id: string
    sector?: string | null
    arabic_dialect?: string | null
    instagram_handle?: string | null
    website_url?: string | null
    onboarding_status?: string | null
  }

  // Detect whether this brand has real social history.
  // data_richness=form_only → no scraper sources → no social history.
  const hasNoSocialHistory = !brandRow.instagram_handle && !brandRow.website_url

  // Load sector baseline so the processing screen can show the client
  // "what works for brands like you" while the pipeline runs (spec: new brands
  // are guided by sector defaults during calibration).
  let sectorBaseline: {
    recommended_content_mix: Record<string, number>
    top_performing_tones: string[]
    worst_performing_tones: string[]
    occasion_insights: Record<string, unknown>
    confidence_benchmarks: Record<string, unknown>
  } | null = null

  if (brandRow.sector) {
    const db = adminClient()
    const dialect = brandRow.arabic_dialect ?? 'MSA_accessible'
    const { data: exact } = await db
      .from('sector_baselines')
      .select('recommended_content_mix, top_performing_tones, worst_performing_tones, occasion_insights, confidence_benchmarks')
      .eq('sector' as never, brandRow.sector)
      .eq('dialect' as never, dialect)
      .maybeSingle()
    const { data: fallback } = !exact ? await db
      .from('sector_baselines')
      .select('recommended_content_mix, top_performing_tones, worst_performing_tones, occasion_insights, confidence_benchmarks')
      .eq('sector' as never, brandRow.sector)
      .eq('dialect' as never, 'MSA_accessible')
      .maybeSingle() : { data: null }
    const row = (exact ?? fallback) as Record<string, unknown> | null
    if (row) {
      sectorBaseline = {
        recommended_content_mix: (row.recommended_content_mix as Record<string, number>) ?? {},
        top_performing_tones:    (row.top_performing_tones as string[]) ?? [],
        worst_performing_tones:  (row.worst_performing_tones as string[]) ?? [],
        occasion_insights:       (row.occasion_insights as Record<string, unknown>) ?? {},
        confidence_benchmarks:   (row.confidence_benchmarks as Record<string, unknown>) ?? {},
      }
    }
  }

  // Initial snapshot — server-rendered so the page is meaningful even before
  // the realtime channel connects.
  const userClient = await getUserScopedClient()
  const initialSnapshot = await snapshotsQ.getLatestSnapshot(brand.brand_id, userClient).catch(() => null)
  const initialIsComplete = initialSnapshot ? !initialSnapshot.is_partial : false

  return (
    <div>
      <PageHeader
        eyebrow={t('processing.eyebrow')}
        title={t('processing.title')}
        subtitle={t('processing.subtitle')}
      />

      <ProcessingTracker
        slug={slug}
        brandId={brand.brand_id}
        initialIsComplete={initialIsComplete}
        initialSnapshotData={(initialSnapshot?.snapshot_data ?? null) as Record<string, unknown> | null}
        initialOnboardingStatus={brandRow.onboarding_status ?? null}
        hasNoSocialHistory={hasNoSocialHistory}
        sector={brandRow.sector ?? null}
        sectorBaseline={sectorBaseline}
      />
    </div>
  )
}