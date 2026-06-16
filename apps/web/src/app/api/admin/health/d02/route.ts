/**
 * GET /api/admin/health/d02
 *
 * Returns the health status of N8N-D02 (BrandDNA Maintenance) based on
 * routing_decisions rows written by the flow.
 *
 * Response shape:
 *   { ok, status, last_run_at, last_batch_id, last_outcome, age_days, consecutive_failures }
 *
 * status values:
 *   "ok"       — last run was within the last 35 days and succeeded
 *   "stale"    — no run in the last 35 days (cron is monthly; >35d = missed)
 *   "failing"  — last run exists but outcome indicates failure
 *   "never_run" — no routing_decisions rows for N8N-D02 at all
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-session'
import { adminClient, isDbConfigured } from '@repo/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STALE_THRESHOLD_DAYS = 35

interface D02Outcome {
  bundles_evaluated?: number
  nominations_enqueued?: number
  drained_written?: number
  drained_rejected?: number
  batch_id?: string
  duration_ms?: number
}

export async function GET() {
  await requireAdmin()

  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: 'db_not_configured' }, { status: 503 })
  }

  const supabase = adminClient()

  // Fetch the last 5 D02 runs to determine consecutive failures.
  const { data, error } = await supabase
    .from('routing_decisions')
    .select('decision_id, flow_id, outcome, timestamp')
    .eq('flow_id', 'N8N-D02')
    .order('timestamp', { ascending: false })
    .limit(5)

  if (error) {
    return NextResponse.json({ ok: false, error: 'db_query_failed', detail: error.message }, { status: 500 })
  }

  const runs = (data ?? []) as Array<{ decision_id: string; flow_id: string; outcome: string; timestamp: string }>

  if (runs.length === 0) {
    return NextResponse.json({
      ok: false,
      status: 'never_run',
      last_run_at: null,
      last_batch_id: null,
      last_outcome: null,
      age_days: null,
      consecutive_failures: 0,
    })
  }

  const latest = runs[0]
  const lastRunAt = new Date(latest.timestamp)
  const ageDays = Math.floor((Date.now() - lastRunAt.getTime()) / 86_400_000)

  let lastOutcome: D02Outcome | null = null
  try {
    const parsed = typeof latest.outcome === 'string' ? JSON.parse(latest.outcome) : latest.outcome
    lastOutcome = typeof parsed === 'object' && parsed !== null ? (parsed as D02Outcome) : null
  } catch {
    // malformed outcome — treat as unknown
  }

  // A run is considered a failure if the outcome object is missing or has
  // no bundles_evaluated field (which is always present on a successful D02 run).
  const isFailed = (run: { outcome: string }) => {
    try {
      const p = typeof run.outcome === 'string' ? JSON.parse(run.outcome) : run.outcome
      return typeof p?.bundles_evaluated !== 'number'
    } catch {
      return true
    }
  }

  const consecutiveFailures = runs.findIndex((r) => !isFailed(r))
  // findIndex returns -1 if ALL are failing; treat that as runs.length.
  const failCount = consecutiveFailures === -1 ? runs.length : consecutiveFailures

  const latestFailed = isFailed(latest)
  const status = latestFailed ? 'failing' : ageDays > STALE_THRESHOLD_DAYS ? 'stale' : 'ok'

  return NextResponse.json({
    ok: status === 'ok',
    status,
    last_run_at: latest.timestamp,
    last_batch_id: lastOutcome?.batch_id ?? null,
    last_outcome: lastOutcome,
    age_days: ageDays,
    consecutive_failures: failCount,
  })
}
