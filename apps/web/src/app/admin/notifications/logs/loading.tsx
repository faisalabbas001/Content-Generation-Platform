import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader } from '@repo/ui/card'
import { Skeleton } from '@repo/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Notifications"
        title="Delivery Log"
        subtitle="Full audit trail of every notification sent — filter, search, retry failures, and track Resend status."
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardBody className="py-4 text-center">
              <Skeleton className="mx-auto h-7 w-10" />
              <Skeleton className="mx-auto mt-2 h-3 w-12" />
              <Skeleton className="mx-auto mt-2 h-5 w-14 rounded-full" />
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardBody className="p-0">
          <div className="flex items-center gap-3 border-b border-(--border-subtle) px-5 py-3">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </div>
          <div className="divide-y divide-(--border-subtle)">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
