/**
 * POST /api/extraction/run
 *
 * The extraction wrapper. Called by N8N-A06 once per onboarding submission.
 *
 * Replaces the previous architecture where n8n had 3+ HTTP nodes calling
 * Apify / Google Places directly — that pattern made true parallelism
 * impossible (n8n's executor processes connections depth-first per item).
 *
 * Now: n8n makes ONE HTTP call here. We fire all 3 sources in parallel via
 * Promise.allSettled (true Node concurrency), normalise the results, return
 * a single combined JSON. n8n then routes the response through its existing
 * stage-callback + source_records-INSERT machinery (so the live UI updates
 * still work the way they always did).
 *
 * Env vars consulted:
 *   APIFY_API_KEY            — required
 *   GOOGLE_PLACES_API_KEY    — optional (lane skips gracefully when absent)
 *
 * Auth: HMAC-signed by n8n via the same scheme as /api/processing/stage
 * and /api/extraction/persist-ig.
 *
 * Idempotent on `x-n8n-idempotency-key`.
 */
import { z } from 'zod'
import { runExtraction } from '@repo/scraping'
import { extractionPrefill } from '@repo/ai'
import { adminClient } from '@repo/db/client'
import { verifyN8nRequest, rememberIdempotent, errorResponse, jsonResponse } from '@/lib/n8n-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Apify Website Content Crawler can take 270s; 300s (5min) is required.
// DO NOT reduce — IG scraper = 90s, Web Crawler = 270s, both run in parallel.
export const maxDuration = 300

const BodySchema = z.object({
  brand_id:         z.string().uuid(),
  slug:             z.string().nullable().optional(),
  instagram_handle: z.string().nullable().optional(),
  website_url:      z.string().nullable().optional(),
  place_search:     z.object({
    name: z.string().default(''),
    city: z.string().default(''),
  }).optional(),
})

export async function POST(request: Request) {
  const verified = await verifyN8nRequest(request)
  if (!verified.ok) return verified.response
  if (verified.cachedResponse) return verified.cachedResponse

  let body: unknown
  try { body = JSON.parse(verified.req.rawBody) }
  catch { return errorResponse(400, 'invalid_json', 'body is not valid JSON') }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse(400, 'invalid_input', 'body did not match schema', {
      issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
    })
  }

  const APIFY_API_KEY = process.env.APIFY_API_KEY?.trim() ?? ''
  if (!APIFY_API_KEY) {
    return errorResponse(500, 'apify_not_configured', 'APIFY_API_KEY env var missing')
  }
  const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? ''

  // Env-controlled IG post limit — keeps Apify cost low during testing.
  // Default 50 (production behaviour). Set IG_POSTS_LIMIT=2 in .env.local for cheap test runs.
  const rawLimit = parseInt(process.env.IG_POSTS_LIMIT ?? '', 10)
  const ig_posts_limit = Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 200 ? rawLimit : 50

  const input = parsed.data
  console.info(`[extraction/run] BEGIN brand=${input.brand_id} ig_posts_limit=${ig_posts_limit}`)

  // Pass db + n8n execution context so runExtraction can write exact Apify costs
  const executionId = (request.headers.get('x-n8n-execution-id') ?? null)
  const clientSlug  = (input.slug ?? null)

  const result = await runExtraction({
    brand_id:              input.brand_id,
    apify_token:           APIFY_API_KEY,
    google_places_api_key: GOOGLE_PLACES_API_KEY,
    instagram_handle:      input.instagram_handle ?? null,
    website_url:           input.website_url ?? null,
    place_search:          {
      name: input.place_search?.name ?? '',
      city: input.place_search?.city ?? '',
    },
    ig_posts_limit,
    db:           adminClient(),
    flow_run_id:  executionId,
    client_slug:  clientSlug,
  })

  // High-level summary log. The lane-by-lane LANE_START / LANE_END / DONE
  // banner lives inside runExtraction(); this is the route-level confirmation
  // that the wrapper finished and what it sent back to n8n.
  console.info(
    `[extraction/run] RESPOND brand=${input.brand_id} ` +
    `status=${JSON.stringify(result.status)} ` +
    `wall=${result.timing.wall_time_ms}ms overlap=${result.timing.parallel_overlap_ms}ms ` +
    `raw_ig_posts=${(result.raw.instagram as { posts_count?: number } | null)?.posts_count ?? 0} ` +
    `raw_web_pages=${(result.raw.website as { pages_count?: number } | null)?.pages_count ?? 0} ` +
    `raw_places=${(result.raw.places as { candidate?: unknown } | null)?.candidate ? 'yes' : 'no'}`,
  )

  // ── LLM pre-fill (Haiku 4.5) ────────────────────────────────────────
  // Runs ONCE here, persisted to brand_profiles.extraction_prefill so the
  // status route can read it without re-deriving heuristics on every poll.
  // Cost guard inside hasUsableExtractionData(): if all 3 lanes returned
  // nothing useful, we skip the LLM call and persist an all-null prefill —
  // the user fills the form by hand. No Haiku spend on empty onboardings.
  const igNorm = result.normalised.instagram as {
    lifecycle_signals?: { followers_count?: number; post_count_total?: number; post_frequency_30d?: number; account_age_months?: number }
  } | null
  const sig = igNorm?.lifecycle_signals ?? {}
  let prefillToPersist: unknown = null
  let prefillRan = false
  let prefillSkipReason: string | undefined
  try {
    // Fetch brand sector so no-history brands get sector-default prefill
    const { data: brandRow } = await adminClient()
      .from('brand_profiles')
      .select('sector')
      .eq('brand_id', input.brand_id)
      .maybeSingle()
    const brandSector = (brandRow as { sector?: string } | null)?.sector ?? null

    const pf = await extractionPrefill.runExtractionPrefill(
      {
        brand_id:  input.brand_id,
        instagram: result.raw.instagram,
        website:   result.raw.website,
        places:    result.raw.places,
        signals: {
          followers_count:    sig.followers_count    ?? null,
          post_count_total:   sig.post_count_total   ?? null,
          post_frequency_30d: sig.post_frequency_30d ?? null,
          account_age_months: sig.account_age_months ?? null,
        },
      },
      { flow_id: 'N8N-A06', brand_id: input.brand_id, db: adminClient(), sector: brandSector },
    )
    prefillRan = pf.ran
    prefillSkipReason = pf.skipped_reason
    // Persist whether the LLM ran or not — an all-null prefill is a valid
    // "we tried, nothing to suggest" signal for the review form.
    prefillToPersist = pf.prefill
  } catch (e) {
    // Non-fatal — extraction itself succeeded; we just don't have an LLM
    // pre-fill. The review form falls back to blank fields.
    console.warn(`[extraction/run] prefill failed brand=${input.brand_id}: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (prefillToPersist) {
    const { error: prefillErr } = await adminClient()
      .from('brand_profiles')
      .update({ extraction_prefill: prefillToPersist as never } as never)
      .eq('brand_id', input.brand_id)
    if (prefillErr) {
      console.warn(`[extraction/run] persist prefill failed: ${prefillErr.message}`)
    } else {
      console.info(
        `[extraction/run] PREFILL ${prefillRan ? 'WROTE' : 'SKIPPED'} brand=${input.brand_id}` +
        (prefillSkipReason ? ` reason=${prefillSkipReason}` : ''),
      )

      // ── Promote prefill analytics → top-level brand_profiles columns ──────
      // extraction_prefill is a JSONB blob — key analytics fields must also
      // live as first-class columns so queries, COO, and the UI can read them
      // without parsing JSONB. Promotion is best-effort, never blocks response.
      try {
        const pf = prefillToPersist as Record<string, unknown>
        // followers_count / ig_post_count from channel_profiles is authoritative
        // (set by persist-ig). Only write if not already set from that source.
        const promotions: Record<string, unknown> = {}
        if (pf.avg_engagement_rate != null)        promotions.avg_engagement_rate = pf.avg_engagement_rate
        if (pf.posting_frequency_per_week != null)  promotions.posting_frequency_per_week = pf.posting_frequency_per_week
        if (pf.primary_content_format != null)      promotions.primary_content_format = pf.primary_content_format
        if (pf.caption_avg_length != null)          promotions.caption_avg_length = Number(pf.caption_avg_length)
        if (pf.content_type_distribution != null)   promotions.content_type_distribution = pf.content_type_distribution
        if (pf.posting_cadence_hint != null)        promotions.posting_rhythm = pf.posting_cadence_hint
        // Occasion relevance — only fill nulls (form answer takes priority)
        if (pf.eid_fitr_relevance != null)          promotions.eid_fitr_relevance = pf.eid_fitr_relevance
        if (pf.eid_adha_relevance != null)          promotions.eid_adha_relevance = pf.eid_adha_relevance
        if (pf.national_day_relevance != null)      promotions.national_day_relevance = pf.national_day_relevance
        if (pf.founding_day_relevance != null)      promotions.founding_day_relevance = pf.founding_day_relevance

        if (Object.keys(promotions).length > 0) {
          // top_hashtags is text[] — handle separately
          const topHashtags = Array.isArray(pf.top_hashtags) ? pf.top_hashtags as string[] : null

          // Build raw SQL for text[] column (Supabase JS can't handle mixed types)
          const db = adminClient()
          const { error: promoErr } = await db
            .from('brand_profiles')
            .update(promotions as never)
            .eq('brand_id', input.brand_id)
          if (promoErr) console.warn(`[extraction/run] analytics promotion failed: ${promoErr.message}`)

          if (topHashtags && topHashtags.length > 0) {
            // top_hashtags is text[] — use RPC or raw update via pg client directly
            // Supabase PostgREST handles text[] via array syntax
            await db.from('brand_profiles')
              .update({ top_hashtags: topHashtags } as never)
              .eq('brand_id', input.brand_id)
          }
          console.info(`[extraction/run] promoted ${Object.keys(promotions).length} analytics fields for brand=${input.brand_id}`)
        }
      } catch (e) {
        console.warn(`[extraction/run] analytics promotion threw: ${(e as Error).message}`)
      }
    }
  }

  // ── Ensure brand_cost_config exists ───────────────────────────────────────
  // Created at first onboarding; if missing (race or schema gap) insert defaults.
  try {
    await adminClient()
      .from('brand_cost_config')
      .insert({ brand_id: input.brand_id } as never)
      .select()
      // ignore conflict — row already exists
  } catch { /* non-fatal */ }

  // Await cost logging before responding — the 3s Apify settle delay + DB
  // writes must complete before the runtime exits. maxDuration=300 covers this.
  await result.costLoggingPromise

  rememberIdempotent(verified.req.idempotencyKey, 200, result)
  return jsonResponse(200, result)
}
