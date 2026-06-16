/**
 * GET /api/img-proxy?u=<encoded-url>
 *
 * Server-side image proxy used as a fallback when an external image URL
 * (typically Instagram CDN) refuses to load cross-origin. The browser
 * already tries the direct URL with `referrerPolicy="no-referrer"`; this
 * route is the second-chance path for cases where IG also IP-rate-limits
 * or returns 403 to the user's region.
 *
 * Allowlist:
 *   • *.cdninstagram.com  (Instagram profile pics + post thumbnails)
 *   • *.fbcdn.net         (older IG/Meta CDN host)
 * Anything else → 400. We refuse to be an open proxy.
 *
 * Caches for 24h (s-maxage) — IG signed URLs typically last ~24h, so caching
 * past expiry is wasteful. Public so Vercel's CDN can hold it.
 */
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_HOST_SUFFIXES = ['.cdninstagram.com', '.fbcdn.net']

export async function GET(req: Request) {
  const url = new URL(req.url)
  const target = url.searchParams.get('u')
  if (!target) return new NextResponse('missing u', { status: 400 })

  let parsed: URL
  try { parsed = new URL(target) }
  catch { return new NextResponse('invalid url', { status: 400 }) }

  if (parsed.protocol !== 'https:') return new NextResponse('https only', { status: 400 })
  if (!ALLOWED_HOST_SUFFIXES.some((s) => parsed.hostname.endsWith(s))) {
    return new NextResponse('host not allowed', { status: 400 })
  }

  const upstream = await fetch(parsed.toString(), {
    // No referer + no auth — emulate an anonymous IG client.
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; OGz Studios/1.0)',
      accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
    },
    redirect: 'follow',
    cache: 'no-store',
  })

  if (!upstream.ok || !upstream.body) {
    return new NextResponse(`upstream ${upstream.status}`, { status: 502 })
  }
  const ct = upstream.headers.get('content-type') ?? 'image/jpeg'
  if (!ct.startsWith('image/')) return new NextResponse('not an image', { status: 415 })

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': ct,
      'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
    },
  })
}
