'use client'

import { usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { Sun, Moon } from '@repo/ui/icons'
import { setThemeAction } from '@/app/actions/theme'
import type { Theme } from '@/lib/theme-server'

/**
 * Sun/Moon theme switch. Sets the theme cookie via a server action and
 * revalidates the layout — server re-renders <html data-theme>, so there's
 * no flash and the choice persists across requests.
 */
export function ThemeToggle({
  current,
  className = '',
}: {
  current: Theme
  className?: string
}) {
  const pathname = usePathname()
  const [pending, start] = useTransition()
  const next: Theme = current === 'dark' ? 'light' : 'dark'

  return (
    <form
      action={(fd) => {
        fd.set('theme', next)
        fd.set('path', pathname || '/')
        start(() => {
          void setThemeAction(fd)
        })
      }}
      className={className}
      aria-busy={pending}
    >
      <button
        type="submit"
        disabled={pending}
        title={next === 'dark' ? 'Switch to dark' : 'Switch to light'}
        aria-label={next === 'dark' ? 'Switch to dark theme' : 'Switch to light theme'}
        className="inline-flex h-8 w-8 items-center justify-center rounded-(--r-md) border border-(--border-default) bg-(--surface-3) text-(--fg-subtle) transition-colors duration-(--d-fast) ease-out hover:border-(--border-strong) hover:text-(--fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) disabled:opacity-60"
      >
        {current === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
      </button>
    </form>
  )
}
