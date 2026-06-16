'use client'

import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'
import { cn } from '../cn'

export interface MarketingHeaderLink {
  href: string
  label: string
}

/**
 * Sticky transparent-with-blur top bar for marketing pages.
 * Hamburger drawer on mobile (<lg).
 *
 * The desktop nav renders as a rounded pill group with a dark container;
 * the active tab is filled and prefixed with an accent dot. Active state is
 * derived from the current pathname (or the `current` override).
 *
 * Note: this is a client component, so it cannot receive a function-typed
 * prop (e.g. `linkAs={NextLink}`) across the RSC boundary. We render plain
 * <a> tags. Next's edge cache + soft-nav still kick in for relative links.
 */
export function MarketingHeader({
  brand,
  nav,
  cta,
  current,
}: {
  brand: ReactNode
  nav: MarketingHeaderLink[]
  cta?: ReactNode
  current?: string
}) {
  const [open, setOpen] = useState(false)
  // Read the current path on the client without depending on next/navigation,
  // so this component stays framework-agnostic inside @repo/ui. Falls back to
  // the `current` prop (or '/') during SSR / first paint.
  const [pathname, setPathname] = useState<string | null>(null)
  useEffect(() => {
    setPathname(window.location.pathname)
  }, [])

  // A nav item is active when:
  //  • it points to a real page that matches the current path (/pricing, /about…), or
  //  • it is the home link (`/`) or a same-page anchor (`/#features`) while on `/`.
  const isActive = (href: string) => {
    const cur = current ?? pathname ?? '/'
    if (href === '/') return cur === '/'
    if (href.startsWith('/#')) return cur === '/'
    return cur === href || cur.startsWith(href + '/')
  }

  return (
    <header className="sticky top-0 z-30 bg-(--bg)/85 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">{brand}</div>

        {/* Rounded pill nav group — dark container, active tab highlighted */}
        <nav className="hidden items-center gap-1 rounded-full border border-(--border-subtle) bg-(--surface-1) p-1 lg:flex">
          {nav.map((n) => {
            const active = isActive(n.href)
            return (
              <a
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-(--d-fast) ease-out',
                  active
                    ? 'bg-(--accent-soft) text-(--accent) ring-1 ring-(--accent-border)'
                    : 'text-(--fg-muted) hover:text-(--fg)',
                )}
              >
                {active && (
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-(--accent)" />
                )}
                {n.label}
              </a>
            )
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">{cta}</div>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-(--r-md) border border-(--border-default) bg-(--surface-3) text-(--fg-subtle) transition-colors duration-(--d-fast) ease-out hover:text-(--fg) lg:hidden"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {open && (
        <div className="border-t border-(--border-subtle) bg-(--surface-1) lg:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 lg:px-8">
            {nav.map((n) => {
              const active = isActive(n.href)
              return (
                <a
                  key={n.href}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-(--r-md) px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-(--accent-soft) text-(--accent) ring-1 ring-(--accent-border)'
                      : 'text-(--fg-subtle) hover:bg-(--surface-3) hover:text-(--fg)',
                  )}
                >
                  {active && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-(--accent)" />}
                  {n.label}
                </a>
              )
            })}
            {cta && <div className="mt-3 flex items-center gap-2 border-t border-(--border-subtle) pt-3">{cta}</div>}
          </nav>
        </div>
      )}
    </header>
  )
}
