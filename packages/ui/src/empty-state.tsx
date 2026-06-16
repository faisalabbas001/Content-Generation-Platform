import type { ReactNode } from 'react'
import { Card } from './card'
import { cn } from './cn'

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('px-6 py-16 text-center', className)}>
      {icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-(--r-lg) bg-(--surface-3) text-(--fg-subtle)">
          {icon}
        </div>
      )}
      <h3 className="font-display text-base font-semibold text-(--fg)">{title}</h3>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-(--fg-muted)">
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </Card>
  )
}
