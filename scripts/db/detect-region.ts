/**
 * Probe each AWS region's Supabase pooler until one accepts a connection.
 * Uses pg's config-object form so we never have to URL-encode the password.
 *
 * Usage:  pnpm tsx scripts/db/detect-region.ts
 */

import pg from 'pg'
import { loadEnv, requireEnv } from './lib/env.js'

const { Client } = pg

const REGIONS = [
  'us-east-1','us-east-2','us-west-1','us-west-2',
  'eu-central-1','eu-central-2','eu-west-1','eu-west-2','eu-west-3','eu-north-1','eu-south-1','eu-south-2',
  'ap-southeast-1','ap-southeast-2','ap-southeast-3','ap-southeast-4',
  'ap-south-1','ap-south-2','ap-northeast-1','ap-northeast-2','ap-northeast-3',
  'sa-east-1','ca-central-1','af-south-1',
  'me-south-1','me-central-1','il-central-1',
]

async function tryRegion(ref: string, password: string, region: string): Promise<{ ok: true } | { ok: false; err: string }> {
  const client = new Client({
    host: `aws-0-${region}.pooler.supabase.com`,
    port: 6543,
    user: `postgres.${ref}`,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 5000,
    query_timeout: 5000,
    connectionTimeoutMillis: 7000,
  })
  try {
    await client.connect()
    await client.query('select 1')
    await client.end()
    return { ok: true }
  } catch (e: unknown) {
    try { await client.end() } catch {}
    const err = e as { code?: string; message?: string }
    return { ok: false, err: err.code ?? err.message ?? String(e) }
  }
}

async function main() {
  loadEnv()
  const url = requireEnv('SUPABASE_URL')
  const pwd = requireEnv('SUPABASE_DB_PASSWORD')
  const m = url.match(/^https:\/\/([^.]+)\.supabase\.co/)
  if (!m) throw new Error(`Bad SUPABASE_URL: ${url}`)
  const ref = m[1]

  console.log(`→ Probing pooler regions for project ${ref}…\n`)
  for (const r of REGIONS) {
    process.stdout.write(`  ${r.padEnd(16)} `)
    const result = await tryRegion(ref, pwd, r)
    if (result.ok) {
      console.log('✓ connected')
      console.log(`\n✓ Region: ${r}`)
      console.log(`\nAdd this to .env.local:`)
      console.log(`SUPABASE_DB_REGION=${r}\n`)
      process.exit(0)
    } else {
      console.log(`✗ ${result.err}`)
    }
  }
  console.log('\n✗ No region accepted the connection. Re-check SUPABASE_DB_PASSWORD.')
  process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
