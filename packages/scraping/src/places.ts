/**
 * Google Places — findplacefromtext lookup.
 *
 * Used for cross-referencing the brand's public listing: rating, review count,
 * formatted address, place_types (which feed the sector hint).
 *
 * If GOOGLE_PLACES_API_KEY is not configured, the wrapper still calls this —
 * it returns ok:false and the wrapper records the lane as 'unavailable'
 * rather than 'skipped' (so the UI flips to amber not grey).
 */
import type { GooglePlacesCandidate, GooglePlacesScrapeResult } from './types'

const PLACES_ENDPOINT = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json'

export interface RunPlacesOptions {
  /** Google Places API key. */
  placesApiKey: string
  /** "<name> <city>" — what the user typed in the seed form. */
  query: string
  /** Hard timeout. Default 15000. */
  timeoutMs?: number
}

export async function runPlacesScrape(opts: RunPlacesOptions): Promise<GooglePlacesScrapeResult> {
  if (!opts.placesApiKey) {
    return { ok: false, candidate: null, error: 'GOOGLE_PLACES_API_KEY not configured' }
  }
  if (!opts.query.trim()) {
    return { ok: false, candidate: null, error: 'empty query' }
  }

  const url = new URL(PLACES_ENDPOINT)
  url.searchParams.set('input', opts.query.trim())
  url.searchParams.set('inputtype', 'textquery')
  url.searchParams.set('fields', 'place_id,name,rating,user_ratings_total,formatted_address,types')
  url.searchParams.set('key', opts.placesApiKey)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000)
  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) {
      return { ok: false, candidate: null, error: `Places ${res.status}` }
    }
    const json = (await res.json()) as { candidates?: GooglePlacesCandidate[]; status?: string }
    const candidate = (json.candidates && json.candidates[0]) || null
    return { ok: !!candidate, candidate, error: candidate ? null : (json.status || 'no_candidate') }
  } catch (err) {
    return {
      ok: false, candidate: null,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}
