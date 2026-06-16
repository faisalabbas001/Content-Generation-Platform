/**
 * Shared env loader for DB scripts.
 *
 * Builds a Postgres connection string for any Supabase project. Picks the
 * Transaction Pooler hostname (port 6543) by default because the direct
 * connection on 5432 is blocked on many ISPs/Windows networks.
 *
 *   SUPABASE_DB_URL        — full postgres://… URL from the dashboard (wins).
 *   SUPABASE_URL           — your project URL (https://<ref>.supabase.co).
 *   SUPABASE_DB_PASSWORD   — the database password.
 *   SUPABASE_DB_REGION     — optional, e.g. 'eu-central-1' (default 'us-east-1').
 *   SUPABASE_DB_POOLER     — optional, 'transaction' (default) | 'session' | 'direct'.
 */

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')

export function loadEnv(): void {
  const candidate = path.join(REPO_ROOT, '.env.local')
  if (!existsSync(candidate)) {
    throw new Error(
      `No .env.local found at ${candidate}. ` +
        `Copy .env.example → .env.local and fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_PASSWORD.`,
    )
  }
  const raw = readFileSync(candidate, 'utf8')
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

export function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Missing required env var: ${key}`)
  return v
}

const POOLER_PORT: Record<string, number> = {
  transaction: 6543,
  session:     5432,
  direct:      5432,
}

/**
 * Build a Postgres connection string from Supabase env vars.
 *
 *   1. Prefer SUPABASE_DB_URL when it is a real postgres:// connection string.
 *      (We ignore it when it's accidentally a https://… URL — that's a common
 *      mistake when someone copies the project URL into the wrong variable.)
 *   2. Otherwise, derive from SUPABASE_URL + SUPABASE_DB_PASSWORD using the
 *      Transaction Pooler hostname on port 6543.
 */
export function getPgConnectionString(): string {
  const fromUrl = process.env.SUPABASE_DB_URL ?? ''
  if (fromUrl.startsWith('postgres://') || fromUrl.startsWith('postgresql://')) {
    return fromUrl
  }

  const supabaseUrl = requireEnv('SUPABASE_URL')
  const dbPassword = requireEnv('SUPABASE_DB_PASSWORD')

  const match = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co/)
  if (!match) {
    throw new Error(
      `SUPABASE_URL should look like https://<project-ref>.supabase.co — got: ${supabaseUrl}`,
    )
  }
  const projectRef = match[1]
  const region = process.env.SUPABASE_DB_REGION ?? 'us-east-1'
  const mode = (process.env.SUPABASE_DB_POOLER ?? 'transaction').toLowerCase()

  if (mode === 'direct') {
    // Direct connection — only works on networks that don't block 5432.
    return `postgres://postgres:${encodeURIComponent(
      dbPassword,
    )}@db.${projectRef}.supabase.co:5432/postgres`
  }

  const port = POOLER_PORT[mode] ?? 6543
  // Pooler username form: "postgres.<ref>"
  return `postgres://postgres.${projectRef}:${encodeURIComponent(
    dbPassword,
  )}@aws-0-${region}.pooler.supabase.com:${port}/postgres`
}

export function getDbLabel(): string {
  const url = process.env.SUPABASE_URL ?? process.env.SUPABASE_DB_URL ?? '(unknown)'
  return url.replace(/:[^@/]+@/, ':***@')
}
