import { Skeleton } from '@repo/ui/skeleton'

export default function AdminLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-(--r-lg)" />
        ))}
      </div>
      <div className="rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2)">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-(--border-subtle) px-5 py-3.5 last:border-b-0">
            <Skeleton className="h-9 w-9 rounded-(--r-md)" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-2 w-1/4" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
