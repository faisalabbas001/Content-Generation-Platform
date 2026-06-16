import pg from 'pg'
import { loadEnv, getPgConnectionString } from './lib/env.js'

async function main(): Promise<void> {
  loadEnv()
  const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
  await c.connect()

  console.log('=== brand_profiles (first 5) ===')
  const brands = await c.query(
    `select brand_id, brand_name_ar, client_slug, auth_user_id from public.brand_profiles order by created_at limit 5`,
  )
  for (const r of brands.rows as Array<{ brand_id: string; brand_name_ar: string; client_slug: string; auth_user_id: string | null }>) {
    console.log(' ', r.client_slug, '|', r.brand_name_ar, '|', r.brand_id, '| user:', r.auth_user_id ? r.auth_user_id.slice(0, 8) + '…' : 'NONE')
  }

  console.log('')
  console.log('=== auth.users (existing test users, first 5) ===')
  const users = await c.query(`select id, email from auth.users order by created_at limit 5`)
  for (const u of users.rows as Array<{ id: string; email: string }>) {
    console.log(' ', u.email, '|', u.id.slice(0, 8) + '…')
  }

  console.log('')
  console.log('=== latest on_demand_requests (5) ===')
  const od = await c.query(
    `select request_id, brand_id, status, created_at, failure_reason from public.on_demand_requests order by created_at desc limit 5`,
  )
  if (od.rowCount === 0) console.log('  (none yet)')
  for (const r of od.rows as Array<{ request_id: string; status: string; created_at: Date; failure_reason: string | null }>) {
    console.log(' ', r.request_id.slice(0, 8) + '…', '|', r.status, '|', r.created_at.toISOString(), '|', r.failure_reason ?? '')
  }

  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
