/**
 * POST /api/agents/audit-reporter
 *
 * Audit Reporter (spec §9 — Phase 7).
 * Generates weekly OGZ system audit report covering:
 *   - Compliance gate hit rates (hard blocks caught)
 *   - CCO approval rates per brand
 *   - Chain selection accuracy
 *   - C2PA compliance percentage
 *   - Cost per brand
 *   - BrandDNA completeness distribution
 *   - Learning cycle outcomes
 *
 * Called by N8N-D02 every Sunday 06:00 Riyadh time.
 * Sends report to Copilot (Management role) via Resend.
 */
import { z } from 'zod'
import { adminClient } from '@repo/db/client'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  flow_id:      z.string().min(1),
  brand_id:     z.string().uuid().optional().default('00000000-0000-0000-0000-000000000000'),
  payload: z.object({
    period_start: z.string(),
    period_end:   z.string(),
    scope:        z.enum(['system', 'brand']).default('system'),
  }),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-D02',
  handler: async (input) => {
    const db = adminClient()
    const { period_start, period_end, scope } = input.payload

    // Gather metrics in parallel
    const [
      usageSummary,
      complianceHits,
      c2paCompliance,
      completenessStats,
      learningCycles,
    ] = await Promise.allSettled([
      // Cost by agent this period
      db.from('usage_logs')
        .select('agent, cost_usd, tokens_in, tokens_out' as never)
        .gte('created_at' as never, period_start)
        .lte('created_at' as never, period_end)
        .then(({ data }) => {
          const byAgent: Record<string, { cost: number; calls: number }> = {}
          for (const row of data ?? []) {
            const r = row as unknown as Record<string, unknown>
            const agent = String(r.agent ?? 'unknown')
            if (!byAgent[agent]) byAgent[agent] = { cost: 0, calls: 0 }
            byAgent[agent].cost += Number(r.cost_usd ?? 0)
            byAgent[agent].calls += 1
          }
          return byAgent
        }),

      // Hard block hits from branddna_event_log
      db.from('branddna_event_log')
        .select('event_type, brand_id')
        .eq('event_type' as never, 'hard_block_triggered')
        .gte('created_at' as never, period_start)
        .lte('created_at' as never, period_end)
        .then(({ data }) => data?.length ?? 0),

      // C2PA compliance from v_c2pa_compliance view
      db.from('v_c2pa_compliance' as never)
        .select('*')
        .limit(1)
        .then(({ data }) => (data?.[0] as unknown as Record<string, unknown>) ?? null),

      // BrandDNA completeness distribution
      db.from('brand_profiles')
        .select('completeness_score')
        .then(({ data }) => {
          const scores = (data ?? []).map((r) => Number((r as Record<string, unknown>).completeness_score ?? 0))
          const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0
          const pct100 = scores.filter((s) => s >= 100).length
          const pctBelow50 = scores.filter((s) => s < 50).length
          return { avg: Math.round(avg), total_brands: scores.length, complete: pct100, below_50: pctBelow50 }
        }),

      // Learning cycles this period
      db.from('learning_cycles' as never)
        .select('brand_id, patterns_found, cost_usd, status' as never)
        .gte('ran_at' as never, period_start)
        .lte('ran_at' as never, period_end)
        .then(({ data }: { data: unknown[] | null; error: unknown }) => data?.length ?? 0),
    ])

    const usage = usageSummary.status === 'fulfilled' ? usageSummary.value : {}
    const totalCost = Object.values(usage).reduce((s, v) => s + v.cost, 0)
    const hardBlockHits = complianceHits.status === 'fulfilled' ? complianceHits.value : 0
    const c2pa = c2paCompliance.status === 'fulfilled' ? c2paCompliance.value : null
    const completeness = completenessStats.status === 'fulfilled' ? completenessStats.value : null
    const learningCount = learningCycles.status === 'fulfilled' ? learningCycles.value : 0

    const report = {
      period_start,
      period_end,
      generated_at:        new Date().toISOString(),
      cost_summary: {
        total_usd:          Number(totalCost.toFixed(4)),
        by_agent:           usage,
      },
      compliance: {
        hard_block_hits:    hardBlockHits,
        c2pa_signed_pct:    c2pa ? Number((c2pa as Record<string, unknown>).signed_pct ?? 0) : null,
        c2pa_total_posts:   c2pa ? Number((c2pa as Record<string, unknown>).total_posts ?? 0) : null,
      },
      branddna: {
        avg_completeness:   completeness?.avg ?? null,
        total_brands:       completeness?.total_brands ?? null,
        brands_complete:    completeness?.complete ?? null,
        brands_below_50:    completeness?.below_50 ?? null,
      },
      learning: {
        cycles_run:         learningCount,
      },
      scope,
    }

    // Write to branddna_event_log as system audit event
    try {
      await db.from('branddna_event_log').insert({
        brand_id:   '00000000-0000-0000-0000-000000000000',
        event_type: 'weekly_audit_report',
        payload:    report,
        source:     'audit_reporter',
      } as never)
    } catch { /* non-fatal */ }

    return {
      task_type: 'audit_report' as const,
      ...report,
    }
  },
})
