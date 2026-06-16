import pg from 'pg'

const connectionString = 'postgres://postgres.redzmrlzhxkkpgcokgvl:ogzstudios%40weiblocks.io@aws-1-ap-south-1.pooler.supabase.com:6543/postgres'
const c = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await c.connect()

const q1 = await c.query(`
  SELECT nomination_id, nomination_type, nomination_data, status, rejection_reason, created_at, processed_at
  FROM public.memory_controller_queue
  WHERE brand_id = '1e3ee34b-a674-4005-87c6-c352d8337ddf'
  ORDER BY created_at DESC
  LIMIT 5
`)

const q2 = await c.query(`
  SELECT brand_id, price_position, updated_at
  FROM public.brand_profiles
  WHERE brand_id = '1e3ee34b-a674-4005-87c6-c352d8337ddf'
`)

await c.end()

console.log(JSON.stringify({ query1: q1.rows, query2: q2.rows }, null, 2))
