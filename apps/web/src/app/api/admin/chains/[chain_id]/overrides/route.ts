/**
 * GET    /api/admin/chains/[chain_id]/overrides          — list brand overrides for a chain
 * POST   /api/admin/chains/[chain_id]/overrides          — upsert brand override
 * DELETE /api/admin/chains/[chain_id]/overrides?id=UUID  — delete brand override by id
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { chainsQ } from '@repo/db'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ chain_id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try { await requireAdmin() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { chain_id } = await params
  try {
    const overrides = await chainsQ.listBrandOverrides(chain_id)
    return NextResponse.json({ overrides })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try { await requireAdmin() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { chain_id } = await params
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const data = body as Record<string, unknown>
  if (!data.brand_id || typeof data.brand_id !== 'string') {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 })
  }
  try {
    const override = await chainsQ.upsertBrandOverride({
      chain_id,
      brand_id:                 data.brand_id as string,
      prompt_suffix:            (data.prompt_suffix as string | null) ?? null,
      negative_prompt_override: (data.negative_prompt_override as string | null) ?? null,
      fal_model_override:       (data.fal_model_override as string | null) ?? null,
      is_active:                typeof data.is_active === 'boolean' ? data.is_active : true,
      notes:                    (data.notes as string | null) ?? null,
    })
    return NextResponse.json(override, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, _ctx: Params) {
  try { await requireAdmin() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 })
  try {
    await chainsQ.deleteBrandOverride(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
