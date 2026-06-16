import { redirect, notFound } from 'next/navigation'
import { calendarsQ } from '@repo/db'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { PageHeader } from '@repo/ui/page-header'
import { EmptyState } from '@repo/ui/empty-state'
import { getServerT } from '@/lib/i18n-server'
import { CalendarRealtime } from './calendar-realtime'

export default async function CalendarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { t } = await getServerT()
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) notFound()

  const userClient = await getUserScopedClient()
  const allCalendars = await calendarsQ.getCalendarsForBrand(brand.brand_id, userClient)

  // No calendar yet — show empty state and keep realtime channel open.
  if (allCalendars.length === 0) {
    return (
      <div className="space-y-6">
        <CalendarRealtime brandId={brand.brand_id} />
        <PageHeader
          eyebrow={t('clientNav.calendar')}
          title={t('calendar.noCalendarYet')}
          subtitle={t('calendar.noCalendarSubtitle')}
        />
        <EmptyState title={t('calendar.emptyTitle')} description={t('calendar.emptyDescription')} />
      </div>
    )
  }

  // 3-Month Rolling: land on the EARLIEST month (chronological first), NOT the
  // latest-created one. getLatestCalendarForBrand returned month-DESC = August, so
  // the client never saw released content in June/July. Sort ascending and redirect
  // to the first month; the month page's tabs let them move forward through the runway.
  const earliest = [...allCalendars].sort((a, b) => a.month.localeCompare(b.month))[0]!
  redirect(`/${slug}/calendar/${earliest.month}`)
}
