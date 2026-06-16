import { notFound } from 'next/navigation'
import { adminQ, adminRegenQ } from '@repo/db'
import { PostInspectionPage } from '../post-inspection-page'

export const dynamic = 'force-dynamic'

export default async function PostInspectionRoute({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string; postId: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const { brandId, postId } = await params
  const { month } = await searchParams

  const { groups } = await adminQ.getQaCalendarGroups(1, 999)
  const group = groups.find((g) => g.brand_id === brandId)
  if (!group) notFound()

  // postId in the URL is the queue_id or post_id (so any QA item is addressable,
  // even pre-image holds that have no post_id yet). 3-MONTH ROLLING: group.qa_items
  // only holds the brand's PRIMARY/latest calendar month, so a post from another
  // month (e.g. the ?month=2026-06 tab while group.month is 2026-08) is NOT there —
  // that caused a 404. Search the SELECTED month's items first, then fall back.
  const monthItems = month ? await adminQ.getCalendarMonthQaItems(brandId, month) : []
  const item =
    monthItems.find((i) => i.queue_id === postId || i.post_id === postId) ??
    group.qa_items.find((i) => i.queue_id === postId || i.post_id === postId)
  if (!item) notFound()

  const backMonth = month ?? group.month
  const backHref = `/admin/qa/${brandId}?month=${backMonth}`

  const regenMap = item.post_id
    ? await adminRegenQ.listAdminRegenerationsForPosts([item.post_id])
    : new Map()
  const regens = item.post_id ? (regenMap.get(item.post_id) ?? []) : []

  return (
    <PostInspectionPage
      item={item}
      group={group}
      backHref={backHref}
      regens={regens}
    />
  )
}
