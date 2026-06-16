import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'
const { Client } = pg
loadEnv()
const client = new Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await client.connect()
const r = await client.query("select table_name from information_schema.tables where table_schema='public' order by table_name")
r.rows.forEach(row => console.log(row.table_name))
await client.end()
