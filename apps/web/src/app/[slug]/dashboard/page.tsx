/**
 * /[slug]/dashboard — primary client landing page.
 *
 * Reads:
 *   - Full BrandDNA via getBrandDna()  (logo, completeness, channels, audience)
 *   - Latest calendar + posts          (existing logic kept)
 *   - Upcoming Saudi occasions         (NEW — countdown ribbon)
 *
 * The dashboard is a snapshot of brand health, NOT a calendar viewer. The
 * calendar gets its own dedicated page; here we surface signals the user
 * needs to see at a glance.
 */
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { brandDnaQ, calendarsQ, occasionsQ, adminClient } from '@repo/db'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Stat } from '@repo/ui/stat'
import { Badge } from '@repo/ui/badge'
import { LinkButton } from '@repo/ui/button'
import { Progress } from '@repo/ui/progress'
import { ArrowUpRight, CheckCircle2, Calendar, Inbox, Sparkles, Bell } from '@repo/ui/icons'
import { getServerT } from '@/lib/i18n-server'
import { formatDateOnly, postStatusLabel, postStatusTone } from '@/lib/format'
import { UpgradeOfferBanner } from './upgrade-offer-banner'

export const dynamic = 'force-dynamic'

const SHARD_DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

export default async function DashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { locale, t } = await getServerT()
  const brandHeader = await getBrandForCurrentUser(slug)
  if (!brandHeader) notFound()

  const userClient = await getUserScopedClient()

  const db = adminClient()

  // Fire all reads in parallel — saves ~200ms on first paint.
  const today = new Date().toISOString().split('T')[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any
  const [dna, calendar, allCalendars, occasions, igChannelProfile, activeOffer, competitorAlerts, unreadNotifCount] = await Promise.all([
    brandDnaQ.getBrandDna(brandHeader.brand_id, userClient),
    calendarsQ.getLatestCalendarForBrand(brandHeader.brand_id, userClient),
    // Folded into the parallel batch (was a sequential await below) — it only
    // needs brand_id, so running it here removes a round-trip from the waterfall.
    calendarsQ.getCalendarsForBrand(brandHeader.brand_id, userClient),
    occasionsQ.getUpcomingOccasions(),
    db.from('channel_profiles')
      .select('postiz_channel_id, handle')
      .eq('brand_id', brandHeader.brand_id as string)
      .eq('channel', 'Instagram')
      .maybeSingle()
      .then((r) => r.data as { postiz_channel_id: string | null; handle: string | null } | null),
    // Only free-tier brands receive upgrade readiness offers from N8N-A05
    brandHeader.tier === 'free'
      ? dbAny
          .from('brand_performance_log')
          .select('perf_id,activity_level,upgrade_recommendation,upgrade_recommendation_ar,suggested_offer,suggested_offer_ar,offer_valid_until,metrics')
          .eq('brand_id', brandHeader.brand_id)
          .eq('evaluation_type', 'upgrade_readiness')
          .eq('offer_status', 'pending')
          .gte('offer_valid_until', today)
          .order('evaluated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r: { data: unknown }) => r.data)
      : Promise.resolve(null),
    // Unread competitor alerts (Layer 5)
    db.from('competitor_alerts')
      .select('alert_id, alert_type, severity, title, body, suggested_content_direction, created_at')
      .eq('brand_id', brandHeader.brand_id as string)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(3)
      .then((r) => (r.data ?? []) as Array<{ alert_id: string; alert_type: string; severity: string; title: string; body: string; suggested_content_direction: string | null; created_at: string }>),
    // Unread notification count for the dashboard banner
    brandHeader.auth_user_id
      ? db.from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('auth_user_id', brandHeader.auth_user_id)
          .is('read_at', null)
          .then((r) => r.count ?? 0)
      : Promise.resolve(0),
  ])
  const postizConnected = !!igChannelProfile?.postiz_channel_id
  if (!dna) notFound()

  const unreadNotifications = (unreadNotifCount as number) ?? 0
  const { brand, channels, evidence, current_confidence, latest_snapshot, sources, method_profile } = dna

  // Pick current-month calendar for the dashboard preview.
  // getLatestCalendarForBrand returns month-DESC (= August for 3-month brands),
  // but the dashboard should show the CURRENT month (June 2026) as the hero.
  // allCalendars is fetched in the parallel batch above.
  const currentMonthStr = new Date().toISOString().slice(0, 7) // e.g. "2026-06"
  // Prefer current month; fall back to earliest released, then latest
  const currentMonthCal = allCalendars.find((c) => c.month === currentMonthStr)
    ?? allCalendars.filter((c) => c.status === 'delivered').sort((a, b) => a.month.localeCompare(b.month))[0]
    ?? calendar

  const posts = currentMonthCal ? await calendarsQ.getPostsForCalendar(currentMonthCal.calendar_id, userClient) : []
  const approved = posts.filter((p) => p.status === 'approved').length
  const pending = posts.filter((p) => p.status === 'pending').length

  // "Total posts this month" should reflect everything generated for the calendar,
  // not just the client-visible (released) subset — otherwise a calendar that's fully
  // generated but not yet released by the team shows a misleading 0. We count ALL
  // rows for the calendar (head-only, no payload) via the service-role client.
  const totalGenerated = currentMonthCal
    ? (await db
        .from('calendar_posts')
        .select('post_id', { count: 'exact', head: true })
        .eq('calendar_id', currentMonthCal.calendar_id)).count ?? posts.length
    : 0
  // Posts generated but not yet released to the client (team still preparing them).
  const beingPrepared = Math.max(0, totalGenerated - posts.length)

  // Sort posts by posting_time ascending — find the next upcoming post
  const sortedPosts = [...posts].sort((a, b) => {
    const at = a.posting_time ? new Date(a.posting_time).getTime() : 0
    const bt = b.posting_time ? new Date(b.posting_time).getTime() : 0
    return at - bt
  })
  // Hero = first pending post (needs approval) chronologically;
  // fall back to first approved post if all are already approved
  const heroPost = sortedPosts.find((p) => p.status !== 'approved')
    ?? sortedPosts[0]
    ?? null
  // Strip = next 4 posts after hero (chronologically)
  const stripPosts = heroPost
    ? sortedPosts.filter((p) => p.post_id !== heroPost.post_id).slice(0, 4)
    : sortedPosts.slice(0, 4)

  const onboardingDone = brand.completeness_score >= 40 && evidence.summary.total > 0
  const isPartial = latest_snapshot?.is_partial ?? false
  const showOnboardingBanner = isPartial || !onboardingDone
  const dialectConfirmedFromEvidence = evidence.bundles.some(
    (b) =>
      b.field_name === 'arabic_dialect' &&
      (b.field_confidence === 'explicitly_confirmed' || b.field_confidence === 'inferred_high'),
  )

  const igChannel = channels.find((c) => c.channel === 'Instagram') ?? null
  const nextOccasion = occasions[0]
  const daysUntil = nextOccasion ? daysBetween(new Date(), new Date(nextOccasion.gregorian_date)) : null

  // Calibration period (spec §3.3)
  const isCalibration = (brand as unknown as Record<string, unknown>).is_calibration_period === true
  const calibEndsAt   = (brand as unknown as Record<string, unknown>).calibration_ends_at as string | null
  const nowTs         = new Date()
  const calibDaysLeft = calibEndsAt
    ? Math.max(0, Math.ceil((new Date(calibEndsAt).getTime() - nowTs.getTime()) / 86_400_000))
    : null

  const shardDay = SHARD_DAY_NAMES[brand.batch_shard % 7] ?? 'Sunday'

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t('dashboard.eyebrow')}
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        action={
          <LinkButton href={`/${slug}/calendar`} trailingIcon={<ArrowUpRight size={16} />}>
            {t('dashboard.viewCalendar')}
          </LinkButton>
        }
      />

      {/* ── Unread notifications banner ─────────────────────────────── */}
      {unreadNotifications > 0 && (
        <Link
          href={`/${slug}/notifications`}
          className="group flex items-center justify-between gap-3 rounded-(--r-lg) border border-(--accent)/30 bg-(--accent)/8 px-4 py-3 transition-all hover:border-(--accent)/50 hover:bg-(--accent)/12"
        >
          <div className="flex items-center gap-3">
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--accent)/20">
              <Bell size={15} className="text-(--accent)" />
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--accent) px-1 font-mono text-[9px] font-bold text-white leading-none">
                {unreadNotifications > 99 ? '99+' : unreadNotifications}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-(--fg)">
                {locale === 'ar'
                  ? `لديك ${unreadNotifications} إشعار${unreadNotifications > 1 ? 'ات' : ''} جديد`
                  : `You have ${unreadNotifications} unread notification${unreadNotifications > 1 ? 's' : ''}`}
              </p>
              <p className="text-xs text-(--fg-muted)">
                {locale === 'ar' ? 'اضغط لعرض التفاصيل' : 'Tap to view details'}
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold text-(--accent) group-hover:underline">
            {locale === 'ar' ? 'عرض ←' : 'View →'}
          </span>
        </Link>
      )}

      {/* ── Calibration period banner (spec §3.3) ───────────────────── */}
      {isCalibration && (
        <div className="rounded-(--r-lg) border border-amber-500/20 bg-amber-500/8 px-4 py-3 flex items-center gap-3">
          <span className="text-amber-400 text-base shrink-0">⏳</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-(--fg) text-sm">
              الفترة التجريبية
              {calibDaysLeft !== null && (
                <span className="font-normal text-amber-400 ms-1">— {calibDaysLeft} يوم متبقي</span>
              )}
            </p>
            <p className="text-(--fg-muted) text-xs mt-0.5">
              النظام يتعلّم من أداء المحتوى خلال أول 90 يوم. التوصيات ستتحسّن تلقائياً مع تراكم البيانات.
            </p>
          </div>
          <Link href={`/${slug}/snapshot`} className="text-xs text-amber-400 hover:text-amber-300 underline whitespace-nowrap shrink-0 transition-colors">
            عرض BrandDNA
          </Link>
        </div>
      )}

      {/* ── Competitor alerts (Layer 5) ──────────────────────────────── */}
      {competitorAlerts.length > 0 && (
        <div className="space-y-2">
          {competitorAlerts.map((alert) => (
            <div key={alert.alert_id} className={`rounded-xl border px-5 py-3 flex items-start gap-3 ${
              alert.severity === 'urgent' ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'
            }`}>
              <span className="mt-0.5 text-base">
                {alert.severity === 'urgent' ? '🚨' : alert.alert_type === 'gap_opportunity' ? '💡' : '📊'}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${alert.severity === 'urgent' ? 'text-red-900' : 'text-blue-900'}`}>
                  {alert.title}
                </p>
                <p className={`text-sm mt-0.5 ${alert.severity === 'urgent' ? 'text-red-800' : 'text-blue-800'}`}>
                  {alert.body}
                </p>
                {alert.suggested_content_direction && (
                  <p className="text-xs text-blue-700 mt-1 italic">{alert.suggested_content_direction}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Brand identity strip ─────────────────────────────────────── */}
      <Card>
        <CardBody className="flex items-center gap-4 p-5">
          {brand.logo_url ? (
            <Image
              src={brand.logo_url}
              alt={brand.brand_name_ar}
              width={56}
              height={56}
              unoptimized
              className="h-14 w-14 shrink-0 rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) object-contain"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-(--r-md) border border-(--border-subtle) bg-(--surface-2) font-display text-xl text-(--fg-muted)">
              {brand.brand_name_ar.slice(0, 1)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 dir="rtl" className="font-display text-xl font-semibold text-(--fg)">{brand.brand_name_ar}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="accent" size="sm">{brand.sector}</Badge>
              {brand.city_primary && <Badge tone="outline" size="sm">{brand.city_primary}</Badge>}
              {brand.arabic_dialect && (
                <Badge tone={dialectConfirmedFromEvidence ? 'success' : 'warning'} size="sm" dot>
                  {brand.arabic_dialect}
                </Badge>
              )}
              {current_confidence?.mode && (
                <Badge tone="info" size="sm">Mode: {current_confidence.mode}</Badge>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Postiz connection warning — shown when Instagram not yet connected ── */}
      {!postizConnected && (
        <Card className="border-amber-400/40 bg-amber-400/5">
          <CardBody className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/20">
              <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-400">Instagram auto-publishing is inactive</p>
              <p className="text-sm text-(--fg-muted)">
                Connect your Instagram account via Postiz to enable auto-publishing of approved posts.
              </p>
            </div>
            <a
              href={`/api/postiz/connect?slug=${slug}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-(--r-sm) border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-400 transition-opacity hover:opacity-80"
            >
              Connect now
            </a>
          </CardBody>
        </Card>
      )}

      {/* ── Upgrade offer banner — free-tier brands with a scored offer ─ */}
      {activeOffer && brand.tier === 'free' && (
        <UpgradeOfferBanner slug={slug} offer={activeOffer} locale={locale} />
      )}

      {/* ── Onboarding banner: only when still in progress ───────────── */}
      {showOnboardingBanner && (
        <Card>
          <CardBody className="flex items-center justify-between gap-4 p-4">
            <div className="text-sm">
              <Badge tone="warning" dot>Onboarding in progress</Badge>
              <p className="mt-1.5 text-(--fg-muted)">
                We&apos;re still building your BrandDNA. Track progress on{' '}
                <Link className="font-medium text-(--accent) hover:underline" href={`/${slug}/processing`}>
                  the processing page
                </Link>.
              </p>
            </div>
            <LinkButton href={`/${slug}/processing`} variant="ghost" size="sm">View progress</LinkButton>
          </CardBody>
        </Card>
      )}

      {/* ── Creative direction summary ──────────────────────────────────
          Hero band showing the v2 three-axis identity so the user sees the
          "who is this brand" line every visit. Full breakdown lives on /profile. */}
      {(brand.archetype_primary || method_profile) && (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-4 p-5">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="text-xs uppercase tracking-[0.2em] text-(--fg-muted)">Creative direction</div>
              <div className="flex flex-wrap items-center gap-2">
                {brand.archetype_primary && (
                  <Badge tone="accent" size="sm">
                    {brand.archetype_primary}{brand.archetype_secondary ? ` + ${brand.archetype_secondary}` : ''}
                  </Badge>
                )}
                {brand.lifecycle_stage && <Badge tone="outline" size="sm">{brand.lifecycle_stage}</Badge>}
                {brand.intent_state && <Badge tone="info" size="sm">intent: {brand.intent_state}</Badge>}
                {method_profile && (
                  <Badge tone={method_profile.composition_score >= 60 ? 'success' : 'warning'} size="sm">
                    composition {method_profile.composition_score}
                  </Badge>
                )}
              </div>
              {method_profile?.creative_direction_text && (
                <p className="line-clamp-2 max-w-2xl text-sm text-(--fg-muted)">
                  {method_profile.creative_direction_text}
                </p>
              )}
            </div>
            <LinkButton href={`/${slug}/profile`} variant="ghost" size="sm">
              View profile
            </LinkButton>
          </CardBody>
        </Card>
      )}

      {/* ── Hero KPIs ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
        <div className="oc-mount oc-stagger-1 flex">
          <Stat
            label={t('dashboard.kpiPosts')}
            value={totalGenerated}
            icon={<Calendar size={18} />}
            tone="accent"
            helper={beingPrepared > 0 ? t('dashboard.kpiBeingPrepared', { n: beingPrepared }) : ' '}
            helperBottom
            className="w-full"
          />
        </div>
        <div className="oc-mount oc-stagger-2 flex">
          <Stat
            label={t('dashboard.kpiApproved')}
            value={approved}
            icon={<CheckCircle2 size={18} />}
            tone="success"
            helper={posts.length ? `${Math.round((approved / posts.length) * 100)}%` : ' '}
            helperBottom
            className="w-full"
          />
        </div>
        <div className="oc-mount oc-stagger-3 flex">
          <Stat
            label={t('dashboard.kpiPending')}
            value={pending}
            icon={<Inbox size={18} />}
            tone={pending ? 'warning' : 'neutral'}
            helper=" "
            helperBottom
            className="w-full"
          />
        </div>
        <div className="oc-mount oc-stagger-4 flex">
          <Stat
            label={t('dashboard.kpiCompleteness')}
            value={`${brand.completeness_score}%`}
            icon={<Sparkles size={18} />}
            tone="info"
            helper=" "
            helperBottom
            className="w-full"
          />
        </div>
      </div>

      {/* ── Calendar preview + side cards ────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr] items-stretch">

        {/* ── Calendar content panel ──────────────────────────────────── */}
        <div className="rounded-2xl border border-(--border-subtle) bg-(--surface-1) overflow-hidden flex flex-col">

          {/* Panel header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-(--fg-faint)">
                {currentMonthCal
                  ? new Date(currentMonthCal.month + '-01').toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US', { month: 'long', year: 'numeric' })
                  : locale === 'ar' ? 'محتوى هذا الشهر' : 'This Month'}
              </p>
              <h2 className="text-lg font-bold text-(--fg) mt-0.5">
                {locale === 'ar' ? 'تقويم المحتوى' : 'Content Calendar'}
              </h2>
            </div>
            <Link
              href={`/${slug}/calendar`}
              className="group inline-flex items-center gap-2 rounded-xl bg-(--surface-2) hover:bg-(--surface-3) border border-(--border-subtle) hover:border-(--accent)/40 px-4 py-2 text-xs font-bold text-(--fg-muted) hover:text-(--fg) transition-all"
            >
              {locale === 'ar' ? 'عرض الكل' : 'View all 3 months'}
              <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>

          {/* ── Panel body ── */}
          <div className="flex flex-col gap-3 px-5 pb-5">

            {posts.length === 0 ? (
              /* ── Empty / preparing state ── */
              <div className="flex flex-col items-center justify-center gap-4 text-center py-10">
                <div className="h-14 w-14 rounded-2xl bg-(--surface-3) flex items-center justify-center">
                  <Calendar size={22} className="text-(--fg-faint)" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-(--fg-muted)">
                    {beingPrepared > 0 ? t('dashboard.calendarBeingPrepared', { n: beingPrepared }) : t('calendar.emptyDescription')}
                  </p>
                  {beingPrepared > 0 && (
                    <p className="text-xs text-(--fg-faint)">Our team is reviewing your content — check back soon.</p>
                  )}
                </div>
              </div>
            ) : (
              /* ── Stack: hero post on top, reel strip below ── */
              <div className="flex flex-col gap-3">

                {/* ── TOP: Instagram post card — image left, caption right ── */}
                {heroPost && (
                  <Link
                    href={`/${slug}/calendar`}
                    className="group flex gap-4 overflow-hidden rounded-2xl border border-(--border-subtle) hover:border-(--accent)/50 bg-(--surface-2) transition-all hover:shadow-xl hover:shadow-black/30 p-3"
                  >
                    {/* Image — 4:5 ratio, fixed 311px wide */}
                    <div className="relative shrink-0 overflow-hidden rounded-xl" style={{ width: 311, aspectRatio: '4/5' }}>
                      <div className="absolute inset-0">
                        {heroPost.storage_url && isVideoUrl(heroPost.storage_url) ? (
                          <video
                            src={heroPost.storage_url}
                            autoPlay
                            muted
                            loop
                            playsInline
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : heroPost.storage_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={heroPost.storage_url}
                            alt=""
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="w-full h-full bg-(--surface-3) flex items-center justify-center">
                            <Calendar size={28} className="text-(--fg-faint)" />
                          </div>
                        )}

                        {/* Up Next badge */}
                        <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/65 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 border border-white/20">
                            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            {locale === 'ar' ? 'التالي' : 'Up Next'}
                          </span>
                          {heroPost.storage_url && isVideoUrl(heroPost.storage_url) && (
                            <div className="flex items-center gap-1.5 rounded-full bg-black/65 backdrop-blur-sm px-3 py-1.5 text-xs font-bold text-white border border-white/20">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                              {locale === 'ar' ? 'فيديو' : 'Video'}
                            </div>
                          )}
                        </div>

                        {/* Bottom scrim + date */}
                        <div className="absolute bottom-0 inset-x-0 h-14 bg-gradient-to-t from-black/65 to-transparent pointer-events-none" />
                        {heroPost.posting_time && (
                          <div className="absolute bottom-3 left-3 z-10 rounded-full bg-black/65 backdrop-blur-sm px-3 py-1.5 text-xs font-semibold text-white">
                            {formatDateOnly(heroPost.posting_time, locale)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: caption + hashtags + status */}
                    <div className="flex flex-col justify-between flex-1 min-w-0 py-1">
                      <div className="space-y-2">
                        {/* Status badge */}
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border ${heroPost.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${heroPost.status === 'approved' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
                          {heroPost.status === 'approved'
                            ? (locale === 'ar' ? 'معتمد' : 'Approved')
                            : (locale === 'ar' ? 'بانتظار الموافقة' : 'Awaiting approval')}
                        </span>

                        {/* Caption */}
                        {heroPost.caption_ar && (
                          <p dir="rtl" className="text-[15px] leading-relaxed text-(--fg) line-clamp-6">
                            <span className="font-bold">{brand.brand_name_ar} </span>
                            {heroPost.caption_ar}
                          </p>
                        )}

                        {/* Hashtags */}
                        {heroPost.hashtags && heroPost.hashtags.length > 0 && (
                          <p className="text-xs text-sky-400/80 leading-relaxed">
                            {heroPost.hashtags.slice(0, 5).map(h => h.startsWith('#') ? h : `#${h}`).join(' ')}
                          </p>
                        )}
                      </div>

                      {/* Bottom: date label */}
                      {heroPost.posting_time && (
                        <p className="text-xs text-(--fg-faint) mt-2">
                          {formatDateOnly(heroPost.posting_time, locale)}
                        </p>
                      )}
                    </div>
                  </Link>
                )}

                {/* ── BOTTOM: Reel-strip — 4 tiles in one row, 9:16 each ── */}
                {stripPosts.length > 0 && (() => {
                  const remaining = posts.length - (heroPost ? 1 : 0) - stripPosts.length
                  const visibleTiles = remaining > 0 ? stripPosts.slice(0, 3) : stripPosts.slice(0, 4)
                  const showMore = remaining > 0

                  return (
                    <div className="grid grid-cols-4 gap-1.5">
                      {visibleTiles.map((p) => (
                        <Link
                          key={p.post_id}
                          href={`/${slug}/calendar`}
                          className="group relative overflow-hidden rounded-xl border border-(--border-subtle) bg-(--surface-2) hover:border-(--accent)/40 transition-all hover:shadow-lg"
                          style={{ aspectRatio: '9/16' }}
                        >
                          <div className="absolute inset-0">
                            {p.storage_url && isVideoUrl(p.storage_url) ? (
                              <video
                                src={p.storage_url}
                                autoPlay
                                muted
                                loop
                                playsInline
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                              />
                            ) : p.storage_url ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={p.storage_url}
                                alt=""
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                              />
                            ) : (
                              <div className="w-full h-full bg-(--surface-3) flex items-center justify-center">
                                <Calendar size={12} className="text-(--fg-faint)" />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                            <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full z-10 ring-1 ring-black/30 ${p.status === 'approved' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            {p.storage_url && isVideoUrl(p.storage_url) && (
                              <div className="absolute top-1.5 left-1.5 z-10 flex items-center justify-center w-4 h-4 rounded-full bg-black/65">
                                <svg className="w-2 h-2" fill="white" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                              </div>
                            )}
                            <div className="absolute bottom-0 inset-x-0 p-1.5 z-10 text-center">
                              <span className="text-[9px] font-bold text-white/90 leading-tight">
                                {p.posting_time
                                  ? new Date(p.posting_time).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-US', { month: 'short', day: 'numeric' })
                                  : `#${p.position}`}
                              </span>
                            </div>
                          </div>
                        </Link>
                      ))}

                      {/* "+N more" tile */}
                      {showMore && (
                        <Link
                          href={`/${slug}/calendar`}
                          className="group relative flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-xl border border-dashed border-(--border-subtle) bg-(--surface-1) hover:border-(--accent)/40 hover:bg-(--surface-2) transition-all"
                          style={{ aspectRatio: '9/16' }}
                        >
                          <span className="text-base font-bold text-(--fg-muted) group-hover:text-(--accent) transition-colors leading-none">
                            +{remaining + 1}
                          </span>
                          <span className="text-[9px] font-semibold text-(--fg-faint) leading-tight">
                            {locale === 'ar' ? 'أكثر' : 'more'}
                          </span>
                        </Link>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {/* ── View all CTA — always at bottom, flush with panel edge ── */}
            <Link
              href={`/${slug}/calendar`}
              className="group flex items-center justify-between w-full rounded-xl border border-(--border-subtle) bg-(--surface-2) hover:bg-(--surface-3) hover:border-(--accent)/30 px-4 py-3 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-(--surface-3) flex items-center justify-center group-hover:bg-(--accent)/15 transition-colors shrink-0">
                  <Calendar size={15} className="text-(--fg-muted) group-hover:text-(--accent) transition-colors" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-(--fg)">
                    {locale === 'ar' ? 'عرض التقويم الكامل · 3 أشهر' : 'Full 3-month calendar'}
                  </p>
                  <p className="text-xs text-(--fg-faint) truncate">
                    {allCalendars.length > 0
                      ? allCalendars.sort((a,b) => a.month.localeCompare(b.month)).map((c) => new Date(c.month + '-01').toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US', { month: 'short' })).join(' · ')
                      : locale === 'ar' ? 'كل منشوراتك' : 'All your posts'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-bold text-(--accent)">
                  {posts.length} {locale === 'ar' ? 'منشور' : 'posts'}
                </span>
                <div className="h-7 w-7 rounded-lg bg-(--surface-3) group-hover:bg-(--accent)/20 flex items-center justify-center transition-colors">
                  <ArrowUpRight size={13} className="text-(--fg-muted) group-hover:text-(--accent) transition-colors" />
                </div>
              </div>
            </Link>

          </div>{/* end panel body */}
        </div>{/* end panel */}

        <div className="flex flex-col gap-4">
          {/* Completeness mini-card */}
          <Card>
            <CardHeader><div><CardTitle>{t('snapshot.completenessCard')}</CardTitle></div></CardHeader>
            <CardBody className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-semibold tracking-tight text-(--accent)">
                  {brand.completeness_score}
                </span>
                <span className="text-sm text-(--fg-muted)">{t('snapshot.outOf100')}</span>
              </div>
              <Progress value={brand.completeness_score} />
              <Link
                href={`/${slug}/snapshot`}
                className="inline-flex items-center gap-1 text-xs font-medium text-(--accent) hover:underline"
              >
                {t('dashboard.viewSnapshot')} <ArrowUpRight size={12} />
              </Link>
            </CardBody>
          </Card>

          {/* Next occasion countdown */}
          {nextOccasion && daysUntil !== null && daysUntil >= 0 && (
            <Card>
              <CardHeader><div><CardTitle>Next occasion</CardTitle></div></CardHeader>
              <CardBody className="space-y-1.5 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-2xl font-semibold text-(--fg)">
                    {locale === 'en' && nextOccasion.occasion_name_en
                      ? nextOccasion.occasion_name_en
                      : nextOccasion.occasion_name_ar}
                  </span>
                </div>
                <p className="text-(--fg-muted)">
                  in <span className="font-medium text-(--fg)">{daysUntil} day{daysUntil === 1 ? '' : 's'}</span>
                </p>
                <Badge
                  tone={nextOccasion.priority === 'Critical' ? 'danger' : nextOccasion.priority === 'High' ? 'warning' : 'outline'}
                  size="sm"
                >
                  {nextOccasion.priority} priority
                </Badge>
              </CardBody>
            </Card>
          )}

          {/* Brand basics */}
          <Card>
            <CardHeader><div><CardTitle>{t('common.yourBrand')}</CardTitle></div></CardHeader>
            <CardBody className="space-y-2.5 text-sm">
              <Row label={t('profile.sector')}  value={brand.sector} />
              <Row label={t('profile.dialect')} value={brand.arabic_dialect ?? '—'} />
              <Row label={t('profile.channel')} value={brand.primary_channel ?? '—'} />
              <Row label={t('profile.tier')}    value={brand.tier} />
              <Row label="Next batch night"     value={shardDay} />
              {sources.count > 0 && <Row label="Signals collected" value={String(sources.count)} />}
            </CardBody>
          </Card>

          {/* Instagram presence — show when we have ANY IG signal (handle, followers,
              or engagement). Following only on followers_count hid the card for brands
              we have a handle + engagement for but no follower count yet. */}
          {igChannel && (igChannel.handle || igChannel.followers_count !== null || igChannel.engagement_rate !== null) && (
            <Card>
              <CardHeader><div><CardTitle>Instagram</CardTitle></div></CardHeader>
              <CardBody className="space-y-1.5 text-sm">
                {igChannel.handle && (
                  <a
                    href={`https://instagram.com/${igChannel.handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-(--accent) hover:underline"
                  >
                    @{igChannel.handle}
                  </a>
                )}
                {igChannel.followers_count !== null ? (
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-2xl font-semibold text-(--fg)">
                      {igChannel.followers_count.toLocaleString()}
                    </span>
                    <span className="text-xs text-(--fg-muted)">followers</span>
                  </div>
                ) : (
                  <div className="text-xs text-(--fg-muted)">Follower count syncing…</div>
                )}
                {igChannel.engagement_rate !== null && (
                  <div className="text-xs text-(--fg-muted)">
                    {(igChannel.engagement_rate * 100).toFixed(1)}% engagement
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-(--border-subtle) pb-2 last:border-0 last:pb-0">
      <span className="text-(--fg-muted)">{label}</span>
      <span className="font-medium text-(--fg)">{value}</span>
    </div>
  )
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /\.mp4(\?|$)/i.test(url) || /\.webm(\?|$)/i.test(url)
}
