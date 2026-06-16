#!/usr/bin/env node
/**
 * Realtime infrastructure smoke — proves the /processing UX wiring works.
 *
 * What we assert (with the dev env's anon-as-service-role situation):
 *
 *   1. supabase_realtime publication contains brand_snapshots + brand_profiles
 *   2. Both tables have replica identity = FULL (required for full INSERT
 *      payloads to be broadcast through the WAL slot)
 *   3. The realtime websocket SUBSCRIBES to a postgres_changes channel
 *      filtered by brand_id within 10s
 *   4. Direct pg INSERTs into brand_snapshots succeed (the rows reach the DB)
 *
 * What we INTENTIONALLY do NOT assert here:
 *   - That events are delivered to the websocket subscriber. In dev,
 *     `SUPABASE_SERVICE_ROLE_KEY` is the anon JWT (HANDOVER), so the
 *     subscriber's role is `anon` with `auth.uid() = NULL`, and the existing
 *     `client_isolation` RLS policy on brand_snapshots filters every row out.
 *     In production with a real service-role JWT (or any logged-in user),
 *     the events flow correctly. Verifying that requires real Supabase auth
 *     — best done via a manual UI test of /onboarding-start → /processing.
 *
 * Usage:
 *   node scripts/processing/smoke-realtime.mjs
 */
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Load .env.local ─────────────────────────────────────────────────
const envPath = resolve('.env.local')
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq < 0) continue
  const k = t.slice(0, eq).trim()
  let v = t.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (!(k in process.env)) process.env[k] = v
}

let pass = 0
let fail = 0
function check(label, ok, detail = '') {
  if (ok) { console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); pass++ }
  else    { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); fail++ }
}

async function main() {
  console.log('OpenClaw — realtime infrastructure smoke')
  console.log('═══════════════════════════════════════════════')

  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
  await c.connect()

  // ── 1. Publication membership ─────────────────────────────────────
  const pub = await c.query(
    `select tablename from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'`,
  )
  const tables = pub.rows.map((r) => r.tablename)
  check('publication contains brand_snapshots', tables.includes('brand_snapshots'), tables.join(', ') || '(empty)')
  check('publication contains brand_profiles',  tables.includes('brand_profiles'),  tables.join(', ') || '(empty)')

  // ── 2. Replica identity FULL ──────────────────────────────────────
  const replica = await c.query(
    `select c.relname, c.relreplident
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('brand_snapshots', 'brand_profiles')`,
  )
  for (const row of replica.rows) {
    check(
      `${row.relname} replica identity = FULL`,
      row.relreplident === 'f',
      `relreplident=${row.relreplident}`,
    )
  }

  // ── 3. Find a brand to test channel subscription ──────────────────
  const r = await c.query(`select brand_id from brand_profiles order by created_at limit 1`)
  if (r.rowCount === 0) {
    console.error('No brand_profiles rows. Run pnpm db:seed first.')
    await c.end()
    process.exit(1)
  }
  const brandId = r.rows[0].brand_id

  // ── 4. Websocket subscription test ────────────────────────────────
  // We don't assert event delivery (RLS gate in dev mode); we just
  // assert the channel subscribes. Production = real JWT = events flow.
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
    { realtime: { params: { eventsPerSecond: 10 } } },
  )
  let subscribed = false
  let channelError = null
  const ch = sb
    .channel(`smoke_${brandId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'brand_snapshots', filter: `brand_id=eq.${brandId}` },
      () => {},
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') subscribed = true
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') channelError = err?.message ?? status
    })
  const subStart = Date.now()
  while (!subscribed && Date.now() - subStart < 10_000 && !channelError) await sleep(100)
  check(
    'websocket subscription opened in <10s',
    subscribed,
    channelError ? `error: ${channelError}` : 'ok',
  )

  // ── 5. Direct pg INSERT lands in brand_snapshots ──────────────────
  const ins = await c.query(
    `insert into brand_snapshots (brand_id, is_partial, snapshot_data)
       values ($1, true, $2::jsonb) returning snapshot_id`,
    [brandId, JSON.stringify({ stage: 'form_submitted', _smoke: true, stage_at: new Date().toISOString() })],
  )
  check('direct INSERT into brand_snapshots succeeds', ins.rowCount === 1, `inserted ${ins.rows[0]?.snapshot_id}`)

  // Cleanup
  await c.query(`delete from brand_snapshots where (snapshot_data->>'_smoke') = 'true'`)

  await sb.removeAllChannels()
  await c.end()

  console.log('\n═══════════════════════════════════════════════')
  console.log(`Passed: ${pass}    Failed: ${fail}`)
  console.log()
  if (fail > 0) {
    console.error('✗ Some realtime infrastructure checks failed.')
    process.exit(1)
  }
  console.log('✓ Realtime infrastructure is healthy.')
  console.log('  In production / with a logged-in user, /processing will receive')
  console.log('  brand_snapshots INSERT events live. Verify by manual UI test.')
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

main().catch((e) => {
  console.error('smoke crashed:', e)
  process.exit(1)
})
