/**
 * Post-signup landing.
 *   - if the user already owns a brand → redirect to that dashboard
 *   - otherwise show the 15-question form (server action creates the brand)
 *
 * Handles the case where Supabase OAuth/email-confirm dropped the user
 * here without a brand profile yet.
 */
import { redirect } from 'next/navigation'
import { requireUser, getFirstBrandForCurrentUser } from '@repo/auth/server'
import { OnboardingStepper } from './stepper'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { getServerT } from '@/lib/i18n-server'

// Never serve a cached render — this page makes a routing decision based on
// live DB state (onboarding_status). A stale cache would send a completed
// brand back to the form on every fresh login.
export const dynamic = 'force-dynamic'

export default async function OnboardingStartPage() {
  await requireUser({ next: '/onboarding-start' })

  // RLS-respecting lookup — user-scoped client. Three cases:
  //   1. brand exists AND onboarding is finished     → dashboard
  //   2. brand exists AND onboarding is mid-flow     → resume the stepper
  //                                                    on the correct step
  //   3. no brand yet                                → show Step 1 (seed form)
  const existing = await getFirstBrandForCurrentUser() as
    | { client_slug: string | null; brand_id: string; onboarding_status: string | null; total_calendars_generated: number; completeness_score: number }
    | null

  // A brand is considered "done" if EITHER of these is true:
  //   • onboarding_status = 'complete'   — Memory Controller set this after A03 finished
  //   • total_calendars_generated > 0    — legacy/seed brand already active
  //
  // completeness_score is intentionally NOT checked here — a partial score (10, 42, 75)
  // is written during extraction and DOES NOT mean the brand is done. Using it here
  // caused a redirect loop: this page sent the user to /{slug}/dashboard, but the
  // layout gate (which correctly ignores completeness_score) sent them straight back.
  const isOnboardingDone = !!existing && (
    existing.onboarding_status === 'complete' ||
    existing.total_calendars_generated > 0
  )
  if (isOnboardingDone) {
    // client_slug should always be set at this point, but guard defensively.
    redirect(existing!.client_slug ? `/${existing!.client_slug}/dashboard` : '/')
  }

  // Pick the step to resume on based on status.
  //   • extraction_pending → Step 2 (still scraping or just kicked off)
  //   • extraction_done | extraction_unavailable → Step 3 (review)
  //   • anything else / no brand → Step 1
  let resume: { brand_id: string; slug: string; step: 2 | 3 } | null = null
  if (existing?.brand_id && existing.client_slug) {
    if (existing.onboarding_status === 'extraction_pending') {
      resume = { brand_id: existing.brand_id, slug: existing.client_slug, step: 2 }
    } else if (
      existing.onboarding_status === 'extraction_done' ||
      existing.onboarding_status === 'extraction_unavailable'
    ) {
      resume = { brand_id: existing.brand_id, slug: existing.client_slug, step: 3 }
    }
    // submitted / scraping / dna_building / memory_writing → A03 is running.
    // Send them to the processing screen so they don't restart onboarding.
    else if (
      existing.onboarding_status === 'submitted' ||
      existing.onboarding_status === 'scraping' ||
      existing.onboarding_status === 'dna_building' ||
      existing.onboarding_status === 'memory_writing'
    ) {
      redirect(`/${existing.client_slug}/processing`)
    }
  }

  const { t } = await getServerT()

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        eyebrow={t('onboarding.eyebrow')}
        title={t('onboarding.title')}
        subtitle={t('onboarding.subtitle')}
        action={<Badge tone="accent" dot>{t('onboarding.topBadge')}</Badge>}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('onboarding.fifteenQuestions')}</CardTitle>
            <CardDescription>{t('onboarding.criticalNote')}</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          <OnboardingStepper resume={resume} />
        </CardBody>
      </Card>
    </main>
  )
}
