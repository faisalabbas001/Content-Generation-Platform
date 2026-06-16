/**
 * POST /api/agents/compliance/precheck
 *
 * Deterministic Compliance Gate (Spine, OGZ doc §9.2) — LLM-free.
 *
 * Called by N8N-A01 / N8N-A02 BETWEEN caption generation and the (expensive)
 * image step. For each post it scans the generated Arabic caption and/or the
 * English visual brief against the brand's negpat + global blocklist + the 10
 * cultural gesture blocks, returning a per-post route:
 *
 *   HOLD      — a HARD_BLOCK fired → skip CCO + image, send to qa_review_queue
 *   WATERMARK — a STRONG/SOFT warning fired → proceed but flag/watermark
 *   CLEAN     — nothing matched
 *
 * This is preventive: it fires before any paid generation, unlike the CCO LLM
 * which only judges captions after the fact.
 */
import { z } from 'zod'
import { loadComplianceRules, checkCaption, checkVisualBrief } from '@repo/compliance'
import { makeAgentRoute } from '@/lib/agent-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PostSchema = z.object({
  post_id: z.string(),
  caption_ar: z.string().optional(),
  visual_brief_en: z.string().optional(),
  posting_time: z.string().optional(),
  register: z.string().optional(),
})

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    occasion: z.string().nullish(),
    posts: z.array(PostSchema).min(1).max(50),
  }),
})

const rank = { NONE: 0, SOFT_WARN: 1, STRONG_WARN: 2, HARD_BLOCK: 3 } as const

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input) => {
    const { occasion, posts } = input.payload
    const rules = await loadComplianceRules(input.brand_id)

    const results = posts.map((p) => {
      const ctx = {
        occasion: occasion ?? null,
        posting_time: p.posting_time ?? null,
        register: p.register ?? null,
        sector: rules.sector,
      }
      const captionVerdict = p.caption_ar ? checkCaption(p.caption_ar, rules, ctx) : null
      const visualVerdict = p.visual_brief_en ? checkVisualBrief(p.visual_brief_en, rules, ctx) : null

      const matched = [
        ...(captionVerdict?.matched ?? []),
        ...(visualVerdict?.matched ?? []),
      ]
      const top = matched.reduce<keyof typeof rank>(
        (acc, m) => (rank[m.severity] > rank[acc] ? m.severity : acc),
        'NONE',
      )
      const route = top === 'HARD_BLOCK' ? 'HOLD' : top === 'NONE' ? 'CLEAN' : 'WATERMARK'

      return {
        post_id: p.post_id,
        route,
        severity: top,
        negpat_flag: top,
        matched,
        caption_action: captionVerdict?.action ?? 'pass',
        visual_action: visualVerdict?.action ?? 'pass',
      }
    })

    return {
      brand_id: input.brand_id,
      blocked_post_ids: results.filter((r) => r.route === 'HOLD').map((r) => r.post_id),
      results,
    }
  },
})
