'use client'

import { useState, useTransition } from 'react'
import { Card, CardBody } from '@repo/ui/card'
import { Button } from '@repo/ui/button'
import { Badge } from '@repo/ui/badge'
import { Sparkles } from '@repo/ui/icons'

export type UpgradeOffer = {
  perf_id: string
  activity_level: string | null
  upgrade_recommendation: string | null
  upgrade_recommendation_ar: string | null
  suggested_offer: string | null
  suggested_offer_ar: string | null
  offer_valid_until: string | null
  metrics: {
    total_calendars?: number
    avg_post_score?: number
    features_to_highlight?: string[]
  } | null
}

const FEATURE_LABELS: Record<string, { en: string; ar: string }> = {
  auto_publishing:    { en: 'Auto-publish to Instagram', ar: 'نشر تلقائي على إنستغرام' },
  unlimited_posts:    { en: 'All 20 posts unlocked',     ar: 'جميع المنشورات الـ20 مفتوحة' },
  unlimited_calendars:{ en: 'Unlimited calendars',        ar: 'تقاويم غير محدودة' },
  priority_support:   { en: 'Priority support',           ar: 'دعم أولوي' },
}

export function UpgradeOfferBanner({
  slug,
  offer,
  locale,
}: {
  slug: string
  offer: UpgradeOffer
  locale: string
}) {
  const isAr = locale === 'ar'
  const [visible, setVisible] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!visible) return null

  const message = isAr
    ? (offer.upgrade_recommendation_ar ?? offer.upgrade_recommendation)
    : (offer.upgrade_recommendation ?? offer.upgrade_recommendation_ar)

  const offerText = isAr
    ? (offer.suggested_offer_ar ?? offer.suggested_offer)
    : (offer.suggested_offer ?? offer.suggested_offer_ar)

  const features = offer.metrics?.features_to_highlight ?? [
    'auto_publishing',
    'unlimited_posts',
    'unlimited_calendars',
    'priority_support',
  ]

  function patchStatus(status: 'accepted' | 'skipped') {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/offers/${offer.perf_id}/status`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status, slug }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        if (status === 'skipped') {
          setVisible(false)
        } else {
          window.location.href = `/${slug}/upgrade`
        }
      } catch {
        setError(
          isAr
            ? 'حدث خطأ، يرجى المحاولة مجددًا'
            : 'Something went wrong — please try again',
        )
      }
    })
  }

  return (
    <Card className="border-(--accent) shadow-(--shadow-glow)">
      <CardBody className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start"><div dir={isAr ? 'rtl' : 'ltr'} className="contents">

        {/* Icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--accent-soft)">
          <Sparkles size={20} className="text-(--accent)" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-(--fg)">
              {isAr ? 'عرض ترقية خاص لك هذا الشهر' : 'Special upgrade offer this month'}
            </p>
            {offerText && (
              <Badge tone="accent" size="sm">{offerText}</Badge>
            )}
          </div>

          {message && (
            <p className="text-sm text-(--fg-muted)">{message}</p>
          )}

          {/* Feature list */}
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {features.map((f) => {
              const label = FEATURE_LABELS[f]
              if (!label) return null
              return (
                <li key={f} className="flex items-center gap-1 text-xs text-(--fg-muted)">
                  <span className="text-(--accent)">✓</span>
                  {isAr ? label.ar : label.en}
                </li>
              )
            })}
          </ul>

          {error && (
            <p className="text-xs text-(--danger)">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => patchStatus('skipped')}
          >
            {isAr ? 'تخطي' : 'Dismiss'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => patchStatus('accepted')}
          >
            {isAr ? 'رقّي الآن' : 'Upgrade Now'}
          </Button>
        </div>

      </div></CardBody>
    </Card>
  )
}
