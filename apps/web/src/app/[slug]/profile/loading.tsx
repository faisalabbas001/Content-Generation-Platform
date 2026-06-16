import { Skeleton } from '@repo/ui/skeleton'
import { Card, CardBody, CardHeader } from '@repo/ui/card'

export default function ProfileLoading() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-3 w-64" />
      </div>

      {/* Direction card */}
      <Card>
        <CardBody className="p-5 space-y-3">
          <Skeleton className="h-5 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </CardBody>
      </Card>

      {/* Main content grid */}
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-(--border-subtle)">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-6 py-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-48" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
        <div className="space-y-5">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-5 w-24" /></CardHeader>
              <CardBody className="space-y-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex justify-between">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      </div>

      {/* Event log skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardBody className="p-0">
          <div className="divide-y divide-(--border-subtle)">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3.5 px-5 py-3.5">
                <Skeleton className="mt-0.5 h-7 w-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-24 rounded" />
                  </div>
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-3 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
