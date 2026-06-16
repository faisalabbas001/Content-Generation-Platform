/**
 * POST /api/agents/ceo/select-chains
 *
 * GPT-4o slot planner. Decides per-slot:
 *   - format      ("image" | "video") — based on day-of-week, occasion, tier
 *   - content_type — emotional / lifestyle / offer / educational / testimonial / announcement
 *
 * Does NOT assign chain_id. Chain assignment happens POST-GENERATION in
 * /api/agents/ceo/match-chain, which reads the actual visual_brief_en written
 * by DeepSeek and selects the best matching chain based on content.
 *
 * Hard video quotas enforced after GPT-4o output:
 *   pro  → exactly 4 videos in 20 slots
 *   free → exactly 1 video in first 8 slots (rest image)
 *
 * Fallback: if GPT-4o fails, deterministic quota enforcement still runs.
 *
 * Hard Rule #1 intact: CEO routes first — this is called after CEO classify.
 */
import { adminClient } from '@repo/db'
import { z } from 'zod'
import { makeAgentRoute } from '@/lib/agent-route'
import { getOpenAIClient } from '@repo/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── Zod schemas ────────────────────────────────────────────────────────────────

const ScheduleDateSchema = z.object({
  date: z.string(),
  posting_time: z.string().optional(),
  hour: z.number().int().optional(),
})

const RequestBody = z.object({
  flow_id: z.string().min(1),
  brand_id: z.string().uuid(),
  payload: z.object({
    post_count: z.number().int().min(1).max(40).default(20),
    schedule_dates: z.array(ScheduleDateSchema).optional().default([]),
    occasion_flags: z.array(z.string()).optional().default([]),
    user_tier: z.enum(['free', 'pro']).optional().default('free'),
  }),
})

// Shape of one slot decision returned by this route.
// chain_id is NOT here — chain assignment happens post-generation in match-chain.
export interface SlotDecision {
  slot_index: number
  format: 'image' | 'video'
  content_type: string
  reasoning?: string
}

// GPT-4o output schema per slot
const GptSlotSchema = z.object({
  slot_index: z.number().int(),
  format: z.enum(['image', 'video']),
  content_type: z.string(),
  reasoning: z.string().optional(),
})
const GptResponseSchema = z.object({
  slots: z.array(GptSlotSchema),
})

// ── Constants ──────────────────────────────────────────────────────────────────

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
  if (s.includes('national_day') || s.includes('nationalday')) return 'national_day'
  if (s.includes('founding_day') || s.includes('foundingday')) return 'founding_day'
  return s
}

// ── GPT-4o system prompt ───────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a Saudi social media slot planner for OGz Studios.

You receive brand data, schedule_dates (one per slot), occasion info, and user_tier.

For EACH slot output exactly one decision object. Your ONLY jobs are:
1. Decide FORMAT: "image" or "video" for each slot
2. Decide CONTENT TYPE: what type of content fits this slot

You do NOT select chains — chain assignment happens after content is written.

OUTPUT FORMAT — a JSON object with one key "slots", exactly N objects:
{
  "slots": [
    {
      "slot_index": 0,
      "format": "image",
      "content_type": "emotional",
      "reasoning": "Sunday family day — emotional image"
    }
  ]
}

HARD VIDEO QUOTA RULES (enforce exactly):
- user_tier = "pro"  → exactly 4 slots must be "video"
- user_tier = "free" → exactly 1 slot in indexes 0–7 must be "video", ALL others "image"

VIDEO SELECTION INTELLIGENCE:
- Prefer video for: occasion teasers (Eid opener, Ramadan countdown), offer reveals on Thursday/Friday (day_of_week 4=Thu, 5=Fri), product unboxings, emotional announcements
- Prefer image for: product hero shots, flat lays, testimonials, educational posts, lifestyle/ambient

CONTENT TYPE ALLOCATION:
- emotional: 30% (family, warmth, storytelling)
- lifestyle: 20%
- offer: 20% (prefer Thursday/Friday slots)
- educational: 10%
- testimonial: 10%
- announcement: 10%

OCCASION AWARENESS:
- Ramadan: iftar/suhoor slots (evening), spiritual warmth
- Eid: celebratory, gifting — video for highlights
- National Day (Sep 23): patriotic — video for anthem/reveal posts
- No occasion: normal weekly rhythm

Respond with valid JSON only. No markdown, no explanation outside the JSON.`
}

// ── Deterministic fallback (format + content_type only — no chain_id) ─────────

function deterministicFallback(
  postCount: number,
  userTier: 'free' | 'pro',
): SlotDecision[] {
  const videoTarget = userTier === 'pro' ? 4 : 1
  const videoWindowEnd = userTier === 'free' ? 8 : postCount
  const contentTypes = ['emotional', 'lifestyle', 'offer', 'educational', 'testimonial', 'announcement']

  const videoPositions = new Set<number>()
  const step = Math.floor(videoWindowEnd / (videoTarget + 1))
  for (let v = 0; v < videoTarget; v++) {
    const pos = Math.min(step * (v + 1) - 1, videoWindowEnd - 1)
    videoPositions.add(pos)
  }

  return Array.from({ length: postCount }, (_, i) => ({
    slot_index: i,
    format: (videoPositions.has(i) ? 'video' : 'image') as 'image' | 'video',
    content_type: contentTypes[i % contentTypes.length]!,
    reasoning: 'deterministic_fallback',
  }))
}

// ── Quota enforcement (format only — no chain_id) ─────────────────────────────

function enforceVideoQuota(slots: SlotDecision[], userTier: 'free' | 'pro'): SlotDecision[] {
  const result = slots.map(s => ({ ...s }))
  const n = result.length

  if (userTier === 'free') {
    const window = Math.min(8, n)
    let videoSet = false
    for (let i = 0; i < window; i++) {
      if (result[i]!.format === 'video' && !videoSet) {
        videoSet = true
      } else {
        result[i]!.format = 'image'
      }
    }
    if (!videoSet) result[window - 1]!.format = 'video'
    for (let i = window; i < n; i++) result[i]!.format = 'image'
  } else {
    // pro: exactly 4 videos
    const videoIndices = result.map((s, i) => s.format === 'video' ? i : -1).filter(i => i >= 0)
    const target = 4
    if (videoIndices.length > target) {
      const keep = new Set(videoIndices.slice(-target))
      for (let i = 0; i < n; i++) {
        if (result[i]!.format === 'video' && !keep.has(i)) result[i]!.format = 'image'
      }
    } else if (videoIndices.length < target) {
      let added = 0
      const step = Math.floor(n / (target + 1))
      for (let attempt = 1; added < target - videoIndices.length; attempt++) {
        const pos = Math.min(step * attempt - 1, n - 1)
        if (result[pos]!.format !== 'video') { result[pos]!.format = 'video'; added++ }
        if (attempt > n) break
      }
    }
  }
  return result
}

// ── Route handler ──────────────────────────────────────────────────────────────

export const POST = makeAgentRoute({
  inputSchema: RequestBody,
  defaultFlowId: 'N8N-A01',
  handler: async (input, _ctx) => {
    const db = adminClient()
    const { post_count, schedule_dates, occasion_flags, user_tier } = input.payload

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

    const sector: string = brand?.sector ?? 'general'
    const qualityTier = toQualityTier(brand)
    const isStarter = qualityTier === 'starter'
    const isConservative = brand?.religious_sensitivity === 'High' || brand?.religious_sensitivity === 'Medium'
    const maturityDays = brand?.created_at
      ? Math.max(0, Math.floor((Date.now() - new Date(brand.created_at).getTime()) / MS_PER_DAY))
      : 365
    const styleRegister: string | null = (visualProfile as { style_register?: string | null } | null)?.style_register ?? null
    const primaryChannel: string | null = brand?.primary_channel ?? null

    // Normalize occasion
    let occasionFamily: string | null = null
    for (const flag of occasion_flags) {
      const fam = normalizeOccasion(flag)
      if (fam) { occasionFamily = fam; break }
    }

    // ── Build GPT-4o user message ─────────────────────────────────────────
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const slotsInput = schedule_dates.slice(0, post_count).map((s, i) => {
      const d = new Date(s.date)
      const dow = isNaN(d.getTime()) ? i % 7 : d.getDay()
      return { slot_index: i, date: s.date, day_of_week: dow, day_name: dayNames[dow] ?? 'Unknown', posting_time: s.posting_time ?? '' }
    })
    while (slotsInput.length < post_count) {
      const i = slotsInput.length
      slotsInput.push({ slot_index: i, date: '', day_of_week: i % 7, day_name: dayNames[i % 7] ?? 'Unknown', posting_time: '' })
    }

    const userMessage = JSON.stringify({
      brand: { sector, style_register: styleRegister, primary_channel: primaryChannel, quality_tier: qualityTier },
      occasion: occasionFamily ? { name: occasionFamily, active: true } : null,
      user_tier,
      post_count,
      schedule_slots: slotsInput,
    })

    // ── Call GPT-4o ───────────────────────────────────────────────────────
    let slots: SlotDecision[] | null = null

    try {
      const client = getOpenAIClient()
      const response = await client.chat.completions.create({
        model: process.env.OPENAI_CHAIN_SELECT_MODEL ?? 'gpt-4o-mini',
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: userMessage },
        ],
      })

      const raw = response.choices[0]?.message?.content ?? ''
      const parsed = GptResponseSchema.safeParse(JSON.parse(raw))

      if (parsed.success && parsed.data.slots.length === post_count) {
        slots = parsed.data.slots.map(s => ({
          slot_index: s.slot_index,
          format: s.format,
          content_type: s.content_type,
          reasoning: s.reasoning,
        }))
      } else {
        console.warn(`[select-chains] GPT-4o returned ${parsed.success ? parsed.data.slots.length : 'invalid'} slots, expected ${post_count} — falling back`)
      }
    } catch (err) {
      console.error(`[select-chains] GPT-4o call failed: ${(err as Error).message} — falling back`)
    }

    // ── Deterministic fallback if GPT-4o failed ───────────────────────────
    if (!slots) slots = deterministicFallback(post_count, user_tier)

    // ── Enforce video quotas (hard business rules) ────────────────────────
    slots = enforceVideoQuota(slots, user_tier)

    return { slots }
  },
})
