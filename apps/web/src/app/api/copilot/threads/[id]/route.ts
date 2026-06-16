/**
 * GET    /api/copilot/threads/[id] — full transcript for one thread.
 * DELETE /api/copilot/threads/[id] — soft-archive (sets archived_at).
 */
import { NextResponse } from 'next/server'
import { copilotThreadsQ } from '@repo/db'
import { requireAdmin } from '@repo/auth/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  const { id } = await ctx.params

  const thread = await copilotThreadsQ.getThread(id, admin.id)
  if (!thread) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const messages = await copilotThreadsQ.loadFullThread(id)
  return NextResponse.json({ ok: true, thread, messages })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  const { id } = await ctx.params
  await copilotThreadsQ.archiveThread(id, admin.id)
  return NextResponse.json({ ok: true })
}
