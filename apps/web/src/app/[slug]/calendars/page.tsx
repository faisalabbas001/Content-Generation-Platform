import Link from 'next/link'
import { notFound } from 'next/navigation'
import { calendarsQ } from '@repo/db'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { PageHeader } from '@repo/ui/page-header'
import { Badge } from '@repo/ui/badge'
import { EmptyState } from '@repo/ui/empty-state'
import { getServerT } from '@/lib/i18n-server'
import { formatDateOnly } from '@/lib/format'
import type { Locale } from '@repo/i18n'

export const dynamic = 'force-dynamic'

function ApprovalBar({ approved, total, isAr }: { approved: number; total: number; isAr: boolean }) {
  const pct = total > 0 ? Math.round((approved / total) * 100) : 0
  const allDone = approved === total && total > 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        <span className="text-(--fg-muted)">
          {isAr ? 'الموافقات' : 'Approvals'}
        </span>
        <span className={`font-semibold ${allDone ? 'text-emerald-400' : 'text-(--fg)'}`}>
          {approved} / {total}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-(--surface-1) overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-500' : 'bg-(--accent)'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function CalendarCard({
  calendar,
  slug,
  locale,
  deliveredLabel,
  draftLabel,
  totalPosts,
  approvedPosts,
}: {
  calendar: any
  slug: string
  locale: Locale
  deliveredLabel: string
  draftLabel: string
  totalPosts: number
  approvedPosts: number
}) {
  const isAr = locale === 'ar'
  const isDelivered = calendar.status === 'delivered'
  const [y, m] = calendar.month.split('-').map(Number)
  const monthName = new Date(y, m - 1, 1).toLocaleString((isAr ? 'ar-SA' : 'en-US') as string, {
    month: 'long', year: 'numeric',
  })
  const allApproved = approvedPosts === totalPosts && totalPosts > 0

  return (
    <Link
      href={`/${slug}/calendar/${calendar.month}`}
      className="group flex flex-col gap-4 rounded-2xl border border-(--border-subtle) bg-(--surface-2) p-5 hover:bg-(--surface-3) hover:border-(--border-default) hover:shadow-lg transition-all duration-200 cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-lg font-bold text-(--fg) truncate">{monthName}</span>
          {calendar.delivered_at && (
            <span className="text-xs text-(--fg-faint)">
              {formatDateOnly(calendar.delivered_at, locale)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge tone={isDelivered ? 'success' : 'warning'} dot>
            {isDelivered ? deliveredLabel : draftLabel}
          </Badge>
          {/* Arrow — shifts right on hover */}
          <svg
            className="w-4 h-4 text-(--fg-faint) group-hover:text-(--accent) group-hover:translate-x-0.5 transition-all duration-200"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            style={isAr ? { transform: 'scaleX(-1)' } : undefined}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>

      {/* Approval progress */}
      {totalPosts > 0 && (
        <ApprovalBar approved={approvedPosts} total={totalPosts} isAr={isAr} />
      )}

      {/* Footer meta */}
      <div className="flex items-center justify-between text-xs text-(--fg-faint)" dir={isAr ? 'rtl' : 'ltr'}>
        <span>{isAr ? `${totalPosts} منشور` : `${totalPosts} posts`}</span>
        {allApproved && (
          <span className="flex items-center gap-1 text-emerald-400 font-medium">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {isAr ? 'مكتمل' : 'Complete'}
          </span>
        )}
      </div>
    </Link>
  )
}

export default async function CalendarsArchivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { locale, t } = await getServerT()
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) notFound()
  const userClient = await getUserScopedClient()

  const [calendarsRaw, postsRaw] = await Promise.all([
    calendarsQ.getCalendarsForBrand(brand.brand_id, userClient),
    userClient
      .from('calendar_posts')
      .select('calendar_id, status')
      .eq('brand_id', brand.brand_id)
      .then(({ data }) => data ?? []),
  ])

  // Show calendars in CHRONOLOGICAL order — earliest (first-generated) month first,
  // so the 3-month rolling runway reads June → July → August (the query returns them
  // newest-first by default).
  const calendars = [...calendarsRaw].sort((a, b) => a.month.localeCompare(b.month))

  // Build per-calendar stats
  const statsMap: Record<string, { total: number; approved: number }> = {}
  for (const p of postsRaw) {
    if (!p.calendar_id) continue
    if (!statsMap[p.calendar_id]) statsMap[p.calendar_id] = { total: 0, approved: 0 }
    statsMap[p.calendar_id].total++
    if (p.status === 'approved') statsMap[p.calendar_id].approved++
  }

  if (calendars.length === 0) {
    return (
      <div>
        <PageHeader eyebrow={t('calendars.eyebrow')} title={t('calendars.title')} subtitle={t('calendars.subtitle')} />
        <EmptyState title={t('calendar.emptyTitle')} description={t('calendar.emptyDescription')} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t('calendars.eyebrow')} title={t('calendars.title')} subtitle={t('calendars.subtitle')} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {calendars.map((calendar) => {
          const stats = statsMap[calendar.calendar_id] ?? { total: 0, approved: 0 }
          return (
            <CalendarCard
              key={calendar.calendar_id}
              calendar={calendar}
              slug={slug}
              locale={locale}
              deliveredLabel={t('calendar.delivered_')}
              draftLabel={t('calendar.draft')}
              totalPosts={stats.total}
              approvedPosts={stats.approved}
            />
          )
        })}
      </div>
    </div>
  )
}
