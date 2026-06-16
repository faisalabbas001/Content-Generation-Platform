import type { ReactNode } from 'react'
import { cn } from './cn'
import { Card } from './card'
import { Badge } from './badge'

export type StatTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export function Stat({
  label,
  value,
  helper,
  helperBottom = false,
  trend,
  tone = 'neutral',
  icon,
  className,
}: {
  label: string
  value: ReactNode
  helper?: ReactNode
  helperBottom?: boolean
  trend?: { value: string; direction: 'up' | 'down' | 'flat' }
  tone?: StatTone
  icon?: ReactNode
  className?: string
}) {
  const trendTone = trend?.direction === 'up' ? 'success' : trend?.direction === 'down' ? 'danger' : 'neutral'
  const accentColor: Record<StatTone, string> = {
    neutral: 'transparent',
    accent: 'var(--accent)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
    info: 'var(--info)',
  }
  return (
    <Card className={cn('relative overflow-hidden p-5', helperBottom && 'flex flex-col', className)}>
      <div className={cn('flex items-start justify-between gap-3', helperBottom && 'flex-1')}>
        <div className="space-y-1.5">
          <div className="text-xs uppercase tracking-wide text-(--fg-muted)">{label}</div>
          <div className="font-display text-2xl font-semibold tracking-tight text-(--fg)">
            {value}
          </div>
          {helper && !helperBottom && <div className="text-xs text-(--fg-muted)">{helper}</div>}
        </div>
        {icon && (
          <div className="rounded-(--r-md) bg-(--surface-3) p-2 text-(--fg-subtle)">
            {icon}
          </div>
        )}
      </div>
      {trend && (
        <div className="mt-3">
          <Badge tone={trendTone} size="sm">
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.value}
          </Badge>
        </div>
      )}
      {helper && helperBottom && (
        <div className="mt-auto pt-4 border-t border-(--border-subtle) text-xs font-medium text-(--fg-muted)">
          {helper}
        </div>
      )}
      {tone !== 'neutral' && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${accentColor[tone]}, transparent)` }}
        />
      )}
    </Card>
  )
}
