'use client'

/**
 * Onboarding stepper — Seed → Extraction → Review.
 *
 *   Step 1  SeedForm          collect Instagram/Website/Maps + name + sector
 *   Step 2  ExtractionScreen  watch the 3-lane scrape progress live
 *   Step 3  ReviewForm        pre-filled review of every other field, submit → A03
 *
 * State the parent owns:
 *   • step                  1 | 2 | 3
 *   • brand_id, slug        set by Step 1
 *   • extraction_kicked_off Step 2 polls only when this is true
 */
import { useState } from 'react'
import { SeedForm } from './seed-form'
import { ExtractionScreen } from './extraction-screen'
import { ReviewForm, type ReviewFields } from './review-form'

/** Field values from Step 1 (Sources). Persisted so going back restores them. */
interface SeedFields {
  instagram_handle: string
  website_url: string
  place_search_name: string
  city_hint: string
}

interface StepperState {
  step: 1 | 2 | 3
  /** Highest step the user has ever reached. Drives "is this step clickable
   *  in the indicator". Going back doesn't lower it — once you've seen Step 3
   *  you can always jump to it. */
  reached: 1 | 2 | 3
  brand_id: string | null
  slug: string | null
  extraction_kicked_off: boolean
  has_sources: boolean
  trigger_error: string | null
  /** Persisted seed-form field values — restored when user goes back to Step 1. */
  seedFields: SeedFields
  /** Persisted review-form field values — restored when user goes back to Step 3. */
  reviewFields: ReviewFields
}

export interface OnboardingResume {
  /** Brand row already exists; resume on this step instead of Step 1. */
  brand_id: string
  slug: string
  step: 2 | 3
}

export function OnboardingStepper({ resume }: { resume?: OnboardingResume | null }) {
  const emptySeedFields: SeedFields = { instagram_handle: '', website_url: '', place_search_name: '', city_hint: '' }
  const emptyReviewFields: ReviewFields = {
    // Section A — confirm
    brandNameAr: '', brandNameEn: '',
    sector: '', cityPrimary: '',
    dialect: '', primaryColor: '#10b981',
    igLogoUrl: null,
    brandDifferentiator: '', primaryAudienceGender: '', ramadanRelevance: '',
    // Q01
    nameMeaning: '',
    // Q02
    productsList: '',
    products: [],
    // Q03
    brandAgeBucket: '', foundingStory: '',
    // Q04
    platforms: [], social: '',
    // Q05
    brandWords: [], brandWordCustom: '',
    // Q06
    brandRefs: [],
    // Q07
    lifestyle: '', custDesc: '',
    // Q08
    pricePosition: '', priceNums: '',
    // Q09
    emotions: [], custQuote: '',
    // Q10
    archetypeFamily: '', captionEx: '',
    // Q11
    music: '', musicLink: '',
    // Q12
    restrictions: [], customRestriction: '',
    // Q13
    bilingual: '', tagline: '',
    // Q14
    occasionsRanked: [], customOccasion: '',
    // Q15
    competitorNames: '',
    // Q16 — ALWAYS ASK
    intent: '', metric: '',
    // Q16b — ALWAYS ASK
    religious: '',
    // Q17
    problems: [],
    // Q19
    vision: '', visionText: '',
    // Q20
    anything: '',
    // Business events
    businessEvents: [],
  }

  const [state, setState] = useState<StepperState>(() =>
    resume
      ? {
          step: resume.step,
          reached: resume.step,
          brand_id: resume.brand_id,
          slug: resume.slug,
          // If we're resuming on Step 2, treat extraction as already running
          // (A06 may still be in flight or already done — the screen polls
          // the status route either way). For Step 3, sources are present
          // by definition.
          extraction_kicked_off: resume.step === 2,
          has_sources: true,
          trigger_error: null,
          seedFields: emptySeedFields,
          reviewFields: emptyReviewFields,
        }
      : {
          step: 1, reached: 1, brand_id: null, slug: null,
          extraction_kicked_off: false, has_sources: false, trigger_error: null,
          seedFields: emptySeedFields,
          reviewFields: emptyReviewFields,
        },
  )

  // Navigate to a step the user has already reached. No-op for steps not yet
  // unlocked (avoids clicks on Step 3 before the user has saved Step 1).
  function gotoStep(target: 1 | 2 | 3) {
    setState((s) => (target <= s.reached ? { ...s, step: target } : s))
  }

  // True only for the FIRST visit to Step 2 — the auto-advance to Step 3 fires
  // once and never again. Without this, every back-nav to Step 2 would bounce
  // forward as soon as the status poll returned 'extraction_done'.
  const firstVisitToExtraction = state.step === 2 && state.reached === 2

  return (
    <div className="space-y-5">
      <StepIndicator current={state.step} reached={state.reached} onNavigate={gotoStep} />

      {state.step === 1 && (
        <SeedForm
          savedValues={state.seedFields}
          onFieldChange={(fields) => setState((s) => ({ ...s, seedFields: fields }))}
          onComplete={({ brand_id, slug, extraction_kicked_off, has_sources, trigger_error }) => {
            const nextStep: 1 | 2 | 3 = has_sources ? 2 : 3
            setState((s) => ({
              ...s,
              step: nextStep,
              // reached only goes forward.
              reached: (Math.max(s.reached, nextStep) as 1 | 2 | 3),
              brand_id, slug, extraction_kicked_off, has_sources, trigger_error,
            }))
          }}
        />
      )}

      {state.step === 2 && state.brand_id && (
        <ExtractionScreen
          brand_id={state.brand_id}
          extractionKickedOff={state.extraction_kicked_off}
          autoAdvance={firstVisitToExtraction}
          triggerError={state.trigger_error}
          onComplete={() => setState((s) => ({
            ...s, step: 3, reached: (Math.max(s.reached, 3) as 1 | 2 | 3),
          }))}
          onBack={() => setState((s) => ({ ...s, step: 1 }))}
        />
      )}

      {state.step === 3 && state.brand_id && (
        <ReviewForm
          brand_id={state.brand_id}
          savedFields={state.reviewFields}
          onFieldChange={(fields) => setState((s) => ({ ...s, reviewFields: fields }))}
          onBack={() => setState((s) => ({ ...s, step: state.has_sources ? 2 : 1 }))}
        />
      )}
    </div>
  )
}

function StepIndicator({
  current, reached, onNavigate,
}: {
  current: 1 | 2 | 3
  reached: 1 | 2 | 3
  onNavigate: (target: 1 | 2 | 3) => void
}) {
  const labels = ['Sources', 'Auto-detect', 'Review']
  return (
    <ol className="flex items-center gap-2">
      {labels.map((label, i) => {
        const num = (i + 1) as 1 | 2 | 3
        const active = num === current
        const done = num < current
        const clickable = num <= reached && num !== current
        return (
          <li key={label} className="flex flex-1 items-center gap-3">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onNavigate(num)}
              title={clickable ? `Go to step ${num}: ${label}` : undefined}
              className={
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ' +
                (active
                  ? 'bg-(--accent) text-(--accent-fg)'
                  : done
                    ? 'bg-(--success)/15 text-(--success) hover:bg-(--success)/25 cursor-pointer'
                    : clickable
                      ? 'bg-(--surface-3) text-(--fg) hover:bg-(--surface-4) cursor-pointer'
                      : 'bg-(--surface-3) text-(--fg-faint) cursor-not-allowed')
              }
            >
              {done ? '✓' : num}
            </button>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onNavigate(num)}
              className={
                'text-left text-xs ' +
                (active
                  ? 'font-semibold text-(--fg)'
                  : done
                    ? 'text-(--fg-muted) hover:text-(--fg) cursor-pointer'
                    : clickable
                      ? 'text-(--fg) hover:text-(--accent) cursor-pointer'
                      : 'text-(--fg-faint) cursor-not-allowed')
              }
            >
              {label}
            </button>
            {i < labels.length - 1 && (
              <span className={'h-px flex-1 ' + (done ? 'bg-(--success)/40' : 'bg-(--border-subtle)')} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
