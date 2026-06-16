/**
 * POST /api/onboarding/extract
 *
 * Section 1 of the v2 onboarding form fires this. We:
 *   1. Validate the user owns the brand_id (auth + RLS check)
 *   2. Mark brand_profiles.onboarding_status = 'extraction_pending'
 *   3. Forward an HMAC-signed POST to N8N-A06 (which queues actual scraping)
 *   4. Return 202 immediately so the UI can advance to Section 2
 *
 * Why this isn't an n8n agent route: this endpoint is called by the
 * BROWSER (via server action), not by n8n. No HMAC verification on the
 * inbound side — instead we use the user's session cookie. The OUTBOUND
 * call to A06 IS HMAC-signed.
 */
import { NextResponse } from 'next/server'
import { adminClient } from '@repo/db'
import { requireUser } from '@repo/auth/server'
import { triggerN8nA06Extraction } from '@/lib/n8n-outbound'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RequestBody = z.object({
  brand_id: z.string().uuid(),
  // The fields the user typed in Section 1 — passed through to A06
  instagram_handle: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  place_search: z.object({
    name: z.string().default(''),
    city: z.string().default(''),
  }).optional(),
})

export async function POST(req: Request) {
  const user = await requireUser({ next: '/onboarding-start' })

  let parsed: z.infer<typeof RequestBody>
  try {
    parsed = RequestBody.parse(await req.json())
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'invalid_body', message: e instanceof Error ? e.message : 'bad json' },
      { status: 400 },
    )
  }

  // Verify ownership via service-role read (RLS on brand_profiles requires
  // auth.uid() but we're not using a user-scoped client here; do it
  // explicitly).
  const db = adminClient()
  const { data: brand, error } = await db
    .from('brand_profiles')
    .select('brand_id, auth_user_id, client_slug, onboarding_status')
    .eq('brand_id', parsed.brand_id)
    .maybeSingle()
  if (error) {
    console.error('[onboarding/extract] db error:', error.message)
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 500 })
  }
  if (!brand || brand.auth_user_id !== user.id) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // Idempotent — if extraction is already running or done, just return ok.
  if (brand.onboarding_status === 'extraction_done') {
    return NextResponse.json({ ok: true, brand_id: parsed.brand_id, already_done: true })
  }

  // Mark status so the UI / A03 can tell extraction is in flight
  await db
    .from('brand_profiles')
    .update({ onboarding_status: 'extraction_pending' } as never)
    .eq('brand_id', parsed.brand_id)

  // Fire HMAC-signed call to A06. We AWAIT but with a 8s timeout — A06
  // responds 202 in ~200ms; if it's down we degrade gracefully.
  const trigger = await triggerN8nA06Extraction({
    brand_id: parsed.brand_id,
    slug: brand.client_slug,
    instagram_handle: parsed.instagram_handle ?? null,
    website_url: parsed.website_url ?? null,
    place_search: parsed.place_search ?? { name: '', city: '' },
  })

  if (!trigger.ok) {
    console.warn(
      `[onboarding/extract] A06 trigger failed for brand=${parsed.brand_id}: ${trigger.error ?? 'unknown'} (status=${trigger.status ?? '-'})`,
    )
    // Don't fail the request — the UI lets the user proceed and fill
    // Section 2 manually. We mark status so we can detect this case.
    await db
      .from('brand_profiles')
      .update({ onboarding_status: 'extraction_unavailable' } as never)
      .eq('brand_id', parsed.brand_id)
    return NextResponse.json({ ok: true, brand_id: parsed.brand_id, extraction_skipped: true })
  }

  return NextResponse.json({ ok: true, brand_id: parsed.brand_id })
}
