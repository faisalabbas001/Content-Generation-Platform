import { cn } from './cn'

export function Progress({
  value,
  max = 100,
  tone = 'accent',
  className,
}: {
  value: number
  max?: number
  tone?: 'accent' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const fill = {
    accent: 'bg-(--accent)',
    success: 'bg-(--success)',
    warning: 'bg-(--warning)',
    danger: 'bg-(--danger)',
  }[tone]
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-(--surface-4)', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-(--d-slow) ease-out', fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
