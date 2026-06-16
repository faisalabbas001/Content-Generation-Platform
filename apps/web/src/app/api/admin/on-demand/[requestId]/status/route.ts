/**
 * GET /api/admin/on-demand/:requestId/status
 *
 * Admin-only polling endpoint mirroring the client-side
 * /api/posts/on-demand/:requestId/status. The admin Regenerate UI polls this
 * while a B03 regeneration runs to show the *real* pipeline step
 * (on_demand_requests.current_step, written by B03) and the real failure reason
 * instead of a generic spinner.
 *
 * Auth: admin cookie (getAdminUserOrNull). Service-role read — admin needs to
 * see any brand's request, so RLS is bypassed via adminClient.
 */
import { NextResponse } from 'next/server'
import { getAdminUserOrNull } from '@repo/auth/admin'
import { adminClient } from '@repo/db/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  const { requestId } = await context.params

  const admin = await getAdminUserOrNull()
  if (!admin) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient() as any)
    .from('on_demand_requests')
    .select('status, failure_reason, current_step, media_type')
    .eq('request_id', requestId)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const row = data as {
    status: string
    failure_reason: string | null
    current_step: string | null
    media_type: string | null
  }
  return NextResponse.json({
    status:         row.status,
    failure_reason: row.failure_reason ?? null,
    current_step:   row.current_step ?? null,
    media_type:     row.media_type ?? 'image',
  })
}
