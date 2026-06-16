import type { ReactNode } from 'react'
import { Card } from '../card'

export function FeatureCard({
  icon,
  title,
  description,
  meta,
}: {
  icon: ReactNode
  title: string
  description: string
  meta?: string
}) {
  return (
    <Card variant="default" interactive className="p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-(--r-md) bg-(--accent-soft) p-2.5 text-(--accent)">{icon}</div>
        <div className="space-y-1.5">
          {meta && (
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-(--fg-faint)">
              {meta}
            </div>
          )}
          <h3 className="font-display text-base font-semibold text-(--fg)">{title}</h3>
          <p className="text-sm leading-relaxed text-(--fg-muted)">{description}</p>
        </div>
      </div>
    </Card>
  )
}
