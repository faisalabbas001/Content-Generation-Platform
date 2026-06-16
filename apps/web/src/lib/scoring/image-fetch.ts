// Fetch an image URL and return base64 + media type for Claude Vision.
// Instagram CDN URLs (cdninstagram.com / scontent-*.fbcdn.net) are signed and
// expire quickly — Claude's servers can't fetch them. We download client-side
// and pass bytes as base64.

const FETCH_TIMEOUT_MS = 10_000
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB — Claude Vision limit

export type Base64Image = {
  base64: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
}

const IG_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.instagram.com/',
  'sec-fetch-dest': 'image',
  'sec-fetch-mode': 'no-cors',
  'sec-fetch-site': 'cross-site',
}

async function tryFetch(url: string): Promise<Base64Image | null> {
  try {
    const res = await fetch(url, {
      headers: IG_BROWSER_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null

    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const mediaType = contentType.includes('png') ? 'image/png'
      : contentType.includes('webp') ? 'image/webp'
      : contentType.includes('gif') ? 'image/gif'
      : 'image/jpeg'

    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > MAX_BYTES || buffer.byteLength < 1000) return null

    return { base64: Buffer.from(buffer).toString('base64'), mediaType }
  } catch {
    return null
  }
}

// Extract Instagram shortCode from a CDN URL or a permalink URL
function extractShortCode(url: string): string | null {
  // CDN URL format: .../?_nc_ht=...&ig_cache_key=...  (no shortCode)
  // Permalink format: https://www.instagram.com/p/{code}/media/...
  const match = url.match(/instagram\.com\/p\/([A-Za-z0-9_-]+)/)
  return match?.[1] ?? null
}

// Fetch an image, trying the CDN URL first, then Instagram's public permalink fallback.
// Pass shortCode when available so the permalink fallback works even if CDN URL has no code.
export async function fetchImageAsBase64(url: string, shortCode?: string): Promise<Base64Image | null> {
  // 1. Try the URL directly (works for non-Instagram CDN URLs, or fresh signed URLs)
  const direct = await tryFetch(url)
  if (direct) return direct

  // 2. Instagram CDN (scontent-*.cdninstagram.com) returns 403 from server IPs.
  //    Fall back to Instagram's public permalink media redirect:
  //    https://www.instagram.com/p/{shortCode}/media/?size=l
  //    This is unauthenticated and returns a 302 to a CDN thumbnail.
  const code = shortCode ?? extractShortCode(url)
  if (code) {
    const permalinkUrl = `https://www.instagram.com/p/${code}/media/?size=l`
    const fromPermalink = await tryFetch(permalinkUrl)
    if (fromPermalink) return fromPermalink
  }

  return null
}
