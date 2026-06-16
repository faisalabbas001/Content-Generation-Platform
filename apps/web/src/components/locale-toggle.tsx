'use client'

import { usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { setLocaleAction } from '@/app/actions/locale'
import { LOCALE_META, type Locale } from '@repo/i18n'

/**
 * Two-state pill: العربية | English. Sets the locale cookie via a server
 * action and revalidates layout — no client navigation, no flash.
 */
export function LocaleToggle({
  current,
  className = '',
  size = 'sm',
}: {
  current: Locale
  className?: string
  size?: 'sm' | 'md'
}) {
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const next: Locale = current === 'ar' ? 'en' : 'ar'

  const sizeClass = size === 'sm' ? 'h-8 text-[11px]' : 'h-9 text-xs'

  return (
    <form
      action={(fd) => {
        fd.set('locale', next)
        fd.set('path', pathname || '/')
        start(() => {
          void setLocaleAction(fd)
        })
      }}
      className={className}
      aria-busy={pending}
    >
      <button
        type="submit"
        disabled={pending}
        title={LOCALE_META[next].nativeLabel}
        aria-label={`Switch to ${LOCALE_META[next].label}`}
        className={`group inline-flex items-center gap-1.5 rounded-(--r-md) border border-(--border-default) bg-(--surface-3) px-2.5 ${sizeClass} font-medium text-(--fg-subtle) transition-colors duration-(--d-fast) ease-out hover:border-(--border-strong) hover:text-(--fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) disabled:opacity-60`}
      >
        <span className="font-mono uppercase tracking-wider">{current.toUpperCase()}</span>
        <span aria-hidden className="text-(--fg-faint) group-hover:text-(--fg-subtle)">→</span>
        <span className="font-mono uppercase tracking-wider text-(--fg)">{next.toUpperCase()}</span>
      </button>
    </form>
  )
}
