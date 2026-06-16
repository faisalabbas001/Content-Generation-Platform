import type { ReactNode } from 'react'
import { cn } from './cn'

export interface SidebarItem {
  href: string
  label: string
  icon?: ReactNode
  group?: string
  badge?: { count: number; tone?: 'danger' | 'warning' | 'info' }
}

export function Sidebar({
  brand,
  items,
  current,
  footer,
  linkAs: Link = 'a' as unknown as React.ElementType,
}: {
  brand: ReactNode
  items: SidebarItem[]
  current?: string
  footer?: ReactNode
  linkAs?: React.ElementType
}) {
  const groups = Array.from(new Set(items.map((i) => i.group ?? '')))

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-e border-(--border-subtle) bg-(--surface-1) py-6 lg:flex lg:flex-col">
      <div className="px-5 pb-6">{brand}</div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3">
        {groups.map((g) => (
          <div key={g}>
            {g && (
              <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-(--fg-faint)">
                {g}
              </div>
            )}
            <ul className="space-y-0.5">
              {items
                .filter((i) => (i.group ?? '') === g)
                .map((i) => {
                  const active = current === i.href
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'group flex items-center gap-2.5 rounded-(--r-lg) px-3 py-2.5 text-sm font-medium transition-colors duration-(--d-fast) ease-out',
                          active
                            ? 'bg-(--fg) text-(--bg) shadow-(--shadow-1)'
                            : 'text-(--fg-muted) hover:bg-(--surface-3) hover:text-(--fg)',
                        )}
                      >
                        {i.icon && (
                          <span
                            aria-hidden
                            className={cn(
                              'shrink-0 transition-colors',
                              active ? 'text-(--bg)' : 'text-(--fg-faint) group-hover:text-(--fg-subtle)',
                            )}
                          >
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
                      </Link>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </nav>

      {footer && <div className="border-t border-(--border-subtle) px-5 pt-4">{footer}</div>}
    </aside>
  )
}
