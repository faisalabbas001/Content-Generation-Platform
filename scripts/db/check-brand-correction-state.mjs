import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../..')

// Load env
const candidate = path.join(REPO_ROOT, '.env.local')
if (!existsSync(candidate)) throw new Error(`No .env.local found at ${candidate}`)
const raw = readFileSync(candidate, 'utf8')
for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq < 0) continue
  const key = line.slice(0, eq).trim()
  let value = line.slice(eq + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  if (!(key in process.env)) process.env[key] = value
}

function getPgConnectionString() {
  const fromUrl = process.env.SUPABASE_DB_URL ?? ''
  if (fromUrl.startsWith('postgres://') || fromUrl.startsWith('postgresql://')) return fromUrl
  const supabaseUrl = process.env.SUPABASE_URL
  const dbPassword = process.env.SUPABASE_DB_PASSWORD
  if (!supabaseUrl || !dbPassword) throw new Error('Missing SUPABASE_URL or SUPABASE_DB_PASSWORD')
  const match = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co/)
  if (!match) throw new Error(`Bad SUPABASE_URL: ${supabaseUrl}`)
  const projectRef = match[1]
  const region = process.env.SUPABASE_DB_REGION ?? 'us-east-1'
  return `postgres://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-${region}.pooler.supabase.com:6543/postgres`
}

const c = new pg.Client({ connectionString: getPgConnectionString(), ssl: { rejectUnauthorized: false } })
await c.connect()

// 1. Brand profile
const brandRes = await c.query(`SELECT * FROM public.brand_profiles WHERE client_slug = 'saudicuisineuae-ftqg' LIMIT 1`)
const brand = brandRes.rows[0]
console.log('=== 1. brand_profiles ===')
console.log(JSON.stringify(brand, null, 2))

if (!brand) {
  console.log('Brand not found, stopping.')
  await c.end()
  process.exit(0)
}

const brandId = brand.brand_id

// Helper: get columns for a table
async function getColumns(table) {
  const r = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table]
  )
  return r.rows.map(r => r.column_name)
}

// 2. routing_decisions
const rdCols = await getColumns('routing_decisions')
console.log('\n=== 2. routing_decisions columns ===', rdCols)
const rdOrderCol = rdCols.includes('created_at') ? 'created_at' : rdCols.includes('decided_at') ? 'decided_at' : rdCols[0]
const rdRes = await c.query(
  `SELECT * FROM public.routing_decisions WHERE brand_id = $1 ORDER BY ${rdOrderCol} DESC LIMIT 10`,
  [brandId]
)
console.log('\n=== 2. routing_decisions (last 10) ===')
console.log(JSON.stringify(rdRes.rows, null, 2))

// 3. branddna_event_log
const evCols = await getColumns('branddna_event_log')
console.log('\n=== 3. branddna_event_log columns ===', evCols)
const evOrderCol = evCols.includes('created_at') ? 'created_at' : evCols.includes('logged_at') ? 'logged_at' : evCols[0]
const evRes = await c.query(
  `SELECT * FROM public.branddna_event_log WHERE brand_id = $1 ORDER BY ${evOrderCol} DESC LIMIT 20`,
  [brandId]
)
console.log('\n=== 3. branddna_event_log (last 20) ===')
console.log(JSON.stringify(evRes.rows, null, 2))

// 4. memory_controller_queue
const mqCols = await getColumns('memory_controller_queue')
console.log('\n=== 4. memory_controller_queue columns ===', mqCols)
const mqOrderCol = mqCols.includes('created_at') ? 'created_at' : mqCols.includes('queued_at') ? 'queued_at' : mqCols[0]
const mqRes = await c.query(
  `SELECT * FROM public.memory_controller_queue WHERE brand_id = $1 ORDER BY ${mqOrderCol} DESC LIMIT 10`,
  [brandId]
)
console.log('\n=== 4. memory_controller_queue (last 10) ===')
console.log(JSON.stringify(mqRes.rows, null, 2))

// 5. anomaly_records
const arCols = await getColumns('anomaly_records')
console.log('\n=== 5. anomaly_records columns ===', arCols)
const arOrderCol = arCols.includes('created_at') ? 'created_at' : arCols.includes('detected_at') ? 'detected_at' : arCols[0]
const arRes = await c.query(
  `SELECT * FROM public.anomaly_records WHERE brand_id = $1 ORDER BY ${arOrderCol} DESC LIMIT 5`,
  [brandId]
)
console.log('\n=== 5. anomaly_records (last 5) ===')
console.log(JSON.stringify(arRes.rows, null, 2))

await c.end()
