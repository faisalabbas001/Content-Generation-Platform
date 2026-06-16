import pg from 'pg'
import { readFileSync } from 'node:fs'
import path from 'node:path'

for (const line of readFileSync(path.resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq < 0) continue
  const k = t.slice(0, eq).trim()
  let v = t.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (!(k in process.env)) process.env[k] = v
}

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()

const cols = await c.query(
  `select column_name from information_schema.columns
     where table_name = 'brand_profiles'
       and column_name in (
         'instagram_handle','website_url','place_id','primary_kpi_type',
         'tone_anti_attribute_ids','audience_gender_mix',
         'onboarding_status','onboarding_started_at','onboarding_completed_at'
       )
     order by column_name`,
)
console.log('new brand_profiles columns:')
for (const r of cols.rows) console.log(`  ✓ ${r.column_name}`)

const bucket = await c.query(
  `select id, public, file_size_limit from storage.buckets where id = 'brand-assets'`,
)
console.log('brand-assets bucket:', bucket.rows[0] ?? 'NOT FOUND')

const policies = await c.query(
  `select policyname from pg_policies where tablename = 'objects' and policyname like 'brand_assets_%' order by policyname`,
)
console.log('storage policies:')
for (const r of policies.rows) console.log(`  ✓ ${r.policyname}`)

await c.end()
