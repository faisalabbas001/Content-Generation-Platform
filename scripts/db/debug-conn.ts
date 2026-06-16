/**
 * Verbose connection probe — prints the *full* error message returned by the
 * Supabase pooler so we can tell whether the failure is "tenant not found",
 * "wrong password", or something else.
 *
 * Usage: pnpm tsx scripts/db/debug-conn.ts [region]
 */
import pg from 'pg'
import { loadEnv, requireEnv } from './lib/env.js'

const region = process.argv[2] ?? 'us-east-1'
const { Client } = pg

;(async () => {
  loadEnv()
  const url = requireEnv('SUPABASE_URL')
  const pwd = requireEnv('SUPABASE_DB_PASSWORD')
  const ref = url.match(/^https:\/\/([^.]+)\.supabase\.co/)?.[1]
  if (!ref) throw new Error(`Bad SUPABASE_URL: ${url}`)

  console.log(`Trying ${region} as user "postgres.${ref}" on port 6543`)
  const client = new Client({
    host: `aws-0-${region}.pooler.supabase.com`,
    port: 6543,
    user: `postgres.${ref}`,
    password: pwd,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  })
  try {
    await client.connect()
    const r = await client.query('select 1 as ok')
    console.log('✓ connected, query result:', r.rows)
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string; severity?: string; routine?: string }
    console.log('✗ failed')
    console.log('  code:    ', err.code)
    console.log('  severity:', err.severity)
    console.log('  routine: ', err.routine)
    console.log('  message: ', err.message)
  } finally {
    try { await client.end() } catch {}
  }
})()
