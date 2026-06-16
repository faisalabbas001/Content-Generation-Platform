import type { ReactNode } from 'react'
import { cn } from './cn'

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-4', className)}>
      {(title || action) && (
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {title && (
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-(--fg-subtle)">
                {title}
              </h2>
            )}
            {description && <p className="text-xs text-(--fg-muted)">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-(--border-subtle)', className)} />
}
