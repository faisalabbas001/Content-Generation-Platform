// Shared Postiz Public API helpers for the connect/detect/sync routes.

// Cloud default; self-hosted instances override via POSTIZ_API_URL
// (e.g. https://postiz.yourdomain.com/public/v1)
export const POSTIZ_API = process.env.POSTIZ_API_URL ?? 'https://api.postiz.com/public/v1'

export type PostizIntegration = {
  id: string         // Postiz channel ID — e.g. "cmp8csbux00amqh0ymw9l5btd"
  name: string       // Display name
  identifier: string // Provider slug — "instagram" | "instagram-standalone" | …
  picture?: string
  profile: string    // Instagram profile URL / handle (may be empty)
  disabled: boolean
}

export function isInstagram(i: PostizIntegration) {
  return (
    (i.identifier === 'instagram' || i.identifier === 'instagram-standalone') &&
    !i.disabled
  )
}

export function igHandle(i: PostizIntegration) {
  return i.profile?.replace(/^.*instagram\.com\//, '').replace(/\/$/, '') || i.name
}

export type ChannelClaim = {
  postiz_channel_id: string
  brand_id: string
  /** auth_user_id of the brand that holds this claim (null if unresolvable). */
  auth_user_id: string | null
}

export type ChannelResolution =
  | { channel: PostizIntegration; reclaimFromBrandIds: string[] }
  | { conflict: true }
  | null

/**
 * Picks which Postiz Instagram channel belongs to the brand currently
 * connecting. Shared by /api/postiz/sync-channels and /api/postiz/detect.
 *
 * Rules, in priority order:
 *   1. A channel that appeared AFTER the connect snapshot and is unclaimed.
 *   2. A new channel claimed by another brand of the SAME user (Postiz
 *      "Channel Updated" case — the user re-authorized an account they had
 *      already connected to an older brand; the claim moves with them).
 *   3. The channel already claimed by THIS brand (re-verify).
 *   4. Any unclaimed channel.
 *   5. A same-user-claimed channel, disambiguated by the OAuth flow type the
 *      user clicked (instagram vs instagram-standalone). If still ambiguous
 *      (several candidates), report a conflict instead of guessing.
 *
 * Channels claimed by a DIFFERENT user's brand are never eligible — a client
 * must not be able to take over another client's Instagram.
 */
export function resolveChannelForBrand(opts: {
  igChannels: PostizIntegration[]
  knownIds: string[]
  connectType: string | null
  claims: ChannelClaim[]
  brandId: string
  userId: string
}): ChannelResolution {
  const { igChannels, knownIds, connectType, claims, brandId, userId } = opts
  const claimFor = new Map(claims.map((c) => [c.postiz_channel_id, c]))

  const claimedByOtherUser = (id: string) => {
    const c = claimFor.get(id)
    return !!c && c.brand_id !== brandId && c.auth_user_id !== userId
  }
  const claimedBySameUserOtherBrand = (id: string) => {
    const c = claimFor.get(id)
    return !!c && c.brand_id !== brandId && c.auth_user_id === userId
  }
  const unclaimed = (id: string) => !claimFor.has(id)
  const mine = (id: string) => claimFor.get(id)?.brand_id === brandId

  const eligible = igChannels.filter((i) => !claimedByOtherUser(i.id))

  let pick =
    eligible.find((i) => !knownIds.includes(i.id) && unclaimed(i.id)) ??
    eligible.find((i) => !knownIds.includes(i.id) && claimedBySameUserOtherBrand(i.id)) ??
    eligible.find((i) => mine(i.id)) ??
    eligible.find((i) => unclaimed(i.id))

  if (!pick) {
    let sameUser = eligible.filter((i) => claimedBySameUserOtherBrand(i.id))
    if (connectType) {
      const typed = sameUser.filter((i) => i.identifier === connectType)
      if (typed.length > 0) sameUser = typed
    }
    if (sameUser.length === 1) pick = sameUser[0]
    else if (sameUser.length > 1) return { conflict: true }
  }

  if (!pick) return null
  const pickedId = pick.id
  const reclaimFromBrandIds = claims
    .filter((c) => c.postiz_channel_id === pickedId && c.brand_id !== brandId)
    .map((c) => c.brand_id)
  return { channel: pick, reclaimFromBrandIds }
}

// ─── Publishing helpers ──────────────────────────────────────────────────────
// Shared by the on-demand publishNow action and the calendar schedule /
// publish-now / pause / reschedule actions. All shapes validated against the
// live Postiz public API (2026-06).

export type PostizMediaRef = { id: string; path: string }

/**
 * Downloads a file (e.g. a Supabase signed URL) and uploads it into Postiz's
 * media library. Postiz post payloads must reference uploaded media objects —
 * raw URLs are rejected by validation.
 */
export async function postizUploadFromUrl(
  apiKey: string,
  srcUrl: string,
  filename: string,
): Promise<PostizMediaRef> {
  // Both fetches retry transient network errors (this machine's DNS
  // intermittently fails with ENOTFOUND — one flake must not fail a publish).
  const fileRes = await fetchWithRetry(srcUrl)
  if (!fileRes.ok) throw new Error(`media download failed: ${fileRes.status}`)
  const blob = await fileRes.blob()
  const form = new FormData()
  form.append('file', blob, filename)
  const upRes = await fetchWithRetry(`${POSTIZ_API}/upload`, {
    method: 'POST',
    headers: { Authorization: apiKey },
    body: form,
  })
  const body = (await upRes.json().catch(() => null)) as { id?: string; path?: string } | null
  if (!upRes.ok || !body?.id || !body?.path) {
    throw new Error(`postiz upload failed: ${upRes.status} ${JSON.stringify(body)}`)
  }
  return { id: body.id, path: body.path }
}

/** fetch with retry on thrown network errors (DNS flakes, resets). */
async function fetchWithRetry(url: string, init?: RequestInit, retries = 2): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init)
    } catch (err) {
      lastErr = err
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw lastErr
}

/**
 * Creates a Postiz post. type 'now' publishes immediately; 'schedule' queues
 * it for `date` (Postiz owns the clock — fires even if our app is down).
 * Returns the Postiz post id.
 */
export async function postizCreatePost(
  apiKey: string,
  opts: {
    type: 'now' | 'schedule' | 'draft'
    date: string // ISO
    channelId: string
    caption: string
    media: PostizMediaRef
  },
): Promise<string> {
  const payload = {
    type: opts.type,
    date: opts.date,
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: opts.channelId },
        value: [{ content: opts.caption, image: [opts.media] }],
        settings: { post_type: 'post' },
      },
    ],
  }
  const res = await postizFetch('/posts', apiKey, { method: 'POST', body: payload })
  const body = (await res.json().catch(() => null)) as
    | { id?: string; postId?: string }
    | Array<{ id?: string; postId?: string }>
    | null
  if (!res.ok) throw new Error(`postiz create failed: ${res.status} ${JSON.stringify(body)}`)
  const first = Array.isArray(body) ? body[0] : body
  const id = (first?.postId ?? first?.id) as string | undefined
  if (!id) throw new Error(`postiz create returned no id: ${JSON.stringify(body)}`)
  return id
}

/** Deletes a Postiz post (scheduled or otherwise). Best-effort — 404 is fine. */
export async function postizDeletePost(apiKey: string, postizPostId: string): Promise<void> {
  const res = await postizFetch(`/posts/${postizPostId}`, apiKey, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '')
    throw new Error(`postiz delete failed: ${res.status} ${body.slice(0, 200)}`)
  }
}

export type PostizPostState = {
  id: string
  state: string // 'QUEUE' | 'PUBLISHED' | 'ERROR' | ...
  publishDate?: string
  releaseURL?: string | null
}

/**
 * Lists Postiz posts in a date window. Used to reconcile our publish_status
 * with reality after a scheduled post's time has passed (state PUBLISHED +
 * releaseURL = the live Instagram permalink).
 */
export async function postizListPosts(
  apiKey: string,
  startISO: string,
  endISO: string,
): Promise<PostizPostState[]> {
  const qs = `?startDate=${encodeURIComponent(startISO)}&endDate=${encodeURIComponent(endISO)}`
  const res = await postizFetch(`/posts${qs}`, apiKey)
  if (!res.ok) throw new Error(`postiz list failed: ${res.status}`)
  const body = (await res.json().catch(() => null)) as
    | { posts?: PostizPostState[] }
    | PostizPostState[]
    | null
  if (Array.isArray(body)) return body
  return body?.posts ?? []
}

// Local dev machines intermittently fail DNS for api.postiz.com
// (getaddrinfo ENOTFOUND) — retry transient network errors before giving up.
export async function postizFetch(
  path: string,
  apiKey: string,
  init?: { method?: string; body?: unknown },
  retries = 2,
): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(`${POSTIZ_API}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: apiKey,
          ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        cache: 'no-store',
      })
    } catch (err) {
      lastErr = err
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
      }
    }
  }
  throw lastErr
}
