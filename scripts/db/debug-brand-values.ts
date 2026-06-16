import pg from 'pg'
import { loadEnv, getPgConnectionString } from './lib/env.js'
loadEnv()
const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await c.connect()
const br = await c.query(`select brand_id from public.brand_profiles where client_slug = 'saudicuisineuae-ftqg'`)
const brand_id = br.rows[0]?.brand_id
console.log('brand_id:', brand_id)
const ap = await c.query(`select * from public.audience_profiles where brand_id = $1`, [brand_id])
console.log('\n=== audience_profiles ===\n', JSON.stringify(ap.rows[0] ?? null, null, 2))
const vsp = await c.query(`select * from public.visual_style_profiles where brand_id = $1`, [brand_id])
console.log('\n=== visual_style_profiles ===\n', JSON.stringify(vsp.rows[0] ?? null, null, 2))
const eb = await c.query(`select field_name, field_confidence, agreement_ratio from public.evidence_bundles where brand_id = $1 order by field_name`, [brand_id])
console.log('\n=== evidence_bundles ===\n', JSON.stringify(eb.rows, null, 2))
await c.end()
