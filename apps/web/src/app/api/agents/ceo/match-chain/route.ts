/**
 * POST /api/agents/ceo/match-chain
 *
 * Post-generation GPT-4o chain matcher. Called AFTER DeepSeek has written
 * caption_ar + visual_brief_en for each post, BEFORE CCO scoring.
 *
 * Why post-generation:
 *   Chain is a visual style template + fal.ai model config. The best chain
 *   depends on what the post is actually about — "steaming mandi rice with
 *   saffron" → F01 Hot Food Hero, "booking CTA for bridal package" → B04
 *   Booking CTA. Assigning chains before seeing the prompt is blind.
 *
 * Input: 20 posts, each with visual_brief_en + content_type + format + occasion
 * Process: GPT-4o reads each post's actual content + brand context → selects
 *          best chain from DB for each post
 * Output: 20 objects with { post_id, chain_id, chain_family, reasoning }
 *
 * Fallback: if GPT-4o fails, deterministic scoring from chainsQ (same as
 *           old plan-slots). Pipeline never breaks.
 *
 * Hard Rule #1 intact: CEO routes first — this is called after CEO classify.
 */
import { adminClient, chainsQ } from '@repo/db'
import { z } from 'zod'
import { makeAgentRoute } from '@/lib/agent-route'
import { getOpenAIClient, getDeepSeekClient } from '@repo/ai'
import { schemas } from '@repo/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── Schemas ────────────────────────────────────────────────────────────────────

const PostInputSchema = z.object({
  post_id: z.string(),
  visual_brief_en: z.string().min(1),
  content_type: z.string(),
  format: z.enum(['image', 'video']),
  offer_type: z.string().nullable().optional(),
  // Richer content so the selector matches on the post's actual MEANING, not just
  // the visual brief — the caption carries the message/intent DeepSeek wrote.
  caption_ar: z.string().nullable().optional(),
  hashtags: z.array(z.string()).nullable().optional(),
  occasion: z.string().nullable().optional(),
})

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    posts: z.array(PostInputSchema).min(1).max(40),
    occasion: z.string().nullable().optional(),
    sector: z.string().optional().default('general'),
  }),
})

const GptMatchSchema = z.object({
  post_id: z.string(),
  chain_id: z.string(),
  reasoning: z.string().optional(),
})
const GptResponseSchema = z.object({
  matches: z.array(GptMatchSchema),
})

export interface ChainMatch {
  post_id: string
  chain_id: string | null
  chain_family: string | null
  reasoning?: string
}

// ── GPT-4o system prompt ───────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  // SELF-EXTENDING DESIGN: there is NO hardcoded chain cheat-sheet here. The agent
  // reasons PURELY from the chain metadata passed in the user message (name, purpose,
  // intent, style_affinity, occasion, anti_patterns). So when an admin adds a new chain
  // row in the DB, it flows into available_chains automatically and the agent matches to
  // it WITHOUT any code/prompt edit. The chain's own `purpose`/`name`/`anti_patterns`
  // columns ARE the selection criteria — selection logic lives in the DATA, not here.
  return `You are the Chain Selector for OGz Studios — a Saudi-market social content platform.

For EACH post (already written by DeepSeek), pick the single BEST-matching production chain
from the provided list, reasoning over the post's ACTUAL content — not by keyword lookup.

Each POST gives you the real content to judge:
- caption_ar     : the Arabic caption (the post's message/intent — read it for meaning)
- content_type   : emotional / lifestyle / offer / educational / testimonial / announcement
- visual_brief_en: the English scene description for the image/video
- hashtags       : topical signals
- format         : "image" or "video"
- occasion       : active occasion (or null)

Each available CHAIN gives you what it is FOR (this is your only matching knowledge —
use it, do not assume chains that aren't listed):
- chain_id, output_type, name, purpose, intent, style_affinity, eligible_occasions, anti_patterns

HOW TO MATCH (reason, don't pattern-match blindly):
1. HARD: output_type MUST equal the post's format. Never put a video chain on an image post.
2. MEANING: read the caption_ar + visual_brief_en together to understand what the post is
   actually about (a dish? a drink? an offer? a heartfelt family moment? a testimonial?),
   then choose the chain whose PURPOSE best serves that meaning + content_type.
3. OCCASION: if the post has an active occasion, prefer a chain whose eligible_occasions
   includes it (e.g. an Eid post → an occasion/celebration chain) when one exists.
4. STYLE: tie-break toward the chain whose style_affinity matches the brand style.
5. ANTI-PATTERNS: never pick a chain whose anti_patterns describe this post.
6. VARIETY: across the calendar, SPREAD selections — do not assign the same chain to
   most posts. Two posts with the same content_type can use different fitting chains so
   the brand's feed looks varied, not repetitive.
7. Only ever output a chain_id that appears in the provided list.

OUTPUT — JSON object, exactly one match per post, no prose outside it:
{
  "matches": [
    { "post_id": "...", "chain_id": "...", "reasoning": "why this chain fits THIS post's content" }
  ]
}`
}

// ── Deterministic fallback ─────────────────────────────────────────────────────

async function deterministicFallback(
  posts: z.infer<typeof PostInputSchema>[],
  brandId: string,
  sector: string,
  occasionFamily: string | null,
  qualityTier: string,
  maturityDays: number,
  isStarter: boolean,
  isConservative: boolean,
  styleRegister: string | null,
  primaryChannel: string | null,
): Promise<ChainMatch[]> {
  const [imageChains, videoChains] = await Promise.all([
    chainsQ.selectChainsForSlot({
      sector, occasionFamily, quality_tier: qualityTier,
      maturity_days: maturityDays, is_starter: isStarter,
      is_conservative: isConservative, output_type: 'image',
      style_register: styleRegister, primary_channel: primaryChannel,
      brand_id: brandId, topN: 1,
    }),
    chainsQ.selectChainsForSlot({
      sector, occasionFamily, quality_tier: qualityTier,
      maturity_days: maturityDays, is_starter: isStarter,
      is_conservative: isConservative, output_type: 'video',
      style_register: styleRegister, primary_channel: primaryChannel,
      brand_id: brandId, topN: 1,
    }),
  ])

  const imageChain = imageChains[0]?.chain ?? null
  const videoChain = videoChains[0]?.chain ?? null

  return posts.map(p => {
    const chain = p.format === 'video' ? videoChain : imageChain
    return {
      post_id: p.post_id,
      chain_id: chain?.chain_id ?? null,
      chain_family: chain?.family ?? null,
      reasoning: 'deterministic_fallback',
    }
  })
}

// ── Route handler ──────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toQualityTier(brand: { pipeline_tier?: string | null; tier?: string | null } | null): string {
  if (brand?.pipeline_tier === 'Pro') return 'enterprise'
  if (brand?.tier === 'paid_starter') return 'growth'
  return 'starter'
}

function normalizeOccasion(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (!s || s === 'none') return null
  if (s.includes('ramadan')) return 'ramadan'
  if (s.includes('eid')) return 'eid'
  if (s.includes('national_day')) return 'national_day'
  if (s.includes('founding_day')) return 'founding_day'
  return s
}

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input, _ctx) => {
    const db = adminClient()
    const { posts, occasion, sector } = input.payload
    const occasionFamily = normalizeOccasion(occasion)

    // ── Load brand profile ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: brand } = await (db as any)
      .from('brand_profiles')
      .select('sector, pipeline_tier, tier, created_at, religious_sensitivity, primary_channel')
      .eq('brand_id', input.brand_id)
      .maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: visualProfile } = await (db as any)
      .from('visual_style_profiles')
      .select('style_register')
      .eq('brand_id', input.brand_id)
      .maybeSingle()

    // CRITICAL: chains.eligible_sectors uses lowercase tokens ('f_and_b'), but
    // brand_profiles.sector is the display form ('F&B'). Without normalizing, the
    // eligible filter (`eligible_sectors.includes(resolvedSector)`) drops EVERY
    // sector-specific chain → the LLM only sees agnostic chains and can mis-match
    // (e.g. a video chain onto an image post). Normalize to the chain token.
    const resolvedSector: string = schemas.sectorToChainToken(brand?.sector ?? sector ?? 'general')
    const qualityTier = toQualityTier(brand)
    const isStarter = qualityTier === 'starter'
    const isConservative = brand?.religious_sensitivity === 'High' || brand?.religious_sensitivity === 'Medium'
    const maturityDays = brand?.created_at
      ? Math.max(0, Math.floor((Date.now() - new Date(brand.created_at).getTime()) / MS_PER_DAY))
      : 365
    const styleRegister: string | null = (visualProfile as { style_register?: string | null } | null)?.style_register ?? null
    const primaryChannel: string | null = brand?.primary_channel ?? null

    // ── Load eligible chains from DB ──────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rawChains } = await (db as any)
      .from('chains')
      .select('chain_id, family, output_type, eligible_sectors, excluded_sectors, eligible_occasions, style_affinity, quality_tiers, name_en, purpose, intent, anti_patterns, frequency')
      .eq('is_active', true)
      .contains('quality_tiers', [qualityTier])

    const allChains = (rawChains ?? []) as Array<{
      chain_id: string; family: string; output_type: string
      eligible_sectors: string[] | null; excluded_sectors: string[] | null
      eligible_occasions: string[] | null; style_affinity: string | null
      quality_tiers: string[]; name_en: string; purpose: string | null
      intent: string[] | null; anti_patterns: string | string[] | null; frequency: string | null
    }>

    const eligibleChains = allChains.filter(c => {
      if (c.eligible_sectors && !c.eligible_sectors.includes(resolvedSector)) return false
      if (c.excluded_sectors && c.excluded_sectors.includes(resolvedSector)) return false
      return true
    })

    const chainMap = new Map(eligibleChains.map(c => [c.chain_id, c]))

    if (eligibleChains.length === 0) {
      // No eligible chains at all — full fallback
      return {
        matches: await deterministicFallback(
          posts, input.brand_id, resolvedSector, occasionFamily,
          qualityTier, maturityDays, isStarter, isConservative,
          styleRegister, primaryChannel,
        ),
      }
    }

    // ── Build GPT-4o user message ─────────────────────────────────────────
    const userMessage = JSON.stringify({
      brand: {
        sector: resolvedSector,
        style_register: styleRegister,
        occasion: occasionFamily,
      },
      posts: posts.map(p => ({
        post_id: p.post_id,
        caption_ar: p.caption_ar ?? null,        // the post's actual message/meaning
        content_type: p.content_type,
        visual_brief_en: p.visual_brief_en,
        hashtags: p.hashtags ?? [],
        format: p.format,
        occasion: p.occasion ?? occasionFamily ?? null,
        offer_type: p.offer_type ?? null,
      })),
      available_chains: eligibleChains.map(c => ({
        chain_id: c.chain_id,
        output_type: c.output_type,
        name: c.name_en,
        purpose: c.purpose,
        intent: c.intent ?? [],
        style_affinity: c.style_affinity,
        eligible_occasions: c.eligible_occasions ?? [],
        anti_patterns: c.anti_patterns ?? null,
      })),
    })

    // ── Call GPT-4o ───────────────────────────────────────────────────────
    let matches: ChainMatch[] | null = null

    try {
      // MODEL: env-configurable so you swap (Claude/o3) later with ZERO code change.
      // Default = deepseek-CHAT (not -reasoner): chain matching is a structured lookup,
      // not deep reasoning — deepseek-reasoner burns its token budget on internal
      // thinking and TRUNCATES the JSON on a 23-post calendar (the "Unterminated string /
      // Unexpected end of JSON input" failures that forced the blind deterministic
      // fallback → wrong V04 picks). deepseek-chat returns clean JSON fast.
      const provider = (process.env.CHAIN_SELECTOR_PROVIDER ?? 'deepseek').toLowerCase()
      const client = provider === 'openai' ? getOpenAIClient() : getDeepSeekClient()
      const model = process.env.CHAIN_SELECTOR_MODEL
        ?? (provider === 'openai' ? 'gpt-4o' : 'deepseek-chat')
      const response = await client.chat.completions.create({
        model,
        max_tokens: 8192,   // ample headroom: ~80 tokens/post × 40 max posts + slack → never truncates
        response_format: { type: 'json_object' },
        temperature: 0.2, // low — selection is reasoning over options, not creative writing
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: userMessage },
        ],
      })

      const raw = response.choices[0]?.message?.content ?? ''
      const parsed = GptResponseSchema.safeParse(JSON.parse(raw))

      if (parsed.success && parsed.data.matches.length === posts.length) {
        const fmtById = new Map(posts.map(p => [p.post_id, p.format]))
        matches = parsed.data.matches.map(m => {
          const chain = chainMap.get(m.chain_id)
          // GUARD 1: reject a hallucinated chain_id (not in the eligible set).
          // GUARD 2 (HARD): output_type MUST equal the post's format. The model
          // sometimes puts a video chain on an image post when it thinks no image
          // chain fits — never allow that. Either guard failing → chain_id=null,
          // which routes this post through the format-correct deterministic fallback.
          const fmt = fmtById.get(m.post_id)
          const formatOk = chain ? chain.output_type === fmt : false
          const valid = !!chain && formatOk
          return {
            post_id: m.post_id,
            chain_id: valid ? m.chain_id : null,
            chain_family: valid ? (chain?.family ?? null) : null,
            reasoning: valid ? m.reasoning
              : `${m.reasoning ?? ''} [rejected: ${!chain ? 'unknown chain' : 'output_type mismatch'}]`.trim(),
          }
        })
      } else {
        console.warn(`[match-chain] GPT-4o returned ${parsed.success ? parsed.data.matches.length : 'invalid'} matches for ${posts.length} posts — falling back`)
      }
    } catch (err) {
      console.error(`[match-chain] GPT-4o failed: ${(err as Error).message} — falling back`)
    }

    // ── Deterministic fallback ────────────────────────────────────────────
    if (!matches) {
      matches = await deterministicFallback(
        posts, input.brand_id, resolvedSector, occasionFamily,
        qualityTier, maturityDays, isStarter, isConservative,
        styleRegister, primaryChannel,
      )
    }

    // ── LAYER 3: deterministic GUARDRAILS on the (LLM or fallback) picks ────
    // The LLM is content-aware but must not violate hard limits. Enforce per-chain
    // frequency caps from chains.frequency (e.g. "3-5 per week" → cap, "0.5" → 1 every
    // other calendar). When a chain is over its cap for THIS calendar, reassign that
    // post to the next-best eligible chain of the SAME output_type that's under cap.
    // This is code, not LLM — caps are a business rule, never left to a model.
    matches = enforceFrequencyCaps(matches, posts, eligibleChains)

    return { matches }
  },
})

// ── Frequency-cap enforcement (Layer 3 guardrail) ───────────────────────────────
// Parse a chain's free-text `frequency` into a per-calendar max, then ensure no chain
// is assigned beyond it. Over-cap posts are reassigned to the next under-cap eligible
// chain of the same output_type. Pure deterministic — caps are a business rule.
type EligChain = {
  chain_id: string; family: string; output_type: string
  eligible_occasions: string[] | null; style_affinity: string | null
  name_en: string; purpose: string | null; intent: string[] | null
  anti_patterns: string | string[] | null; frequency: string | null
}

function freqToCap(frequency: string | null, calendarPosts: number): number {
  // Doc frequencies are weekly-ish ("3-5 per week", "1-2", "0.5", "1 per active occasion").
  // A calendar ≈ a month ≈ ~4 weeks. Convert the UPPER bound to a per-calendar cap.
  if (!frequency) return Number.POSITIVE_INFINITY // no cap declared → unlimited
  const nums = (frequency.match(/\d+(\.\d+)?/g) || []).map(Number)
  if (nums.length === 0) return Number.POSITIVE_INFINITY
  const perWeekUpper = Math.max(...nums)
  // "0.5" style → ~2 per calendar at most; small weekly numbers → ×4 weeks, capped at
  // the calendar size so a cap never blocks a small calendar.
  const cap = perWeekUpper < 1 ? 2 : Math.ceil(perWeekUpper * 4)
  return Math.min(cap, calendarPosts)
}

function enforceFrequencyCaps(
  matches: ChainMatch[],
  posts: Array<{ post_id: string; format: 'image' | 'video' }>,
  eligible: EligChain[],
): ChainMatch[] {
  const byId = new Map(eligible.map(c => [c.chain_id, c]))
  const formatById = new Map(posts.map(p => [p.post_id, p.format]))
  const total = matches.length
  const caps = new Map<string, number>()        // chain_id → max allowed this calendar
  const used = new Map<string, number>()         // chain_id → assigned so far
  const capOf = (id: string) => {
    if (caps.has(id)) return caps.get(id) as number
    const c = byId.get(id)
    const cap = c ? freqToCap(c.frequency, total) : Number.POSITIVE_INFINITY
    caps.set(id, cap); return cap
  }

  return matches.map(m => {
    if (!m.chain_id) return m
    const fmt = formatById.get(m.post_id)
    const cur = used.get(m.chain_id) ?? 0
    if (cur < capOf(m.chain_id)) {
      used.set(m.chain_id, cur + 1)
      return m
    }
    // Over cap → find an under-cap eligible chain of the same output_type, least-used first.
    const alt = eligible
      .filter(c => c.output_type === (fmt === 'video' ? 'video' : 'image'))
      .filter(c => (used.get(c.chain_id) ?? 0) < capOf(c.chain_id))
      .sort((a, b) => (used.get(a.chain_id) ?? 0) - (used.get(b.chain_id) ?? 0))[0]
    if (!alt) return m // nothing under cap → keep original (better than null)
    used.set(alt.chain_id, (used.get(alt.chain_id) ?? 0) + 1)
    return {
      post_id: m.post_id,
      chain_id: alt.chain_id,
      chain_family: alt.family,
      reasoning: `${m.reasoning ?? ''} [cap-reassigned from ${m.chain_id} → ${alt.chain_id}]`.trim(),
    }
  })
}
