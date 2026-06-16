/**
 * OGz Studios — DB seeder
 *
 * Applies every .sql file in supabase/seeds/ in order. Dev-only data.
 * Seeds are NOT tracked in schema_migrations — they are idempotent by UUID.
 *
 * Usage: pnpm db:seed
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, getPgConnectionString, getDbLabel } from './lib/env.js'
import pg from 'pg'

const { Client } = pg

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEEDS_DIR = path.resolve(__dirname, '../../supabase/seeds')

async function main(): Promise<void> {
  loadEnv()
  if (!existsSync(SEEDS_DIR)) {
    console.log('No seeds directory found — skipping.')
    return
  }
  const files = readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  if (files.length === 0) {
    console.log('No seed files found — skipping.')
    return
  }

  const conn = getPgConnectionString()
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()

  console.log(`→ Seeding ${getDbLabel()}`)
  try {
    for (const file of files) {
      const sql = readFileSync(path.join(SEEDS_DIR, file), 'utf8')
      console.log(`  → ${file}`)
      await client.query(sql)
    }
    console.log('✓ seeds complete')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('✗ seed failed')
  console.error(err)
  process.exit(1)
})
