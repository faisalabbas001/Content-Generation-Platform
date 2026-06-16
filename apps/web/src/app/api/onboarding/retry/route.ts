/**
 * POST /api/onboarding/retry
 *
 * Called by the user's /processing page when the timeout banner appears.
 * Re-fires N8N-A03 from the original `source_records` row of type 'form'
 * (the audit trail we always persist on submit). Idempotent — repeated
 * calls within 5 min return the cached response.
 *
 * Auth: requireBrandAccess(slug) — RLS-scoped, only the owner can retry.
 *
 * Doc §3.2 + §5.4 recovery path: this is the manual + admin equivalent of
 * the cron janitor we discussed.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBrandAccess, getUserScopedClient } from '@repo/auth/server'
import { adminClient } from '@repo/db/client'
import { triggerN8nA03Onboarding, triggerN8nA07CompetitorExtraction } from '@/lib/n8n-outbound'
import { emitProcessingStage } from '@/lib/processing-stage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  slug: z.string().min(1),
})

export async function POST(req: Request) {
  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }) }

  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_input' }, { status: 400 })
  }

  // Verify ownership.
  const { brand } = await requireBrandAccess(parsed.data.slug)

  // Find the original form-submission source_record (admin-side read so we
  // can dig into raw_payload regardless of RLS edge cases).
  const adb = adminClient()
  const { data: source, error } = await adb
    .from('source_records')
    .select('source_id, raw_payload, captured_at')
    .eq('brand_id', brand.brand_id)
    .eq('source_type', 'form')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  if (!source) {
    return NextResponse.json({ ok: false, error: 'no_form_source_record' }, { status: 404 })
  }

  // Reset stage to 'form_submitted' so the UI shows the pipeline restarting.
  await emitProcessingStage({
    brand_id: brand.brand_id,
    stage: 'form_submitted',
    metadata: { retried_at: new Date().toISOString(), retried_from: 'user_retry' },
  })

  // Reconstruct the n8n payload from the original form data.
  // The v2 source_records shape stores IG handle + website under `seed`
  // (per submitFinal). v1 wrote them at the top level. Read both so retries
  // work for brands onboarded under either version, and also fall back to
  // brand_profiles itself if the source_record is empty.
  const rawPayload = (source.raw_payload as Record<string, unknown>) ?? {}
  const seed = (rawPayload.seed as Record<string, unknown> | undefined) ?? {}
  const brandRow = brand as unknown as { instagram_handle?: string | null; website_url?: string | null }
  const ig =
    String(seed.instagram_handle ?? rawPayload.instagram_handle ?? brandRow.instagram_handle ?? '').trim() || null
  const web =
    String(seed.website_url ?? rawPayload.website_url ?? brandRow.website_url ?? '').trim() || null

  // Build place_search.name carefully: prefer review.brand_name_en (the real
  // English name the user typed in Step 3), fall back to seed/top-level, then
  // brand_name_ar — but ONLY if it's not the literal placeholder. A placeholder
  // string like "(awaiting review)" makes Apify Places hit a dead lookup.
  const review = (rawPayload.review as Record<string, unknown> | undefined) ?? {}
  const PLACEHOLDER = '(awaiting review)'
  const cleanName = (...candidates: unknown[]): string => {
    for (const c of candidates) {
      if (typeof c !== 'string') continue
      const trimmed = c.trim()
      if (!trimmed) continue
      if (trimmed === PLACEHOLDER) continue
      if (trimmed.startsWith('(') && trimmed.endsWith(')')) continue  // any parenthetical placeholder
      return trimmed
    }
    return ''
  }
  const placeName = cleanName(
    review.brand_name_en, seed.brand_name_en, rawPayload.brand_name_en,
    review.brand_name_ar, seed.brand_name_ar, rawPayload.brand_name_ar,
    (brand as { brand_name_ar?: string }).brand_name_ar,
  )
  const placeCity = String(seed.city_primary ?? rawPayload.city_primary ?? (brand as { city_primary?: string }).city_primary ?? '').trim()

  // Build occasion_flags from stored occasions_ranked if present
  const OCCASION_MAP: Record<string, string> = {
    'Ramadan / Eid Al-Fitr': 'ramadan',
    'Eid Al-Adha':           'eid_al_adha',
    'Saudi National Day':    'national_day',
    'Founding Day':          'founding_day',
    "Mother's Day":          'mothers_day',
    'Back to School':        'back_to_school',
    "Valentine's Day":       'valentines_day',
    'Seasonal Offers':       'seasonal_offers',
  }
  const occasionsRanked = (review.occasions_ranked ?? rawPayload.occasions_ranked) as string[] | undefined
  const occasionFlags = (occasionsRanked ?? [])
    .map((o) => OCCASION_MAP[o])
    .filter(Boolean) as string[]

  // Log what we're retrying so you can verify all fields are present
  console.log('[retry] re-firing A03 for brand:', brand.brand_id, {
    slug: parsed.data.slug,
    instagram_handle: ig,
    website_url: web,
    place_name: placeName,
    place_city: placeCity,
    occasion_flags: occasionFlags,
    form_payload_keys: Object.keys(rawPayload),
    review_keys: Object.keys(review),
  })

  const triggerResult = await triggerN8nA03Onboarding({
    flow_id: 'N8N-A03',
    brand_id: brand.brand_id,
    slug: parsed.data.slug,
    instagram_handle: ig,
    website_url: web,
    place_search: { name: placeName, city: placeCity },
    occasion_flags: occasionFlags.length > 0 ? occasionFlags : ['none'],
    form_payload: rawPayload,
    retry: true,
  })

  console.log('[retry] A03 result:', triggerResult.ok ? 'ok' : 'failed', triggerResult.error ?? '')

  // Re-fire A07 for any active competitors — same as submitFinal
  try {
    const { data: activeCompetitors } = await adb
      .from('competitor_accounts')
      .select('competitor_id, handle_instagram')
      .eq('brand_id', brand.brand_id)
      .eq('is_active', true)
      .limit(5)
    if (activeCompetitors && activeCompetitors.length > 0) {
      console.log('[retry] firing A07 for', activeCompetitors.length, 'competitors:', activeCompetitors.map(c => c.handle_instagram).join(', '))
      const a07 = await triggerN8nA07CompetitorExtraction({
        brand_id:        brand.brand_id,
        competitors:     activeCompetitors,
        extraction_type: 'light',
        triggered_by:    'retry',
      })
      console.log('[retry] A07 result:', a07.ok ? 'ok' : 'failed', a07.error ?? '')
    } else {
      console.log('[retry] A07 skipped — no active competitors')
    }
  } catch (a07Err) {
    console.warn('[retry] A07 exception:', a07Err)
  }

  return NextResponse.json({ ok: triggerResult.ok, request_id: triggerResult.request_id, error: triggerResult.error ?? null })
}
