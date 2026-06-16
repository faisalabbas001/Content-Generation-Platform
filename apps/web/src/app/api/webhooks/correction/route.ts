/**
 * POST /api/webhooks/correction
 *
 * Programmatic alternative to the in-app correction form on /[slug]/profile.
 * Accepts an HMAC-signed payload describing a brand-DNA correction, persists
 * it as a `source_records` row of type 'correction', and forwards to N8N-A04
 * which kicks off the Memory Controller pipeline.
 *
 * Why this exists alongside the server action:
 *   - The in-app form (`actions/brand-correction.ts`) is for users in the
 *     UI — RLS-scoped, no signature.
 *   - This endpoint is for OPS / external partners / batch corrections
 *     (e.g. an admin script running outside the browser). Same outcome,
 *     different entry point.
 *
 * Body shape:
 *   { brand_id, field_name, corrected_value, current_value?, reasoning? }
 */
import { adminClient } from '@repo/db/client'
import { z } from 'zod'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'
import { triggerN8nA04Correction } from '@/lib/n8n-outbound'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORRECTABLE_FIELDS = z.enum([
  'arabic_dialect', 'price_position', 'formality_level', 'humor_tolerance',
  'religious_sensitivity', 'bilingual_ratio', 'brand_differentiator', 'primary_kpi_type',
  'primary_channel', 'ramadan_relevance', 'tone_anti_attribute_ids', 'archetype_primary',
  'archetype_secondary', 'lifecycle_stage', 'intent_state', 'primary_color_hex',
  'audience_description_ar', 'audience_age_range', 'audience_language_preference',
  'sub_sector', 'region_primary', 'tone_register', 'archetype_family',
  'founding_story', 'owner_values', 'comfort_on_camera', 'way_of_speaking',
  'communication_style', 'brand_goals', 'posting_rhythm', 'caption_style',
  'permission_level', 'cultural_tension_owned', 'goal_phase', 'brave_safe_default',
  'national_day_relevance', 'eid_fitr_relevance', 'eid_adha_relevance', 'founding_day_relevance',
  'emotions', 'occasions_ranked', 'lifestyle', 'music', 'music_link', 'brand_refs',
  'price_nums', 'vision', 'vision_text', 'tagline', 'cust_quote', 'caption_ex',
  'metric', 'anything', 'custom_restriction', 'custom_occasion',
  'scale_minmax', 'scale_quietloud', 'scale_localglobal', 'scale_tradmod',
  'social', 'platforms', 'name_meaning', 'hero_why', 'lifecycle',
  'respected_brands', 'respected_why', 'goal', 'problems',
  'founded_year', 'brand_name_en', 'city_primary', 'sector',
])

const Schema = z.object({
  brand_id: z.string().uuid(),
  field_name: CORRECTABLE_FIELDS,
  corrected_value: z.string().min(1).max(500),
  current_value: z.string().nullable().optional(),
  reasoning: z.string().max(500).nullable().optional(),
})

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: unknown
  try { body = JSON.parse(verified.req.rawBody) }
  catch { return errorResponse(400, 'invalid_json', 'body is not valid JSON') }

  const parsed = Schema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'body did not match schema', {
      issues: parsed.error.issues.slice(0, 5).map((i) => i.message),
    })
  }
  const f = parsed.data

  const db = adminClient()

  // Confirm brand exists. (We don't enforce ownership here since this
  // endpoint is for ops / partners — HMAC is the auth gate.)
  const { data: brand, error: brandErr } = await db
    .from('brand_profiles')
    .select('brand_id, client_slug')
    .eq('brand_id', f.brand_id)
    .maybeSingle()
  if (brandErr) return errorResponse(500, 'db_error', brandErr.message)
  if (!brand) return errorResponse(404, 'brand_not_found', `brand ${f.brand_id} does not exist`)

  // Persist correction request
  const { error: srcErr } = await db.from('source_records').insert({
    brand_id: f.brand_id,
    source_type: 'correction',
    raw_payload: {
      field_name: f.field_name,
      current_value: f.current_value ?? null,
      corrected_value: f.corrected_value,
      reasoning: f.reasoning ?? null,
      submitted_via: 'api_webhook',
      request_id: verified.req.requestId,
    },
    recency_score: 1.0,
  } as never)
  if (srcErr) return errorResponse(500, 'db_error', `source_records insert failed: ${srcErr.message}`)

  // Trigger N8N-A04 (fire-and-forget — this endpoint is the inbound; we
  // forward to the correction-handling flow which will call CEO + Memory).
  void triggerN8nA04Correction({
    flow_id: 'N8N-A04',
    brand_id: f.brand_id,
    slug: (brand as { client_slug: string }).client_slug,
    field_name: f.field_name,
    current_value: f.current_value ?? null,
    corrected_value: f.corrected_value,
    reasoning: f.reasoning ?? null,
  }).then((r) => {
    if (!r.ok) console.warn('[webhook/correction] N8N-A04 trigger failed:', r.error)
  })

  const response = { ok: true, request_id: verified.req.requestId, brand_id: f.brand_id }
  rememberIdempotent(verified.req.idempotencyKey, 200, response)
  return jsonResponse(200, response)
}
