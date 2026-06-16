/**
 * Generic n8n → AI agent route handler.
 *
 * Every `/api/agents/*` route follows the same shape:
 *   1. Verify HMAC + replay + idempotency (lib/n8n-auth)
 *   2. JSON.parse the body
 *   3. Validate the input shape with a Zod schema
 *   4. Call the agent wrapper in @repo/ai (which handles retry + logging)
 *   5. Return the result (and cache it for idempotency)
 *
 * Centralising this means:
 *   - Each route file is ~20 lines and easy to audit.
 *   - Security policy is enforced uniformly (one place to fix bugs).
 *   - Errors map cleanly (Zod fail → 400, provider overloaded → 503 + Retry-After,
 *     AiCallFailedError → 502, anything else → 500 without leaking stack traces).
 */
import type { z } from 'zod'
import { AiCallFailedError } from '@repo/ai'
import {
  verifyN8nRequest,
  rememberIdempotent,
  rememberRequestResponse,
  errorResponse,
  jsonResponse,
} from './n8n-auth'

export interface AgentRouteOptions<S extends z.ZodTypeAny, TOut> {
  /** Zod schema validating the inbound request body. */
  inputSchema: S
  /** Run the agent; receive validated input + the n8n requestId. */
  handler: (input: z.infer<S>, ctx: { requestId: string; flowId: string }) => Promise<TOut>
  /** What to log this call as in usage_logs.flow_id when not provided. */
  defaultFlowId: string
}

/**
 * Build a POST handler. Usage:
 *
 *   export const POST = makeAgentRoute({
 *     inputSchema: CeoClassifyRequest,
 *     defaultFlowId: 'unknown_flow',
 *     handler: async (input, ctx) => ceo.classify(input.payload, { ...ctx, db: adminClient() }),
 *   })
 */
export function makeAgentRoute<S extends z.ZodTypeAny, TOut>(opts: AgentRouteOptions<S, TOut>) {
  return async function POST(request: Request): Promise<Response> {
    const verified = await verifyN8nRequest(request)
    if (!verified.ok) return verified.response
    if (verified.cachedResponse) return verified.cachedResponse

    const { rawBody, requestId, idempotencyKey } = verified.req

    let parsedBody: unknown
    try {
      parsedBody = JSON.parse(rawBody)
    } catch {
      return errorResponse(400, 'invalid_json', 'Request body is not valid JSON')
    }

    const validation = opts.inputSchema.safeParse(parsedBody)
    if (!validation.success) {
      const issues = validation.error.issues.slice(0, 5).map((i: z.ZodIssue) => ({
        path: i.path.join('.'),
        message: i.message,
      }))
      // Log to terminal so n8n's hidden response body isn't the only place
      // the failure surfaces. Trim the raw body to 1500 chars so we don't
      // dump huge IG payloads but we can still see the shape that failed.
      const url = new URL(request.url).pathname
      const peek = rawBody.length > 1500 ? rawBody.slice(0, 1500) + '…(truncated)' : rawBody
      console.warn(`[agent-route] invalid_input ${url} request_id=${requestId} issues=${JSON.stringify(issues)}`)
      console.warn(`[agent-route] body_peek=${peek}`)
      return errorResponse(400, 'invalid_input', 'Request body did not match schema', { issues })
    }
    const validated = validation.data as z.infer<S>

    // Allow callers to override flow_id via a top-level `flow_id` field if the
    // input schema includes one — the agent wrappers thread this into usage_logs.
    const flowId =
      (parsedBody as { flow_id?: unknown })?.flow_id &&
      typeof (parsedBody as { flow_id?: unknown }).flow_id === 'string'
        ? ((parsedBody as { flow_id: string }).flow_id)
        : opts.defaultFlowId

    try {
      const result = await opts.handler(validated, { requestId, flowId })
      const responseBody = { ok: true, request_id: requestId, result }
      rememberIdempotent(idempotencyKey, 200, responseBody)
      rememberRequestResponse(requestId, 200, responseBody)
      return jsonResponse(200, responseBody)
    } catch (err) {
      if (err instanceof AiCallFailedError) {
        if (err.isOverloaded) {
          // Anthropic 529 — provider is temporarily at capacity.
          // Return 503 so n8n's retry mechanism reschedules rather than treating
          // this as a permanent failure. Retry-After: 60 tells n8n to wait 60s.
          const body = JSON.stringify({
            ok: false,
            error: 'provider_overloaded',
            message: 'AI provider is temporarily overloaded — retry in 60s',
            node: err.node,
            attempts: err.attempts,
            request_id: requestId,
          })
          return new Response(body, {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
          })
        }
        // Any other AI failure after retries — usage + anomaly already logged.
        return errorResponse(502, 'agent_call_failed', err.message, {
          node: err.node,
          attempts: err.attempts,
          request_id: requestId,
        })
      }
      // Unknown — log to stderr (Vercel captures it) and return generic 500.
      console.error(`[agent-route] ${opts.defaultFlowId} crashed:`, err)
      return errorResponse(500, 'internal_error', 'agent route crashed', { request_id: requestId })
    }
  }
}

