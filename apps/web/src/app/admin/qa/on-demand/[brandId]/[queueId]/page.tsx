import { notFound } from 'next/navigation'
import { adminQ } from '@repo/db'
import { OnDemandInspectionPage } from '../on-demand-inspection-page'

export const dynamic = 'force-dynamic'

export default async function OnDemandPostDetailPage({
  params,
}: {
  params: Promise<{ brandId: string; queueId: string }>
}) {
  const { brandId, queueId } = await params

  const { groups } = await adminQ.getQaOnDemandGroups(1, 999)
  const group = groups.find((g) => g.brand_id === brandId)
  if (!group) notFound()

  const item = group.items.find((i) => i.queue_id === queueId)
  if (!item) notFound()

  const backHref = `/admin/qa/on-demand/${brandId}`

  return (
    <OnDemandInspectionPage
      item={item}
      backHref={backHref}
    />
  )
}
