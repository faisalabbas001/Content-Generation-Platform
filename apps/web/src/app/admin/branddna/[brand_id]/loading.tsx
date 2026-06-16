import { Skeleton } from '@repo/ui/skeleton'
import { Card, CardBody, CardHeader } from '@repo/ui/card'

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-(--border-subtle)">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  )
}

export default function BrandDnaLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Header strip */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-3 w-48" />
      </div>

      {/* Brand identity card */}
      <Card>
        <CardBody className="flex items-center gap-4 p-5">
          <Skeleton className="h-14 w-14 shrink-0 rounded-(--r-md)" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Two-column grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardBody className="space-y-2">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="flex justify-between">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Queue skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardBody className="p-0">
          <TableSkeleton rows={10} />
        </CardBody>
      </Card>

      {/* Event log skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardBody className="p-0">
          <TableSkeleton rows={8} />
        </CardBody>
      </Card>
    </div>
  )
}
