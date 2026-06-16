// Instagram ingestion for scorecard — reuses @repo/scraping exactly as onboarding does.

import { runInstagramScrape } from '@repo/scraping'
import type { InstagramProfile, InstagramPost } from './types'
import { fetchImageAsBase64 } from './image-fetch'

export type IngestError =
  | 'private_account'
  | 'account_not_found'
  | 'rate_limited'
  | 'insufficient_posts'
  | 'scrape_failed'
  | 'apify_not_configured'

export type IngestResult =
  | { ok: true; profile: InstagramProfile; status: 'complete' | 'preliminary' | 'stale' }
  | { ok: false; error: IngestError; message: string }

export function normaliseHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/^@/, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

export async function ingestProfile(handle: string): Promise<IngestResult> {
  const apifyToken = process.env.APIFY_API_KEY?.trim()
  if (!apifyToken) {
    return { ok: false, error: 'apify_not_configured', message: 'APIFY_API_KEY is not set' }
  }

  // Use the same scraper the onboarding pipeline uses — run-sync-get-dataset-items
  const result = await runInstagramScrape({
    apifyToken,
    handle,
    postsLimit: 30,
    timeoutMs: 90000,
  })

  if (!result.ok) {
    // Detect private account from error string
    if (result.error?.toLowerCase().includes('private')) {
      return { ok: false, error: 'private_account', message: 'Account is private' }
    }
    return { ok: false, error: 'scrape_failed', message: result.error ?? 'Scrape failed' }
  }

  const d = result.details
  if (!d && result.posts.length === 0) {
    return { ok: false, error: 'account_not_found', message: `@${handle} not found` }
  }

  if (d?.isPrivate === true) {
    return { ok: false, error: 'private_account', message: 'Account is private' }
  }

  // Map Apify posts → our InstagramPost shape
  const posts: InstagramPost[] = result.posts.map(p => {
    const shortCode = String(p.shortCode ?? p.id ?? '')
    // Prefer the CDN displayUrl; if missing build the Instagram public media permalink
    // which redirects to a CDN image without requiring cookies.
    const media_url = p.displayUrl
      ? String(p.displayUrl)
      : shortCode
      ? `https://www.instagram.com/p/${shortCode}/media/?size=l`
      : ''
    return {
      id:             shortCode,
      media_url,
      short_code:     shortCode,
      media_type:     (p.type === 'Video' || p.productType === 'clips' || p.productType === 'igtv')
                        ? 'VIDEO'
                        : p.type === 'Sidecar' ? 'CAROUSEL_ALBUM' : 'IMAGE',
      caption:        String(p.caption ?? ''),
      timestamp:      String(p.timestamp ?? p.takenAtTimestamp ?? new Date().toISOString()),
      like_count:     Number(p.likesCount ?? 0),
      comments_count: Number(p.commentsCount ?? 0),
    }
  })

  // Pre-fetch images immediately while CDN URLs are fresh (Instagram CDN URLs expire quickly)
  // Batched concurrency=5 to avoid Instagram rate-limiting the fetch
  const imagePosts = posts.filter(p => (p.media_type === 'IMAGE' || p.media_type === 'CAROUSEL_ALBUM') && p.media_url).slice(0, 20)
  const FETCH_CONCURRENCY = 5
  const allFetchResults: PromiseSettledResult<{ id: string; img: Awaited<ReturnType<typeof fetchImageAsBase64>> }>[] = []
  for (let i = 0; i < imagePosts.length; i += FETCH_CONCURRENCY) {
    const batch = imagePosts.slice(i, i + FETCH_CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(p => fetchImageAsBase64(p.media_url!, p.short_code).then(img => ({ id: p.id, img })))
    )
    allFetchResults.push(...batchResults)
  }
  const fetchResults = allFetchResults
  const imageCache = new Map<string, { base64: string; mediaType: string }>()
  for (const r of fetchResults) {
    if (r.status === 'fulfilled' && r.value.img) {
      imageCache.set(r.value.id, { base64: r.value.img.base64, mediaType: r.value.img.mediaType })
    }
  }
  console.info(`[ingestion] prefetch handle=${handle} total=${imagePosts.length} success=${imageCache.size} failed=${imagePosts.length - imageCache.size}`)
  // Attach pre-fetched image data to posts
  const postsWithImages = posts.map(p => {
    const cached = imageCache.get(p.id)
    if (!cached) return p
    return {
      ...p,
      media_base64: cached.base64,
      media_mime: cached.mediaType as InstagramPost['media_mime'],
    }
  })

  const profile: InstagramProfile = {
    handle,
    name:            String(d?.fullName ?? handle),
    biography:       d?.biography ?? null,
    followers_count: Number(d?.followersCount ?? 0),
    media_count:     Number(d?.postsCount ?? posts.length),
    posts:           postsWithImages,
  }

  // Scan status
  let status: 'complete' | 'preliminary' | 'stale' = 'complete'
  if (posts.length < 10) {
    status = 'preliminary'
  } else {
    const sorted = [...posts].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    const daysSinceLast =
      (Date.now() - new Date(sorted[0]?.timestamp ?? 0).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceLast > 90) status = 'stale'
  }

  return { ok: true, profile, status }
}
