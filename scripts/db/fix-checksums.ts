/**
 * One-off: scan all migration files and update schema_migrations rows whose
 * checksum no longer matches the file on disk (e.g. after a line-ending or
 * encoding normalisation touched the file). Only updates rows where the file
 * still exists — does not insert new rows (that's the migrator's job).
 *
 * Usage: pnpm tsx scripts/db/fix-checksums.ts
 */

import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'

const { Client } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations')

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

async function main() {
  loadEnv()
  const client = new Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      const currentChecksum = sha256(sql)

      const row = await client.query(
        'select checksum from public.schema_migrations where filename = $1',
        [file],
      )

      if (!row.rowCount) {
        // Not yet applied — migrator will handle it
        continue
      }

      const storedChecksum = row.rows[0].checksum
      if (storedChecksum !== currentChecksum) {
        console.log(`  ✎ fixing checksum for ${file}`)
        console.log(`    stored:  ${storedChecksum}`)
        console.log(`    current: ${currentChecksum}`)
        await client.query(
          'update public.schema_migrations set checksum = $1 where filename = $2',
          [currentChecksum, file],
        )
      } else {
        console.log(`  · ${file}  OK`)
      }
    }

    console.log('✓ checksum sync complete')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('✗ fix-checksums failed:', err.message)
  process.exit(1)
})
