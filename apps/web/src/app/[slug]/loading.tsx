import { Skeleton } from '@repo/ui/skeleton'

export default function ClientLoading() {
  return (
    <div className="space-y-6">
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
      <Skeleton className="h-72 rounded-(--r-lg)" />
    </div>
  )
}
