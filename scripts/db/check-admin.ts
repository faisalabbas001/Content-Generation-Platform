/**
 * Quick admin user status check — confirms admin@openclaw.dev exists and is confirmed.
 * Usage: pnpm tsx scripts/db/check-admin.ts
 */
import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'

async function main() {
  loadEnv()
  const client = new pg.Client({
    connectionString: getPgConnectionString(),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select id, email, email_confirmed_at, raw_user_meta_data, created_at
         from auth.users
        where email = any($1::text[])
        order by created_at desc`,
      [['admin@openclaw.dev', 'admin@openclaw.local', 'usamalatif52@gmail.com']],
    )
    console.log('Auth users found:')
    for (const r of rows) {
      console.log(
        `  ${r.email} — id=${r.id.slice(0, 8)}… confirmed=${!!r.email_confirmed_at} meta=${JSON.stringify(
          r.raw_user_meta_data ?? {},
        )}`,
      )
    }
    if (rows.length === 0) console.log('  (none)')
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
