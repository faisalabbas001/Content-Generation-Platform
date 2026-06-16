import Link from 'next/link'
import { notFound } from 'next/navigation'
import { onDemandQ } from '@repo/db'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { LinkButton } from '@repo/ui/button'
import { EmptyState } from '@repo/ui/empty-state'
import { Plus, Sparkles, Clock, ChevronLeft, ChevronRight } from '@repo/ui/icons'
import { getServerT } from '@/lib/i18n-server'
import { formatDate } from '@/lib/format'
import { OnDemandDownloadButton } from './download-button'
import { AutoRefresh } from './auto-refresh'
import { VideoCardPreview } from './video-card-preview'
import { PublishNowButton } from './publish-button'

export const dynamic = 'force-dynamic'

type Status = 'queued' | 'generating' | 'delivered' | 'held' | 'failed'

const PAGE_SIZE = 20

function statusTone(s: Status): 'success' | 'warning' | 'info' | 'danger' | 'neutral' {
  switch (s) {
    case 'delivered':  return 'success'
    case 'generating': return 'info'
    case 'queued':     return 'neutral'
    case 'held':       return 'warning'
    case 'failed':     return 'danger'
  }
}

function parsePage(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw
  const n = Number(v)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

export default async function OnDemandListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string | string[] }>
}) {
  const { slug } = await params
  const { page: pageParam } = await searchParams
  const requestedPage = parsePage(pageParam)
  const { locale, t } = await getServerT()
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) notFound()
  const userClient = await getUserScopedClient()

  // The query swallows missing-table errors (migration 0009 not applied) so
  // the page degrades to its empty state. Any other failure is logged here
  // and we still fall back to an empty page rather than crashing into
  // error.tsx — the user can retry once the brief is wired up.
  let paged: Awaited<ReturnType<typeof onDemandQ.getOnDemandRequestsForBrandPaged>> = {
    items: [], total: 0, page: requestedPage, pageSize: PAGE_SIZE, pageCount: 0,
  }
  try {
    paged = await onDemandQ.getOnDemandRequestsForBrandPaged(brand.brand_id, {
      client: userClient,
      page: requestedPage,
      pageSize: PAGE_SIZE,
    })
  } catch (err) {
    console.error('[on-demand] list query failed:', err)
  }

  const newPostHref = `/${slug}/on-demand/new`

  // If the user landed past the last page (e.g. bookmarked), redirect-style
  // fallback: render the last available page instead of an awkward empty
  // state with prev/next disabled. This keeps the URL honest without a
  // server redirect (which would clobber the deep link history).
  const totalPages = Math.max(paged.pageCount, 1)
  const currentPage = Math.min(Math.max(paged.page, 1), totalPages)
  const isOverflow =
    paged.total > 0 && requestedPage > totalPages && currentPage !== requestedPage
  if (isOverflow) {
    paged = await onDemandQ.getOnDemandRequestsForBrandPaged(brand.brand_id, {
      client: userClient,
      page: currentPage,
      pageSize: PAGE_SIZE,
    })
  }

  const requests = paged.items

  if (paged.total === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={t('onDemandPosts.eyebrow')}
          title={t('onDemandPosts.title')}
          subtitle={t('onDemandPosts.subtitle')}
          action={
            <LinkButton href={newPostHref} leadingIcon={<Plus size={16} />}>
              {t('onDemandPosts.createNew')}
            </LinkButton>
          }
        />
        <EmptyState
          icon={<Sparkles size={20} aria-hidden />}
          title={t('onDemandPosts.emptyTitle')}
          description={t('onDemandPosts.emptyDescription')}
          action={
            <LinkButton href={newPostHref} leadingIcon={<Plus size={16} />}>
              {t('onDemandPosts.createNew')}
            </LinkButton>
          }
        />
      </div>
    )
  }

  const from = (currentPage - 1) * paged.pageSize + 1
  const to = Math.min(currentPage * paged.pageSize, paged.total)
  const hasActiveCards = requests.some((r) => r.status === 'generating' || r.status === 'held')

  const publishLabels = {
    publishNow:   t('onDemandPosts.publishNow'),
    publishing:   t('onDemandPosts.publishing'),
    published:    t('onDemandPosts.published'),
    success:      t('onDemandPosts.publishSuccess'),
    notConnected: t('onDemandPosts.publishNotConnected'),
    notReady:     t('onDemandPosts.publishNotReady'),
    failed:       t('onDemandPosts.publishFailed'),
    confirm:      t('onDemandPosts.publishConfirm'),
  }

  return (
    <div className="space-y-6">
      <AutoRefresh hasActiveCards={hasActiveCards} />
      <PageHeader
        eyebrow={t('onDemandPosts.eyebrow')}
        title={t('onDemandPosts.title')}
        subtitle={t('onDemandPosts.subtitle')}
        action={
          <LinkButton href={newPostHref} leadingIcon={<Plus size={16} />}>
            {t('onDemandPosts.createNew')}
          </LinkButton>
        }
      />

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:gap-5">
        {requests.map((r) => {
          const status = r.status as Status
          const post = r.post
          // Determine media type: post (calendar_posts.media_type) takes precedence,
          // then fall back to on_demand_requests.media_type set at submit time.
          const isVideoCard = ((post as { media_type?: string } | null)?.media_type ?? (r as { media_type?: string }).media_type ?? 'image') === 'video'
          // For image posts: storage_url is the deliverable JPEG (usable as background-image).
          // For video posts: storage_url may be the intermediate keyframe JPEG or the final
          // MP4 — neither is usable as a CSS background-image, so we show a placeholder.
          const imageUrl = (!isVideoCard && post?.storage_url) ? post.storage_url : null
          // For video posts: only treat storage_url as a playable preview when it's
          // the final .mp4 (mirrors the detail page guard). While Kling is still
          // animating, storage_url holds the intermediate keyframe JPEG, so we keep
          // showing the ▶ placeholder instead of a broken <video>.
          const rawVideoUrl = isVideoCard ? (post?.storage_url ?? null) : null
          const videoUrl = rawVideoUrl && (/\.mp4([?#]|$)/i.test(rawVideoUrl) || /\/video\//.test(rawVideoUrl))
            ? rawVideoUrl
            : null
          // Generate-Then-Review: a 'held' row now carries real generated media,
          // but it must stay BLURRED until an admin approves — so we no longer
          // override 'held' to 'delivered' for videos. A 'failed'/rejected row's
          // media is hidden entirely. Clear media renders only for 'delivered'.
          const displayStatus: Status = status
          // Has a usable asset to show *blurred* while awaiting review.
          const heldMedia = status === 'held' ? (imageUrl ?? videoUrl) : null
          const captionAr = post?.caption_ar ?? null

          const detailsHref = `/${slug}/on-demand/${r.request_id}`
          return (
            <Link
              key={r.request_id}
              href={detailsHref}
              aria-label={t('onDemandPosts.openDetails')}
              className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) rounded-(--r-lg)"
            >
              <Card
                variant="default"
                interactive
                className="group relative overflow-hidden h-full"
              >
                {isVideoCard && status === 'delivered' ? (
                  videoUrl ? (
                    /* Video ready — hover-to-play preview with a centred play
                       badge while paused. Client component: plays on hover/focus,
                       rewinds on leave, so idle cards stay a still poster instead
                       of running N autoplaying clips at once. */
                    <VideoCardPreview src={videoUrl} />
                  ) : (
                    /* Still animating — keyframe is intermediate and the final MP4
                       isn't ready, so show the branded ▶ placeholder. */
                    <div
                      aria-hidden
                      className="flex aspect-square w-full items-center justify-center"
                      style={{
                        background: `linear-gradient(135deg, ${brand.primary_color_hex ?? '#10b981'}26, ${brand.primary_color_hex ?? '#10b981'}80)`,
                      }}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-3xl text-white/80" aria-hidden>▶</span>
                        <span className="text-[11px] font-medium text-white/70">
                          {t('onDemandPosts.videoGenerating')}
                        </span>
                      </div>
                    </div>
                  )
                ) : imageUrl && status === 'delivered' ? (
                  <div
                    aria-hidden
                    className="aspect-square w-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${imageUrl})` }}
                  />
                ) : status === 'held' ? (
                  /* ── Held: media generated but awaiting admin review. Show the
                       real asset BLURRED (scale up to hide blurred edges) with an
                       "Admin review required" overlay. Falls back to a synthetic
                       placeholder for pre-generation holds with no media yet. ── */
                  <div
                    aria-hidden
                    className="relative flex aspect-square w-full items-center justify-center overflow-hidden"
                    style={
                      heldMedia && !isVideoCard
                        ? undefined
                        : { background: `linear-gradient(135deg, ${brand.primary_color_hex ?? '#10b981'}18, ${brand.primary_color_hex ?? '#10b981'}40)` }
                    }
                  >
                    {heldMedia && !isVideoCard ? (
                      <div
                        className="absolute inset-0 scale-110 bg-cover bg-center blur-xl"
                        style={{ backgroundImage: `url(${heldMedia})` }}
                      />
                    ) : heldMedia && isVideoCard ? (
                      <video
                        src={heldMedia}
                        muted
                        preload="metadata"
                        className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center opacity-20">
                        <div className="h-20 w-20 rounded-2xl blur-xl" style={{ background: brand.primary_color_hex ?? '#10b981' }} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/25" />
                    <div className="relative z-10 flex flex-col items-center gap-2 px-4 text-center">
                      <Clock size={22} className="text-white/90" aria-hidden />
                      <p className="text-[11px] font-semibold leading-snug text-white drop-shadow">
                        {t('onDemandPosts.adminReviewRequired')}
                      </p>
                    </div>
                  </div>
                ) : status === 'failed' && (r as { failure_reason?: string | null }).failure_reason === 'admin_rejected' ? (
                  /* ── Rejected by admin ── */
                  <div
                    aria-hidden
                    className="flex aspect-square w-full items-center justify-center"
                    style={{ background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)' }}
                  >
                    <div className="flex flex-col items-center gap-2 px-4 text-center">
                      <span className="text-2xl" aria-hidden>✕</span>
                      <p className="text-[11px] font-medium leading-snug text-(--fg-subtle)">
                        {t('onDemandPosts.rejectedByAdmin')}
                      </p>
                    </div>
                  </div>
                ) : (
                  /* ── Generic no-image placeholder ── */
                  <div
                    aria-hidden
                    className="flex aspect-square w-full items-center justify-center"
                    style={{
                      background: `linear-gradient(135deg, ${brand.primary_color_hex ?? '#10b981'}26, ${brand.primary_color_hex ?? '#10b981'}80)`,
                    }}
                  >
                    <Sparkles size={28} className="text-white/60" aria-hidden />
                  </div>
                )}

                {/* Action icons — top-end corner overlay, only when usable media
                    exists. `stopPropagation` keeps clicks from triggering the
                    parent <Link>. RTL flips the corner via end-2 so the stack
                    always sits on the reading-direction edge. */}
                {status === 'delivered' && (imageUrl || videoUrl) && (
                  <div className="absolute top-2 end-2 flex items-center gap-1.5">
                    {imageUrl && (
                      <OnDemandDownloadButton
                        requestId={r.request_id}
                        label={t('onDemandPosts.downloadImage')}
                        variant="icon"
                        stopPropagation
                      />
                    )}
                    <PublishNowButton
                      slug={slug}
                      requestId={r.request_id}
                      labels={publishLabels}
                      alreadyPublished={post?.publish_status === 'published'}
                      variant="icon"
                      stopPropagation
                    />
                  </div>
                )}

                <CardBody className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={statusTone(displayStatus)} dot>
                      {displayStatus === 'failed' && (r as { failure_reason?: string | null }).failure_reason === 'admin_rejected'
                        ? t('onDemandPosts.rejectedByAdmin')
                        : t(`onDemandPosts.statusLabel.${displayStatus}` as const)}
                    </Badge>
                  </div>

                  {captionAr && status === 'delivered' ? (
                    <p
                      dir="rtl"
                      className="line-clamp-3 text-sm leading-relaxed text-(--fg-subtle)"
                    >
                      {captionAr}
                    </p>
                  ) : (
                    <p className="line-clamp-3 text-xs italic text-(--fg-muted)">
                      {status === 'held'
                        ? t('onDemandPosts.captionHeld')
                        : (status === 'failed' && (r as { failure_reason?: string | null }).failure_reason === 'admin_rejected')
                          ? t('onDemandPosts.captionRejected')
                          : status === 'failed'
                            ? t('onDemandPosts.captionFailed')
                            : t('onDemandPosts.captionPending')}
                    </p>
                  )}

                  <div className="flex items-center justify-between border-t border-(--border-subtle) pt-2 text-[11px] text-(--fg-faint)">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} aria-hidden />
                      {formatDate(r.posting_time ?? r.created_at, locale)}
                    </span>
                    <span className="font-mono uppercase tracking-wide">{r.platform}</span>
                  </div>
                </CardBody>
              </Card>
            </Link>
          )
        })}
      </div>

      {paged.pageCount > 1 ? (
        <Pagination
          slug={slug}
          page={currentPage}
          pageCount={paged.pageCount}
          summary={t('onDemandPosts.pagination.summary', {
            from,
            to,
            total: paged.total,
          })}
          pageLabel={t('onDemandPosts.pagination.page', {
            page: currentPage,
            total: paged.pageCount,
          })}
          previousLabel={t('onDemandPosts.pagination.previous')}
          nextLabel={t('onDemandPosts.pagination.next')}
          goToPageLabel={(p: number) =>
            t('onDemandPosts.pagination.goToPage', { page: p })
          }
          locale={locale}
        />
      ) : null}
    </div>
  )
}

/**
 * Pagination control. Renders:
 *   - a textual "Showing X–Y of Z" summary,
 *   - prev / next buttons (disabled at the edges),
 *   - a windowed list of page links (first, last, current ±1, with ellipses).
 *
 * Layout responsiveness:
 *   - Mobile (< sm): summary stacks above the controls and the page-number
 *     window collapses to "Page N of M" so we never overflow the viewport.
 *   - sm and up: summary on the leading edge, controls on the trailing edge.
 *
 * RTL: the parent <html dir> drives chevron mirroring. We use logical
 * `ChevronLeft` for "previous" (start side) and `ChevronRight` for "next"
 * (end side); the browser flips them automatically in RTL via the dir attr
 * on the surrounding nav.
 */
function Pagination({
  slug,
  page,
  pageCount,
  summary,
  pageLabel,
  previousLabel,
  nextLabel,
  goToPageLabel,
  locale,
}: {
  slug: string
  page: number
  pageCount: number
  summary: string
  pageLabel: string
  previousLabel: string
  nextLabel: string
  goToPageLabel: (p: number) => string
  locale: 'ar' | 'en'
}) {
  const hrefFor = (p: number) =>
    p <= 1 ? `/${slug}/on-demand` : `/${slug}/on-demand?page=${p}`
  const prevDisabled = page <= 1
  const nextDisabled = page >= pageCount
  const window = pageWindow(page, pageCount)
  const isRtl = locale === 'ar'

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-3 border-t border-(--border-subtle) pt-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-xs text-(--fg-faint) sm:text-sm">{summary}</p>

      <div className="flex items-center justify-center gap-1.5 sm:justify-end">
        <PageLink
          href={hrefFor(page - 1)}
          disabled={prevDisabled}
          aria-label={previousLabel}
        >
          {isRtl ? <ChevronRight size={14} aria-hidden /> : <ChevronLeft size={14} aria-hidden />}
          <span className="hidden sm:inline">{previousLabel}</span>
        </PageLink>

        {/* Mobile: collapse the page-number window to a single label. */}
        <span className="px-2 text-xs text-(--fg-subtle) sm:hidden">{pageLabel}</span>

        <ol className="hidden items-center gap-1 sm:flex">
          {window.map((entry, idx) =>
            entry === 'gap' ? (
              <li
                key={`gap-${idx}`}
                aria-hidden
                className="px-1.5 text-(--fg-faint) select-none"
              >
                …
              </li>
            ) : (
              <li key={entry}>
                <PageLink
                  href={hrefFor(entry)}
                  active={entry === page}
                  aria-label={goToPageLabel(entry)}
                  aria-current={entry === page ? 'page' : undefined}
                >
                  {entry}
                </PageLink>
              </li>
            ),
          )}
        </ol>

        <PageLink
          href={hrefFor(page + 1)}
          disabled={nextDisabled}
          aria-label={nextLabel}
        >
          <span className="hidden sm:inline">{nextLabel}</span>
          {isRtl ? <ChevronLeft size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </PageLink>
      </div>
    </nav>
  )
}

function PageLink({
  href,
  active = false,
  disabled = false,
  children,
  ...rest
}: {
  href: string
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'>) {
  const base =
    'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-colors'
  const tone = active
    ? 'bg-(--accent) text-white shadow-sm'
    : 'border border-(--border-subtle) text-(--fg-subtle) hover:bg-(--surface-3) hover:text-(--fg)'
  const disabledStyle = 'pointer-events-none cursor-not-allowed opacity-40'

  if (disabled) {
    return (
      <span
        aria-disabled
        className={`${base} ${tone} ${disabledStyle}`}
        {...rest}
      >
        {children}
      </span>
    )
  }
  return (
    <a href={href} className={`${base} ${tone}`} {...rest}>
      {children}
    </a>
  )
}

/**
 * Build a windowed list of page numbers around the current page:
 *   1, …, p-1, p, p+1, …, last
 * Edges always shown; gaps shown as 'gap' tokens. Returns at most 7 entries.
 */
function pageWindow(page: number, pageCount: number): Array<number | 'gap'> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  const out: Array<number | 'gap'> = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pageCount - 1, page + 1)
  if (start > 2) out.push('gap')
  for (let p = start; p <= end; p++) out.push(p)
  if (end < pageCount - 1) out.push('gap')
  out.push(pageCount)
  return out
}
