'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export function StrategyReviewCta({ slug, brandId }: { slug: string; brandId: string }) {
  const storageKey = `strategy_cta_dismissed_${brandId}`
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Only show if the user hasn't dismissed it in this browser
    const dismissed = localStorage.getItem(storageKey)
    if (!dismissed) setVisible(true)
  }, [storageKey])

  function dismiss() {
    localStorage.setItem(storageKey, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="relative rounded-(--r-lg) border-2 border-(--accent) bg-(--accent)/5 px-5 py-4 flex items-center gap-4 shadow-lg shadow-(--accent)/10">
      {/* Dismiss */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 text-(--fg-faint) hover:text-(--fg) transition-colors text-lg leading-none"
      >
        ×
      </button>

      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--accent)/15 text-xl">
        🚀
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-(--fg) text-sm leading-snug">
          Your BrandDNA is ready — review your strategy
        </p>
        <p className="text-(--fg-muted) text-xs mt-0.5">
          The AI has built your content strategy. Review and approve it to start generating your calendar.
        </p>
      </div>

      {/* CTA */}
      <Link
        href={`/${slug}/strategy-review`}
        onClick={dismiss}
        className="shrink-0 flex items-center gap-2 rounded-(--r-md) bg-(--accent) px-4 py-2 text-sm font-bold text-(--accent-fg) hover:opacity-90 transition-opacity"
      >
        Review Strategy
        <span className="animate-bounce inline-block">→</span>
      </Link>
    </div>
  )
}
