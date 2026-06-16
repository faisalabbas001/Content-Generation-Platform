import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'

async function main() {
  loadEnv()
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: pnpm tsx scripts/db/check-user-seed.ts <email>')
    process.exit(1)
  }
  const c = new pg.Client({
    connectionString: getPgConnectionString(),
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  try {
    const { rows: users } = await c.query<{ id: string }>(
      `select id from auth.users where lower(email) = lower($1)`,
      [email],
    )
    if (users.length === 0) {
      console.error(`no auth user with email ${email}`)
      process.exit(1)
    }
    const userId = users[0]!.id

    const tables = [
      'brand_profiles',
      'audience_profiles',
      'visual_style_profiles',
      'channel_profiles',
      'evidence_bundles',
      'source_records',
      'brand_snapshots',
      'calendars',
      'calendar_posts',
      'qa_review_queue',
      'routing_decisions',
      'branddna_event_log',
      'anomaly_records',
      'usage_logs',
      'override_rules',
      'confidence_classifications',
    ]
    console.log(`=== Row counts for ${email} ===`)
    for (const t of tables) {
      const filter =
        t === 'brand_profiles'
          ? `auth_user_id = $1`
          : `brand_id in (select brand_id from public.brand_profiles where auth_user_id = $1)`
      const r = await c.query<{ n: number }>(
        `select count(*)::int as n from public.${t} where ${filter}`,
        [userId],
      )
      console.log(`  ${t.padEnd(28)} ${r.rows[0]!.n}`)
    }
    const slug = await c.query<{ client_slug: string }>(
      `select client_slug from public.brand_profiles where auth_user_id = $1 limit 1`,
      [userId],
    )
    if (slug.rows[0]) {
      console.log('')
      console.log(`Dashboard URL: http://localhost:3000/${slug.rows[0].client_slug}/dashboard`)
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
