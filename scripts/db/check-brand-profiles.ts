import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'
const { Client } = pg
loadEnv()
const client = new Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await client.connect()
const r = await client.query("select column_name from information_schema.columns where table_schema='public' and table_name='brand_profiles' order by ordinal_position")
r.rows.forEach(row => console.log(row.column_name))
await client.end()
