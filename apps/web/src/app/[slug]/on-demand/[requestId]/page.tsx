import Link from 'next/link'
import { notFound } from 'next/navigation'
import { onDemandQ } from '@repo/db'
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { PageHeader } from '@repo/ui/page-header'
import { Card, CardBody, CardHeader, CardTitle } from '@repo/ui/card'
import { Badge } from '@repo/ui/badge'
import { ArrowLeft, Clock, Sparkles } from '@repo/ui/icons'
import { getServerT } from '@/lib/i18n-server'
import { formatDate } from '@/lib/format'
import { OnDemandDownloadButton } from '../download-button'
import { PublishNowButton } from '../publish-button'
import { RegenerateButton } from '../regenerate-button'
import { AutoRefresh } from '../auto-refresh'
import { OnDemandImageViewer, type RevisionEntry } from '../image-history-viewer'
import { CleanImageCard } from '../clean-image-card'
import { RevisionProvider } from '../on-demand-revision-context'

export const dynamic = 'force-dynamic'

type Status = 'queued' | 'generating' | 'delivered' | 'held' | 'failed'

function statusTone(s: Status): 'success' | 'warning' | 'info' | 'danger' | 'neutral' {
  switch (s) {
    case 'delivered':  return 'success'
    case 'generating': return 'info'
    case 'queued':     return 'neutral'
    case 'held':       return 'warning'
    case 'failed':     return 'danger'
  }
}

export default async function OnDemandDetailsPage({
  params,
}: {
  params: Promise<{ slug: string; requestId: string }>
}) {
  const { slug, requestId } = await params
  const { locale, t } = await getServerT()

  const brand = await getBrandForCurrentUser(slug)
  if (!brand) notFound()

  const userClient = await getUserScopedClient()
  // Same defensive pattern as the listing — RLS already gates by ownership,
  // but a missing migration / stale row should not blow up into error.tsx.
  let row: Awaited<ReturnType<typeof onDemandQ.getOnDemandRequestById>> = null
  try {
    row = await onDemandQ.getOnDemandRequestById(requestId, userClient)
  } catch (err) {
    console.error('[on-demand:details] query failed:', err)
  }
  if (!row) notFound()

  const status = row.status as Status
  const post = row.post
  // Cast only for JSONB fields not on the hand-maintained CalendarPost type.
  // media_type IS on CalendarPost (types.ts line 151) so read it directly from post.
  const postJsonb = post as unknown as {
    revision_count?: number
    revision_history?: RevisionEntry[] | string
    clean_storage_url?: string | null
  } | null

  // What was actually produced (post) takes precedence; fall back to what was
  // requested (request row). Defaults to 'image' for every legacy row.
  // calendar_posts.media_type is set by the n8n pipeline on insert (mig 0075).
  // on_demand_requests.media_type is the reliable fallback for older pipeline rows.
  const isVideo = (((post as { media_type?: string } | null)?.media_type ?? (row as { media_type?: string }).media_type ?? 'image') as string) === 'video'

  const revisionCount   = postJsonb?.revision_count ?? 0
  // PostgREST/JSONB can return revision_history as either a parsed array OR a
  // JSON string (depending on how the n8n Supabase node wrote it). Coerce to
  // an array defensively so the viewer never sees a non-iterable.
  const rawHistory = postJsonb?.revision_history
  let revisionHistory: RevisionEntry[] = []
  if (Array.isArray(rawHistory)) {
    revisionHistory = rawHistory
  } else if (typeof rawHistory === 'string' && rawHistory.length > 0) {
    try {
      const parsed = JSON.parse(rawHistory)
      if (Array.isArray(parsed)) revisionHistory = parsed as RevisionEntry[]
    } catch {
      // malformed JSON in the column — fall through with [].
    }
  }
  const rawStorageUrl = post?.storage_url ?? null
  // For video posts the two-model pipeline (Flux keyframe → Kling MP4) first
  // writes the keyframe JPEG into storage_url, then overwrites it with the MP4
  // after the animation step completes. A JPEG URL must not be fed to <video>.
  // Guard: treat the storage_url as a usable video URL only when the path ends
  // with .mp4 or contains '/video/' (i.e. the final Kling artifact is present).
  const isStorageUrlVideo = rawStorageUrl
    ? /\.mp4([?#]|$)/i.test(rawStorageUrl) || /\/video\//.test(rawStorageUrl)
    : false
  const rawImageUrl = rawStorageUrl
  // Cache-bust with ?v={revision_count} so the browser re-fetches after each
  // regeneration (same storage path is overwritten — URL alone never changes).
  const imageUrl = rawImageUrl
    ? `${rawImageUrl}${rawImageUrl.includes('?') ? '&' : '?'}v=${revisionCount}`
    : null
  // For video posts: only expose the player URL when the stored artifact is
  // actually an mp4 file. Prevents an empty/broken <video> element while Kling
  // is still animating (storage_url holds the intermediate keyframe JPEG).
  const videoUrl = (isVideo && isStorageUrlVideo) ? imageUrl : null
  // Generate-Then-Review: 'held' rows now carry real generated media but must
  // stay blurred until an admin approves, so we no longer override 'held' to
  // 'delivered'. Clear media renders only for 'delivered'; held media is blurred.
  const displayStatus: Status = status
  // Usable asset to show *blurred* while awaiting review. For video use only the
  // final .mp4 (videoUrl); never feed the keyframe JPEG into <video>.
  const heldMedia = status === 'held' ? (isVideo ? videoUrl : imageUrl) : null
  // Clean (no-overlay) variant — NULL for legacy posts predating migration 0036.
  const rawCleanUrl = postJsonb?.clean_storage_url ?? null
  const cleanImageUrl = rawCleanUrl
    ? `${rawCleanUrl}${rawCleanUrl.includes('?') ? '&' : '?'}v=${revisionCount}`
    : null
  const captionAr = post?.caption_ar ?? null
  const hashtags = post?.hashtags?.length ? post.hashtags : row.hashtags

  const listingHref = `/${slug}/on-demand`

  const isActive = status === 'generating' || status === 'held'

  return (
    <div className="space-y-6">
      <AutoRefresh hasActiveCards={isActive} />
      <Link
        href={listingHref}
        className="inline-flex items-center gap-1.5 text-xs text-(--fg-muted) hover:text-(--fg) transition-colors"
      >
        <ArrowLeft size={14} aria-hidden /> {t('onDemandPosts.details.back')}
      </Link>

      <PageHeader
        eyebrow={t('onDemandPosts.details.eyebrow')}
        title={row.occasion_name?.startsWith('__seed__') || !row.occasion_name
          ? row.hero_concept.split(/[.\n]/)[0].slice(0, 60)
          : row.occasion_name.slice(0, 60)}
        subtitle={`${row.platform} · ${row.canvas}`}
        action={
          <Badge tone={statusTone(displayStatus)} dot>
            {(row as { failure_reason?: string | null }).failure_reason === 'admin_rejected'
              ? t('onDemandPosts.rejectedByAdmin')
              : t(`onDemandPosts.statusLabel.${displayStatus}` as const)}
          </Badge>
        }
      />

      <RevisionProvider initialCleanUrl={cleanImageUrl}>
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_22rem]">
        {/* ─── Image + caption ─────────────────────────────────── */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t(isVideo ? 'onDemandPosts.details.videoSection' : 'onDemandPosts.details.imageSection')}</CardTitle>
              {imageUrl && status === 'delivered' && (
                <OnDemandDownloadButton
                  requestId={row.request_id}
                  label={t(isVideo ? 'onDemandPosts.downloadVideo' : 'onDemandPosts.downloadImage')}
                  variant="icon"
                />
              )}
            </CardHeader>
            <CardBody>
              {videoUrl && status === 'delivered' ? (
                /* Video result — native player with play/pause/seek. 9:16 chains
                   produce vertical clips; max-h keeps tall video in view.
                   Only reached when storage_url holds the final .mp4 from Kling
                   (guarded by isStorageUrlVideo check above). */
                <video
                  src={videoUrl}
                  controls
                  preload="metadata"
                  playsInline
                  className="mx-auto max-h-[70vh] w-full rounded-(--r-md) bg-black"
                >
                  {t('onDemandPosts.details.videoUnsupported')}
                </video>
              ) : status === 'held' ? (
                /* Held — real generated media shown BLURRED with an "Admin review
                   required" overlay until approval. Pre-generation holds (no media
                   yet) fall back to the synthetic blurred placeholder. */
                <div
                  className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-(--r-md)"
                  style={
                    heldMedia
                      ? undefined
                      : { background: `linear-gradient(135deg, ${brand.primary_color_hex ?? '#10b981'}18, ${brand.primary_color_hex ?? '#10b981'}40)` }
                  }
                >
                  {heldMedia && isVideo ? (
                    <video src={heldMedia} muted preload="metadata" className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl" />
                  ) : heldMedia ? (
                    <div className="absolute inset-0 scale-110 bg-cover bg-center blur-2xl" style={{ backgroundImage: `url(${heldMedia})` }} />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center opacity-20">
                      <div className="h-32 w-32 rounded-3xl blur-2xl" style={{ background: brand.primary_color_hex ?? '#10b981' }} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/30" />
                  <div className="relative z-10 flex flex-col items-center gap-3 px-8 text-center">
                    <Clock size={32} className="text-white/90" aria-hidden />
                    <p className="text-sm font-semibold leading-snug text-white drop-shadow">
                      {t('onDemandPosts.adminReviewRequired')}
                    </p>
                    <p className="text-xs text-white/80">
                      {t('onDemandPosts.captionHeld')}
                    </p>
                  </div>
                </div>
              ) : isVideo && !videoUrl && status !== 'failed' ? (
                /* Video requested but the final .mp4 is not yet available —
                   the pipeline is still in the Flux keyframe phase or Kling
                   animation step. Show a branded placeholder instead of an
                   empty/broken <video> element. */
                <div
                  className="flex aspect-video w-full items-center justify-center rounded-(--r-md)"
                  style={{
                    background: `linear-gradient(135deg, ${brand.primary_color_hex ?? '#10b981'}26, ${brand.primary_color_hex ?? '#10b981'}80)`,
                  }}
                >
                  <div className="flex flex-col items-center gap-3 text-white/80">
                    <span className="text-5xl" aria-hidden>▶</span>
                    <span className="text-sm font-medium">{t('onDemandPosts.details.videoGenerating')}</span>
                  </div>
                </div>
              ) : imageUrl && status === 'delivered' ? (
                <OnDemandImageViewer
                  currentUrl={imageUrl}
                  alt={row.hero_concept}
                  revisionHistory={revisionHistory}
                  brandColor={brand.primary_color_hex ?? '#10b981'}
                  currentCleanUrl={cleanImageUrl}
                />
              ) : status === 'failed' && (row as { failure_reason?: string | null }).failure_reason === 'admin_rejected' ? (
                /* Rejected by admin */
                <div
                  className="flex aspect-square w-full items-center justify-center rounded-(--r-md)"
                  style={{ background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)' }}
                >
                  <div className="flex flex-col items-center gap-3 px-8 text-center">
                    <span className="text-4xl" aria-hidden>✕</span>
                    <p className="text-sm font-medium text-(--fg-subtle)">{t('onDemandPosts.rejectedByAdmin')}</p>
                  </div>
                </div>
              ) : (
                /* Generic pending/generating placeholder */
                <div
                  className="flex aspect-square w-full items-center justify-center rounded-(--r-md)"
                  style={{
                    background: `linear-gradient(135deg, ${brand.primary_color_hex ?? '#10b981'}26, ${brand.primary_color_hex ?? '#10b981'}80)`,
                  }}
                >
                  <div className="flex flex-col items-center gap-2 text-(--fg-muted)">
                    <Sparkles size={28} aria-hidden />
                    <span className="text-xs">{t('onDemandPosts.details.noImage')}</span>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('onDemandPosts.details.captionSection')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {captionAr && status === 'delivered' ? (
                <p dir="rtl" className="text-sm leading-relaxed text-(--fg)">
                  {captionAr}
                </p>
              ) : (
                <p className="text-sm italic text-(--fg-muted)">
                  {status === 'held'
                    ? t('onDemandPosts.captionHeld')
                    : status === 'failed' && (row as { failure_reason?: string | null }).failure_reason === 'admin_rejected'
                      ? t('onDemandPosts.captionRejected')
                      : status === 'failed'
                        ? t('onDemandPosts.captionFailed')
                        : t('onDemandPosts.captionPending')}
                </p>
              )}
              {hashtags.length > 0 && status === 'delivered' && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {hashtags.map((h) => (
                    <Badge key={h} tone="outline" size="sm">{h}</Badge>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ─── Sidebar: brief + meta ───────────────────────────── */}
        <aside className="space-y-5 lg:sticky lg:top-28">
          {/* Publish now — only for delivered posts with final media (for
              video that means the Kling .mp4, never the keyframe JPEG). */}
          {status === 'delivered' && (isVideo ? videoUrl : imageUrl) && (
            <PublishNowButton
              slug={slug}
              requestId={row.request_id}
              labels={{
                publishNow:   t('onDemandPosts.publishNow'),
                publishing:   t('onDemandPosts.publishing'),
                published:    t('onDemandPosts.published'),
                success:      t('onDemandPosts.publishSuccess'),
                notConnected: t('onDemandPosts.publishNotConnected'),
                notReady:     t('onDemandPosts.publishNotReady'),
                failed:       t('onDemandPosts.publishFailed'),
                confirm:      t('onDemandPosts.publishConfirm'),
              }}
              alreadyPublished={post?.publish_status === 'published'}
              variant="full"
            />
          )}

          {imageUrl && status === 'delivered' && (
            <OnDemandDownloadButton
              requestId={row.request_id}
              label={t(isVideo ? 'onDemandPosts.downloadVideo' : 'onDemandPosts.downloadImage')}
              variant="full"
            />
          )}

          {/* Regenerate — show whenever a linked post_id exists, EXCEPT while the
              post is held for admin review (Generate-Then-Review): the client
              must not regenerate moderated content before a decision.
              Prefer row.post_id (FK column on on_demand_requests) which is
              set as soon as the calendar_posts row is created, even before
              the on_demand_request_id back-reference is filled in. */}
          {status !== 'held' && (row.post_id ?? row.post?.post_id) && (
            <RegenerateButton
              slug={slug}
              requestId={row.request_id}
              postId={(row.post_id ?? row.post?.post_id)!}
              brandId={row.brand_id}
              revisionCount={revisionCount}
              previousPrompt={row.style_descriptor ?? null}
              currentImageUrl={rawStorageUrl}
              isVideo={isVideo}
            />
          )}

          {/* Clean (text-free) variant is image-only — video has no overlay/clean pair.
              Only shown when delivered: held posts blur all assets until approval,
              and rejected posts must never expose the generated image. */}
          {!isVideo && status === 'delivered' && (
            <CleanImageCard
              requestId={row.request_id}
              alt={row.hero_concept}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('onDemandPosts.details.briefSection')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5 text-sm">
              <Row
                label={t('onDemandPosts.details.field.mediaType')}
                value={t(`onDemandPosts.details.mediaTypeValue.${isVideo ? 'video' : 'image'}` as const)}
              />
              <Row label={t('onDemandPosts.details.field.contentType')} value={row.content_type} />
              <Row label={t('onDemandPosts.details.field.objective')}   value={row.objective} />
              <Row label={t('onDemandPosts.details.field.platform')}    value={row.platform} />
              <Row label={t('onDemandPosts.details.field.canvas')}      value={row.canvas} />
              {row.occasion_name && !row.occasion_name.startsWith('__seed__') && (
                <Row label={t('onDemandPosts.details.field.occasion')} value={row.occasion_name} />
              )}
              <RowMulti
                label={t('onDemandPosts.details.field.styleDescriptor')}
                value={row.style_descriptor}
              />
              <RowMulti
                label={t('onDemandPosts.details.field.heroConcept')}
                value={row.hero_concept}
              />
              {row.color_palette.length > 0 && (
                <div className="space-y-1.5 border-b border-(--border-subtle) pb-2 last:border-0 last:pb-0">
                  <span className="text-(--fg-muted) text-xs">
                    {t('onDemandPosts.details.field.colorPalette')}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {row.color_palette.map((c) => (
                      <span
                        key={c}
                        title={c}
                        className="inline-flex items-center gap-1.5 rounded-(--r-sm) border border-(--border-subtle) px-2 py-1 text-[11px] font-mono text-(--fg-subtle)"
                      >
                        <span
                          aria-hidden
                          className="h-3 w-3 rounded-full border border-(--border-default)"
                          style={{ backgroundColor: c }}
                        />
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('onDemandPosts.details.metaSection')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5 text-sm">
              <Row
                label={t('onDemandPosts.details.field.status')}
                value={(row as { failure_reason?: string | null }).failure_reason === 'admin_rejected'
                  ? t('onDemandPosts.rejectedByAdmin')
                  : t(`onDemandPosts.statusLabel.${status}` as const)}
              />
              <Row
                label={t('onDemandPosts.details.field.postingTime')}
                value={formatDate(row.posting_time, locale)}
              />
              <Row
                label={t('onDemandPosts.details.field.submittedAt')}
                value={formatDate(row.created_at, locale)}
              />
              <Row
                label={t('onDemandPosts.details.field.deliveredAt')}
                value={formatDate(row.delivered_at, locale)}
              />
              {row.failure_reason && (
                <RowMulti
                  label={t('onDemandPosts.details.field.failureReason')}
                  value={row.failure_reason}
                />
              )}
              <Row
                label={t('onDemandPosts.details.field.requestId')}
                value={row.request_id.slice(0, 8)}
                mono
              />
            </CardBody>
          </Card>
        </aside>
      </div>
      </RevisionProvider>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-(--border-subtle) pb-2 last:border-0 last:pb-0">
      <span className="shrink-0 text-(--fg-muted) text-xs">{label}</span>
      <span className={`min-w-0 truncate font-medium text-(--fg) text-end ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function RowMulti({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 border-b border-(--border-subtle) pb-2 last:border-0 last:pb-0">
      <span className="text-(--fg-muted) text-xs">{label}</span>
      <p className="line-clamp-4 text-(--fg) text-sm leading-relaxed">{value}</p>
    </div>
  )
}
