/**
 * POST /api/onboarding/gap
 *
 * User-facing endpoint that captures answers to A03's gap_notification
 * questions and routes them through the Memory Controller queue (Hard Rule #2).
 *
 * Body shape:
 *   { brand_id: uuid, slug: string, answers: { [field_name]: string } }
 *
 * For each answer:
 *   • If the field maps to a known critical-field path (arabic_dialect,
 *     religious_sensitivity, etc.), enqueue a `field_update` nomination at
 *     `explicitly_confirmed` (the user just typed it — that's the strongest
 *     possible confidence).
 *   • Also enqueue a `confidence_upgrade` nomination so evidence_bundles
 *     reflects the new confidence state.
 *   • Drain the queue inline so the next page refresh shows the new state.
 *
 * Auth: user-scoped (NOT HMAC). Verifies the auth.uid() owns the brand via
 * supabase ssr client before enqueueing.
 */
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { adminClient } from '@repo/db/client'
import { getBrandForCurrentUser } from '@repo/auth/server'
import { enqueueNominations, processQueue } from '@repo/memory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  brand_id: z.string().uuid(),
  slug: z.string().min(1),
  answers: z.record(z.string(), z.string().min(1).max(2000)),
})

// Map gap-question field keys → Memory Controller field_path + evidence_name.
const GAP_FIELD_MAP: Record<string, { field_path: string; evidence_name: string; enum?: string[] }> = {
  // ── Original fields ──────────────────────────────────────────────────────
  arabic_dialect:           { field_path: 'VoiceProfile.arabic_dialect',         evidence_name: 'arabic_dialect',         enum: ['Najdi','Hejazi','Gulf','MSA_formal','MSA_accessible','Mixed'] },
  brand_differentiator:     { field_path: 'BrandProfile.brand_differentiator',   evidence_name: 'brand_differentiator' },
  primary_color_hex:        { field_path: 'BrandProfile.primary_color_hex',      evidence_name: 'primary_color_hex' },
  archetype_primary:        { field_path: 'BrandProfile.archetype_primary',      evidence_name: 'archetype_primary' },
  lifecycle_stage:          { field_path: 'BrandProfile.lifecycle_stage',        evidence_name: 'lifecycle_stage',        enum: ['pre_launch','launch','growth','maturity','recovery'] },
  intent_state:             { field_path: 'BrandProfile.intent_state',           evidence_name: 'intent_state',           enum: ['launch','grow','defend','harvest','recover'] },
  primary_kpi_type:         { field_path: 'BrandProfile.primary_kpi_type',       evidence_name: 'primary_kpi_type',       enum: ['engagement','conversion','awareness','trust'] },
  religious_sensitivity:    { field_path: 'BrandProfile.religious_sensitivity',  evidence_name: 'religious_sensitivity',  enum: ['Low','Medium','High'] },
  bilingual_ratio:          { field_path: 'BrandProfile.bilingual_ratio',        evidence_name: 'bilingual_ratio',        enum: ['arabic_only','arabic_primary','balanced','english_primary'] },
  formality_level:          { field_path: 'BrandProfile.formality_level',        evidence_name: 'formality_level',        enum: ['casual','semi_formal','formal'] },
  humor_tolerance:          { field_path: 'BrandProfile.humor_tolerance',        evidence_name: 'humor_tolerance',        enum: ['none','light','moderate'] },
  ramadan_relevance:        { field_path: 'BrandProfile.ramadan_relevance',      evidence_name: 'ramadan_relevance',      enum: ['Critical','High','Medium','Low','Not_relevant'] },
  primary_channel:          { field_path: 'BrandProfile.primary_channel',        evidence_name: 'primary_channel',        enum: ['Instagram','Snapchat','TikTok','Twitter'] },
  // ── v6 new scalar fields ─────────────────────────────────────────────────
  name_meaning:             { field_path: 'BrandProfile.name_meaning',           evidence_name: 'name_meaning' },
  hero_why:                 { field_path: 'BrandProfile.hero_why',               evidence_name: 'hero_why' },
  lifecycle:                { field_path: 'BrandProfile.lifecycle',              evidence_name: 'lifecycle',              enum: ['launch','growth','established','mature','legacy'] },
  lifestyle:                { field_path: 'BrandProfile.lifestyle',              evidence_name: 'lifestyle',              enum: ['family_home','coffee_solo','mall_friends','gym','gathering','outdoor'] },
  price_nums:               { field_path: 'BrandProfile.price_nums',             evidence_name: 'price_nums' },
  archetype_family:         { field_path: 'BrandProfile.archetype_family',       evidence_name: 'archetype_family',       enum: ['hero','caregiver','explorer','creator'] },
  music:                    { field_path: 'BrandProfile.music',                  evidence_name: 'music',                  enum: ['acoustic','arabic','pop','cinematic','lofi','energy'] },
  music_link:               { field_path: 'BrandProfile.music_link',             evidence_name: 'music_link' },
  custom_restriction:       { field_path: 'BrandProfile.custom_restriction',     evidence_name: 'custom_restriction' },
  respected_brands:         { field_path: 'BrandProfile.respected_brands',       evidence_name: 'respected_brands' },
  respected_why:            { field_path: 'BrandProfile.respected_why',          evidence_name: 'respected_why' },
  goal:                     { field_path: 'BrandProfile.goal',                   evidence_name: 'goal',                   enum: ['orders','awareness','launch','community','trust'] },
  founding_story:           { field_path: 'BrandProfile.founding_story',         evidence_name: 'founding_story' },
  vision:                   { field_path: 'BrandProfile.vision',                 evidence_name: 'vision',                 enum: ['customers','recognition','community','premium'] },
  vision_text:              { field_path: 'BrandProfile.vision_text',            evidence_name: 'vision_text' },
  tagline:                  { field_path: 'BrandProfile.tagline',                evidence_name: 'tagline' },
  cust_quote:               { field_path: 'BrandProfile.cust_quote',             evidence_name: 'cust_quote' },
  caption_ex:               { field_path: 'BrandProfile.caption_ex',             evidence_name: 'caption_ex' },
  metric:                   { field_path: 'BrandProfile.metric',                 evidence_name: 'metric' },
  national_day_relevance:   { field_path: 'BrandProfile.national_day_relevance', evidence_name: 'national_day_relevance', enum: ['Critical','High','Medium','Low','Not_relevant'] },
  social:                   { field_path: 'BrandProfile.social',                 evidence_name: 'social' },
  price_position:           { field_path: 'BrandProfile.price_position',         evidence_name: 'price_position',         enum: ['budget','mid_market','premium','luxury'] },
  brand_name_en:            { field_path: 'BrandProfile.brand_name_en',          evidence_name: 'brand_name_en' },
  brand_name_ar:            { field_path: 'BrandProfile.brand_name_ar',          evidence_name: 'brand_name_ar' },
  city_primary:             { field_path: 'BrandProfile.city_primary',           evidence_name: 'city_primary' },
  sector:                   { field_path: 'BrandProfile.sector',                 evidence_name: 'sector' },
  anything:                 { field_path: 'BrandProfile.anything',               evidence_name: 'anything' },
}

export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }) }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_input', issues: parsed.error.issues.slice(0, 5) }, { status: 400 })
  }
  const { brand_id, slug, answers } = parsed.data

  // Ownership check — only the brand owner can answer their own gaps.
  const brandHeader = await getBrandForCurrentUser(slug)
  if (!brandHeader || brandHeader.brand_id !== brand_id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const db = adminClient()

  // We need at least one source_record to attach evidence to. Grab the form
  // source_records row written at submit-time (it always exists at this point
  // because gap_notification only fires after A03 ran COO).
  const { data: formSource } = await db
    .from('source_records')
    .select('source_id')
    .eq('brand_id', brand_id)
    .eq('source_type', 'form')
    .limit(1)
    .maybeSingle()
  const formSourceId = (formSource as { source_id: string } | null)?.source_id ?? null

  // Build the nominations. Drop any answer whose field isn't in the map.
  const nominations: unknown[] = []
  const accepted: string[] = []
  const rejected: Array<{ field: string; reason: string }> = []
  for (const [rawField, rawValue] of Object.entries(answers)) {
    const mapping = GAP_FIELD_MAP[rawField]
    if (!mapping) {
      rejected.push({ field: rawField, reason: 'unknown_field' })
      continue
    }
    const value = rawValue.trim()
    if (!value) continue
    // Light enum coercion — accept exact match, case-insensitive substring fall-back.
    let proposed: string = value
    if (mapping.enum) {
      const exact = mapping.enum.find((v) => v === value)
      const ci = mapping.enum.find((v) => v.toLowerCase() === value.toLowerCase())
      const prefix = mapping.enum.find((v) => v.toLowerCase().startsWith(value.toLowerCase()))
      proposed = exact ?? ci ?? prefix ?? value
      if (!mapping.enum.includes(proposed)) {
        rejected.push({ field: rawField, reason: `value not in enum [${mapping.enum.join(', ')}]` })
        continue
      }
    }
    // field_update — write the column itself
    nominations.push({
      nomination_type: 'field_update',
      brand_id,
      data: {
        field_path: mapping.field_path,
        proposed_value: proposed,
        source: 'client_confirmation',
        evidence_source_ids: formSourceId ? [formSourceId] : [],
        reasoning: 'user answered gap_notification prompt',
      },
    })
    // confidence_upgrade — bump evidence_bundles to explicitly_confirmed
    if (formSourceId) {
      nominations.push({
        nomination_type: 'confidence_upgrade',
        brand_id,
        data: {
          field_name: mapping.evidence_name,
          new_state: 'explicitly_confirmed',
          evidence_source_ids: [formSourceId],
          agreement_ratio: 1.0,
          reasoning: 'user answered gap_notification',
        },
      })
    }
    accepted.push(rawField)
  }

  if (nominations.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_acceptable_answers', rejected }, { status: 400 })
  }

  const enq = await enqueueNominations(db, nominations, { nominated_by: 'user_gap_answer' })
  // Drain inline so the next page reflects new completeness immediately.
  let drained = { written: 0, rejected: 0 }
  try {
    const r = await processQueue(db, { batch_size: 50 })
    drained = { written: r.written, rejected: r.rejected }
  } catch (e) {
    console.warn('[onboarding/gap] drain failed:', (e as Error).message)
  }

  return NextResponse.json({
    ok: true,
    accepted,
    rejected,
    enqueued: enq.enqueued,
    skipped_duplicates: enq.skipped_duplicates,
    rejected_at_input: enq.rejected_at_input,
    drained,
  })
}
