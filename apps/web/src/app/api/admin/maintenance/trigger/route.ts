/**
 * POST /api/admin/maintenance/trigger
 *
 * Admin-only endpoint to manually fire D02 (BrandDNA maintenance) or A05
 * (upgrade readiness scoring) without waiting for the monthly cron.
 *
 * Body: { flow: 'D02' | 'A05' }
 *
 * What it does:
 *   D02 — fires the n8n D02 webhook which sweeps stale evidence_bundles,
 *          enqueues confidence_upgrade nominations, drains memory queue.
 *   A05 — fires the n8n A05 webhook which scores all free-tier brands and
 *          writes results to brand_performance_log + routing_decisions.
 *
 * Auth: requireAdmin() validates admin cookie.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { triggerN8n } from '@/lib/n8n-outbound'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  flow: z.enum(['D02', 'A05']),
})

const FLOW_PATHS: Record<'D02' | 'A05', string> = {
  D02: process.env.N8N_D02_WEBHOOK_PATH ?? '/webhook/openclaw-maintenance',
  A05: process.env.N8N_A05_WEBHOOK_PATH ?? '/webhook/openclaw-upgrade-check',
}

export async function POST(req: Request) {
  const admin = await requireAdmin()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = Body.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }

  const { flow } = parsed.data
  const path = FLOW_PATHS[flow]

  const result = await triggerN8n({
    path,
    body: {
      flow_id: `N8N-${flow}`,
      triggered_by: 'admin_manual',
      triggered_at: new Date().toISOString(),
    },
    timeoutMs: 10_000,
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: 'n8n_trigger_failed', detail: result.error, request_id: result.request_id },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    flow,
    request_id: result.request_id,
    triggered_by: admin.email,
    message: `${flow} triggered — check /admin/flows for execution status`,
  })
}
