/**
 * GET /api/posts/on-demand/:requestId/download-clean
 *
 * Same model as /download but serves the pre-overlay (no Arabic text) image
 * variant — `calendar_posts.clean_storage_url`. Returns 409 with `no_clean_yet`
 * when the column is NULL (legacy posts before migration 0036, or generation
 * runs where the clean upload failed best-effort).
 *
 * Auth: user-scoped Supabase client + RLS — never bypasses ownership checks.
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

  const cleanUrl = row.post?.clean_storage_url ?? null
  if (!cleanUrl) {
    return NextResponse.json(
      { error: 'no_clean_yet', status: row.status },
      { status: 409 },
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(cleanUrl, { signal: AbortSignal.timeout(15_000) })
  } catch (err) {
    console.error('[on-demand:download-clean] upstream fetch failed:', err)
    return NextResponse.json({ error: 'upstream_unreachable' }, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: 'upstream_error', status: upstream.status },
      { status: 502 },
    )
  }

  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg'
  const ext = extensionFor(contentType, cleanUrl)
  const filename = `openclaw-${requestId.slice(0, 8)}-clean.${ext}`

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
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
  const m = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)
  return m ? m[1].toLowerCase() : 'jpg'
}
