import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'

const { Client } = pg

async function main() {
  loadEnv()
  
  const sql = readFileSync('supabase/migrations/0009_drop_leads.sql', 'utf8')
  const checksum = createHash('sha256').update(sql).digest('hex')
  console.log('Correct checksum:', checksum)
  
  const client = new Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  
  try {
    const result = await client.query(
      'UPDATE public.schema_migrations SET checksum = $1 WHERE filename = $2 RETURNING *',
      [checksum, '0009_drop_leads.sql']
    )
    console.log('✓ Updated migration record:', result.rows[0])
  } finally {
    await client.end()
  }
}

main().catch(console.error)
