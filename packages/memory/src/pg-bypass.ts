/**
 * RLS-bypass read helpers for the Memory Controller.
 *
 * In production with a real `service_role` JWT, the Supabase JS client used
 * by validate.ts bypasses RLS automatically. In dev (and any environment
 * where SUPABASE_SERVICE_ROLE_KEY actually contains the anon JWT — see
 * HANDOVER.md) those reads fail with empty results, which the validator
 * interprets as "brand_not_found".
 *
 * This module provides a small escape hatch: if SUPABASE_DB_URL is set, we
 * verify reads via a direct Postgres connection that bypasses RLS by design.
 * Production never hits this path (service_role JWT works on the JS client).
 *
 * The fallback is OPTIONAL — callers pass `bypass: pgBypassAdapter()` and
 * validate.ts falls back to it only when the JS-client read returns empty.
 *
 * SECURITY NOTE: this module is server-only. It reads SUPABASE_DB_URL from
 * env. Never import it from a `'use client'` boundary. The connection is
 * pooled internally and reused.
 */
import { Client } from 'pg'

let _client: Client | null = null
let _connecting: Promise<Client> | null = null

/**
 * Single shared pg.Client for the entire @repo/memory package. Validate.ts,
 * apply-brand.ts, and any other module that needs to bypass RLS all funnel
 * through here — that means one TCP connection to the Supabase pooler per
 * Node.js process, never N. Critical for batch jobs that process 50+
 * nominations.
 */
/**
 * Treat connect failures as "bypass unavailable" rather than fatal. If the
 * SUPABASE_DB_URL points at a host that doesn't resolve (dev misconfig,
 * paused/deleted project, network outage), the JS service-role client is
 * still capable of running the drain — RLS is bypassed at the JWT level.
 * Returning null here is what callers already expect when SUPABASE_DB_URL is
 * unset, so the rest of the pipeline degrades gracefully instead of 500-ing
 * every memory drain.
 */
let _connectAttemptFailed = false

export async function getSharedPgClient(): Promise<Client | null> {
  if (_client) return _client
  if (_connectAttemptFailed) return null
  if (_connecting) return _connecting
  const conn = process.env.SUPABASE_DB_URL?.trim()
  if (!conn) return null

  _connecting = (async () => {
    const c = new Client({ connectionString: conn })
    await c.connect()
    _client = c
    return c
  })()
  try {
    return await _connecting
  } catch (err) {
    _connectAttemptFailed = true
    console.warn(
      `[memory/pg-bypass] disabled — could not connect to SUPABASE_DB_URL: ${(err as Error).message}. ` +
        'Falling back to JS service-role client (RLS bypassed via JWT).',
    )
    return null
  } finally {
    _connecting = null
  }
}

export interface PgBypass {
  brandExists(brand_id: string): Promise<boolean>
  brandIdsForSources(source_ids: string[]): Promise<Map<string, string>>
}

/**
 * Build an RLS-bypass adapter. Returns null when SUPABASE_DB_URL is not
 * configured — callers should treat null as "use the JS client only".
 */
export async function pgBypassAdapter(): Promise<PgBypass | null> {
  const c = await getSharedPgClient()
  if (!c) return null
  return {
    async brandExists(brand_id) {
      const r = await c.query(`select 1 from brand_profiles where brand_id = $1 limit 1`, [brand_id])
      return (r.rowCount ?? 0) > 0
    },
    async brandIdsForSources(source_ids) {
      if (source_ids.length === 0) return new Map()
      const r = await c.query<{ source_id: string; brand_id: string }>(
        `select source_id, brand_id from source_records where source_id = any($1::uuid[])`,
        [source_ids],
      )
      const out = new Map<string, string>()
      for (const row of r.rows) out.set(row.source_id, row.brand_id)
      return out
    },
  }
}

/**
 * Cleanly close the shared pg client. Call this at the end of long-running
 * scripts (smoke tests, n8n workers) — production routes don't need this
 * because Vercel terminates the function context for us.
 */
export async function closeSharedPgClient(): Promise<void> {
  if (_client) {
    await _client.end()
    _client = null
  }
}

/** Test-only alias kept for backwards compat. */
export const __closePgBypassForTests = closeSharedPgClient
