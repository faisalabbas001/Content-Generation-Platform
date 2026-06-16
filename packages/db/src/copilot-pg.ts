/**
 * Copilot pg client — direct Postgres connection that runs queries under the
 * appropriate Copilot RLS scope.
 *
 * Why not use the Supabase service-role client?
 *   service_role bypasses RLS entirely. The whole point of SEC-07 is that
 *   even a buggy app cannot exfiltrate cross-role data — Postgres has to
 *   refuse the row. So we use a plain pg.Client + the `app.copilot_role`
 *   GUC + the policies in migration 0018.
 *
 * Why not use the Supabase anon client with a custom JWT?
 *   That's the right answer once SUPABASE_ADMIN_URL is provisioned and we
 *   can mint JWTs with `copilot_role` claims. Today we don't have a JWT
 *   minter for that claim, so we use the GUC pattern. The migration is
 *   structured so swapping `current_copilot_role()` to read
 *   `auth.jwt() ->> 'copilot_role'` is a one-line change later.
 *
 * Lifecycle:
 *   const c = await openCopilotClient('management')
 *   try { ... await c.query(...) ... } finally { await c.close() }
 *
 * Each invocation uses a fresh connection — copilot calls are infrequent
 * (admin chat) so a pool is overkill.
 */
import { Client, type QueryResultRow } from 'pg'

export type CopilotRole = 'management' | 'tech' | 'production'

export interface CopilotPgClient {
  query<R extends QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number }>
  close(): Promise<void>
}

export async function openCopilotClient(role: CopilotRole): Promise<CopilotPgClient> {
  const connStr = process.env.SUPABASE_DB_URL
  if (!connStr) {
    throw new Error('SUPABASE_DB_URL is not set — required for copilot RLS-scoped reads.')
  }
  const client = new Client({
    connectionString: connStr,
    // Supabase pooler endpoints require ssl in prod; the connection string
    // typically already encodes sslmode=require, but we keep this for safety.
    ssl: connStr.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  // Set the per-session GUC. `false` (3rd arg) = session-scoped; we close
  // the connection right after the request so this is effectively
  // request-scoped without paying a transaction round-trip.
  await client.query(`select set_config('app.copilot_role', $1, false)`, [role])

  return {
    async query<R extends QueryResultRow = Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ) {
      const r = await client.query<R>(text, params as never[])
      return { rows: (r.rows as R[]) ?? [], rowCount: r.rowCount ?? 0 }
    },
    async close() {
      try {
        await client.end()
      } catch {
        // Connection may already be torn down — ignore.
      }
    },
  }
}

/**
 * Helper: run a single query inside an open/close pair.
 * For the common case where the caller does ONE query.
 */
export async function withCopilotClient<T>(
  role: CopilotRole,
  fn: (c: CopilotPgClient) => Promise<T>,
): Promise<T> {
  const c = await openCopilotClient(role)
  try {
    return await fn(c)
  } finally {
    await c.close()
  }
}
