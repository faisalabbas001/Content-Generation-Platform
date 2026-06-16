'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { adminClient } from '@repo/db'
import { getBrandForCurrentUser } from '@repo/auth/server'
import { notify } from '@repo/email'
import { triggerN8nB03Revision } from '@/lib/n8n-outbound'
import {
  postizUploadFromUrl,
  postizCreatePost,
  postizDeletePost,
  postizListPosts,
} from '@/lib/postiz'

export interface PostActionResult {
  ok: boolean
  error?: string
  /** New publish_status after the action, when it changed. */
  publishStatus?: string
}

// ─── Postiz sync helpers (server-only, shared by the publish actions) ────────

function getIgChannel(db: ReturnType<typeof adminClient>, brandId: string) {
  return db
    .from('channel_profiles')
    .select('postiz_channel_id')
    .eq('brand_id', brandId)
    .eq('channel', 'Instagram')
    .not('postiz_channel_id', 'is', null)
    .maybeSingle()
    .then(({ data }) => (data?.postiz_channel_id as string | undefined) ?? null)
}

type SyncablePost = {
  post_id: string
  caption_ar: string | null
  hashtags: string[] | null
  storage_url: string | null
  media_type?: string | null
}

/**
 * Pushes one calendar post into Postiz: signs the storage URL, uploads the
 * media into Postiz's library, creates the post (type 'now' or 'schedule').
 * Returns the Postiz post id. Throws on any failure — callers map that to
 * publish_status='failed'.
 */
async function syncToPostiz(
  db: ReturnType<typeof adminClient>,
  post: SyncablePost,
  channelId: string,
  apiKey: string,
  type: 'now' | 'schedule',
  dateIso: string,
): Promise<string> {
  if (!post.storage_url) throw new Error('post has no media')
  const m = post.storage_url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/)
  if (!m) throw new Error(`cannot parse storage_url: ${post.storage_url}`)
  const [, bucket, rawPath] = m
  const { data: signed, error: signErr } = await db.storage
    .from(bucket)
    .createSignedUrl(decodeURIComponent(rawPath), 3600)
  if (signErr || !signed?.signedUrl) throw new Error(`sign failed: ${signErr?.message}`)

  const isVideo = (post.media_type ?? 'image') === 'video'
  const media = await postizUploadFromUrl(
    apiKey,
    signed.signedUrl,
    `${post.post_id}.${isVideo ? 'mp4' : 'jpg'}`,
  )
  const caption = [post.caption_ar, (post.hashtags ?? []).join(' ')].filter(Boolean).join('\n\n')
  return postizCreatePost(apiKey, { type, date: dateIso, channelId, caption, media })
}

const VALID_INTENTS = ['launch', 'grow', 'defend', 'harvest', 'recover'] as const
type IntentOverride = typeof VALID_INTENTS[number]

export async function setCalendarIntentOverride(
  calendarId: string,
  slug: string,
  intentOverride: IntentOverride | null,
): Promise<PostActionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }
  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string
  if (intentOverride !== null && !VALID_INTENTS.includes(intentOverride)) {
    return { ok: false, error: 'Invalid intent value.' }
  }
  try {
    const db = adminClient()
    const { error } = await db
      .from('calendars')
      .update({ intent_override: intentOverride })
      .eq('calendar_id', calendarId)
      .eq('brand_id', brandId)
    if (error) throw error
    revalidatePath(`/${slug}/calendar`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Failed to save intent override.' }
  }
}

export async function selectCaptionVariant(
  postId: string,
  slug: string,
  variantIndex: 0 | 1 | 2,
): Promise<PostActionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }
  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string
  try {
    const db = adminClient()
    const { data: post, error: fetchErr } = await db
      .from('calendar_posts')
      .select('caption_variants')
      .eq('post_id', postId)
      .eq('brand_id', brandId)
      .single()
    if (fetchErr || !post) return { ok: false, error: 'Post not found.' }
    const variants = post.caption_variants as Array<{ caption_ar: string; hashtags: string[]; tone: string }> | null
    if (!variants || variants.length < 3) return { ok: false, error: 'No variants available.' }
    const chosen = variants[variantIndex]
    const { error } = await db
      .from('calendar_posts')
      .update({
        caption_ar: chosen.caption_ar,
        hashtags: chosen.hashtags,
        selected_variant_index: variantIndex,
      })
      .eq('post_id', postId)
      .eq('brand_id', brandId)
    if (error) throw error

    // Content changed — if the post is already queued in Postiz, the queued
    // copy holds the OLD caption. Re-sync: delete + recreate at the same time.
    await resyncScheduledPost(db, postId, brandId).catch((e) =>
      console.error(`[selectCaptionVariant] Postiz re-sync failed post_id=${postId}:`, e),
    )

    revalidatePath(`/${slug}/calendar`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Failed to select variant.' }
  }
}

/**
 * If the post is currently scheduled in Postiz, replace the queued copy with
 * the post's CURRENT content/media at the same posting_time. Used after any
 * content mutation (caption variant selection, regeneration) so the queue
 * never publishes stale content. No-op for unscheduled/published posts.
 */
async function resyncScheduledPost(
  db: ReturnType<typeof adminClient>,
  postId: string,
  brandId: string,
): Promise<void> {
  const { data: post } = await db
    .from('calendar_posts')
    .select('publish_status, postiz_post_id, posting_time, caption_ar, hashtags, storage_url, media_type, post_id')
    .eq('post_id', postId)
    .eq('brand_id', brandId)
    .maybeSingle()
  if (!post || post.publish_status !== 'scheduled' || !post.postiz_post_id) return

  const apiKey = process.env.POSTIZ_API_KEY
  if (!apiKey) return
  const channelId = await getIgChannel(db, brandId)
  if (!channelId) return
  const postingTime = post.posting_time ? new Date(post.posting_time) : null
  if (!postingTime || postingTime <= new Date()) return

  await postizDeletePost(apiKey, post.postiz_post_id as string)
  try {
    const newId = await syncToPostiz(
      db, post as SyncablePost, channelId, apiKey, 'schedule', postingTime.toISOString(),
    )
    await db
      .from('calendar_posts')
      .update({ postiz_post_id: newId })
      .eq('post_id', postId)
      .eq('brand_id', brandId)
  } catch (err) {
    // Old queue entry is gone and recreate failed — reflect honestly.
    await db
      .from('calendar_posts')
      .update({ publish_status: 'unscheduled', postiz_post_id: null, publish_requested_at: null })
      .eq('post_id', postId)
      .eq('brand_id', brandId)
    throw err
  }
}

export async function approvePost(postId: string, slug: string): Promise<PostActionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }

  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  try {
    const db = adminClient()

    // Approve is a pure content decision — it does NOT schedule publishing.
    // publish_status stays null until the client explicitly clicks "Publish"
    // (see publishPost), which is when N8N-P01 is triggered.
    const { error } = await db
      .from('calendar_posts')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('post_id', postId)
      .eq('brand_id', brandId)

    if (error) throw error
    revalidatePath(`/${slug}/calendar`)

    if (brand.auth_user_id) {
      // after() — the email (Resend can retry for seconds) runs AFTER the
      // response is sent, so Approve feels instant. Unlike fire-and-forget,
      // after() keeps the serverless function alive until it completes.
      after(() =>
        fireNotifyApproved(db, brand, brandId, postId).catch((e) =>
          console.error('[approvePost] notify error:', e),
        ),
      )
    }

    return { ok: true }
  } catch {
    return { ok: false, error: 'Failed to approve post.' }
  }
}

/**
 * Schedule publishing — fired when the client clicks "Schedule" on an
 * approved post. Pushes the post straight into Postiz (type:'schedule'):
 * Postiz owns the time queue and publishes at that moment even if our app
 * is down. No n8n involved.
 *
 * scheduleTimeIso (optional): a user-chosen time from the schedule panel.
 * When provided it replaces posting_time (the user accepted or edited the
 * recommended slot). When absent, posting_time is used; a past posting_time
 * is rejected with a clear error so the user picks a new time.
 */
export async function publishPost(
  postId: string,
  slug: string,
  scheduleTimeIso?: string,
): Promise<PostActionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }

  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  try {
    const db = adminClient()

    const { data: existing } = await db
      .from('calendar_posts')
      .select('status, posting_time, publish_status, publish_requested_at, caption_ar, hashtags, storage_url, media_type, post_id, scheduled_date')
      .eq('post_id', postId)
      .eq('brand_id', brandId)
      .maybeSingle()

    if (!existing) return { ok: false, error: 'Post not found.' }
    if (existing.status !== 'approved') {
      return { ok: false, error: 'Approve the post before publishing.' }
    }
    // Idempotent — already scheduled or live.
    if (existing.publish_status === 'scheduled' || existing.publish_status === 'published') {
      return { ok: true, publishStatus: existing.publish_status }
    }

    // Resolve the schedule time: explicit user choice wins over posting_time.
    let postingTime: Date | null = null
    if (scheduleTimeIso) {
      postingTime = new Date(scheduleTimeIso)
      if (isNaN(postingTime.getTime())) return { ok: false, error: 'Invalid date.' }
      if (postingTime <= new Date()) return { ok: false, error: 'Pick a time in the future.' }
      // Persist the chosen time so calendar views + the countdown agree.
      // When the DATE changes, remember the original day in scheduled_date
      // (once) so the calendar can show a "moved to …" marker on the old cell.
      const prevDay = existing.posting_time ? String(existing.posting_time).slice(0, 10) : null
      const newDay = postingTime.toISOString().slice(0, 10)
      const existingScheduledDate = (existing as { scheduled_date?: string | null }).scheduled_date
      await db
        .from('calendar_posts')
        .update({
          posting_time: postingTime.toISOString(),
          ...(prevDay && prevDay !== newDay && !existingScheduledDate
            ? { scheduled_date: prevDay }
            : {}),
        })
        .eq('post_id', postId)
        .eq('brand_id', brandId)
    } else {
      postingTime = existing.posting_time ? new Date(existing.posting_time) : null
    }
    if (!postingTime || postingTime <= new Date()) {
      // Recommended slot already passed — don't dead-end into manual_required;
      // tell the user to pick a new time in the schedule panel.
      return { ok: false, error: 'This post\'s recommended time has passed — pick a new time to schedule it.' }
    }

    const channelId = await getIgChannel(db, brandId)
    if (!channelId) {
      return { ok: false, error: 'Connect your Instagram account in Settings first.' }
    }
    const apiKey = process.env.POSTIZ_API_KEY
    if (!apiKey) return { ok: false, error: 'Publishing is not configured yet.' }

    let postizPostId: string
    try {
      postizPostId = await syncToPostiz(
        db, existing as SyncablePost, channelId, apiKey, 'schedule', postingTime.toISOString(),
      )
    } catch (err) {
      console.error(`[publishPost] Postiz schedule failed post_id=${postId}:`, err)
      await db
        .from('calendar_posts')
        .update({ publish_requested_at: new Date().toISOString(), publish_status: 'failed' })
        .eq('post_id', postId)
        .eq('brand_id', brandId)
      revalidatePath(`/${slug}/calendar`)
      return { ok: true, publishStatus: 'failed', error: 'Scheduling failed. Try again or publish manually.' }
    }

    const { error } = await db
      .from('calendar_posts')
      .update({
        publish_requested_at: new Date().toISOString(),
        publish_status: 'scheduled',
        postiz_post_id: postizPostId,
      })
      .eq('post_id', postId)
      .eq('brand_id', brandId)
    if (error) throw error

    revalidatePath(`/${slug}/calendar`)
    return { ok: true, publishStatus: 'scheduled' }
  } catch {
    return { ok: false, error: 'Failed to publish post.' }
  }
}

/**
 * Publish immediately — skips the schedule and posts to Instagram right now.
 * If the post was already scheduled in Postiz, the queued copy is removed
 * first so it can't double-publish.
 */
export async function publishNowPost(postId: string, slug: string): Promise<PostActionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }
  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  try {
    const db = adminClient()
    const { data: post } = await db
      .from('calendar_posts')
      .select('status, publish_status, postiz_post_id, caption_ar, hashtags, storage_url, media_type, post_id')
      .eq('post_id', postId)
      .eq('brand_id', brandId)
      .maybeSingle()

    if (!post) return { ok: false, error: 'Post not found.' }
    if (post.status !== 'approved') return { ok: false, error: 'Approve the post before publishing.' }
    if (post.publish_status === 'published') return { ok: true, publishStatus: 'published' }

    const channelId = await getIgChannel(db, brandId)
    if (!channelId) return { ok: false, error: 'Connect your Instagram account in Settings first.' }
    const apiKey = process.env.POSTIZ_API_KEY
    if (!apiKey) return { ok: false, error: 'Publishing is not configured yet.' }

    // Remove the queued copy first — never double-publish.
    if (post.publish_status === 'scheduled' && post.postiz_post_id) {
      await postizDeletePost(apiKey, post.postiz_post_id as string).catch((e) =>
        console.warn(`[publishNowPost] delete of scheduled copy failed (continuing):`, e),
      )
    }

    let postizPostId: string
    try {
      postizPostId = await syncToPostiz(
        db, post as SyncablePost, channelId, apiKey, 'now', new Date().toISOString(),
      )
    } catch (err) {
      console.error(`[publishNowPost] Postiz publish failed post_id=${postId}:`, err)
      await db
        .from('calendar_posts')
        .update({ publish_status: 'failed' })
        .eq('post_id', postId)
        .eq('brand_id', brandId)
      revalidatePath(`/${slug}/calendar`)
      return { ok: true, publishStatus: 'failed', error: 'Publishing failed. Please try again.' }
    }

    await db
      .from('calendar_posts')
      .update({
        publish_requested_at: new Date().toISOString(),
        publish_status: 'published',
        postiz_post_id: postizPostId,
        published_at: new Date().toISOString(),
      })
      .eq('post_id', postId)
      .eq('brand_id', brandId)

    revalidatePath(`/${slug}/calendar`)
    return { ok: true, publishStatus: 'published' }
  } catch {
    return { ok: false, error: 'Failed to publish post.' }
  }
}

/**
 * Pause / stop publishing — removes the scheduled copy from Postiz's queue
 * and returns the post to 'unscheduled' so the user can re-schedule later.
 */
export async function pausePublishing(postId: string, slug: string): Promise<PostActionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }
  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  try {
    const db = adminClient()
    const { data: post } = await db
      .from('calendar_posts')
      .select('publish_status, postiz_post_id')
      .eq('post_id', postId)
      .eq('brand_id', brandId)
      .maybeSingle()
    if (!post) return { ok: false, error: 'Post not found.' }
    if (post.publish_status === 'published') {
      return { ok: false, error: 'Already published — cannot pause.' }
    }

    const apiKey = process.env.POSTIZ_API_KEY
    if (post.postiz_post_id && apiKey) {
      await postizDeletePost(apiKey, post.postiz_post_id as string)
    }

    await db
      .from('calendar_posts')
      .update({
        publish_status: 'unscheduled',
        postiz_post_id: null,
        publish_requested_at: null,
      })
      .eq('post_id', postId)
      .eq('brand_id', brandId)

    revalidatePath(`/${slug}/calendar`)
    return { ok: true, publishStatus: 'unscheduled' }
  } catch (err) {
    console.error(`[pausePublishing] failed post_id=${postId}:`, err)
    return { ok: false, error: 'Failed to pause publishing.' }
  }
}

/**
 * Change posting time. Updates posting_time in the DB; if the post is
 * scheduled in Postiz the queued copy is deleted and re-created at the new
 * time (delete + recreate are the verified primitives — there is no update).
 */
export async function reschedulePost(
  postId: string,
  slug: string,
  newTimeIso: string,
): Promise<PostActionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }
  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  const newTime = new Date(newTimeIso)
  if (isNaN(newTime.getTime())) return { ok: false, error: 'Invalid date.' }
  if (newTime <= new Date()) return { ok: false, error: 'Pick a time in the future.' }

  try {
    const db = adminClient()
    const { data: post } = await db
      .from('calendar_posts')
      .select('publish_status, postiz_post_id, caption_ar, hashtags, storage_url, media_type, post_id, posting_time, scheduled_date')
      .eq('post_id', postId)
      .eq('brand_id', brandId)
      .maybeSingle()
    if (!post) return { ok: false, error: 'Post not found.' }
    if (post.publish_status === 'published') {
      return { ok: false, error: 'Already published — cannot reschedule.' }
    }

    const update: {
      posting_time: string
      scheduled_date?: string
      postiz_post_id?: string | null
      publish_status?: 'unscheduled'
      publish_requested_at?: null
    } = { posting_time: newTime.toISOString() }

    // Remember the original day (once) so the calendar can mark the old cell
    // with "moved to …" instead of showing it as empty.
    const prevDay = post.posting_time ? String(post.posting_time).slice(0, 10) : null
    const newDay = newTime.toISOString().slice(0, 10)
    if (prevDay && prevDay !== newDay && !(post as { scheduled_date?: string | null }).scheduled_date) {
      update.scheduled_date = prevDay
    }

    if (post.publish_status === 'scheduled' && post.postiz_post_id) {
      const apiKey = process.env.POSTIZ_API_KEY
      if (!apiKey) return { ok: false, error: 'Publishing is not configured yet.' }
      const channelId = await getIgChannel(db, brandId)
      if (!channelId) return { ok: false, error: 'Connect your Instagram account in Settings first.' }

      await postizDeletePost(apiKey, post.postiz_post_id as string)
      try {
        update.postiz_post_id = await syncToPostiz(
          db, post as SyncablePost, channelId, apiKey, 'schedule', newTime.toISOString(),
        )
      } catch (err) {
        // The old queue entry is gone — reflect that honestly.
        console.error(`[reschedulePost] re-sync failed post_id=${postId}:`, err)
        update.postiz_post_id = null
        update.publish_status = 'unscheduled'
        update.publish_requested_at = null
        await db.from('calendar_posts').update(update).eq('post_id', postId).eq('brand_id', brandId)
        revalidatePath(`/${slug}/calendar`)
        return { ok: true, publishStatus: 'unscheduled', error: 'Time updated, but re-scheduling failed — click Schedule again.' }
      }
    }

    await db.from('calendar_posts').update(update).eq('post_id', postId).eq('brand_id', brandId)
    revalidatePath(`/${slug}/calendar`)
    return { ok: true, publishStatus: (post.publish_status as string) ?? undefined }
  } catch (err) {
    console.error(`[reschedulePost] failed post_id=${postId}:`, err)
    return { ok: false, error: 'Failed to reschedule.' }
  }
}

/**
 * Reconciles a scheduled post against Postiz reality. Called by the UI when
 * a countdown reaches zero (and on load for overdue posts). Postiz reports
 * state PUBLISHED with the live Instagram permalink (releaseURL) — we store
 * it in external_post_id so the UI can link straight to the post.
 */
export async function reconcilePublish(postId: string, slug: string): Promise<PostActionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }
  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  try {
    const db = adminClient()
    const { data: post } = await db
      .from('calendar_posts')
      .select('publish_status, postiz_post_id, posting_time')
      .eq('post_id', postId)
      .eq('brand_id', brandId)
      .maybeSingle()
    if (!post) return { ok: false, error: 'Post not found.' }
    if (post.publish_status !== 'scheduled' || !post.postiz_post_id) {
      return { ok: true, publishStatus: (post.publish_status as string) ?? undefined }
    }

    const apiKey = process.env.POSTIZ_API_KEY
    if (!apiKey) return { ok: true, publishStatus: 'scheduled' }

    const center = post.posting_time ? new Date(post.posting_time) : new Date()
    const start = new Date(center.getTime() - 48 * 3600_000).toISOString()
    const end = new Date(center.getTime() + 48 * 3600_000).toISOString()
    const remote = (await postizListPosts(apiKey, start, end)).find(
      (p) => p.id === post.postiz_post_id,
    )

    if (remote?.state === 'PUBLISHED') {
      await db
        .from('calendar_posts')
        .update({
          publish_status: 'published',
          published_at: remote.publishDate ?? new Date().toISOString(),
          external_post_id: remote.releaseURL ?? null,
        })
        .eq('post_id', postId)
        .eq('brand_id', brandId)
      revalidatePath(`/${slug}/calendar`)
      return { ok: true, publishStatus: 'published' }
    }
    if (remote?.state === 'ERROR') {
      await db
        .from('calendar_posts')
        .update({ publish_status: 'failed' })
        .eq('post_id', postId)
        .eq('brand_id', brandId)
      revalidatePath(`/${slug}/calendar`)
      return { ok: true, publishStatus: 'failed', error: 'Postiz reported a publishing error.' }
    }
    // Still queued (or list window missed it) — leave as scheduled.
    return { ok: true, publishStatus: 'scheduled' }
  } catch (err) {
    console.error(`[reconcilePublish] failed post_id=${postId}:`, err)
    return { ok: true, publishStatus: 'scheduled' }
  }
}

async function fireNotifyApproved(
  db: ReturnType<typeof adminClient>,
  brand: NonNullable<Awaited<ReturnType<typeof getBrandForCurrentUser>>>,
  brandId: string,
  postId: string,
) {
  const [{ data: post }, { data: authData }] = await Promise.all([
    db.from('calendar_posts').select('position, calendar_id').eq('post_id', postId).maybeSingle(),
    db.auth.admin.getUserById(brand.auth_user_id!),
  ])

  const userEmail = authData.user?.email
  if (!userEmail || !post) return

  const { data: calendar } = post.calendar_id
    ? await db.from('calendars').select('month').eq('calendar_id', post.calendar_id).maybeSingle()
    : { data: null }

  await notify({
    templateKey: 'post_approved',
    variables: {
      brand_name: brand.brand_name_ar,
      position: post.position,
      month: calendar?.month ?? '',
    },
    brandId,
    authUserId: brand.auth_user_id!,
    userEmail,
    postId,
    calendarId: post.calendar_id ?? undefined,
  })
}

export async function bulkApprove(
  postIds: string[],
  slug: string,
): Promise<{ ok: boolean; approved: string[]; failed: string[]; error?: string }> {
  if (!postIds.length) return { ok: false, approved: [], failed: [], error: 'No posts selected.' }
  if (postIds.length > 50) return { ok: false, approved: [], failed: [], error: 'Too many posts selected at once (max 50).' }

  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, approved: [], failed: [], error: 'Access denied.' }
  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  const db = adminClient()

  // Fetch all selected posts in one query — verify ownership and get posting_time
  const { data: posts, error: fetchErr } = await db
    .from('calendar_posts')
    .select('post_id, posting_time, status')
    .in('post_id', postIds)
    .eq('brand_id', brandId)
    .neq('status', 'approved')

  if (fetchErr) return { ok: false, approved: [], failed: postIds, error: 'Failed to load posts.' }
  if (!posts?.length) return { ok: false, approved: [], failed: postIds, error: 'No approvable posts found.' }

  const now = new Date()
  const approved: string[] = []
  const failed: string[] = []

  // Bulk approve is a pure content decision — publishing is an explicit per-post
  // action (see publishPost). publish_status stays null until the client clicks Publish.
  await Promise.allSettled(
    posts.map(async (post) => {
      const { error } = await db
        .from('calendar_posts')
        .update({
          status: 'approved',
          approved_at: now.toISOString(),
        })
        .eq('post_id', post.post_id)
        .eq('brand_id', brandId)

      if (error) { failed.push(post.post_id); return }
      approved.push(post.post_id)
    }),
  )

  revalidatePath(`/${slug}/calendar`)
  return { ok: true, approved, failed }
}

export async function requestChanges(
  postId: string,
  slug: string,
  revisionReason: string,
): Promise<PostActionResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, error: 'Access denied.' }

  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  try {
    const db = adminClient()
    const { data: post, error: fetchErr } = await db
      .from('calendar_posts')
      .select('post_id, revision_count, status, position, calendar_id, caption_ar')
      .eq('post_id', postId)
      .eq('brand_id', brandId)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!post) return { ok: false, error: 'Post not found.' }
    if (post.status === 'approved') return { ok: false, error: 'Cannot revise an approved post.' }

    const currentCount = (post.revision_count ?? 0) as number
    if (currentCount >= 3) {
      return { ok: false, error: 'Maximum of 3 revisions reached. This image is final.' }
    }

    const newCount = currentCount + 1

    // Increment revision counter so B03 and the CEO know which pass this is.
    const { error: updateErr } = await db
      .from('calendar_posts')
      .update({ revision_count: newCount } as never)
      .eq('post_id', postId)
      .eq('brand_id', brandId)
    if (updateErr) throw updateErr

    // Fire B03 immediately — no admin pre-approval gate.
    // B03 regenerates the caption, then CEO evaluates the new output against
    // the 11 override triggers and confidence score. The post only lands in
    // /admin/qa if the new caption fails a trigger or scores below threshold.
    triggerN8nB03Revision({
      post_id:         postId,
      brand_id:        brandId,
      revision_reason: revisionReason,
      revision_type:   'caption',
      revision_number: newCount,
    }).catch(() => {})

    revalidatePath(`/${slug}/calendar`)
    return { ok: true }
  } catch (err) {
    console.error('[requestChanges] Error:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'Failed to request changes.' }
  }
}

