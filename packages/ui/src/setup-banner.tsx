import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Friendly banner shown when the app can't reach the database
 * (e.g. .env.local missing). Renders nothing if `show` is false.
 */
export function SetupBanner({
  show,
  title,
  body,
  hint,
  className,
}: {
  show: boolean
  title: string
  body: ReactNode
  hint?: ReactNode
  className?: string
}) {
  if (!show) return null
  return (
    <div
      className={cn(
        'mb-6 rounded-(--r-lg) border border-(--warning) bg-(--warning-soft) px-5 py-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--warning) text-(--bg)"
        >
          !
        </div>
        <div className="space-y-1.5">
          <h3 className="font-display text-sm font-semibold text-(--warning)">{title}</h3>
          <p className="text-sm leading-relaxed text-(--fg-subtle)">{body}</p>
          {hint && <p className="text-xs text-(--fg-muted)">{hint}</p>}
        </div>
      </div>
    </div>
  )
}
