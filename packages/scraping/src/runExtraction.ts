/**
 * runExtraction — single function that fires all 3 sources in parallel and
 * returns the combined result.
 *
 * Used by /api/extraction/run, which is called by N8N-A06's wrapper HTTP
 * node. n8n keeps owning the workflow shape; we just own the I/O.
 *
 * True parallelism via Promise.allSettled — each source gets its own
 * timeout and failure mode, and a partial result is preferable to a
 * total failure.
 *
 * Response shape:
 *   • status            — per-lane 'done' | 'unavailable' | 'skipped'
 *   • raw               — the FULL untouched Apify / Google Places responses
 *                         (this is what n8n writes to source_records.raw_payload
 *                         — no field loss, no normalisation)
 *   • normalised        — the compact summarised view used by the UI
 *   • enrichment        — IG-only post observations + signatures + reply samples
 *                         + channel_profile + palette URLs + mentions, ready for
 *                         /api/extraction/persist-ig
 *   • timing            — wall-clock measurements for monitoring (when each
 *                         lane started + finished, total wall time)
 */
import type { CombinedExtractionResult } from './types'
import { runInstagramScrape } from './instagram'
import { runWebsiteScrape } from './website'
import { runPlacesScrape } from './places'
import { normaliseInstagram, normaliseWebsite, normalisePlaces } from './normalise'

// ── Apify exact cost lookup ───────────────────────────────────────────────────

interface ApifyRunCost {
  runId:          string
  actorName:      string
  usageTotalUsd:  number
  runTimeSecs:    number
  memMaxMb:       number
}

/**
 * Fetch the exact USD cost for a completed Apify actor run.
 * Apify docs: usageTotalUsd is "eventually consistent" — wait 3s before querying.
 * Returns null if the run ID is absent or the API call fails (non-fatal).
 */
async function fetchApifyRunCost(
  runId: string,
  token: string,
  actorName: string,
): Promise<ApifyRunCost | null> {
  if (!runId) return null
  try {
    // Brief wait for Apify's eventually-consistent billing aggregation
    await new Promise((r) => setTimeout(r, 3000))
    const res = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
      { headers: { 'content-type': 'application/json' } },
    )
    if (!res.ok) {
      console.warn(`[scraping] Apify run cost fetch failed for ${runId}: HTTP ${res.status}`)
      return null
    }
    const body = (await res.json()) as { data?: Record<string, unknown> }
    const d = body.data ?? {}
    const usageTotalUsd = typeof d['usageTotalUsd'] === 'number' ? d['usageTotalUsd'] : 0
    const stats = (d['stats'] ?? {}) as Record<string, unknown>
    const runTimeSecs = typeof stats['runTimeSecs'] === 'number' ? stats['runTimeSecs'] : 0
    const memMaxBytes = typeof stats['memMaxBytes'] === 'number' ? stats['memMaxBytes'] : 0
    console.info(`[scraping] Apify run cost ${runId} (${actorName}): $${usageTotalUsd.toFixed(6)} / ${runTimeSecs.toFixed(1)}s`)
    return { runId, actorName, usageTotalUsd, runTimeSecs, memMaxMb: Math.round(memMaxBytes / 1024 / 1024) }
  } catch (err) {
    console.warn(`[scraping] Apify cost fetch error for ${runId}:`, err instanceof Error ? err.message : String(err))
    return null
  }
}

export interface RunExtractionInput {
  brand_id:              string
  apify_token:           string
  google_places_api_key: string
  instagram_handle:      string | null
  website_url:           string | null
  place_search:          { name: string; city: string }
  /** Optional override for IG posts to fetch (Apify cost lever). Default 50. */
  ig_posts_limit?: number
  /**
   * Supabase service-role DB client for writing usage_logs.
   * When provided, exact Apify + Google Places costs are written after extraction.
   * Pass null to disable cost logging (e.g. in tests).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any | null
  /** n8n execution ID — threads usage_logs rows back to the triggering flow run. */
  flow_run_id?: string | null
  /** Brand slug for usage_logs.client_slug attribution. */
  client_slug?: string | null
}

export interface ExtractionTiming {
  started_at:   string
  finished_at:  string
  wall_time_ms: number
  /** Per-lane: when it started, finished, and how long it took. Use this
   *  to verify all 3 lanes truly overlapped (started near t=0). */
  lanes: {
    instagram: { started_ms: number; finished_ms: number; duration_ms: number; outcome: string }
    website:   { started_ms: number; finished_ms: number; duration_ms: number; outcome: string }
    places:    { started_ms: number; finished_ms: number; duration_ms: number; outcome: string }
  }
  parallel_overlap_ms: number
}

export type RunExtractionResult = CombinedExtractionResult & {
  raw: {
    instagram: unknown        // FULL Apify IG response (details + posts arrays)
    website:   unknown        // FULL Apify Website Crawler pages array
    places:    unknown        // FULL Google Places candidate
  }
  timing: ExtractionTiming
  /**
   * Promise that resolves when Apify + Google Places cost rows are written.
   * Pass to `waitUntil()` in the calling Vercel route to keep the function
   * alive until the 3s Apify settle delay + API round-trips complete.
   * Always resolves (never rejects) — errors are logged internally.
   */
  costLoggingPromise: Promise<void>
}

export async function runExtraction(input: RunExtractionInput): Promise<RunExtractionResult> {
  const { brand_id, apify_token, google_places_api_key, instagram_handle, website_url, place_search } = input

  const placeQuery = `${place_search.name ?? ''} ${place_search.city ?? ''}`.trim()
  const t0 = Date.now()

  // Per-lane timing tracking
  const laneTiming = {
    instagram: { started_ms: 0, finished_ms: 0, duration_ms: 0, outcome: 'pending' },
    website:   { started_ms: 0, finished_ms: 0, duration_ms: 0, outcome: 'pending' },
    places:    { started_ms: 0, finished_ms: 0, duration_ms: 0, outcome: 'pending' },
  }

  console.info(`[extraction] START brand=${brand_id} ig=${!!instagram_handle} web=${!!website_url} places=${!!placeQuery}`)

  // Wrap each scraper with per-lane timing + log so the terminal shows when
  // each lane started + finished. ALL THREE awaited in parallel via
  // Promise.allSettled — they truly overlap, not sequential.
  const igTask = (async () => {
    if (!instagram_handle) {
      laneTiming.instagram.outcome = 'skipped'
      return null
    }
    laneTiming.instagram.started_ms = Date.now() - t0
    console.info(`[extraction] [+${laneTiming.instagram.started_ms}ms] LANE_START instagram (handle=${instagram_handle})`)
    try {
      const r = await runInstagramScrape({ apifyToken: apify_token, handle: instagram_handle, postsLimit: input.ig_posts_limit })
      laneTiming.instagram.finished_ms = Date.now() - t0
      laneTiming.instagram.duration_ms = laneTiming.instagram.finished_ms - laneTiming.instagram.started_ms
      laneTiming.instagram.outcome = r.ok ? 'done' : 'unavailable'
      console.info(`[extraction] [+${laneTiming.instagram.finished_ms}ms] LANE_END instagram outcome=${laneTiming.instagram.outcome} duration=${laneTiming.instagram.duration_ms}ms posts=${r.posts.length}`)
      return r
    } catch (e) {
      laneTiming.instagram.finished_ms = Date.now() - t0
      laneTiming.instagram.duration_ms = laneTiming.instagram.finished_ms - laneTiming.instagram.started_ms
      laneTiming.instagram.outcome = 'error'
      console.warn(`[extraction] [+${laneTiming.instagram.finished_ms}ms] LANE_ERROR instagram: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  })()

  const webTask = (async () => {
    if (!website_url) {
      laneTiming.website.outcome = 'skipped'
      return null
    }
    laneTiming.website.started_ms = Date.now() - t0
    console.info(`[extraction] [+${laneTiming.website.started_ms}ms] LANE_START website (${website_url})`)
    try {
      const r = await runWebsiteScrape({ apifyToken: apify_token, url: website_url })
      laneTiming.website.finished_ms = Date.now() - t0
      laneTiming.website.duration_ms = laneTiming.website.finished_ms - laneTiming.website.started_ms
      laneTiming.website.outcome = r.ok ? 'done' : 'unavailable'
      console.info(`[extraction] [+${laneTiming.website.finished_ms}ms] LANE_END website outcome=${laneTiming.website.outcome} duration=${laneTiming.website.duration_ms}ms pages=${r.pages.length}`)
      return r
    } catch (e) {
      laneTiming.website.finished_ms = Date.now() - t0
      laneTiming.website.duration_ms = laneTiming.website.finished_ms - laneTiming.website.started_ms
      laneTiming.website.outcome = 'error'
      console.warn(`[extraction] [+${laneTiming.website.finished_ms}ms] LANE_ERROR website: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  })()

  const placesTask = (async () => {
    if (!placeQuery) {
      laneTiming.places.outcome = 'skipped'
      return null
    }
    laneTiming.places.started_ms = Date.now() - t0
    console.info(`[extraction] [+${laneTiming.places.started_ms}ms] LANE_START places (${placeQuery})`)
    try {
      const r = await runPlacesScrape({ placesApiKey: google_places_api_key, query: placeQuery })
      laneTiming.places.finished_ms = Date.now() - t0
      laneTiming.places.duration_ms = laneTiming.places.finished_ms - laneTiming.places.started_ms
      laneTiming.places.outcome = r.ok ? 'done' : 'unavailable'
      console.info(`[extraction] [+${laneTiming.places.finished_ms}ms] LANE_END places outcome=${laneTiming.places.outcome} duration=${laneTiming.places.duration_ms}ms`)
      return r
    } catch (e) {
      laneTiming.places.finished_ms = Date.now() - t0
      laneTiming.places.duration_ms = laneTiming.places.finished_ms - laneTiming.places.started_ms
      laneTiming.places.outcome = 'error'
      console.warn(`[extraction] [+${laneTiming.places.finished_ms}ms] LANE_ERROR places: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  })()

  // True parallel — Promise.all awaits all three concurrently
  const [ig, web, places] = await Promise.all([igTask, webTask, placesTask])

  const t1 = Date.now()
  const wall_time_ms = t1 - t0

  // Compute parallel overlap — proves the lanes ran concurrently. If the
  // earliest finished_ms > the latest started_ms, they overlapped. Otherwise
  // they ran sequentially (which would be a bug).
  const lanesActive = [laneTiming.instagram, laneTiming.website, laneTiming.places]
    .filter((l) => l.outcome !== 'skipped' && l.outcome !== 'pending')
  let parallel_overlap_ms = 0
  if (lanesActive.length >= 2) {
    const earliestFinish = Math.min(...lanesActive.map((l) => l.finished_ms))
    const latestStart    = Math.max(...lanesActive.map((l) => l.started_ms))
    parallel_overlap_ms = Math.max(0, earliestFinish - latestStart)
  }

  console.info(
    `[extraction] DONE brand=${brand_id} wall=${wall_time_ms}ms ` +
    `overlap=${parallel_overlap_ms}ms ` +
    `(ig=${laneTiming.instagram.duration_ms}ms web=${laneTiming.website.duration_ms}ms places=${laneTiming.places.duration_ms}ms) ` +
    `→ if wall ≈ max(lanes), parallel works. If wall ≈ sum(lanes), lanes are sequential.`,
  )

  // ── Exact cost logging — build the promise; caller MUST pass to waitUntil() ─
  // Vercel freezes the runtime after response is sent. Returning the promise
  // lets the route call waitUntil(result.costLoggingPromise) to keep the
  // function alive for the 3s Apify settle delay + API round-trips.
  const db         = input.db ?? null
  const flowRunId  = input.flow_run_id ?? null
  const clientSlug = input.client_slug ?? null

  const costLoggingPromise: Promise<void> = db ? (async () => {
    try {
      const igDetailsRunId = (ig as { apify_run_id_details?: string | null } | null)?.apify_run_id_details ?? null
      const igPostsRunId   = (ig as { apify_run_id_posts?:   string | null } | null)?.apify_run_id_posts   ?? null
      const webRunId       = (web as { apify_run_id?:        string | null } | null)?.apify_run_id         ?? null

      const [igDetailsCost, igPostsCost, webCost] = await Promise.all([
        igDetailsRunId ? fetchApifyRunCost(igDetailsRunId, apify_token, 'apify_instagram_details') : null,
        igPostsRunId   ? fetchApifyRunCost(igPostsRunId,   apify_token, 'apify_instagram_posts')   : null,
        webRunId       ? fetchApifyRunCost(webRunId,       apify_token, 'apify_website')            : null,
      ])

      const baseRow = {
        flow_id:      'N8N-A06',
        brand_id,
        provider:     'apify',
        agent:        'A06',
        request_type: 'scrape_cost',
        flow_run_id:  flowRunId,
        client_slug:  clientSlug,
        tokens_in:    0,
        tokens_out:   0,
      }

      for (const c of [igDetailsCost, igPostsCost, webCost].filter(Boolean) as ApifyRunCost[]) {
        try {
          const { error } = await db.from('usage_logs').insert({
            ...baseRow,
            node_name:   c.actorName,
            status:      'success',
            cost_usd:    c.usageTotalUsd,
            duration_ms: Math.round(c.runTimeSecs * 1000),
            payload:     { apify_run_id: c.runId, memory_mb: c.memMaxMb },
          } as never)
          if (error) console.warn(`[extraction] usage_logs insert failed for ${c.actorName}:`, error.message)
        } catch (e: unknown) {
          console.warn(`[extraction] usage_logs insert failed for ${c.actorName}:`, e instanceof Error ? e.message : String(e))
        }
      }

      // Google Places — $0.017/call regardless of empty result
      // (Google charges per API call, not per result)
      if (laneTiming.places.outcome !== 'skipped') {
        try {
          const { error } = await db.from('usage_logs').insert({
            ...baseRow,
            node_name:    'google_places',
            provider:     'google',
            status:       places?.ok ? 'success' : 'error',
            cost_usd:     0.017,
            duration_ms:  laneTiming.places.duration_ms,
            payload:      { query: placeQuery },
          } as never)
          if (error) console.warn('[extraction] usage_logs google_places insert failed:', error.message)
        } catch (e: unknown) {
          console.warn('[extraction] usage_logs google_places insert failed:', e instanceof Error ? e.message : String(e))
        }
      }
    } catch (err) {
      console.warn('[extraction] cost logging error:', err instanceof Error ? err.message : String(err))
    }
  })() : Promise.resolve()

  // Per-lane status
  const status: CombinedExtractionResult['status'] = {
    instagram: !instagram_handle ? 'skipped' : ig?.ok ? 'done' : 'unavailable',
    website:   !website_url      ? 'skipped' : web?.ok ? 'done' : 'unavailable',
    places:    !placeQuery       ? 'skipped' : places?.ok ? 'done' : 'unavailable',
  }

  // Normalise each (compact summary for UI)
  const igNorm = ig?.ok
    ? normaliseInstagram({ brand_id, handle: instagram_handle, scrape: ig })
    : null
  const webNorm = web?.ok && website_url ? normaliseWebsite(website_url, web) : null
  const placesNorm = places ? normalisePlaces(places) : null

  // Build raw payloads — these go into source_records.raw_payload AS-IS.
  // Includes EVERY field Apify returned (latestComments, displayUrl, music
  // info, etc.) — nothing is dropped.
  const raw = {
    instagram: ig
      ? { ok: ig.ok, error: ig.error, details: ig.details, posts: ig.posts, posts_count: ig.posts.length }
      : null,
    website: web
      ? { ok: web.ok, error: web.error, pages: web.pages, pages_count: web.pages.length }
      : null,
    places: places
      ? { ok: places.ok, error: places.error, candidate: places.candidate }
      : null,
  }

  return {
    brand_id,
    completed_at: new Date().toISOString(),
    status,
    instagram: ig,
    website: web,
    places,
    raw,
    normalised: {
      instagram: igNorm?.summary ?? null,
      website:   webNorm,
      places:    placesNorm,
    },
    enrichment: {
      ig_post_observations: igNorm?.observations ?? [],
      brand_reply_samples:  igNorm?.brand_reply_samples ?? [],
      signature_hashtags:   igNorm?.summary.signature_hashtags ?? [],
      signature_phrases:    igNorm?.summary.signature_phrases ?? [],
      channel_profile:      igNorm?.channel_profile ?? null,
      palette_image_urls:   igNorm?.palette_image_urls ?? [],
      mentions:             igNorm?.mentions ?? [],
    },
    timing: {
      started_at:  new Date(t0).toISOString(),
      finished_at: new Date(t1).toISOString(),
      wall_time_ms,
      lanes: laneTiming,
      parallel_overlap_ms,
    },
    costLoggingPromise: Promise.resolve(),
  }
}
