'use client'

/**
 * Step 1 — Sources only.
 *
 * Per UX rule: Step 1 should ask for nothing the extraction can probably tell
 * us. Brand name, sector, and city all get pre-filled in Step 3 from the
 * scraping payload (IG full_name, business_category, Places types/address).
 * Step 1's job is the bare minimum to kick off A06: at least one source URL.
 *
 * Optional: instagram_handle, website_url, place_search_name (+ city_hint
 * to help disambiguate Places lookups).
 *
 * If all sources are blank we skip extraction and jump to Step 3 — the user
 * fills everything by hand there.
 *
 * Fields are fully controlled and initialised from `savedValues` so that
 * going back from Step 2 → Step 1 restores whatever the user typed.
 */
import { useState, useTransition } from 'react'
import { Button } from '@repo/ui/button'
import { Field, Input, Select } from '@repo/ui/input'
import { submitSeed, type SeedResult } from '@/app/actions/onboarding-v2'

const SAUDI_CITIES = ['Riyadh', 'Jeddah', 'Dammam', 'Mecca', 'Medina', 'Khobar', 'Tabuk', 'Abha', 'Other'] as const

/** Mirror of StepperState.seedFields — kept in sync via onFieldChange. */
export interface SeedFieldValues {
  instagram_handle: string
  website_url: string
  place_search_name: string
  city_hint: string
}

export interface SeedFormProps {
  /** Field values previously saved by the stepper — restores inputs on back-nav. */
  savedValues: SeedFieldValues
  /** Called on every field change so the parent can persist the values. */
  onFieldChange: (fields: SeedFieldValues) => void
  onComplete: (result: {
    brand_id: string
    slug: string
    extraction_kicked_off: boolean
    has_sources: boolean
    trigger_error: string | null
  }) => void
}

export function SeedForm({ savedValues, onFieldChange, onComplete }: SeedFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Controlled field state — initialised from savedValues so back-nav restores.
  const [fields, setFields] = useState<SeedFieldValues>(savedValues)

  function updateField(key: keyof SeedFieldValues, value: string) {
    const next = { ...fields, [key]: value }
    setFields(next)
    onFieldChange(next)
  }

  const sourceCount =
    (fields.instagram_handle.trim() ? 1 : 0) +
    (fields.website_url.trim() ? 1 : 0) +
    (fields.place_search_name.trim() ? 1 : 0)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const r: SeedResult = await submitSeed(fd)
      if (!r.ok || !r.brand_id || !r.slug) {
        setError(r.error ?? 'Submission failed')
        return
      }
      onComplete({
        brand_id: r.brand_id,
        slug: r.slug,
        extraction_kicked_off: !!r.extraction_kicked_off,
        has_sources: !!r.has_sources,
        trigger_error: r.trigger_error ?? null,
      })
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <header className="space-y-1">
        <h2 className="font-display text-lg font-semibold text-(--fg)">Tell us where to look</h2>
        <p className="text-sm text-(--fg-muted)">
          Drop your handles and we&apos;ll auto-detect everything we can — name, sector, voice,
          colours, audience signals — so the next step is mostly review, not typing.
        </p>
      </header>

      <section className="space-y-4 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-3) p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-(--fg)">Where can we find you online?</h3>
            <p className="text-xs text-(--fg-muted)">
              The more sources, the better the auto-fill. Even one is enough to get started.
            </p>
          </div>
          <span className={
            'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ' +
            (sourceCount >= 2
              ? 'bg-(--success)/15 text-(--success)'
              : sourceCount === 1
                ? 'bg-(--accent-soft) text-(--accent)'
                : 'bg-(--warning)/10 text-(--warning)')
          }>
            {sourceCount}/3 sources
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Instagram handle" hint="@handle, instagram.com/handle, or full URL.">
            <div className="flex items-center gap-2">
              <span className="font-mono text-(--fg-muted)">@</span>
              <Input
                name="instagram_handle"
                dir="ltr"
                placeholder="kudu  ·  @kudu  ·  instagram.com/kudu"
                value={fields.instagram_handle}
                onChange={(e) => updateField('instagram_handle', e.currentTarget.value)}
              />
            </div>
          </Field>

          <Field label="Website" hint="Even a holding page is fine.">
            <Input
              name="website_url"
              dir="ltr"
              type="url"
              placeholder="https://yourbrand.sa"
              value={fields.website_url}
              onChange={(e) => updateField('website_url', e.currentTarget.value)}
            />
          </Field>

          <Field
            label="Business name on Google Maps"
            hint="Used to find your reviews + category. Leave blank if you're online-only."
          >
            <Input
              name="place_search_name"
              dir="auto"
              value={fields.place_search_name}
              onChange={(e) => updateField('place_search_name', e.currentTarget.value)}
            />
          </Field>

          <Field
            label="City (helps Maps lookup)"
            hint="Optional — narrows the Google Maps search if there are multiple matches."
          >
            <Select
              name="city_hint"
              value={fields.city_hint}
              onChange={(e) => updateField('city_hint', e.currentTarget.value)}
            >
              <option value="">— skip —</option>
              {SAUDI_CITIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>

        {sourceCount === 0 && (
          <p className="rounded-(--r-sm) border border-(--warning)/30 bg-(--warning)/10 px-3 py-2 text-xs text-(--warning)">
            No sources yet — you can still continue and fill everything manually in the next step.
          </p>
        )}
      </section>

      {error && (
        <p
          className="rounded-(--r-sm) border border-(--danger)/30 bg-(--danger)/10 px-3 py-2 text-sm text-(--danger)"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-(--border-subtle) pt-5">
        <p className="text-xs text-(--fg-muted)">Step 1 of 3 · ~30 seconds</p>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : sourceCount > 0 ? 'Start auto-detection →' : 'Continue →'}
        </Button>
      </div>
    </form>
  )
}
