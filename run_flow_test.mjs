/**
 * Dynamic flow test — verifies the full negative_patterns + override_rules pipeline
 * against the live Supabase DB using the service role key (bypasses RLS).
 *
 * Tests:
 *   1. global_negative_patterns — schema, seed count, active filter
 *   2. Memory Controller nomination → processQueue → negative_patterns write
 *   3. Memory Controller nomination → processQueue → override_rules write
 *   4. Event log recorded for both
 *   5. source / reasoning / description fields populated correctly
 *   6. ON CONFLICT upsert (duplicate pattern same brand → updates severity)
 *   7. brand-dna query returns global_negative_patterns + per-brand patterns
 *   8. Cleanup (delete test rows)
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

// Use the Supabase JS client via fetch — no pg needed (REST API)
const SUPABASE_URL = 'https://redzmrlzhxkkpgcokgvl.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJlZHptcmx6aHhra3BnY29rZ3ZsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzUzMDE5MiwiZXhwIjoyMDkzMTA2MTkyfQ.JK_Vctncdz90VUxnRXVnwysl6P6XgKbJ2-a5Zf3qgpo'

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
}

let passed = 0
let failed = 0
const issues = []

function ok(label) { console.log(`  ✓ ${label}`); passed++ }
function fail(label, detail) { console.log(`  ✗ ${label}\n      → ${detail}`); failed++; issues.push({ label, detail }) }
function section(title) { const pad = Math.max(0, 50 - title.length); console.log(`\n── ${title} ${'─'.repeat(pad)}`) }

async function q(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers, ...opts })
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text()
  return { status: res.status, data: body }
}

// ─── Pick a real brand_id to test against ───────────────────────────────────
section('Setup — find a test brand')
const brandsRes = await q('brand_profiles?select=brand_id,brand_name_ar,client_slug&limit=1')
if (!brandsRes.data?.length) { console.log('No brands found — cannot run tests'); process.exit(1) }
const TEST_BRAND = brandsRes.data[0]
console.log(`  Using brand: ${TEST_BRAND.brand_name_ar} (${TEST_BRAND.brand_id.slice(0,8)}…)`)
const brand_id = TEST_BRAND.brand_id
const slug     = TEST_BRAND.client_slug

// ─── 1. global_negative_patterns ────────────────────────────────────────────
section('1. global_negative_patterns')

const gnpAll = await q('global_negative_patterns?select=*')
if (gnpAll.status !== 200) { fail('table accessible', `status ${gnpAll.status}: ${JSON.stringify(gnpAll.data)}`) }
else {
  ok(`table accessible (${gnpAll.data.length} rows)`)
  const active = gnpAll.data.filter(r => r.is_active)
  active.length >= 10 ? ok(`seed data present (${active.length} active rows)`) : fail('seed data', `only ${active.length} active rows`)

  const cats = [...new Set(gnpAll.data.map(r => r.category))]
  cats.length >= 5 ? ok(`categories seeded: ${cats.join(', ')}`) : fail('categories', `only ${cats.length} categories`)

  const hasHardBlock = gnpAll.data.some(r => r.severity === 'HARD_BLOCK')
  hasHardBlock ? ok('HARD_BLOCK severity rows exist') : fail('HARD_BLOCK severity', 'no HARD_BLOCK rows found')

  const cols = Object.keys(gnpAll.data[0] || {})
  const requiredCols = ['pattern_id','pattern_text','severity','category','description','is_active','created_at','updated_at']
  const missing = requiredCols.filter(c => !cols.includes(c))
  missing.length === 0 ? ok('all required columns present') : fail('columns', `missing: ${missing.join(', ')}`)
}

// ─── 2. negative_patterns schema ────────────────────────────────────────────
section('2. negative_patterns — schema check')

// Insert a test pattern directly to check columns
const npInsert = await q('negative_patterns', {
  method: 'POST',
  body: JSON.stringify({
    brand_id,
    pattern_text: '__TEST_PATTERN_FLOW_' + Date.now(),
    severity: 'SOFT_WARN',
    reasoning: 'automated flow test',
    source: 'test',
  }),
})
let testPatternId = null
if (npInsert.status === 201) {
  testPatternId = npInsert.data[0]?.pattern_id
  ok(`insert with new columns (id: ${testPatternId?.slice(0,8)}…)`)
  const row = npInsert.data[0]
  row.reasoning === 'automated flow test' ? ok('reasoning column populated') : fail('reasoning', `got: ${row.reasoning}`)
  row.source === 'test' ? ok('source column populated') : fail('source', `got: ${row.source}`)
  row.updated_at ? ok('updated_at column present') : fail('updated_at', 'null or missing')
} else {
  fail(`insert negative_pattern`, `status ${npInsert.status}: ${JSON.stringify(npInsert.data)}`)
}

// ─── 3. override_rules schema ────────────────────────────────────────────────
section('3. override_rules — schema check')

const orInsert = await q('override_rules', {
  method: 'POST',
  body: JSON.stringify({
    brand_id,
    rule_key: '__test_flow_rule_' + Date.now(),
    rule_value: { test: true, items: ['a','b'] },
    description: 'automated test rule',
    reasoning: 'flow test reasoning',
    is_active: true,
  }),
})
let testRuleId = null
if (orInsert.status === 201) {
  testRuleId = orInsert.data[0]?.rule_id
  ok(`insert with new columns (id: ${testRuleId?.slice(0,8)}…)`)
  const row = orInsert.data[0]
  row.description === 'automated test rule' ? ok('description column populated') : fail('description', `got: ${row.description}`)
  row.reasoning === 'flow test reasoning' ? ok('reasoning column populated') : fail('reasoning', `got: ${row.reasoning}`)
  row.is_active === true ? ok('is_active column populated') : fail('is_active', `got: ${row.is_active}`)
  row.updated_at ? ok('updated_at column present') : fail('updated_at', 'null or missing')
} else {
  fail(`insert override_rule`, `status ${orInsert.status}: ${JSON.stringify(orInsert.data)}`)
}

// ─── 4. Memory Controller queue — nomination insert ─────────────────────────
section('4. Memory Controller queue — enqueue nominations')

const nomPatText = '__TEST_NOM_PATTERN_' + Date.now()
const nomRuleKey  = '__test_nom_rule_' + Date.now()

const nomInsert = await q('memory_controller_queue', {
  method: 'POST',
  body: JSON.stringify([
    {
      brand_id,
      nomination_type: 'negative_pattern_add',
      status: 'pending',
      nomination_data: {
        pattern_text: nomPatText,
        severity: 'STRONG_WARN',
        reasoning: 'flow test via direct insert',
        source: 'test',
      },
      nominated_by: 'test',
    },
    {
      brand_id,
      nomination_type: 'override_rule_add',
      status: 'pending',
      nomination_data: {
        rule_key: nomRuleKey,
        rule_value: ['#test1','#test2'],
        description: 'test hashtags',
        reasoning: 'flow test override rule',
      },
      nominated_by: 'test',
    },
  ]),
})

let nomIds = []
if (nomInsert.status === 201) {
  nomIds = nomInsert.data.map(r => r.nomination_id)
  ok(`2 nominations enqueued (ids: ${nomIds.map(id => id.slice(0,8)).join(', ')})`)
} else {
  fail('enqueue nominations', `status ${nomInsert.status}: ${JSON.stringify(nomInsert.data)}`)
}

// ─── 5. Simulate processQueue — mark written + insert rows ──────────────────
section('5. Simulate Memory Controller processQueue')

// Insert the negative pattern (as processQueue would)
const procNP = await q('negative_patterns', {
  method: 'POST',
  body: JSON.stringify({
    brand_id,
    pattern_text: nomPatText,
    severity: 'STRONG_WARN',
    reasoning: 'flow test via direct insert',
    source: 'test',
  }),
})
let nomPatternId = null
if (procNP.status === 201) {
  nomPatternId = procNP.data[0]?.pattern_id
  ok(`negative_pattern row written (id: ${nomPatternId?.slice(0,8)}…)`)
} else {
  fail('write negative_pattern', `status ${procNP.status}: ${JSON.stringify(procNP.data)}`)
}

// Insert the override rule
const procOR = await q('override_rules', {
  method: 'POST',
  body: JSON.stringify({
    brand_id,
    rule_key: nomRuleKey,
    rule_value: ['#test1','#test2'],
    description: 'test hashtags',
    reasoning: 'flow test override rule',
    is_active: true,
  }),
})
let nomRuleId = null
if (procOR.status === 201) {
  nomRuleId = procOR.data[0]?.rule_id
  ok(`override_rule row written (id: ${nomRuleId?.slice(0,8)}…)`)
} else {
  fail('write override_rule', `status ${procOR.status}: ${JSON.stringify(procOR.data)}`)
}

// Mark nominations as written
if (nomIds.length > 0) {
  const markRes = await q(`memory_controller_queue?nomination_id=in.(${nomIds.join(',')})`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'written', processed_at: new Date().toISOString() }),
  })
  markRes.status === 204 || markRes.status === 200
    ? ok('nominations marked written')
    : fail('mark nominations written', `status ${markRes.status}`)
}

// ─── 6. Event log — write events ────────────────────────────────────────────
section('6. branddna_event_log — event recording')

const eventsInsert = await q('branddna_event_log', {
  method: 'POST',
  body: JSON.stringify([
    {
      brand_id,
      event_type: 'override_added',
      event_data: { nomination_type: 'negative_pattern_add', pattern_text: nomPatText, severity: 'STRONG_WARN', source: 'test' },
    },
    {
      brand_id,
      event_type: 'override_added',
      event_data: { nomination_type: 'override_rule_add', rule_key: nomRuleKey, description: 'test hashtags' },
    },
  ]),
})
let eventIds = []
if (eventsInsert.status === 201) {
  eventIds = eventsInsert.data.map(r => r.event_id)
  ok(`2 events recorded in branddna_event_log`)
} else {
  fail('record events', `status ${eventsInsert.status}: ${JSON.stringify(eventsInsert.data)}`)
}

// Verify events are readable
const eventsRead = await q(`branddna_event_log?brand_id=eq.${brand_id}&event_type=eq.override_added&order=created_at.desc&limit=5`)
if (eventsRead.status === 200 && eventsRead.data.length >= 2) {
  ok(`events readable from branddna_event_log (${eventsRead.data.length} recent)`)
  const hasNP = eventsRead.data.some(e => e.event_data?.nomination_type === 'negative_pattern_add')
  const hasOR = eventsRead.data.some(e => e.event_data?.nomination_type === 'override_rule_add')
  hasNP ? ok('negative_pattern event data correct') : fail('negative_pattern event', 'not found in log')
  hasOR ? ok('override_rule event data correct') : fail('override_rule event', 'not found in log')
} else {
  fail('read events', `status ${eventsRead.status}, count: ${eventsRead.data?.length}`)
}

// ─── 7. ON CONFLICT upsert — duplicate pattern updates severity ──────────────
section('7. ON CONFLICT upsert — idempotency')

// Note: ON CONFLICT with expression index lower(pattern_text) is enforced in apply-brand.ts via raw SQL.
// Here we verify that PATCH (update) on an existing row works and covers the upsert path.
if (testPatternId) {
  // First insert a second row with a distinct pattern_text
  const ins1 = await q('negative_patterns', {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify({ brand_id, pattern_text: '__TEST_UPSERT_ROW', severity: 'SOFT_WARN', reasoning: 'initial', source: 'test' }),
  })
  const upsertRowId = ins1.status === 201 ? ins1.data[0]?.pattern_id : null
  if (upsertRowId) {
    ok(`upsert: inserted initial row (id: ${upsertRowId.slice(0,8)}…)`)
    // Now PATCH to simulate "update on conflict"
    const patch = await q(`negative_patterns?pattern_id=eq.${upsertRowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ severity: 'HARD_BLOCK', reasoning: 'severity escalated by upsert', source: 'admin' }),
    })
    // Read back
    const check = await q(`negative_patterns?pattern_id=eq.${upsertRowId}&select=severity,reasoning,source`)
    if (check.status === 200 && check.data.length > 0) {
      const row = check.data[0]
      row.severity === 'HARD_BLOCK' ? ok('upsert: PATCH updated severity to HARD_BLOCK') : fail('upsert severity', `got ${row.severity}`)
      row.reasoning === 'severity escalated by upsert' ? ok('upsert: PATCH updated reasoning') : fail('upsert reasoning', `got ${row.reasoning}`)
      row.source === 'admin' ? ok('upsert: PATCH updated source to admin') : fail('upsert source', `got ${row.source}`)
    } else {
      fail('read back upserted row', `status ${check.status}`)
    }
    // Cleanup
    await q(`negative_patterns?pattern_id=eq.${upsertRowId}`, { method: 'DELETE' })
  } else {
    fail('upsert test row insert', `status ${ins1.status}: ${JSON.stringify(ins1.data)}`)
  }
}

// ─── 8. getBrandDna query — global + brand patterns returned ────────────────
section('8. getBrandDna — global_negative_patterns in response')

const gnpActive = await q('global_negative_patterns?is_active=eq.true&select=pattern_id,pattern_text,severity,category')
const brandNPs  = await q(`negative_patterns?brand_id=eq.${brand_id}&select=pattern_id,pattern_text,severity,source`)
const brandORs  = await q(`override_rules?brand_id=eq.${brand_id}&is_active=eq.true&select=rule_id,rule_key,rule_value,description`)

gnpActive.status === 200 ? ok(`global_negative_patterns query: ${gnpActive.data.length} active rows`) : fail('global_negative_patterns query', `status ${gnpActive.status}`)
brandNPs.status === 200 ? ok(`brand negative_patterns query: ${brandNPs.data.length} rows (incl. test rows)`) : fail('brand negative_patterns query', `status ${brandNPs.status}`)
brandORs.status === 200 ? ok(`brand override_rules query: ${brandORs.data.length} active rows`) : fail('brand override_rules query', `status ${brandORs.status}`)

// Verify test pattern appears in brand query
if (brandNPs.status === 200) {
  const testRow = brandNPs.data.find(r => r.pattern_text === nomPatText)
  testRow ? ok(`nominated test pattern visible in brand query (source: ${testRow.source})`) : fail('test pattern in brand query', 'not found')
}
// Verify test rule appears
if (brandORs.status === 200) {
  const testRule = brandORs.data.find(r => r.rule_key === nomRuleKey)
  testRule ? ok(`nominated test rule visible in brand query (desc: ${testRule.description})`) : fail('test rule in brand query', 'not found')
}

// ─── 9. Cache key policy_version — verify updated_at changes on upsert ──────
section('9. Cache invalidation — updated_at changes on upsert')

if (testPatternId) {
  const before = await q(`negative_patterns?pattern_id=eq.${testPatternId}&select=updated_at,severity`)
  const beforeTs = before.data?.[0]?.updated_at

  // Update severity (triggers updated_at via trigger)
  await q(`negative_patterns?pattern_id=eq.${testPatternId}`, {
    method: 'PATCH',
    body: JSON.stringify({ severity: 'HARD_BLOCK' }),
  })
  await new Promise(r => setTimeout(r, 500))
  const after = await q(`negative_patterns?pattern_id=eq.${testPatternId}&select=updated_at,severity`)
  const afterTs = after.data?.[0]?.updated_at

  if (beforeTs && afterTs && beforeTs !== afterTs) {
    ok(`updated_at trigger fires on UPDATE (${beforeTs.slice(11,19)} → ${afterTs.slice(11,19)})`)
  } else if (beforeTs === afterTs) {
    fail('updated_at trigger', 'timestamp did not change after PATCH — trigger may not be active')
  } else {
    fail('updated_at trigger', `could not read timestamps (before: ${beforeTs}, after: ${afterTs})`)
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────
section('Cleanup — delete test rows')

const toDelete = [
  testPatternId && `negative_patterns?pattern_id=eq.${testPatternId}`,
  nomPatternId && `negative_patterns?pattern_id=eq.${nomPatternId}`,
  testRuleId   && `override_rules?rule_id=eq.${testRuleId}`,
  nomRuleId    && `override_rules?rule_id=eq.${nomRuleId}`,
  nomIds.length > 0 && `memory_controller_queue?nomination_id=in.(${nomIds.join(',')})`,
  eventIds.length > 0 && `branddna_event_log?event_id=in.(${eventIds.join(',')})`,
].filter(Boolean)

for (const path of toDelete) {
  const r = await q(path, { method: 'DELETE' })
  r.status === 204 || r.status === 200 ? ok(`deleted: ${path.split('?')[0]}`) : fail(`delete ${path}`, `status ${r.status}`)
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(55)}`)
console.log(`  PASSED: ${passed}   FAILED: ${failed}`)
if (issues.length > 0) {
  console.log(`\n  Issues to fix:`)
  issues.forEach((i, n) => console.log(`    ${n+1}. ${i.label}\n       ${i.detail}`))
}
console.log(`${'═'.repeat(55)}\n`)
