import { Spinner } from './spinner'
import { cn } from './cn'

/**
 * PageLoader — full-screen loader used by app/loading.tsx.
 * Centred spinner + brand mark + label.
 */
export function PageLoader({
  label,
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div className={cn('flex min-h-[50vh] flex-col items-center justify-center gap-3', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-(--r-md) bg-(--surface-3) text-(--accent)">
        <Spinner size={22} />
      </div>
      {label && <p className="text-sm text-(--fg-muted)">{label}</p>}
    </div>
  )
}

/** Inline loader for narrower contexts (cards, panels). */
export function InlineLoader({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-(--fg-muted)">
      <Spinner size={16} className="text-(--accent)" />
      {label && <span>{label}</span>}
    </div>
  )
}
