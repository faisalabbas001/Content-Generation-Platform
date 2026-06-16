/**
 * POST /api/agents/ceo/batch-complete
 *
 * CEO Step 8 (final) — called by N8N-A01 once a brand's calendar skeleton has
 * been produced and bulk-inserted (decoupled producer; visuals run later in
 * N8N-V01-Worker). This is a deterministic acknowledgment + audit endpoint:
 * it does NOT call the LLM. It returns the routing_decision envelope A01 writes
 * to `routing_decisions`, and an (empty by default) memory_nominations array.
 *
 * Hard Rule #1 compliance: this is the CEO closing the loop on its own batch —
 * no COO/CCO/DeepSeek dispatch happens here.
 */
import { z } from 'zod'
import { schemas } from '@repo/core'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    batch_id: z.string().optional(),
    month: z.string().optional(),
    outcome: z.string().default('calendar_generated'),
    pipeline: z.string().optional(),
    confidence_mode: z.string().optional(),
    agents_dispatched: z.array(z.string()).optional(),
    posts_generated: z.number().int().nonnegative().optional(),
    cost_constraint: z.string().optional(),
    n8n_execution_id: z.union([z.string(), z.number()]).optional(),
    workflow_trigger: z.string().optional(),
  }),
})

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input, ctx) => {
    const p = input.payload

    // Build the routing_decision row A01 will persist to `routing_decisions`.
    // Deterministic — mirrors the inputs n8n already computed.
    const routing_decision = {
      brand_id: input.brand_id,
      flow_id: input.flow_id,
      request_type: 'batch_completion',
      pipeline_assigned: p.pipeline ?? 'A',
      agents_dispatched: p.agents_dispatched ?? ['CEO', 'COO', 'DeepSeek', 'MatchChain', 'CCO'],
      constraints_applied: {
        cost_constraint: p.cost_constraint ?? 'normal',
        confidence_mode: p.confidence_mode ?? 'Standard',
      },
      outcome: p.outcome ?? 'calendar_generated',
      confidence_mode: p.confidence_mode ?? 'Standard',
      timestamp: new Date().toISOString(),
    }

    // No automatic memory nominations at batch close — the confidence-gate step
    // already enqueued per-post signals. Return an empty array so A01's
    // memory_controller_queue insert writes a harmless default row (it guards
    // with ?? {} / ?? 'CEO').
    const memory_nominations: unknown[] = []

    return {
      acknowledged: true,
      batch_id: p.batch_id ?? null,
      month: p.month ?? null,
      posts_generated: p.posts_generated ?? 0,
      n8n_execution_id: p.n8n_execution_id ?? null,
      workflow_trigger: p.workflow_trigger ?? null,
      routing_decision,
      memory_nominations,
    }
  },
})
