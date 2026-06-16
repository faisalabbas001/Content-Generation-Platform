import type { ReactNode } from 'react'
import { cn } from './cn'

export function PageHeader({
  title,
  subtitle,
  action,
  eyebrow,
  className,
}: {
  title: string
  subtitle?: string
  eyebrow?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'mb-8 flex flex-col gap-4 border-b border-(--border-subtle) pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="space-y-1.5">
        {eyebrow && (
          <div className="text-xs uppercase tracking-[0.2em] text-(--fg-muted)">{eyebrow}</div>
        )}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-(--fg) sm:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="text-sm leading-relaxed text-(--fg-muted)">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </header>
  )
}
