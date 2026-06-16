/**
 * POST /api/copilot/[role]
 *
 * Streams the copilot reply as Server-Sent Events so admins see tokens the
 * moment they are generated. Implements Doc §8.5.
 *
 * SSE event format (compact keys to minimise per-chunk overhead):
 *   data: {"t":"d","v":"<text chunk>"}                  ← delta
 *   data: {"t":"z","i":"<thread_id>","c":<cost_usd>}    ← done
 *   data: {"t":"e","m":"<message>"}                     ← error
 *
 * Pre-stream (synchronous — errors return plain JSON):
 *   1. requireAdmin()                   ← re-verified every call
 *   2. Rate-limit check                 ← 20 req / 60 s per admin
 *   3. Parse + validate body
 *   4. Thread resolution (create or load)
 *   5. Persist user message FIRST
 *   6. Parallel: fetchCopilotContext + loadThreadHistory   ← Gap 3 fix
 *
 * In-stream:
 *   7. copilot.askStream() → forward chunks as SSE deltas
 *   8. Persist assistant message after stream ends
 *   9. Send done event with thread_id + cost_usd
 */
import { NextResponse } from 'next/server'
import { adminClient, copilotContextQ, copilotThreadsQ } from '@repo/db'
import { copilot } from '@repo/ai'
import { requireAdmin } from '@repo/auth/admin'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// In-memory sliding-window rate limiter — 20 requests per admin per 60 s.
// Resets on cold start (serverless), which is acceptable for an internal tool.
const _rl = new Map<string, number[]>()
function allowRequest(adminId: string): boolean {
  const now    = Date.now()
  const window = (_rl.get(adminId) ?? []).filter((t) => now - t < 60_000)
  if (window.length >= 20) return false
  window.push(now)
  _rl.set(adminId, window)
  return true
}

const ALLOWED_ROLES = ['management', 'tech', 'production'] as const
type CopilotRole = (typeof ALLOWED_ROLES)[number]

const RequestBody = z.object({
  message:   z.string().min(1).max(4000),
  thread_id: z.string().uuid().optional(),
})

const enc = new TextEncoder()
function sseChunk(data: object): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request, ctx: { params: Promise<{ role: string }> }) {
  const { role } = await ctx.params
  if (!ALLOWED_ROLES.includes(role as CopilotRole)) {
    return NextResponse.json({ error: 'unknown_role' }, { status: 400 })
  }
  const copilotRole = role as CopilotRole

  // Re-verify admin on every API call. Layout guards the page; this guards the API.
  const admin = await requireAdmin()

  if (!allowRequest(admin.id)) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many requests — wait a moment.' },
      { status: 429 },
    )
  }

  let parsed: z.infer<typeof RequestBody>
  try {
    parsed = RequestBody.parse(await req.json())
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', message: e instanceof Error ? e.message : 'bad json' },
      { status: 400 },
    )
  }

  // ── Thread resolution ────────────────────────────────────────────────────
  let thread = parsed.thread_id
    ? await copilotThreadsQ.getThread(parsed.thread_id, admin.id)
    : null
  if (parsed.thread_id && !thread) {
    return NextResponse.json({ error: 'thread_not_found' }, { status: 404 })
  }
  if (thread && thread.role !== copilotRole) {
    return NextResponse.json({ error: 'thread_role_mismatch' }, { status: 400 })
  }
  if (!thread) {
    thread = await copilotThreadsQ.createThread(admin.id, copilotRole)
  }

  // ── Persist user turn BEFORE the stream starts ───────────────────────────
  // Done first so a model failure still leaves the question in the transcript.
  await copilotThreadsQ.appendUserMessage({
    thread_id:         thread.thread_id,
    content:           parsed.message,
    set_title_if_empty: true,
  })

  // ── Fetch context + history in parallel (Gap 3 fix) ─────────────────────
  // These use separate DB connections so Promise.all() gives true parallelism.
  const [context, fullHistory] = await Promise.all([
    copilotContextQ.fetchCopilotContext(copilotRole),
    copilotThreadsQ.loadThreadHistory(thread.thread_id),
  ])
  // Drop the user message we just persisted — it's the last row.
  const history = fullHistory.slice(0, -1)

  // ── Stream response ──────────────────────────────────────────────────────
  const threadSnap = thread
  const db         = adminClient()

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let result: Awaited<ReturnType<typeof copilot.askStream>> | null = null

      try {
        result = await copilot.askStream(
          {
            role:         copilotRole,
            history,
            user_message: parsed.message,
            context:      context as unknown as Record<string, unknown>,
          },
          {
            admin_user_id: admin.id,
            flow_id:       `copilot_${copilotRole}`,
            db,
          },
          (chunk) => controller.enqueue(sseChunk({ t: 'd', v: chunk })),
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Copilot error — please try again.'
        controller.enqueue(sseChunk({ t: 'e', m: msg }))
        controller.close()
        return
      }

      // Persist assistant turn after stream completes.
      try {
        await copilotThreadsQ.appendAssistantMessage({
          thread_id:        threadSnap.thread_id,
          content:          result.reply,
          tokens_in:        result.usage.input_tokens,
          tokens_out:       result.usage.output_tokens,
          cost_usd:         result.cost_usd,
          context_snapshot: context as unknown as Record<string, unknown>,
        })
      } catch { /* non-fatal — reply already on its way to the client */ }

      controller.enqueue(sseChunk({ t: 'z', i: threadSnap.thread_id, c: result.cost_usd }))
      controller.close()
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type':     'text/event-stream; charset=utf-8',
      'Cache-Control':    'no-cache, no-transform',
      'X-Accel-Buffering': 'no',  // Prevents nginx from buffering SSE chunks
    },
  })
}
