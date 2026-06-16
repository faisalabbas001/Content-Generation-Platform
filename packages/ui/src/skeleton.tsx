import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * Skeleton — neutral block that pulses to indicate loading state.
 * Use for table-row, card, or text-block placeholders.
 */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-(--r-sm) bg-(--surface-3)', className)}
      {...rest}
    />
  )
}

/** Convenience helpers used by route-level loading.tsx files. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <Skeleton className="h-9 w-9 rounded-(--r-md)" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2 w-1/4" />
      </div>
      <Skeleton className="h-5 w-14 rounded-full" />
    </div>
  )
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) p-5">
      <Skeleton className="mb-3 h-3 w-1/4" />
      <Skeleton className="mb-5 h-7 w-1/2" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  )
}
