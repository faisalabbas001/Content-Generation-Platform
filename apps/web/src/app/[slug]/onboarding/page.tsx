/**
 * /[slug]/onboarding — DEPRECATED.
 *
 * This was the old v6 20-question single-page form.
 * The real onboarding is at /onboarding-start (3-stage: seed → extraction → review).
 *
 * Anyone hitting this URL is redirected to the correct flow.
 */
import { redirect } from 'next/navigation'
import { getBrandForCurrentUser } from '@repo/auth/server'

export default async function DeprecatedOnboardingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const brand = await getBrandForCurrentUser(slug)

  // If brand is complete, send to dashboard
  if (brand && (brand as unknown as Record<string, unknown>).onboarding_status === 'complete') {
    redirect(`/${slug}/dashboard`)
  }

  // If brand is mid-pipeline, send to processing
  const midPipeline = ['submitted', 'scraping', 'dna_building', 'memory_writing']
  if (brand && midPipeline.includes(String((brand as unknown as Record<string, unknown>).onboarding_status ?? ''))) {
    redirect(`/${slug}/processing`)
  }

  // Otherwise send to the real onboarding start
  redirect('/onboarding-start')
}
