'use client'

import { useState, useTransition } from 'react'
import { setCalendarIntentOverride } from './actions'

const INTENTS = [
  { v: 'launch',  label: 'Launch',  labelAr: 'إطلاق',   hint: 'Establish presence' },
  { v: 'grow',    label: 'Grow',    labelAr: 'نمو',     hint: 'Expand reach' },
  { v: 'defend',  label: 'Defend',  labelAr: 'تعزيز',   hint: 'Protect position' },
  { v: 'harvest', label: 'Harvest', labelAr: 'تحويل',   hint: 'Drive conversions' },
  { v: 'recover', label: 'Recover', labelAr: 'استعادة', hint: 'Re-engage audience' },
] as const

type IntentValue = typeof INTENTS[number]['v']

interface Props {
  calendarId: string
  slug: string
  currentOverride: IntentValue | null
  brandDefaultIntent: IntentValue | null
  isAr: boolean
}

export function IntentOverrideSelector({ calendarId, slug, currentOverride, brandDefaultIntent, isAr }: Props) {
  const [selected, setSelected] = useState<IntentValue | null>(currentOverride)
  const [isPending, startTransition] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)

  function handleChange(val: IntentValue | null) {
    setSelected(val)
    startTransition(async () => {
      await setCalendarIntentOverride(calendarId, slug, val)
      setSavedAt(Date.now())
    })
  }

  const label = isAr ? 'تجاوز نية التقويم' : 'Calendar intent override'
  const hint = isAr
    ? 'اختر نية مختلفة لهذا التقويم بدلاً من الافتراضي للعلامة التجارية.'
    : 'Override the intent for this calendar only. Leave blank to use the brand default.'

  const effectiveIntent = selected ?? brandDefaultIntent

  return (
    <div className="flex flex-col gap-2 rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-(--fg)">{label}</p>
          <p className="text-xs text-(--fg-faint)">{hint}</p>
        </div>
        {isPending && (
          <span className="text-xs text-(--fg-muted) animate-pulse">{isAr ? 'جارٍ الحفظ…' : 'Saving…'}</span>
        )}
        {!isPending && savedAt && (
          <span className="text-xs text-emerald-400">{isAr ? 'تم الحفظ ✓' : 'Saved ✓'}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Use brand default option */}
        <button
          type="button"
          onClick={() => handleChange(null)}
          disabled={isPending}
          className={[
            'rounded-(--r-sm) border px-3 py-1.5 text-xs font-medium transition-colors',
            selected === null
              ? 'border-(--accent) bg-(--accent)/10 text-(--accent)'
              : 'border-(--border-subtle) text-(--fg-muted) hover:border-(--border-default) hover:text-(--fg)',
          ].join(' ')}
        >
          {isAr ? `الافتراضي (${brandDefaultIntent ?? '—'})` : `Brand default${brandDefaultIntent ? ` (${brandDefaultIntent})` : ''}`}
        </button>

        {INTENTS.map((intent) => (
          <button
            key={intent.v}
            type="button"
            onClick={() => handleChange(intent.v)}
            disabled={isPending}
            title={intent.hint}
            className={[
              'rounded-(--r-sm) border px-3 py-1.5 text-xs font-medium transition-colors',
              selected === intent.v
                ? 'border-(--accent) bg-(--accent)/10 text-(--accent)'
                : 'border-(--border-subtle) text-(--fg-muted) hover:border-(--border-default) hover:text-(--fg)',
            ].join(' ')}
          >
            {isAr ? intent.labelAr : intent.label}
          </button>
        ))}
      </div>

      {effectiveIntent && (
        <p className="text-xs text-(--fg-muted)">
          {isAr
            ? `النية الفعّالة لهذا التقويم: ${effectiveIntent}`
            : `Effective intent for this calendar: ${effectiveIntent}`}
        </p>
      )}
    </div>
  )
}
