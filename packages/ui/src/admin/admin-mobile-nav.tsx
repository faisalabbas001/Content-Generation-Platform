'use client'

import type { ReactNode } from 'react'
import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'
import { cn } from '../cn'
import type { SidebarItem } from '../sidebar'

/**
 * Mobile-only off-canvas drawer mirroring the desktop sidebar.
 * Renders nothing on lg+. Uses plain <a> for nav items because passing
 * `next/link` (a function) across the RSC boundary into a client component
 * is not allowed.
 */
export function AdminMobileNav({
  brand,
  items,
  current,
  pathname,
}: {
  brand: ReactNode
  items: SidebarItem[]
  current?: string
  pathname?: string | null
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const groups = Array.from(new Set(items.map((i) => i.group ?? '')))

  return (
    <div className="lg:hidden">
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-(--border-subtle) bg-(--bg)/85 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">{brand}</div>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-(--r-md) border border-(--border-default) bg-(--surface-3) text-(--fg-subtle) hover:text-(--fg)"
        >
          <Menu size={18} />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <aside className="absolute inset-y-0 inset-e-0 flex w-72 max-w-full flex-col border-s border-(--border-subtle) bg-(--surface-1) py-5">
            <div className="flex items-center justify-between px-4 pb-4">
              <div className="flex items-center gap-2.5">{brand}</div>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-(--r-md) bg-(--surface-3) text-(--fg-subtle) hover:text-(--fg)"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 space-y-5 overflow-y-auto px-3">
              {groups.map((g) => (
                <div key={g}>
                  {g && (
                    <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-(--fg-faint)">
                      {g}
                    </div>
                  )}
                  <ul className="space-y-0.5">
                    {items.filter((i) => (i.group ?? '') === g).map((i) => {
                      const active = current === i.href
                      return (
                        <li key={i.href}>
                          <a
                            href={i.href}
                            onClick={() => setOpen(false)}
                            aria-current={active ? 'page' : undefined}
                            className={cn(
                              'flex items-center gap-2.5 rounded-(--r-lg) px-3 py-2.5 text-sm font-medium transition-colors',
                              active
                                ? 'bg-(--fg) text-(--bg)'
                                : 'text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg)',
                            )}
                          >
                            {i.icon && (
                              <span aria-hidden className={cn('shrink-0', active ? 'text-(--bg)' : 'text-(--fg-faint)')}>
                                {i.icon}
                              </span>
                            )}
                            <span className="truncate">{i.label}</span>
                            {i.badge && i.badge.count > 0 && (
                              <span className={cn(
                                'ms-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none tabular-nums',
                                i.badge.tone === 'danger'  ? 'bg-(--danger) text-white' :
                                i.badge.tone === 'warning' ? 'bg-(--warning) text-black' :
                                                              'bg-(--info) text-white',
                              )}>
                                {i.badge.count > 99 ? '99+' : i.badge.count}
                              </span>
                            )}
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </div>
  )
}
