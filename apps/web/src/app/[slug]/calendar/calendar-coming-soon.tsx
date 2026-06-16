/**
 * CalendarComingSoon — the "coming soon" teaser for the client /calendar page,
 * shown for a month whose posts aren't released to the client yet.
 *
 * UX intent: instead of an empty text box, the client sees a REAL-LOOKING calendar
 * grid — frosted/blurred post cards in the same 7-column layout as the live calendar
 * — with a reassuring "coming soon" message floating in a glass card on top.
 *
 * 3-MONTH ROLLING: the glass card now shows the FULL 3-month runway strip (each month
 * as a pill with its state — ready / preparing / current) so the client understands
 * they have a rolling 3-month plan, not a single dead-end "coming soon". We keep the
 * softer "being prepared / available soon" wording, never "under review".
 *
 * Pure presentational, RTL-aware. `count` sizes the teaser grid for THIS month;
 * `runway` lists every month + how many of its posts are already released.
 */
import { Badge } from '@repo/ui/badge'

const SHIMMER = [
  'from-amber-500/15 to-orange-500/10',
  'from-sky-500/15 to-indigo-500/10',
  'from-emerald-500/15 to-teal-500/10',
  'from-rose-500/15 to-pink-500/10',
  'from-violet-500/15 to-fuchsia-500/10',
]

export interface RunwayMonth {
  month: string          // 'YYYY-MM'
  total: number
  releasedCount: number  // posts already client-visible
  isCurrent: boolean
}

/** Short month label for a 'YYYY-MM' key, locale-aware. */
function monthLabel(key: string, isAr: boolean): string {
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return new Date(y, m - 1, 1).toLocaleString(isAr ? 'ar-SA' : 'en-US', { month: 'short' })
}

export function CalendarComingSoon({
  count,
  month,
  runway = [],
  offDays,
  isAr,
}: {
  count: number
  month: string
  runway?: RunwayMonth[]
  offDays: number[]
  isAr: boolean
}) {
  const dir = isAr ? 'rtl' : 'ltr'
  const weekdays = isAr
    ? ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // Build a 5-week (35-cell) teaser grid. Weekend columns stay empty; weekday cells
  // get a frosted "post" tile until we've placed `count` of them — mirroring how the
  // real calendar skips off-days. This makes the teaser's density feel authentic.
  const TOTAL_CELLS = 35
  let placed = 0
  const cells = Array.from({ length: TOTAL_CELLS }, (_, i) => {
    const dow = i % 7
    const isWeekend = offDays.includes(dow)
    const hasPost = !isWeekend && placed < count
    if (hasPost) placed++
    return { i, isWeekend, hasPost, tone: SHIMMER[placed % SHIMMER.length] }
  })

  return (
    <div className="relative" dir={dir}>
      {/* ── The frosted calendar grid (the teaser) ───────────────────────── */}
      <div
        className="select-none rounded-(--r-lg) border border-(--border-subtle) bg-(--surface-2) shadow-(--shadow-1) overflow-hidden"
        aria-hidden="true"
      >
        {/* Day headers — readable (not blurred) so the month shape is legible */}
        <div className="grid grid-cols-7 border-b border-(--border-subtle) bg-(--surface-3)">
          {weekdays.map((day, i) => (
            <div
              key={i}
              className={`p-3 text-center text-xs font-bold border-r border-(--border-subtle) last:border-r-0 uppercase tracking-wider ${
                offDays.includes(i) ? 'text-(--fg-faint) bg-black/10' : 'text-(--fg-muted)'
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Grid body — blurred tiles */}
        <div className="grid grid-cols-7 auto-rows-[180px] blur-[3px] opacity-80">
          {cells.map(({ i, isWeekend, hasPost, tone }) => (
            <div
              key={i}
              className={`relative border-b border-r border-(--border-subtle) last:border-r-0 p-2 ${
                isWeekend ? 'bg-black/10' : 'bg-(--surface-1)'
              }`}
            >
              {hasPost && (
                <div className="flex h-full w-full flex-col gap-2">
                  {/* faux image tile */}
                  <div className={`flex-1 rounded-(--r-md) bg-gradient-to-br ${tone} border border-white/5`} />
                  {/* faux caption lines */}
                  <div className="space-y-1.5">
                    <div className="h-2 w-4/5 rounded-full bg-(--fg)/15" />
                    <div className="h-2 w-3/5 rounded-full bg-(--fg)/10" />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Glass overlay with the review message (kept, not removed) ─────── */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="flex max-w-md flex-col items-center gap-4 rounded-(--r-lg) border border-white/10 bg-(--surface-1)/80 px-8 py-10 text-center shadow-2xl backdrop-blur-md">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30">
            {/* sparkle icon — "your content is being crafted", not a waiting clock */}
            <svg className="h-7 w-7 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
          </div>

          {/* Reassuring "coming soon" tone — we deliberately never say "under
              review / before release" so the client isn't made to feel their
              calendar might not be approved. */}
          <Badge tone="info" size="sm" dot>
            {isAr ? 'قريبًا' : 'Coming soon'}
          </Badge>

          {/* 3-month framing: the client has a rolling plan, not one month. */}
          <h3 className="text-lg font-semibold text-(--fg)">
            {runway.length > 1
              ? (isAr ? 'خطة المحتوى لـ 3 أشهر قيد التجهيز' : 'Your 3-month content plan is being prepared')
              : (isAr ? 'تقويمك قيد التجهيز' : 'Your calendar is being prepared')}
          </h3>
          <p className="text-sm leading-relaxed text-(--fg-muted)">
            {isAr
              ? `نضع اللمسات الأخيرة على منشورات ${monthLabel(month, true)} — ستتوفر هنا قريبًا.`
              : `We’re putting the finishing touches on your ${monthLabel(month, false)} posts — they’ll be available here soon.`}
          </p>

          {count > 0 && (
            <p className="text-xs font-medium text-(--fg-faint)">
              {isAr
                ? `${count} منشور${count > 1 ? 'اً' : ''} قيد التحضير لشهر ${monthLabel(month, true)}`
                : `${count} post${count > 1 ? 's' : ''} being prepared for ${monthLabel(month, false)}`}
            </p>
          )}

          {/* ── 3-Month Rolling runway strip ──────────────────────────────────
              Each month as a pill: ✓ ready (has released posts) · current (this
              month) · preparing. Shows the client their full forward runway. */}
          {runway.length > 1 && (
            <div className="mt-1 w-full">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-(--fg-faint)">
                {isAr ? 'تقويم الـ 3 أشهر' : 'Your 3-month runway'}
              </p>
              <div className="flex items-center justify-center gap-2" dir={dir}>
                {runway.map((r) => {
                  const ready = r.releasedCount > 0
                  const isThis = r.month === month
                  return (
                    <div
                      key={r.month}
                      className={[
                        'flex flex-1 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center transition-colors',
                        ready
                          ? 'border-emerald-500/40 bg-emerald-500/10'
                          : isThis
                            ? 'border-sky-500/50 bg-sky-500/10'
                            : 'border-(--border-subtle) bg-(--surface-2)',
                      ].join(' ')}
                    >
                      <span className={`text-xs font-semibold ${ready ? 'text-emerald-400' : isThis ? 'text-sky-300' : 'text-(--fg-muted)'}`}>
                        {monthLabel(r.month, isAr)}
                      </span>
                      <span className="text-[9px] text-(--fg-faint)">
                        {ready
                          ? (isAr ? `${r.releasedCount} جاهز` : `${r.releasedCount} ready`)
                          : (isAr ? 'قيد التجهيز' : 'preparing')}
                      </span>
                      {ready && (
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white">
                          <svg width="8" height="8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="mt-2 text-[10px] text-(--fg-faint)">
                {isAr
                  ? 'افتح "كل التقويمات" للتنقل بين الأشهر.'
                  : 'Open “All calendars” to switch between months.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
