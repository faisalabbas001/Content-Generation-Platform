/**
 * OGz Studios — DB migrator
 *
 * Applies every SQL file in supabase/migrations in order, using the Postgres
 * connection derived from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * Tracked in a schema_migrations table so re-runs skip already-applied files.
 *
 * Usage:   pnpm db:migrate
 * Reset:   pnpm db:reset   (drops everything then re-applies)
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

async function main(): Promise<void> {
  loadEnv()
  const conn = getPgConnectionString()

  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    await ensureMigrationsTable(client)

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const fullPath = path.join(MIGRATIONS_DIR, file)
      const sql = readFileSync(fullPath, 'utf8')
      const checksum = sha256(sql)

      const already = await client.query(
        'select checksum from public.schema_migrations where filename = $1',
        [file],
      )

      if (already.rowCount && already.rows[0].checksum === checksum) {
        console.log(`  · ${file}  (already applied — skipping)`)
        continue
      }

      if (already.rowCount && already.rows[0].checksum !== checksum) {
        throw new Error(
          `Migration ${file} has been modified after being applied. ` +
            `Create a new migration file instead of editing an applied one.`,
        )
      }

      console.log(`  → ${file}`)
      // CONCURRENTLY indexes cannot run inside a transaction block.
      const needsNoTx = /concurrently/i.test(sql)
      if (needsNoTx) {
        await client.query(sql)
        await client.query(
          'insert into public.schema_migrations (filename, checksum) values ($1,$2)',
          [file, checksum],
        )
      } else {
        await client.query('begin')
        try {
          await client.query(sql)
          await client.query(
            'insert into public.schema_migrations (filename, checksum) values ($1,$2)',
            [file, checksum],
          )
          await client.query('commit')
        } catch (err) {
          await client.query('rollback')
          throw err
        }
      }
    }

    console.log('✓ migrations complete')
  } finally {
    await client.end()
  }
}

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    create table if not exists public.schema_migrations (
      filename    text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `)
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

main().catch((err) => {
  console.error('✗ migration failed')
  console.error(err)
  process.exit(1)
})
