/**
 * GET    /api/admin/chains/[chain_id]   — fetch single chain
 * PATCH  /api/admin/chains/[chain_id]   — update chain fields
 * DELETE /api/admin/chains/[chain_id]   — delete chain (hard delete)
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
    const chain = await chainsQ.getChain(chain_id)
    if (!chain) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(chain)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try { await requireAdmin() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { chain_id } = await params
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  // Prevent chain_id from being changed via patch
  const { chain_id: _ignored, ...patch } = body as Record<string, unknown>
  try {
    const updated = await chainsQ.updateChain(chain_id, patch as Parameters<typeof chainsQ.updateChain>[1])
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try { await requireAdmin() } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { chain_id } = await params
  try {
    await chainsQ.deleteChain(chain_id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
