/**
 * POST /api/agents/deepseek/generate-all
 *
 * App-side chunked + PARALLEL DeepSeek generation (A06-style). Replaces the
 * fragile n8n Split → Loop → DeepSeek → Collect chain. n8n makes ONE call with
 * the full brand + schedule_dates; this route:
 *   1. Splits schedule_dates into chunks of CHUNK_SIZE (small = reliable parse).
 *   2. Fires all chunks with Promise.allSettled (TRUE parallel — no n8n loop).
 *   3. Retries each chunk up to MAX_ATTEMPTS until it returns its full count.
 *   4. Merges every chunk's posts (de-duped) and applies the compliance gate.
 *   5. Returns ALL posts in one response — no collapse, scales to 3-month.
 *
 * Hard Rule #3 unchanged: visual_brief_en MUST be English-only.
 */
import { adminClient } from '@repo/db/client'
import { deepseek } from '@repo/ai'
import { loadComplianceRules, checkCaption, checkVisualBrief } from '@repo/compliance'
import { z } from 'zod'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Chunks run in parallel, so wall-time ≈ slowest chunk (~40s) even for 51 posts.
// 300s gives generous headroom for cold starts + retries.
export const maxDuration = 300

const CHUNK_SIZE = 3       // small ask per DeepSeek call = far fewer parse failures
const MAX_ATTEMPTS = 4     // per-chunk retries until it returns its full post_count

const ScheduleDateSchema = z.object({
  date: z.string(),
  posting_time: z.string(),
  hour: z.number().int(),
  is_video_slot: z.boolean().optional(),
})

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    caption_context: z.string().min(1),
    // Total posts wanted; schedule_dates.length is authoritative when present.
    post_count: z.number().int().min(1).max(120),
    schedule_dates: z.array(ScheduleDateSchema).min(1),
    start_date: z.string().optional().default(''),
    off_days: z.array(z.number().int()).optional().default([]),
    occasion_context: z
      .object({
        name: z.string(),
        lead_weeks: z.number().int().optional().default(0),
        priority: z.string().optional().default('Medium'),
      })
      .optional(),
    intended_format: z.string().optional().default('image'),
    watermark_required: z.boolean(),
  }),
})

const rank = { NONE: 0, SOFT_WARN: 1, STRONG_WARN: 2, HARD_BLOCK: 3 } as const

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input, ctx) => {
    const db = adminClient()
    const p = input.payload
    const dates = p.schedule_dates

    // ── 1. Split into chunks of CHUNK_SIZE ──────────────────────────────────
    const chunks: (typeof dates)[] = []
    for (let i = 0; i < dates.length; i += CHUNK_SIZE) {
      chunks.push(dates.slice(i, i + CHUNK_SIZE))
    }

    // ── 2. One chunk → DeepSeek, retry until it returns its full count ──────
    const runChunk = async (slice: typeof dates) => {
      const want = slice.length
      let best: Awaited<ReturnType<typeof deepseek.generate>> | null = null
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const r = await deepseek.generate(
            {
              brand_id: input.brand_id,
              month: p.month,
              caption_context: p.caption_context,
              post_count: want,
              schedule_dates: slice,
              start_date: slice[0]?.date ?? p.start_date,
              off_days: p.off_days,
              occasion_context: p.occasion_context,
              intended_format: p.intended_format,
              watermark_required: p.watermark_required,
            },
            { flow_id: ctx.flowId, brand_id: input.brand_id, db },
          )
          const got = r.posts?.length ?? 0
          if (!best || got > (best.posts?.length ?? 0)) best = r
          if (got >= want) return r // full chunk → done
        } catch (e) {
          console.warn(`[generate-all] chunk attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(e as Error).message}`)
        }
      }
      return best // fullest partial we managed (may be < want, or null)
    }

    // ── 3. Fire ALL chunks in parallel ──────────────────────────────────────
    // ── 3. Fire chunks with BOUNDED concurrency (avoid DeepSeek thundering-herd).
    // Unbounded Promise.all of 6+ chunks rate-limits DeepSeek. Run CONCURRENCY at
    // a time — fast (parallel) but kind to the API. Scales to 3-month (17 chunks).
    const CONCURRENCY = 4
    const settled: PromiseSettledResult<Awaited<ReturnType<typeof runChunk>>>[] = new Array(chunks.length)
    let cursor = 0
    const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
      while (cursor < chunks.length) {
        const idx = cursor++
        try { settled[idx] = { status: 'fulfilled', value: await runChunk(chunks[idx]!) } }
        catch (e) { settled[idx] = { status: 'rejected', reason: e } }
      }
    })
    await Promise.all(workers)

    // ── 4. Merge every chunk's posts, IN CHUNK ORDER ────────────────────────
    // CRITICAL: DeepSeek numbers post_id per-call (each chunk returns post_1..3),
    // so post_ids COLLIDE across chunks. We must NOT de-dupe by post_id (that
    // drops every chunk after the first). Each chunk owns distinct schedule_dates,
    // so we concatenate in chunk order and RE-ASSIGN a globally-unique post_id +
    // align posting_time to this brand's schedule slot by global index.
    type GenResult = Awaited<ReturnType<typeof deepseek.generate>>
    const ok: GenResult[] = settled
      .filter((s): s is PromiseFulfilledResult<GenResult> => s.status === 'fulfilled' && !!s.value)
      .map((s) => s.value)
    const reasoning = ok[0]?.reasoning ?? 'generated via generate-all'

    const merged: GenResult['posts'] = []
    settled.forEach((s, chunkIdx) => {
      if (s.status !== 'fulfilled' || !s.value) return
      const chunkPosts = s.value.posts ?? []
      chunkPosts.forEach((post, j) => {
        const globalIdx = chunkIdx * CHUNK_SIZE + j
        const slot = dates[globalIdx]
        merged.push({
          ...post,
          post_id: `${input.brand_id}_${p.month}_${globalIdx + 1}`, // globally unique
          posting_time: slot?.posting_time ?? post.posting_time,    // align to schedule
        })
      })
    })

    // ── 5. Compliance gate (same logic as /generate) ────────────────────────
    const occasion = p.occasion_context?.name ?? null
    const rules = await loadComplianceRules(input.brand_id)
    const posts = merged.map((post) => {
      const c = { occasion, posting_time: post.posting_time, sector: rules.sector }
      const cap = checkCaption(post.caption_ar ?? '', rules, c)
      const vis = checkVisualBrief(post.visual_brief_en ?? '', rules, c)
      const matched = [...cap.matched, ...vis.matched]
      const top = matched.reduce<keyof typeof rank>(
        (acc, m) => (rank[m.severity] > rank[acc] ? m.severity : acc),
        'NONE',
      )
      const religious = cap.religious_content_detected || vis.religious_content_detected
      const compliance_route =
        top === 'HARD_BLOCK' || religious ? 'HOLD' : top === 'NONE' ? 'CLEAN' : 'WATERMARK'
      const compliance_reason = religious && top !== 'HARD_BLOCK' ? 'religious_content' : undefined
      return { ...post, compliance_route, compliance_severity: top, compliance_matched: matched, compliance_reason }
    })

    const wanted = dates.length
    console.info(
      `[generate-all] brand=${input.brand_id} chunks=${chunks.length} wanted=${wanted} got=${posts.length}`,
    )

    return {
      brand_id: input.brand_id,
      month: p.month,
      reasoning,
      posts,
      compliance_blocked_post_ids: posts.filter((x) => x.compliance_route === 'HOLD').map((x) => x.post_id),
      _meta: { chunks: chunks.length, wanted, got: posts.length },
    }
  },
})
