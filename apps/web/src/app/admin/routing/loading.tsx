import { Skeleton } from '@repo/ui/skeleton'

export default function RoutingLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-3 w-72" />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {[160, 120, 120, 200].map((w, i) => (
          <Skeleton key={i} className="h-8 rounded-(--r-sm)" style={{ width: w }} />
        ))}
        <Skeleton className="h-8 w-20 rounded-(--r-sm)" />
      </div>

      {/* Summary bar */}
      <div className="flex justify-between">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>

      {/* Row cards */}
      <div className="space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="rounded-(--r-md) border border-(--border-subtle) bg-(--surface-1) px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="ms-auto h-3 w-28" />
            </div>
            <div className="mt-1.5 flex gap-4">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex justify-between border-t border-(--border-subtle) pt-4">
        <div className="flex gap-1">
          {[80, 36, 36, 36, 36, 80].map((w, i) => (
            <Skeleton key={i} className="h-7 rounded-(--r-sm)" style={{ width: w }} />
          ))}
        </div>
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  )
}
