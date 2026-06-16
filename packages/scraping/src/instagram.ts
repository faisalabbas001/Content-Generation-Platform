/**
 * Apify Instagram scraper — runs `details` and `posts` modes in parallel.
 *
 * The Apify IG actor (`apify~instagram-scraper`) requires `resultsType` as
 * a STRING (not array), so we kick off two independent runs and combine
 * results.
 *
 * Each call uses run-sync-get-dataset-items, which blocks until the actor
 * finishes (~15-90s) then returns the dataset as a JSON array. We use
 * AbortController to bound each call and log distinguishable errors.
 */
import type { InstagramProfile, InstagramPost, InstagramScrapeResult } from './types'

export interface InstagramScrapeResultWithRunIds extends InstagramScrapeResult {
  apify_run_id_details: string | null
  apify_run_id_posts:   string | null
}

const APIFY_ENDPOINT = 'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items'

export interface RunInstagramOptions {
  /** Apify API token (passed in by the wrapper). */
  apifyToken: string
  /** Public Instagram handle (no @, no URL). e.g. 'kudusa' */
  handle: string
  /** Hard timeout per individual Apify call (ms). Default 90000. */
  timeoutMs?: number
  /** Max posts to retrieve. Default 50 (matches old n8n behaviour). */
  postsLimit?: number
}

/**
 * Fire details + posts in parallel via `Promise.all`. Either side is allowed
 * to fail independently — we return whatever succeeded so callers can still
 * extract value from a partial scrape.
 */
export async function runInstagramScrape(opts: RunInstagramOptions): Promise<InstagramScrapeResultWithRunIds> {
  const limit = opts.postsLimit ?? 50
  const timeoutMs = opts.timeoutMs ?? 90000

  console.info(`[scraping/instagram] START handle=${opts.handle} postsLimit=${limit} timeout=${timeoutMs}ms`)

  const detailsBody = {
    directUrls:    [`https://instagram.com/${opts.handle}/`],
    resultsLimit:  1,
    resultsType:   'details',
    addParentData: false,
  }
  const postsBody = {
    directUrls:    [`https://instagram.com/${opts.handle}/`],
    resultsLimit:  limit,
    resultsType:   'posts',
    addParentData: false,
  }

  const t0 = Date.now()
  const [detailsResult, postsResult] = await Promise.allSettled([
    callApify(opts.apifyToken, detailsBody, timeoutMs, 'details'),
    callApify(opts.apifyToken, postsBody,   timeoutMs, 'posts'),
  ])
  const elapsed = Date.now() - t0

  // Extract run IDs for cost lookup
  const apify_run_id_details = detailsResult.status === 'fulfilled' ? detailsResult.value.runId : null
  const apify_run_id_posts   = postsResult.status   === 'fulfilled' ? postsResult.value.runId   : null

  const rawDetailsArr = detailsResult.status === 'fulfilled' ? detailsResult.value.data : []
  const rawPostsArr   = postsResult.status   === 'fulfilled' ? postsResult.value.data   : []

  const rawDetails = (rawDetailsArr as InstagramProfile[])[0] ?? null
  // Apify's details payload embeds latestPosts (24) + latestIgtvVideos (12)
  // regardless of resultsLimit. Trim them too so dev mode genuinely sees N.
  const details = rawDetails ? {
    ...rawDetails,
    latestPosts:      Array.isArray((rawDetails as Record<string, unknown>).latestPosts)
      ? ((rawDetails as Record<string, unknown>).latestPosts as unknown[]).slice(0, limit)
      : (rawDetails as Record<string, unknown>).latestPosts,
    latestIgtvVideos: Array.isArray((rawDetails as Record<string, unknown>).latestIgtvVideos)
      ? ((rawDetails as Record<string, unknown>).latestIgtvVideos as unknown[]).slice(0, limit)
      : (rawDetails as Record<string, unknown>).latestIgtvVideos,
  } as InstagramProfile : null
  // Apify's `resultsLimit` is "best effort" — for some accounts it returns
  // pinned posts on top of the cap. Hard-trim client-side so the env-controlled
  // IG_POSTS_LIMIT is the actual ceiling (matters for dev + cost control).
  const allPosts = (rawPostsArr as InstagramPost[]).filter(
    (p): p is InstagramPost => p !== null && (!!p.shortCode || !!p.caption || !!p.type),
  )
  const posts = allPosts.slice(0, limit)
  if (allPosts.length > posts.length) {
    console.info(
      `[scraping/instagram] TRIM handle=${opts.handle} apify_returned=${allPosts.length} ` +
      `kept=${posts.length} (env IG_POSTS_LIMIT enforced)`,
    )
  }

  const detailsErr = detailsResult.status === 'rejected' ? String(detailsResult.reason).slice(0, 200) : null
  const postsErr   = postsResult.status === 'rejected'   ? String(postsResult.reason).slice(0, 200)   : null

  const ok = details !== null || posts.length > 0
  console.info(
    `[scraping/instagram] ${ok ? 'OK' : 'FAIL'} handle=${opts.handle} ` +
    `details=${detailsResult.status}${detailsErr ? `(${detailsErr})` : ''} ` +
    `posts=${postsResult.status}${postsErr ? `(${postsErr})` : ''} ` +
    `posts_count=${posts.length} in ${elapsed}ms`,
  )

  return {
    ok,
    details,
    posts,
    error: !ok
      ? `IG: details=${detailsResult.status}${detailsErr ? ' '+detailsErr : ''}; posts=${postsResult.status}${postsErr ? ' '+postsErr : ''}`
      : null,
    apify_run_id_details,
    apify_run_id_posts,
  }
}

interface ApifyCallResult {
  data:  unknown[]
  runId: string | null
}

async function callApify(
  token: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  mode: string,
): Promise<ApifyCallResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // Pin actor memory so all 3 lanes fit under Apify Free's 8 GB concurrent
  // cap. IG fires TWO parallel calls (details + posts), so 1 GB × 2 = 2 GB
  // for IG, plus 2 GB for Web Crawler, plus 0 for Places (REST) = 4 GB total.
  const memoryMbytes = 1024
  try {
    const res = await fetch(`${APIFY_ENDPOINT}?token=${encodeURIComponent(token)}&memory=${memoryMbytes}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    // Capture run ID from response headers for exact cost lookup after completion.
    const runId = res.headers.get('X-Apify-Run-Id') ?? null
    if (runId) console.info(`[scraping/instagram] run_id=${runId} mode=${mode}`)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Apify IG ${mode} ${res.status}: ${text.slice(0, 200)}`)
    }
    const json = (await res.json()) as unknown
    return { data: Array.isArray(json) ? json : [], runId }
  } finally {
    clearTimeout(timer)
  }
}

