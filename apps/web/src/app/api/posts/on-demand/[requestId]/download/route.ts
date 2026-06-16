/**
 * GET /api/posts/on-demand/:requestId/download
 *
 * Streams the on-demand post image back to the browser with a
 * `Content-Disposition: attachment` header so the click actually downloads
 * the file (instead of opening it in a new tab) — and so cross-origin
 * URLs (Supabase Storage CDN, picsum dummies) work without the browser
 * dropping the `download` attribute on a same-origin policy mismatch.
 *
 * Auth model:
 *   We call `getOnDemandRequestById` through the user-scoped client. RLS
 *   enforces ownership at the database — if the caller doesn't own the brand,
 *   the row simply doesn't come back and we return 404. We never try to
 *   bypass RLS here.
 */
import { NextResponse } from 'next/server'
import { onDemandQ } from '@repo/db'
import { getCurrentUser, getUserScopedClient } from '@repo/auth/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  const { requestId } = await context.params

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const userDb = await getUserScopedClient()
  const row = await onDemandQ.getOnDemandRequestById(requestId, userDb)
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const imageUrl = row.post?.storage_url ?? null
  if (!imageUrl) {
    return NextResponse.json({ error: 'no_image_yet', status: row.status }, { status: 409 })
  }

  // Fetch upstream (Supabase Storage / dummy CDN) and re-stream.
  let upstream: Response
  try {
    upstream = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) })
  } catch (err) {
    console.error('[on-demand:download] upstream fetch failed:', err)
    return NextResponse.json({ error: 'upstream_unreachable' }, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: 'upstream_error', status: upstream.status },
      { status: 502 },
    )
  }

  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg'
  const ext = extensionFor(contentType, imageUrl)
  const filename = `openclaw-${requestId.slice(0, 8)}.${ext}`

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      // RFC 5987-encoded filename so non-ASCII brand names don't break.
      'content-disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store',
    },
  })
}

function extensionFor(mime: string, url: string): string {
  const fromMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
    'image/gif':  'gif',
    'image/avif': 'avif',
  }
  if (fromMime[mime]) return fromMime[mime]
  // Fallback to the URL extension if the upstream didn't return a useful mime.
  const m = url.match(/\.([a-zA-Z0-9]{2,5})(?:\?|#|$)/)
  return m ? m[1].toLowerCase() : 'jpg'
}
