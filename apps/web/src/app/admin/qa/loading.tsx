import { Skeleton } from '@repo/ui/skeleton'

export default function QaLoading() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-3 w-80" />
      </div>

      {/* Tab bar */}
      <Skeleton className="h-11 w-full rounded-(--r-lg) sm:w-72" />

      {/* Legend bar */}
      <Skeleton className="h-10 w-full rounded-(--r-lg)" />

      {/* Table */}
      <div className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2)">
        {/* Header row */}
        <div className="flex items-center gap-4 border-b border-(--border-default) px-5 py-3">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="ml-auto h-3 w-10" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
        {/* Data rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-(--border-subtle) px-5 py-4 last:border-b-0"
          >
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-1 h-4 w-20 rounded-full" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-7 w-20 rounded-(--r-md)" />
              <Skeleton className="h-7 w-16 rounded-(--r-md)" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
