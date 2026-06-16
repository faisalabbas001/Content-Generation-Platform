import pg from 'pg'

const connStr = 'postgres://postgres.redzmrlzhxkkpgcokgvl:ogzstudios%40weiblocks.io@aws-1-ap-south-1.pooler.supabase.com:6543/postgres'

async function main() {
  const client = new pg.Client({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    // Query 1: RLS policies
    console.log('\n=== QUERY 1: RLS Policies on branddna_event_log ===')
    const q1 = await client.query(`
      SELECT policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE tablename = 'branddna_event_log'
    `)
    console.log(JSON.stringify(q1.rows, null, 2))

    // Query 2: RLS enabled
    console.log('\n=== QUERY 2: RLS enabled on branddna_event_log ===')
    const q2 = await client.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'branddna_event_log'
    `)
    console.log(JSON.stringify(q2.rows, null, 2))

    // Query 3: Realtime publication
    console.log('\n=== QUERY 3: Supabase Realtime publication ===')
    const q3 = await client.query(`
      SELECT schemaname, tablename
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
      AND tablename = 'branddna_event_log'
    `)
    console.log(JSON.stringify(q3.rows, null, 2))

    // Query 4: Most recent events
    console.log('\n=== QUERY 4: Most recent events for brand ===')
    const q4 = await client.query(`
      SELECT event_type, event_data, created_at
      FROM public.branddna_event_log
      WHERE brand_id = '1e3ee34b-a674-4005-87c6-c352d8337ddf'
      ORDER BY created_at DESC
      LIMIT 10
    `)
    console.log(JSON.stringify(q4.rows, null, 2))
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
