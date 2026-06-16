import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'

const { Client } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations')

async function main() {
  loadEnv()
  
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  
  const client = new Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  
  try {
    let updated = 0
    for (const file of files) {
      const fullPath = path.join(MIGRATIONS_DIR, file)
      const sql = readFileSync(fullPath, 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      
      const already = await client.query(
        'select checksum from public.schema_migrations where filename = $1',
        [file],
      )
      
      if (already.rowCount && already.rows[0].checksum !== checksum) {
        await client.query(
          'UPDATE public.schema_migrations SET checksum = $1 WHERE filename = $2',
          [checksum, file]
        )
        console.log(`  ✓ Fixed ${file}`)
        updated++
      }
    }
    console.log(`\nUpdated ${updated} migrations`)
  } finally {
    await client.end()
  }
}

main().catch(console.error)
