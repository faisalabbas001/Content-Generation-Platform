/**
 * GET /api/admin/brand/[brand_id]/caption-context
 *
 * Admin-only — returns the full CaptionContext stored in Qdrant for a brand.
 * Scrolls all points from the `brand_<brand_id>` collection and returns them.
 *
 * Query params:
 *   limit   (optional, default 100, max 1000) — how many points to return per page
 *   offset  (optional, Qdrant next-page token) — pass the `next_page_offset` from
 *             a previous response to page through large collections
 *   with_vectors (optional, default false) — include raw embedding vectors
 *
 * Response:
 *   { ok: true, collection, total, points: [...], next_page_offset }
 *
 * Auth: requireAdmin() validates the admin cookie + allowlist.
 * Qdrant: uses QDRANT_URL + QDRANT_API_KEY from env.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@repo/auth/admin'
import { collectionFor, isVectorsConfigured } from '@repo/vectors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function qdrantHeaders() {
  const key = process.env.QDRANT_API_KEY
  if (!key) throw new Error('QDRANT_API_KEY not set')
  return { 'api-key': key, 'content-type': 'application/json' }
}

function qdrantBase() {
  const url = process.env.QDRANT_URL?.replace(/\/$/, '')
  if (!url) throw new Error('QDRANT_URL not set')
  return url
}

export async function GET(req: Request, ctx: { params: Promise<{ brand_id: string }> }) {
  await requireAdmin()
  const { brand_id } = await ctx.params

  if (!UUID_RE.test(brand_id)) {
    return NextResponse.json({ ok: false, error: 'invalid_brand_id' }, { status: 400 })
  }

  if (!isVectorsConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'qdrant_not_configured', hint: 'Set QDRANT_URL and QDRANT_API_KEY in env' },
      { status: 503 },
    )
  }

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 1000)
  const offset = url.searchParams.get('offset') ?? null
  const withVectors = url.searchParams.get('with_vectors') === 'true'

  const collection = collectionFor(brand_id)

  // 1. Check the collection exists and grab metadata (total point count)
  const infoRes = await fetch(`${qdrantBase()}/collections/${collection}`, {
    headers: qdrantHeaders(),
  })

  if (infoRes.status === 404) {
    return NextResponse.json(
      {
        ok: false,
        error: 'collection_not_found',
        collection,
        hint: 'BrandDNA namespace has not been created yet — run N8N-A03 for this brand',
      },
      { status: 404 },
    )
  }
  if (!infoRes.ok) {
    const text = await infoRes.text()
    return NextResponse.json(
      { ok: false, error: 'qdrant_error', detail: text },
      { status: 502 },
    )
  }

  const infoBody = (await infoRes.json()) as {
    result?: { points_count?: number; status?: string; config?: unknown }
  }
  const total = infoBody.result?.points_count ?? 0
  const collectionStatus = infoBody.result?.status ?? 'unknown'

  // 2. Scroll all points
  const scrollBody: Record<string, unknown> = {
    limit,
    with_payload: true,
    with_vector: withVectors,
  }
  if (offset) scrollBody.offset = offset

  const scrollRes = await fetch(`${qdrantBase()}/collections/${collection}/points/scroll`, {
    method: 'POST',
    headers: qdrantHeaders(),
    body: JSON.stringify(scrollBody),
  })

  if (!scrollRes.ok) {
    const text = await scrollRes.text()
    return NextResponse.json(
      { ok: false, error: 'qdrant_scroll_error', detail: text },
      { status: 502 },
    )
  }

  const scrollData = (await scrollRes.json()) as {
    result?: {
      points?: Array<{ id: string | number; payload?: Record<string, unknown>; vector?: unknown }>
      next_page_offset?: string | number | null
    }
  }

  const points = scrollData.result?.points ?? []
  const next_page_offset = scrollData.result?.next_page_offset ?? null

  return NextResponse.json({
    ok: true,
    brand_id,
    collection,
    collection_status: collectionStatus,
    total_points: total,
    returned: points.length,
    next_page_offset,
    points,
  })
}
