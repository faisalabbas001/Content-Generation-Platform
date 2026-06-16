import pg from 'pg'
import { loadEnv, getPgConnectionString } from './lib/env.js'
loadEnv()
const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await c.connect()
const r = await c.query('select brand_id, price_position from public.brand_profiles limit 1')
console.log(JSON.stringify(r.rows[0]))
await c.end()
