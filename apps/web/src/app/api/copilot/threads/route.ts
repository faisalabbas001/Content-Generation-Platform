/**
 * GET /api/copilot/threads?role=management
 *   List the admin user's recent threads for a role (most recent first).
 *
 * POST /api/copilot/threads
 *   Body: { role: 'management' | 'tech' | 'production' }
 *   Create a new empty thread.
 */
import { NextResponse } from 'next/server'
import { copilotThreadsQ } from '@repo/db'
import { requireAdmin } from '@repo/auth/admin'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLE_SCHEMA = z.enum(['management', 'tech', 'production'])

export async function GET(req: Request) {
  const admin = await requireAdmin()
  const url = new URL(req.url)
  const role = ROLE_SCHEMA.safeParse(url.searchParams.get('role'))
  if (!role.success) return NextResponse.json({ error: 'invalid_role' }, { status: 400 })

  const include_archived = url.searchParams.get('include_archived') === 'true'
  const threads = await copilotThreadsQ.listThreads(admin.id, role.data, { include_archived })
  return NextResponse.json({ ok: true, threads })
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  const body = (await req.json().catch(() => ({}))) as { role?: unknown }
  const role = ROLE_SCHEMA.safeParse(body.role)
  if (!role.success) return NextResponse.json({ error: 'invalid_role' }, { status: 400 })
  const thread = await copilotThreadsQ.createThread(admin.id, role.data)
  return NextResponse.json({ ok: true, thread })
}
