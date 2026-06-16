/**
 * GET /api/posts/on-demand/:requestId/status
 *
 * Lightweight polling endpoint used by the on-demand form to watch a
 * request's progress without a full page reload. Returns only status and
 * failure_reason — the detail page owns the full view once delivered.
 *
 * Auth: user-scoped client → RLS enforces that the caller owns the brand
 * that owns this request. Unknown or foreign request_ids return 404.
 */
import { NextResponse } from 'next/server'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (userDb as any)
    .from('on_demand_requests')
    .select('status, failure_reason, current_step, media_type')
    .eq('request_id', requestId)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const row = data as { status: string; failure_reason: string | null; current_step: string | null; media_type: string | null }
  return NextResponse.json({
    status:         row.status,
    failure_reason: row.failure_reason ?? null,
    current_step:   row.current_step ?? null,
    media_type:     row.media_type ?? 'image',
  })
}
