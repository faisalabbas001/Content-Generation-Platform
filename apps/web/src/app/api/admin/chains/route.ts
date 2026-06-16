/**
 * GET  /api/admin/chains   — list chains (with filters)
 * POST /api/admin/chains   — create new chain
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { chainsQ } from '@repo/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const limit  = Math.min(200, parseInt(sp.get('limit')  ?? '100', 10))
  const offset = Math.max(0,   parseInt(sp.get('offset') ?? '0',   10))

  try {
    const result = await chainsQ.listChains(
      {
        family:      sp.get('family')      ?? undefined,
        output_type: sp.get('output_type') ?? undefined,
        is_active:   sp.has('is_active')   ? sp.get('is_active') === 'true' : undefined,
        search:      sp.get('search')      ?? undefined,
      },
      { limit, offset },
    )
    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/admin/chains GET]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data = body as Record<string, unknown>
  if (!data.chain_id || typeof data.chain_id !== 'string') {
    return NextResponse.json({ error: 'chain_id is required' }, { status: 400 })
  }
  if (!data.name_en || !data.name_ar || !data.family || !data.fal_model_primary || !data.prompt_template) {
    return NextResponse.json({ error: 'Missing required fields: name_en, name_ar, family, fal_model_primary, prompt_template' }, { status: 400 })
  }

  try {
    const chain = await chainsQ.upsertChain(data as unknown as Parameters<typeof chainsQ.upsertChain>[0])
    return NextResponse.json(chain, { status: 201 })
  } catch (e) {
    console.error('[api/admin/chains POST]', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
