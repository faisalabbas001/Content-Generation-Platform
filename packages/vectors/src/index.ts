/**
 * @repo/vectors — Qdrant wrapper for OGz Studios (Doc §3.2, §5.3)
 *
 * Per-brand namespaces for CaptionContext caching. Each brand gets its own
 * Qdrant collection named `brand_${brand_id}`. The N8N-A03 onboarding flow
 * creates the namespace once after BrandDNA is built (Doc §5.3 step 4); the
 * N8N-A04 brand-correction flow invalidates it when the user edits BrandDNA.
 *
 * Phase 1: collections are created with vector size 1, distance Cosine.
 * The actual embedding dimension is the responsibility of N8N-A01 (caption
 * generation) — when it starts upserting real CaptionContext payloads it
 * will recreate the collection with the correct dimension. We provision an
 * empty collection up-front so n8n can write to it without race conditions.
 *
 * No SDK dependency: uses fetch + the Qdrant REST API.
 *
 * Env required:
 *   QDRANT_URL      — e.g. https://xxxx.aws.cloud.qdrant.io:6333
 *   QDRANT_API_KEY  — bearer token for the Qdrant Cloud cluster
 */

import { createHash } from 'node:crypto'

const QDRANT_URL = () => process.env.QDRANT_URL?.replace(/\/$/, '') ?? ''
const QDRANT_KEY = () => process.env.QDRANT_API_KEY ?? ''

export function isVectorsConfigured(): boolean {
  return Boolean(QDRANT_URL() && QDRANT_KEY())
}

export function collectionFor(brandId: string): string {
  return `brand_${brandId}`
}

type QdrantHeaders = Record<string, string>
function headers(): QdrantHeaders {
  const key = QDRANT_KEY()
  if (!key) throw new Error('QDRANT_API_KEY not set')
  return { 'api-key': key, 'content-type': 'application/json' }
}

async function qfetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = QDRANT_URL()
  if (!base) throw new Error('QDRANT_URL not set')
  return fetch(`${base}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } })
}

/**
 * Create the per-brand Qdrant collection if it does not yet exist.
 * Idempotent: returns { created: false } when the collection already exists.
 *
 * Doc §5.3 step 4 — invoked once at the end of N8N-A03.
 */
export async function setupBrandNamespace(
  brandId: string,
  opts: { vectorSize?: number; distance?: 'Cosine' | 'Dot' | 'Euclid' } = {},
): Promise<{ collection: string; created: boolean }> {
  const collection = collectionFor(brandId)
  const existing = await qfetch(`/collections/${collection}`)
  if (existing.ok) return { collection, created: false }
  if (existing.status !== 404) {
    throw new Error(`qdrant GET ${collection} failed: ${existing.status} ${await existing.text()}`)
  }
  const res = await qfetch(`/collections/${collection}`, {
    method: 'PUT',
    body: JSON.stringify({
      vectors: { size: opts.vectorSize ?? 1, distance: opts.distance ?? 'Cosine' },
    }),
  })
  if (!res.ok) {
    throw new Error(`qdrant PUT ${collection} failed: ${res.status} ${await res.text()}`)
  }
  return { collection, created: true }
}

/**
 * Delete the per-brand Qdrant collection. Used by N8N-D02 maintenance when a
 * brand is hard-deleted, and as the implementation of `invalidateBrandCache`
 * (Doc §5.4 — A04 wipes the cache so corrected BrandDNA is reflected in the
 * next caption generation).
 */
export async function deleteBrandNamespace(brandId: string): Promise<{ deleted: boolean }> {
  const collection = collectionFor(brandId)
  const res = await qfetch(`/collections/${collection}`, { method: 'DELETE' })
  if (res.ok) return { deleted: true }
  if (res.status === 404) return { deleted: false }
  throw new Error(`qdrant DELETE ${collection} failed: ${res.status} ${await res.text()}`)
}

/**
 * Invalidate cached CaptionContext for a brand. Called by N8N-A04 after
 * BrandDNA correction so the next caption regenerates against fresh DNA.
 *
 * Strategy: drop the entire collection. Cheap, safe, and the next A01 run
 * will recreate it with the right dimension on first upsert.
 */
export async function invalidateBrandCache(brandId: string): Promise<{ deleted: boolean }> {
  return deleteBrandNamespace(brandId)
}

/** Stable UUID-shaped id derived from an arbitrary key (Qdrant requires uint64 or UUID). */
function deterministicPointId(key: string): string {
  const h = createHash('sha256').update(key).digest('hex')
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-')
}

/**
 * Upsert a CaptionContext payload for a brand. Used by N8N-A01.
 *
 * `vector` may be omitted in Phase 1 — we store payload-only points using a
 * 1-dim placeholder vector. When real embeddings arrive, pass them and the
 * caller is responsible for recreating the collection at the right size.
 */
export async function upsertCaptionContext(
  brandId: string,
  key: string,
  payload: Record<string, unknown>,
  vector?: number[],
): Promise<{ point_id: string }> {
  const collection = collectionFor(brandId)
  const point_id = deterministicPointId(key)
  const body = JSON.stringify({
    points: [{ id: point_id, vector: vector ?? [0], payload: { ...payload, _key: key } }],
  })
  let res = await qfetch(`/collections/${collection}/points?wait=true`, { method: 'PUT', body })
  // Auto-create the collection on first upsert (e.g. brands onboarded before
  // A03 namespace provisioning, or after A04 invalidation wiped the collection).
  if (res.status === 404) {
    await setupBrandNamespace(brandId)
    res = await qfetch(`/collections/${collection}/points?wait=true`, { method: 'PUT', body })
  }
  if (!res.ok) {
    throw new Error(`qdrant upsert failed: ${res.status} ${await res.text()}`)
  }
  return { point_id }
}

/** Retrieve a previously-upserted CaptionContext by key. */
export async function getCaptionContext<T = Record<string, unknown>>(
  brandId: string,
  key: string,
): Promise<T | null> {
  const collection = collectionFor(brandId)
  const point_id = deterministicPointId(key)
  const res = await qfetch(`/collections/${collection}/points/${point_id}`)
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`qdrant get failed: ${res.status} ${await res.text()}`)
  }
  const body = (await res.json()) as { result?: { payload?: T } }
  return body.result?.payload ?? null
}
