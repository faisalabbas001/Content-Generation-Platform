/**
 * Force-confirms an admin user (sets email_confirmed_at + is_admin=true via direct SQL).
 * Used in dev when service-role key is missing.
 *
 * Usage: pnpm tsx scripts/db/confirm-admin.ts admin@openclaw.dev
 */
import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'

async function main() {
  loadEnv()
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: pnpm tsx scripts/db/confirm-admin.ts <email>')
    process.exit(1)
  }
  const c = new pg.Client({
    connectionString: getPgConnectionString(),
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  try {
    const { rows } = await c.query(
      `update auth.users
          set email_confirmed_at = coalesce(email_confirmed_at, now()),
              raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"is_admin":true}'::jsonb
        where email = $1
        returning id, email, email_confirmed_at, raw_user_meta_data`,
      [email],
    )
    if (rows.length === 0) {
      console.error(`✗ no auth user with email ${email}`)
      process.exit(1)
    }
    console.log('✓ admin confirmed:')
    console.log(JSON.stringify(rows[0], null, 2))
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
