'use server'

/**
 * Server actions for the on-demand post flow.
 *
 * triggerOnDemandPost  — triggers N8N-A02 (new on-demand post).
 * requestRegenerate    — triggers N8N-B03 (revision/regeneration of an
 *                        existing on-demand post). Webhook URL is set in
 *                        N8N_B03_WEBHOOK_URL (env) — falls back to the
 *                        cloud testing URL when the var is absent.
 */

/**
 * Server action — triggers N8N-A02 (on-demand single post).
 *
 * Auth direction: n8n Cloud webhook URLs contain the auth token in the URL
 * itself (https://xxx.app.n8n.cloud/webhook/TOKEN). No HMAC needed here.
 * N8N_WEBHOOK_SECRET is inbound-only (n8n → Next.js direction).
 */
import { getBrandForCurrentUser, getUserScopedClient } from '@repo/auth/server'
import { adminClient } from '@repo/db/client'
import { adminQ } from '@repo/db'
import { notify } from '@repo/email'
import { revalidatePath } from 'next/cache'
import { resendClient, resendFrom } from '@repo/email/client'

export interface OnDemandResult {
  ok: boolean
  message: string
  /** Present on non-ok results to let the caller distinguish held/rejected/error without parsing the message string. */
  status?: 'held' | 'rejected' | 'error' | 'unknown'
}

export interface RegeneratePromptOverride {
  special_instructions?: string
  style_descriptor?: string
  hero_concept?: string
  negative_prompt?: string
  cultural_guidance?: string
}

export async function triggerOnDemandPost(
  formData: FormData,
  slug: string,
): Promise<OnDemandResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, message: 'Brand not found or access denied.' }

  const webhookUrl = process.env.N8N_A02_WEBHOOK_URL
  if (!webhookUrl) {
    return { ok: false, message: 'On-demand generation is not configured yet. Contact support.' }
  }

  const occasionName     = (formData.get('occasion_name') as string | null) ?? ''
  const occasionLeadWeeks = parseInt((formData.get('occasion_lead_weeks') as string) ?? '0', 10) || 0
  const occasionPriority = (formData.get('occasion_priority') as string) ?? 'Medium'

  const paletteRaw = (formData.get('color_palette') as string | null) ?? ''
  const paletteHex = paletteRaw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c))

  const payload = {
    brand_id:      (brand as unknown as Record<string, unknown>)['brand_id'] as string,
    brand_name_ar: (brand as unknown as Record<string, unknown>)['brand_name_ar'] as string ?? '',
    dialect:       (brand as unknown as Record<string, unknown>)['arabic_dialect'] as string ?? 'MSA_accessible',
    month:         formData.get('month') as string,
    posts_per_week: parseInt((formData.get('posts_per_week') as string) ?? '1', 10) || 1,
    content_type:  formData.get('content_type') as string,
    objective:     formData.get('objective') as string,
    platform:      formData.get('platform') as string,
    posting_time:  formData.get('posting_time') as string,
    hashtags:      formData.get('hashtags') as string,
    ...(occasionName ? {
      occasion_context: {
        name:       occasionName,
        lead_weeks: occasionLeadWeeks,
        priority:   occasionPriority,
      },
    } : {}),
    // Visual brief — English only (Hard Rule #3 enforced in /api/image/generate)
    style_descriptor:   formData.get('style_descriptor') as string,
    hero_concept:       formData.get('hero_concept') as string,
    negative_prompt:    formData.get('negative_prompt') as string,
    cultural_guidance:  formData.get('cultural_guidance') as string,
    canvas:             formData.get('canvas') as string,
    palette_hex:        paletteHex,
    // Controls
    image_model:            formData.get('image_model') as string,
    media_type:             (formData.get('media_type') as string | null) ?? 'image',
    first_ever_post:        formData.get('first_ever_post') === 'on',
    overlay_brand_name_ar:  formData.get('overlay_brand_name_ar') === 'on',
  }

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[on-demand] n8n webhook error:', res.status, text.slice(0, 200))
      return { ok: false, message: 'Generation request failed. Please try again.' }
    }

    // Alert admin team about the new on-demand request — fire-and-forget
    fireAdminOnDemandAlert(
      payload.brand_name_ar,
      payload.content_type as string,
    ).catch((e) => console.error('[on-demand] admin alert error:', e))

    return { ok: true, message: 'Your post is being generated — check back in a few minutes.' }
  } catch (err) {
    console.error('[on-demand] webhook fetch failed:', err)
    return { ok: false, message: 'Could not reach the generation service. Please try again.' }
  }
}

async function fireAdminOnDemandAlert(
  brandNameAr: string,
  contentType: string,
) {
  const adminEmails = (process.env.COPILOT_MANAGEMENT_EMAIL ?? process.env.ADMIN_ALLOWLIST_EMAILS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (adminEmails.length === 0) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const qaUrl = `${appUrl}/admin/qa?tab=on_demand`

  await resendClient().emails.send({
    from:    resendFrom(),
    to:      adminEmails,
    subject: `⚡ طلب محتوى فوري — ${brandNameAr}`,
    html: `<div dir="rtl" style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="margin:0 0 8px">طلب محتوى جديد</h2>
      <p style="color:#555;margin:0 0 16px">
        العلامة التجارية: <strong>${brandNameAr}</strong><br/>
        نوع المحتوى: <strong>${contentType}</strong>
      </p>
      <a href="${qaUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">
        عرض طابور الطلبات
      </a>
    </div>`,
  })
}

/**
 * Triggers N8N-B03 to regenerate an on-demand post.
 *
 * B03 expects the calendar_posts `post_id` (not the on_demand_requests
 * `request_id`). The caller must pass both so this action can revalidate
 * the detail page after queueing.
 */
export async function requestRegenerate(
  slug: string,
  requestId: string | null,
  postId: string,
  brandId: string,
  promptOverride?: RegeneratePromptOverride,
): Promise<OnDemandResult> {
  const brand = await getBrandForCurrentUser(slug)
  if (!brand || (brand as unknown as Record<string, unknown>)['brand_id'] !== brandId) {
    return { ok: false, message: 'Unauthorized.' }
  }

  // Pre-check rate limit (B03 also enforces this, but fail fast in the UI).
  const userClient = await getUserScopedClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postRow } = await (userClient as any)
    .from('calendar_posts')
    .select('revision_count')
    .eq('post_id', postId)
    .maybeSingle()
  const currentCount = (postRow as { revision_count: number } | null)?.revision_count ?? 0
  if (currentCount >= 3) {
    return { ok: false, message: 'Maximum 3 regenerations reached for this post.' }
  }

  const b03Url =
    process.env.N8N_B03_WEBHOOK_URL ??
    'https://ogztudios.app.n8n.cloud/webhook-test/revision-request'

  try {
    const res = await fetch(b03Url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_id:             brandId,
        post_id:              postId,
        revision_reason:      promptOverride?.special_instructions
          ? `User correction: ${promptOverride.special_instructions.slice(0, 120)}`
          : 'User requested regeneration.',
        revision_type:        'full',
        special_instructions: promptOverride?.special_instructions ?? '',
        ...(promptOverride ? { prompt_override: promptOverride } : {}),
      }),
    })

    // B03 always replies with JSON — parse once so we can distinguish the
    // three valid outcomes (all of which use HTTP 200):
    //   { success: true,  ... }                                 → image regenerated
    //   { success: false, status: 'held',     message, post_id } → routed to QA queue
    //   { success: false, status: 'rejected', message, post_id } → CEO brand-safety block
    let body: { success?: boolean; status?: string; message?: string } = {}
    try {
      body = (await res.json()) as typeof body
    } catch {
      // Non-JSON body (e.g., HTML error page from ngrok) — leave body empty.
    }

    if (!res.ok) {
      console.error('[regenerate] B03 webhook HTTP error:', res.status, body)
      return { ok: false, status: 'error' as const, message: body.message ?? `Request failed (${res.status}). Please try again.` }
    }

    // n8n returned 200 — workflow finished, but it may have routed the post
    // to QA or rejection instead of completing the regeneration.
    if (body.success === false) {
      const status = body.status ?? 'unknown'
      if (status === 'held') {
        return {
          ok: false,
          status: 'held' as const,
          message: body.message
            ? `This regeneration was sent for admin review — it cannot be published yet. Reason: ${body.message}`
            : 'This regeneration was sent for admin review — it cannot be published yet.',
        }
      }
      if (status === 'rejected') {
        return {
          ok: false,
          status: 'rejected' as const,
          message: body.message
            ? `Regeneration was blocked by the brand-safety gate: ${body.message}`
            : 'Regeneration was blocked by the brand-safety gate.',
        }
      }
      return { ok: false, status: 'unknown' as const, message: body.message ?? 'Regeneration could not be completed.' }
    }

    if (requestId) revalidatePath(`/${slug}/on-demand/${requestId}`)

    // Alert admin that a revision was requested — fire-and-forget
    const brandNameAr = (brand as unknown as Record<string, unknown>)['brand_name_ar'] as string ?? ''
    fireAdminRevisionAlert(brandNameAr, brandId, postId, promptOverride?.special_instructions ?? '').catch(
      (e) => console.error('[regenerate] admin alert error:', e),
    )

    return { ok: true, message: 'New image is ready — refreshing the page.' }
  } catch (err) {
    console.error('[regenerate] webhook fetch failed:', err)
    return { ok: false, message: 'Could not reach the generation service. Please try again.' }
  }
}

/**
 * Polls revision state for a calendar_posts row.
 * Used by RegenerateButton to detect when regeneration completes.
 *
 * NOTE: storage_url never changes between revisions (same post_id path,
 * Supabase upsert overwrites silently). revision_count is the reliable
 * change signal — it increments by 1 on every successful B03 run.
 */
export async function getPostRevisionState(postId: string): Promise<{
  revisionCount: number
  updatedAt: string | null
} | null> {
  const userClient = await getUserScopedClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (userClient as any)
    .from('calendar_posts')
    .select('revision_count, updated_at')
    .eq('post_id', postId)
    .maybeSingle()
  if (!data) return null
  const row = data as { revision_count: number; updated_at: string | null }
  return { revisionCount: row.revision_count ?? 0, updatedAt: row.updated_at ?? null }
}

async function fireAdminRevisionAlert(
  brandNameAr: string,
  brandId: string,
  postId: string,
  instructions: string,
) {
  const adminEmails = (process.env.COPILOT_MANAGEMENT_EMAIL ?? process.env.ADMIN_ALLOWLIST_EMAILS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (adminEmails.length === 0) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const qaUrl = `${appUrl}/admin/qa?tab=on_demand`

  await resendClient().emails.send({
    from:    resendFrom(),
    to:      adminEmails,
    subject: `🔄 طلب مراجعة محتوى — ${brandNameAr}`,
    html: `<div dir="rtl" style="font-family:sans-serif;padding:24px;max-width:480px">
      <h2 style="margin:0 0 8px">طلب إعادة توليد</h2>
      <p style="color:#555;margin:0 0 8px">
        العلامة التجارية: <strong>${brandNameAr}</strong>
      </p>
      ${instructions ? `<p style="color:#555;margin:0 0 16px">ملاحظات العميل: <em>${instructions.slice(0, 200)}</em></p>` : ''}
      <a href="${qaUrl}" style="display:inline-block;background:#f59e0b;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">
        عرض طابور المراجعة
      </a>
    </div>`,
  })
}

export type PublishCode =
  | 'published'
  | 'not_connected'
  | 'not_ready'
  | 'already_published'
  | 'postiz_error'
  | 'db_error'

export interface PublishResult {
  ok: boolean
  code: PublishCode
}

/**
 * Publishes a delivered on-demand post to the brand's connected Instagram
 * account INSTANTLY via Postiz (type:'now'). Mirrors the N8N-P01 payload
 * shape, but skips scheduling.
 *
 * Steps:
 *   1. RLS-scoped load of the request + post (ownership enforced).
 *   2. Resolve the brand's postiz_channel_id from channel_profiles.
 *   3. Sign the storage URL (1h) so Postiz can download the media.
 *   4. POST /posts with type 'now'.
 *   5. Persist postiz_post_id + publish_status='published' + published_at.
 */
export async function publishNow(slug: string, requestId: string): Promise<PublishResult> {
  const { adminClient, onDemandQ } = await import('@repo/db')
  const { postizFetch } = await import('@/lib/postiz')

  const brand = await getBrandForCurrentUser(slug)
  if (!brand) return { ok: false, code: 'not_ready' }
  const brandId = (brand as unknown as Record<string, unknown>)['brand_id'] as string

  // 1. Ownership-scoped load — RLS guarantees this user owns the request.
  const userClient = await getUserScopedClient()
  const row = await onDemandQ.getOnDemandRequestById(requestId, userClient)
  if (!row || row.brand_id !== brandId) return { ok: false, code: 'not_ready' }

  const post = row.post
  if (row.status !== 'delivered' || !post?.storage_url) {
    return { ok: false, code: 'not_ready' }
  }
  if (post.publish_status === 'published') {
    return { ok: false, code: 'already_published' }
  }

  // Media type guard: a video post is only publishable once the final .mp4
  // replaced the intermediate keyframe JPEG in storage_url.
  const isVideo =
    ((post as { media_type?: string }).media_type ??
      (row as { media_type?: string }).media_type ??
      'image') === 'video'
  const isMp4 = /\.mp4([?#]|$)/i.test(post.storage_url) || /\/video\//.test(post.storage_url)
  if (isVideo && !isMp4) return { ok: false, code: 'not_ready' }

  const db = adminClient()

  // 2. Connected Instagram channel for THIS brand.
  const { data: channel } = await db
    .from('channel_profiles')
    .select('postiz_channel_id')
    .eq('brand_id', brandId)
    .eq('channel', 'Instagram')
    .not('postiz_channel_id', 'is', null)
    .maybeSingle()
  const channelId = channel?.postiz_channel_id as string | undefined
  if (!channelId) return { ok: false, code: 'not_connected' }

  const apiKey = process.env.POSTIZ_API_KEY
  if (!apiKey) {
    console.error('[publish-now] POSTIZ_API_KEY not configured')
    return { ok: false, code: 'postiz_error' }
  }

  // 3. Sign the storage URL so Postiz can fetch the media (same approach as
  //    N8N-P01 — Postiz downloads the file at creation time, 1h is plenty).
  //    storage_url: https://<proj>.supabase.co/storage/v1/object/public/<bucket>/<path>
  const m = post.storage_url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/)
  if (!m) {
    console.error('[publish-now] cannot parse storage_url:', post.storage_url)
    return { ok: false, code: 'not_ready' }
  }
  const [, bucket, rawPath] = m
  const storagePath = decodeURIComponent(rawPath)
  const { data: signed, error: signErr } = await db.storage
    .from(bucket)
    .createSignedUrl(storagePath, 3600)
  if (signErr || !signed?.signedUrl) {
    console.error('[publish-now] signed URL failed:', signErr)
    return { ok: false, code: 'postiz_error' }
  }

  // 4a. Upload the media to Postiz's library first — the public API requires
  //     posts to reference uploaded media objects ({id, path}), not raw URLs.
  const { POSTIZ_API } = await import('@/lib/postiz')
  let mediaRef: { id: string; path: string }
  try {
    const fileRes = await fetch(signed.signedUrl)
    if (!fileRes.ok) {
      console.error('[publish-now] media download failed:', fileRes.status)
      return { ok: false, code: 'postiz_error' }
    }
    const blob = await fileRes.blob()
    const form = new FormData()
    const filename = `${post.post_id}.${isVideo ? 'mp4' : 'jpg'}`
    form.append('file', blob, filename)
    const upRes = await fetch(`${POSTIZ_API}/upload`, {
      method: 'POST',
      headers: { Authorization: apiKey },
      body: form,
    })
    const upBody = (await upRes.json().catch(() => null)) as
      | { id?: string; path?: string }
      | null
    if (!upRes.ok || !upBody?.id || !upBody?.path) {
      console.error('[publish-now] Postiz upload failed:', upRes.status, JSON.stringify(upBody))
      return { ok: false, code: 'postiz_error' }
    }
    mediaRef = { id: upBody.id, path: upBody.path }
  } catch (err) {
    console.error('[publish-now] media upload unreachable:', err)
    return { ok: false, code: 'postiz_error' }
  }

  // 4b. Create the Postiz post with type 'now' → publishes immediately.
  //     Shape validated against the live API: top-level tags is required,
  //     media goes in value[0].image, settings.post_type must be post|story.
  const caption = [post.caption_ar, (post.hashtags ?? []).join(' ')]
    .filter(Boolean)
    .join('\n\n')
  const payload = {
    type: 'now',
    date: new Date().toISOString(),
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: channelId },
        value: [{ content: caption, image: [mediaRef] }],
        settings: { post_type: 'post' },
      },
    ],
  }

  let postizPostId: string | null = null
  try {
    const res = await postizFetch('/posts', apiKey, { method: 'POST', body: payload })
    const body = (await res.json().catch(() => null)) as
      | { id?: string; postId?: string }
      | Array<{ id?: string; postId?: string }>
      | null
    if (!res.ok) {
      console.error('[publish-now] Postiz error:', res.status, JSON.stringify(body))
      return { ok: false, code: 'postiz_error' }
    }
    const first = Array.isArray(body) ? body[0] : body
    postizPostId = (first?.id ?? first?.postId ?? null) as string | null
  } catch (err) {
    console.error('[publish-now] Postiz unreachable:', err)
    return { ok: false, code: 'postiz_error' }
  }

  // 5. Persist publish state. Postiz accepted the post — even if this write
  //    fails we report success but log loudly for reconciliation.
  const { error: updErr } = await db
    .from('calendar_posts')
    .update({
      postiz_post_id: postizPostId,
      publish_status: 'published',
      published_at: new Date().toISOString(),
    })
    .eq('post_id', post.post_id)
  if (updErr) {
    console.error('[publish-now] calendar_posts update failed:', updErr)
  }

  revalidatePath(`/${slug}/on-demand`)
  revalidatePath(`/${slug}/on-demand/${requestId}`)
  return { ok: true, code: 'published' }
}
