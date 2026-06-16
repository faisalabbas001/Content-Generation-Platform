/**
 * POST /api/webhooks/fal-ai/video-callback
 *
 * Called by fal.ai when an async video generation job finishes.
 * Submitted by /api/image/generate-video with ?fal_webhook=... query param.
 *
 * Hard Rule #4: fal CDN URLs are NEVER stored. We download the buffer here
 * and upload it to Supabase Storage immediately.
 *
 * On FAILED: falls back gracefully — resets post to format_tier='image' so the
 * calendar still delivers; the image chain will regenerate on next batch run.
 *
 * Returns 200 for all outcomes (COMPLETED, FAILED, unknown request_id).
 * fal.ai retries on 4xx/5xx; returning 200 even on errors prevents retry storms.
 */
import { NextRequest, NextResponse } from 'next/server'
import { adminClient } from '@repo/db/client'

const BUCKET = 'post-images'
const FALLBACK_URL = 'https://app.openclaw.com/assets/visual-placeholder.png'

// Shape fal.ai sends to the webhook URL.
// IMPORTANT: fal's QUEUE WEBHOOK uses status "OK"/"ERROR" (NOT "COMPLETED"/"FAILED"
// — those are the POLL endpoint's statuses). The webhook also puts the model output
// directly under `payload` (e.g. payload.video.url). We accept all spellings.
interface FalVideoCallback {
  request_id:        string
  gateway_request_id?: string
  status:            'OK' | 'ERROR' | 'COMPLETED' | 'FAILED' | string
  payload?:   {
    video?:   { url: string }
    videos?:  Array<{ url: string }>
    error?:   string
  }
  // Some fal webhook variants nest the output one level deeper.
  video?:   { url: string }
  error?:   string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: FalVideoCallback
  try {
    body = (await req.json()) as FalVideoCallback
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 200 })
  }

  const { request_id, status, payload } = body

  console.log(`[fal-video-callback] received: request_id=${request_id} status=${status} has_payload=${!!payload} has_video=${!!(payload?.video?.url ?? payload?.videos?.[0]?.url ?? body.video?.url)} body_preview=${JSON.stringify(body).slice(0,400)}`)

  if (!request_id) {
    return NextResponse.json({ ok: false, reason: 'missing_request_id' }, { status: 200 })
  }

  const db = adminClient()

  // Look up the matching usage_log row — correlates fal request_id → post_id + brand_id.
  const { data: log } = await db
    .from('usage_logs')
    .select('post_id, brand_id')
    .eq('fal_request_id', request_id)
    .maybeSingle()

  if (!log?.post_id || !log?.brand_id) {
    console.warn(`[fal-video-callback] NO usage_log for request_id=${request_id} — already processed or orphaned. Body=${JSON.stringify(body).slice(0,200)}`)
    return NextResponse.json({ ok: true })
  }

  const { post_id, brand_id } = log
  console.log(`[fal-video-callback] post_id=${post_id} brand_id=${brand_id} status=${status}`)

  // ── FAILED ──────────────────────────────────────────────────────────────────
  // The animate job failed. The keyframe still ({post_id}-kf.jpg) was already
  // generated + uploaded synchronously at submit time, so degrade to that image
  // instead of a generic placeholder — the post is never blank. Resolve its URL
  // from the post's month (same calendar path the keyframe was stored under).
  // fal webhook failure: status "ERROR" (webhook) or "FAILED" (poll), or an error field.
  const isFailure = status === 'ERROR' || status === 'FAILED' || !!payload?.error || !!body.error
  if (isFailure) {
    console.error(`[fal-video-callback] FAILED post=${post_id} error="${payload?.error ?? body.error ?? 'unknown'}" full_body=${JSON.stringify(body).slice(0,400)}`)
    let kfUrl: string = FALLBACK_URL
    let failOnDemandRequestId: string | null = null
    try {
      const { data: postRow } = await db
        .from('calendar_posts')
        .select('posting_time, on_demand_request_id')
        .eq('post_id', post_id)
        .maybeSingle()
      const pt = (postRow as { posting_time?: string; on_demand_request_id?: string } | null)?.posting_time
      const month = (pt && /^\d{4}-\d{2}/.test(pt)) ? pt.slice(0, 7) : '2026-06'
      failOnDemandRequestId = (postRow as { posting_time?: string; on_demand_request_id?: string } | null)?.on_demand_request_id ?? null
      const { data: u } = db.storage.from(BUCKET).getPublicUrl(`clients/${brand_id}/calendars/${month}/${post_id}-kf.jpg`)
      if (u?.publicUrl) kfUrl = u.publicUrl
    } catch { /* keep FALLBACK_URL */ }

    await Promise.allSettled([
      db
        .from('calendar_posts')
        .update({
          format:       'image',
          format_tier:  'image',
          media_type:   'image',
          status:       'clean',          // degraded to a still, still admin-reviewable
          storage_url:  kfUrl,            // the keyframe (not a blank placeholder)
          visual_failed: false,
          requires_human_review: true,    // flag so admin can re-request video
          claimed_at:   null,
          video_status: 'failed',
          hold_reason:  'video_fell_back_to_keyframe',
          last_error:   `fal_video_failed: ${payload?.error ?? 'unknown'}`,
        } as never)
        .eq('post_id', post_id),
      db
        .from('usage_logs')
        .update({ status: 'failed' })
        .eq('fal_request_id', request_id),
      // BUG FIX 6 (failure): mark the on_demand request as failed — ONLY if it is still
      // 'generating'. If it was set to 'held' by the CEO gate, leave it alone; admin will
      // still see the keyframe degradation via calendar_posts and can approve/reject normally.
      ...(failOnDemandRequestId
        ? [db
            .from('on_demand_requests')
            .update({ status: 'failed', failure_reason: 'video_render_failed' } as never)
            .eq('request_id', failOnDemandRequestId)
            .eq('status', 'generating')]
        : []),
    ])

    return NextResponse.json({ ok: true })
  }

  // ── SUCCESS ──────────────────────────────────────────────────────────────────
  // fal webhook success status is "OK" (webhook) or "COMPLETED" (poll). Anything
  // else that isn't a failure is an intermediate status (IN_QUEUE/IN_PROGRESS) → ignore.
  const isSuccess = status === 'OK' || status === 'COMPLETED'
  if (!isSuccess) {
    return NextResponse.json({ ok: true })
  }

  // Video URL can be at payload.video.url, payload.videos[0].url, or top-level video.url.
  const videoUrl = payload?.video?.url ?? payload?.videos?.[0]?.url ?? body.video?.url
  console.log(`[fal-video-callback] SUCCESS post=${post_id} videoUrl=${videoUrl ?? 'MISSING'} full_payload=${JSON.stringify(payload ?? {}).slice(0,300)}`)
  if (!videoUrl) {
    console.error(`[fal-video-callback] COMPLETED but NO video URL for request_id=${request_id} post=${post_id} — full body: ${JSON.stringify(body).slice(0,500)}`)
    return NextResponse.json({ ok: true })
  }

  try {
    // Hard Rule #4: download immediately — never store the fal.ai CDN URL.
    const videoRes = await fetch(videoUrl)
    if (!videoRes.ok) {
      throw new Error(`fal CDN download failed (${videoRes.status}) for ${videoUrl.slice(0, 80)}`)
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer())

    // CRITICAL: upload to the SAME deterministic path the rest of the pipeline uses —
    // clients/{brand_id}/calendars/{YYYY-MM}/{post_id}.mp4 — so the Worker's Sweep
    // Video Processing .mp4 check and the UI all resolve it. (Was clients/{brand}/videos/…
    // which nothing else looked at.) Month comes from the post's posting_time.
    let month = '2026-06'
    let onDemandRequestId: string | null = null
    let postCurrentStatus: string | null = null
    try {
      const { data: postRow } = await db
        .from('calendar_posts')
        .select('posting_time, on_demand_request_id, status')
        .eq('post_id', post_id)
        .maybeSingle()
      const row = postRow as { posting_time?: string; on_demand_request_id?: string; status?: string } | null
      const pt = row?.posting_time
      onDemandRequestId = row?.on_demand_request_id ?? null
      postCurrentStatus = row?.status ?? null
      if (pt && /^\d{4}-\d{2}/.test(pt)) month = pt.slice(0, 7)
    } catch { /* keep default */ }
    const storagePath = `clients/${brand_id}/calendars/${month}/${post_id}.mp4`

    const { error: uploadErr } = await db.storage
      .from(BUCKET)
      .upload(storagePath, videoBuffer, { contentType: 'video/mp4', upsert: true })

    if (uploadErr) {
      throw new Error(`Supabase Storage upload failed: ${uploadErr.message}`)
    }

    const { data: urlData } = db.storage.from(BUCKET).getPublicUrl(storagePath)
    const supabaseUrl = urlData.publicUrl

    // Update the post and the log. status='clean' (the pipeline's "image ready,
    // awaiting admin" state) — NOT 'generated' (which isn't in the status machine
    // and would hide the post). claimed_at cleared so it's never re-reaped.
    // HOLD GUARD: if the keyframe QC held this video (status='pending_review'),
    // the MP4 arriving must NOT lift the hold — keep pending_review so admin QA
    // still gates delivery; only the storage_url/video fields are refreshed.
    const nextStatus = postCurrentStatus === 'pending_review' ? 'pending_review' : 'clean'
    await Promise.allSettled([
      db
        .from('calendar_posts')
        .update({ storage_url: supabaseUrl, status: nextStatus, format: 'video', format_tier: 'video', media_type: 'video', video_status: 'completed', visual_failed: false, claimed_at: null, last_error: null } as never)
        .eq('post_id', post_id),
      db
        .from('usage_logs')
        .update({ status: 'completed' })
        .eq('fal_request_id', request_id),
      // BUG FIX 6 (success): mark the on_demand request as delivered so the UI stops
      // showing the 'generating' spinner and shows the video player. Without this the
      // status stays 'generating' indefinitely even after the MP4 is in Storage.
      // Guard: ONLY transition from 'generating' → 'delivered'. If the CEO gate set the
      // request to 'held', the video-callback must NOT overwrite it — the hold stands until
      // an admin approves, which then sets 'delivered' via approveQaItem().
      ...(onDemandRequestId
        ? [db
            .from('on_demand_requests')
            .update({ status: 'delivered', delivered_at: new Date().toISOString() } as never)
            .eq('request_id', onDemandRequestId)
            .eq('status', 'generating')]
        : []),
    ])

    console.log(`[fal-video-callback] video stored for post ${post_id}: ${supabaseUrl}`)
  } catch (err) {
    console.error(`[fal-video-callback] error processing COMPLETED callback for ${request_id}:`, err)
    // Do NOT return 5xx — that would cause fal.ai to retry and potentially double-upload.
    // Best-effort: set placeholder so the UI never shows a permanently broken slot.
    try {
      await db
        .from('calendar_posts')
        .update({
          format_tier:  'image',
          status:       'draft',
          storage_url:  FALLBACK_URL,
          video_status: 'failed',
          last_error:   err instanceof Error ? err.message : 'unknown_upload_error',
        })
        .eq('post_id', post_id)
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true })
}
