import Link from 'next/link'
import { notFound } from 'next/navigation'
import { calendarsQ } from '@repo/db'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { Badge } from '@repo/ui/badge'
import { LinkButton } from '@repo/ui/button'
import { Toaster } from '@repo/ui/client/toast'
import { getServerT } from '@/lib/i18n-server'
import { formatDateOnly } from '@/lib/format'
import { reconcileOverdueScheduledPosts } from '@/lib/postiz-reconcile'
import { CalendarClientView } from '../calendar-client-view'
import { CalendarComingSoon } from '../calendar-coming-soon'
import { DownloadButton } from '../download-button'
import { IntentOverrideSelector } from '../intent-override-selector'

export default async function CalendarMonthPage({
  params,
}: {
  params: Promise<{ slug: string; month: string }>
}) {
  const { slug, month } = await params
  const { locale, t } = await getServerT()
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) notFound()
  const userClient = await getUserScopedClient()
  const calendars = await calendarsQ.getCalendarsForBrand(brand.brand_id, userClient)
  const calendar = calendars.find((c) => c.month === month) ?? null
  if (!calendar) notFound()

  // Flip any overdue 'scheduled' posts to published/failed against Postiz
  // reality BEFORE fetching, so statuses are correct on every page open.
  await reconcileOverdueScheduledPosts(brand.brand_id)

  const posts = await calendarsQ.getPostsForCalendar(calendar.calendar_id, userClient)
  const heldPostIds = await calendarsQ.getHeldPostIds(brand.brand_id)
  const freeLimit = brand.tier === 'free' ? 8 : Infinity
  const isAr = locale === 'ar'

  // Total posts in this calendar (any status) — sizes the "under review" teaser grid
  // so the blurred preview reflects the real volume being prepared this month.
  const totalPostCount = await calendarsQ.countPostsForCalendar(calendar.calendar_id, userClient)

  // 3-Month Rolling runway summary — every calendar this brand has, in chronological
  // order, with whether each month already has client-visible (released) content. The
  // coming-soon teaser uses this to show the FULL 3-month plan ("Jun · Jul · Aug")
  // and which month is the current one, instead of a single dead-end "coming soon".
  const runwayMonths = await Promise.all(
    [...calendars]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(async (c) => {
        const visible = await calendarsQ.getPostsForCalendar(c.calendar_id, userClient)
        const total = await calendarsQ.countPostsForCalendar(c.calendar_id, userClient)
        // Up to 3 image thumbnails for the upcoming-calendar preview cards
        // (images only — guaranteed renderable in a plain <img>).
        const previews = visible
          .filter((p) => p.storage_url && !/\.mp4([?#]|$)/i.test(p.storage_url))
          .slice(0, 3)
          .map((p) => p.storage_url as string)
        return { month: c.month, total, releasedCount: visible.length, isCurrent: c.month === month, previews }
      }),
  )

  // getPostsForCalendar already filters to client-visible posts (status IN pending|approved),
  // where 'pending' = admin released it (awaiting THIS client's approval) and 'approved' =
  // the client approved it. The grid shows as soon as ANY post is released — we must NOT
  // gate on 'approved' alone, or freshly-released posts (all 'pending') would be trapped
  // behind the "under review" empty state and the client could never approve them.
  const calendarApproved = calendar.status === 'delivered'
  const hasVisiblePosts = posts.length > 0

  const offDays = (process.env.OFF_DAYS ?? '0,6')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !Number.isNaN(n) && n >= 0 && n <= 6)

  // Month navigation — sorted chronologically
  const sortedCalendars = [...calendars].sort((a, b) => a.month.localeCompare(b.month))
  const currentIndex = sortedCalendars.findIndex((c) => c.month === month)
  const prevCalendar = currentIndex > 0 ? sortedCalendars[currentIndex - 1] : null
  const nextCalendar = currentIndex < sortedCalendars.length - 1 ? sortedCalendars[currentIndex + 1] : null

  function monthLabel(m: string, loc: string): string {
    const [y, mo] = m.split('-').map(Number)
    return new Date(y, mo - 1, 1).toLocaleString(loc === 'ar' ? 'ar-SA' : 'en-US', { month: 'long', year: 'numeric' })
  }

  return (
    <div className="space-y-5">
      <Toaster />

      {/* ── Header row: title + download action ─────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-(--fg-faint) mb-1">
            {isAr ? 'تقويم المحتوى' : 'Content Calendar'}
          </p>
          <h1 className="text-2xl font-bold text-(--fg)">
            {monthLabel(month, locale)}
          </h1>
          <p className="mt-1 text-sm text-(--fg-muted)">
            {calendar.status === 'delivered'
              ? t('calendar.delivered', { date: formatDateOnly(calendar.delivered_at, locale) })
              : t('calendar.draftNotDelivered')}
          </p>
        </div>
        <div className="shrink-0 self-start">
          {brand.tier === 'free' ? (
            <LinkButton href={`/${slug}/upgrade`} variant="outline">
              {t('calendar.upgradePlan')}
            </LinkButton>
          ) : (
            <DownloadButton
              calendarId={calendar.calendar_id}
              slug={slug}
              totalWithImages={posts.filter(p => p.storage_url).length}
              label={t('calendar.downloadAll')}
              startedLabel={t('calendar.downloadStarted')}
            />
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) px-5 py-3">
        <Badge tone={calendar.status === 'delivered' ? 'success' : 'warning'} dot>
          {calendar.status === 'delivered' ? t('calendar.delivered_') : t('calendar.draft')}
        </Badge>
        <span className="h-3.5 w-px bg-(--border-default)" />
        <span className="text-xs text-(--fg-muted)">{t('calendar.postCount', { n: posts.length })}</span>
        <span className="text-xs text-(--fg-faint)">·</span>
        <span className="text-xs text-(--fg-muted)">
          {t('calendar.availableToYou', {
            available: freeLimit === Infinity ? posts.length : Math.min(freeLimit, posts.length),
            total: posts.length,
          })}
        </span>
      </div>

      {/* Per-calendar intent override */}
      <IntentOverrideSelector
        calendarId={calendar.calendar_id}
        slug={slug}
        currentOverride={(calendar as { intent_override?: string | null }).intent_override as 'launch' | 'grow' | 'defend' | 'harvest' | 'recover' | null ?? null}
        brandDefaultIntent={(brand as unknown as Record<string, unknown>)['intent_state'] as 'launch' | 'grow' | 'defend' | 'harvest' | 'recover' | null ?? null}
        isAr={locale === 'ar'}
      />

      {/* ── Empty states: no posts visible yet ────────────────────────────── */}
      {calendarApproved && !hasVisiblePosts ? (
        /* Delivered but posts not yet surfaced */
        <div className="flex flex-col items-center justify-center gap-4 rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) px-8 py-16 text-center">
          <p className="text-lg font-semibold text-(--fg)">
            {isAr ? 'تم اعتماد تقويمك' : 'Your calendar has been approved'}
          </p>
          <p className="text-sm text-(--fg-muted) max-w-sm">
            {isAr
              ? 'سيظهر هنا قريباً. شكراً لتفهمك.'
              : 'It will appear here shortly. Thank you for your patience.'}
          </p>
        </div>
      ) : !hasVisiblePosts ? (
        /* Posts exist but none are client-visible yet (still under admin review).
           Show the blurred coming-soon teaser grid (real volume + the review
           message). NOTE: do NOT say "Approved" — nothing has been released. */
        <CalendarComingSoon
          count={totalPostCount}
          month={month}
          runway={runwayMonths}
          offDays={offDays}
          isAr={isAr}
        />
      ) : (
        /* Normal grid */
        <CalendarClientView
          posts={posts}
          heldPostIds={heldPostIds}
          freeLimit={freeLimit}
          slug={slug}
          locale={locale}
          brandNameAr={brand.brand_name_ar}
          brandLogoUrl={brand.logo_url ?? null}
          channel={brand.primary_channel ?? 'Instagram'}
          offDays={offDays}
          calendarMonth={calendar.month}
          /* Posts generated for this month but NOT yet released to the client.
             Drives the blurred "being prepared" placeholders on weekday slots that
             have no released post yet, so the client sees content IS coming. */
          preparingCount={Math.max(0, totalPostCount - posts.length)}
          strings={{
            approve: t('calendar.approve'),
            requestChanges: t('calendar.requestChanges'),
            download: t('calendar.download'),
            publish: t('calendar.publish'),
            approveSuccess: t('calendar.approveSuccess'),
            approveError: t('calendar.approveError'),
            downloadStarted: t('calendar.downloadStarted'),
          }}
        />
      )}

      {/* ── Calendar navigation — previous + upcoming months ────────── */}
      {runwayMonths.some((m) => m.month !== month) && (() => {
        const prevMonths = runwayMonths.filter((m) => m.month < month).reverse()
        const nextMonths = runwayMonths.filter((m) => m.month > month)

        function CalendarCard({ m, isPrev }: { m: typeof runwayMonths[0]; isPrev?: boolean }) {
          const ready = m.releasedCount > 0
          const monthLabel = new Date(`${m.month}-01T00:00:00`).toLocaleDateString(
            isAr ? 'ar-SA' : 'en-US',
            { month: 'long', year: 'numeric' },
          )
          return (
            <Link
              key={m.month}
              href={`/${slug}/calendar/${m.month}`}
              className={`group relative overflow-hidden rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl ${
                isPrev
                  ? 'border-(--border-subtle) bg-(--surface-2)/60 hover:border-(--border-default) opacity-80 hover:opacity-100'
                  : ready
                    ? 'border-emerald-500/25 bg-linear-to-br from-emerald-600/10 via-(--surface-2) to-(--surface-2) hover:border-emerald-500/45'
                    : 'border-(--border-subtle) bg-(--surface-2) hover:border-(--border-default)'
              }`}
            >
              <div className="flex items-center gap-4">
                {m.previews.length > 0 ? (
                  <div className="flex shrink-0 -space-x-4 rtl:space-x-reverse">
                    {m.previews.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={url}
                        src={url}
                        alt=""
                        loading="lazy"
                        className="h-16 w-16 rounded-xl border-2 border-(--surface-1) object-cover shadow-md transition-transform duration-200 group-hover:scale-105"
                        style={{ zIndex: 3 - i, rotate: `${(i - 1) * 4}deg` }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-(--surface-3)">
                    <svg className="h-7 w-7 text-(--fg-faint)" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <rect x="3" y="4" width="18" height="17" rx="2" />
                      <path strokeLinecap="round" d="M8 2v4m8-4v4M3 9h18" />
                    </svg>
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isPrev && (
                      <svg className="h-3.5 w-3.5 shrink-0 text-(--fg-faint) rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                    )}
                    <p className="truncate text-lg font-bold text-(--fg)">{monthLabel}</p>
                    <Badge tone={ready ? 'success' : 'warning'} dot>
                      {ready ? (isAr ? 'جاهز' : 'Ready') : (isAr ? 'قيد التحضير' : 'Preparing')}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-(--fg-muted)">
                    {ready
                      ? (isAr ? `${m.releasedCount} منشور بانتظار مراجعتك` : `${m.releasedCount} posts waiting for your review`)
                      : (isAr ? `${m.total} منشور قيد التحضير` : `${m.total} posts in preparation`)}
                  </p>
                  <p className={`mt-1.5 inline-flex items-center gap-1 text-xs font-semibold ${ready ? 'text-emerald-400' : 'text-(--fg-faint)'}`}>
                    {isPrev
                      ? (isAr ? 'العودة إلى هذا الشهر' : 'Go back to this month')
                      : ready
                        ? (isAr ? 'افتح وراجِع' : 'Open & review')
                        : (isAr ? 'سيصلك إشعار عند الجاهزية' : 'You\'ll be notified when ready')}
                    <svg
                      className={`h-3.5 w-3.5 transition-transform ${isPrev ? 'group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5' : 'group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5'}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d={isPrev ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
                    </svg>
                  </p>
                </div>
              </div>
            </Link>
          )
        }

        return (
          <div className="space-y-6 pt-2" dir={isAr ? 'rtl' : 'ltr'}>
            {prevMonths.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-baseline justify-between px-1">
                  <h3 className="text-lg font-bold text-(--fg)">
                    {isAr ? '◀ التقويمات السابقة' : '◀ Previous calendars'}
                  </h3>
                  <span className="text-xs text-(--fg-muted)">
                    {isAr ? 'العودة إلى الأشهر الماضية' : 'Navigate back to past months'}
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {prevMonths.map((m) => <CalendarCard key={m.month} m={m} isPrev />)}
                </div>
              </section>
            )}

            {nextMonths.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-baseline justify-between px-1">
                  <h3 className="text-lg font-bold text-(--fg)">
                    {isAr ? '📅 التقويمات القادمة' : '📅 Upcoming calendars'}
                  </h3>
                  <span className="text-xs text-(--fg-muted)">
                    {isAr ? 'خطة المحتوى الجاهزة للأشهر القادمة' : 'Your content runway for the months ahead'}
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {nextMonths.map((m) => <CalendarCard key={m.month} m={m} />)}
                </div>
              </section>
            )}
          </div>
        )
      })()}
    </div>
  )
}
