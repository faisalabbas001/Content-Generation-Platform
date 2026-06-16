#!/usr/bin/env node
/**
 * admin-e2e.mjs — comprehensive functional test of every admin page + action.
 *
 * READS: HTTP GET each admin page; expect 200 (admin cookie set via OC_ADMIN_COOKIE).
 *        If no cookie present, READs are skipped with a SKIP note.
 *
 * WRITES: Each action exercises the same DB ops the server action performs
 *         (we use service-role, the same client the action uses internally —
 *         bypassing the action wrapper avoids needing a real Next session).
 *         Then we re-read to confirm the write took effect.
 *
 * Usage:
 *   OC_ADMIN_COOKIE='oc_admin_access=...; oc_admin_refresh=...' \
 *   node scripts/admin-e2e.mjs
 *
 *   # Or skip READs and run writes only:
 *   node scripts/admin-e2e.mjs --writes-only
 */
import dotenv from 'dotenv'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', 'apps', 'web', '.env.local') })

const BASE = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const COOKIE = process.env.OC_ADMIN_COOKIE
const args = Object.fromEntries(process.argv.slice(2).map((a) => [a.replace(/^--/, ''), true]))

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let pass = 0, fail = 0, skip = 0
function rec(name, status, detail = '') {
  if (status === 'PASS') { console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`); pass++ }
  else if (status === 'SKIP') { console.log(`  ⊝ ${name}${detail ? '  ' + detail : ''}`); skip++ }
  else { console.error(`  ✗ ${name}\n      ${detail}`); fail++ }
}

// ════════════════════════════════════════════════════════════════════
// 1. READ pages — HTTP GET each one, expect 200 (or 302 to /admin-access)
// ════════════════════════════════════════════════════════════════════
console.log('\n=== 1. READ pages — HTTP GET ===')

const PAGES = [
  '/admin',
  '/admin/users',
  '/admin/clients',
  '/admin/branddna',
  '/admin/anomalies',
  '/admin/routing',
  '/admin/audit',
  '/admin/baselines',
  '/admin/occasions',
  '/admin/qa',
  '/admin/flows',
  '/admin/performance',
  '/admin/cost',
  '/admin/settings',
  '/admin/copilot/management',
  '/admin/copilot/tech',
  '/admin/copilot/production',
]

if (args['writes-only']) {
  for (const p of PAGES) rec(`GET ${p}`, 'SKIP', '(--writes-only)')
} else {
  for (const p of PAGES) {
    try {
      const headers = COOKIE ? { cookie: COOKIE } : {}
      const r = await fetch(BASE + p, { headers, redirect: 'manual' })
      if (r.status === 200) rec(`GET ${p}`, 'PASS', `200 in ${r.headers.get('x-vercel-cache') ?? '-'}`)
      else if (r.status === 307 || r.status === 302) {
        const loc = r.headers.get('location') ?? ''
        if (loc.includes('/admin-access')) rec(`GET ${p}`, COOKIE ? 'FAIL' : 'SKIP', `redirect → ${loc} (admin auth needed)`)
        else rec(`GET ${p}`, 'PASS', `redirect → ${loc}`)
      }
      else rec(`GET ${p}`, 'FAIL', `status=${r.status}`)
    } catch (e) {
      rec(`GET ${p}`, 'FAIL', e.message)
    }
  }

  // Brand-id and user-id detail pages
  const { data: anyBrand } = await db.from('brand_profiles').select('brand_id').eq('onboarding_status', 'complete').limit(1).maybeSingle()
  const { data: usersList } = await db.auth.admin.listUsers({ page: 1, perPage: 1 })
  const sampleUser = usersList?.users?.[0]?.id
  if (anyBrand?.brand_id) {
    for (const p of [`/admin/branddna/${anyBrand.brand_id}`, `/admin/clients/${anyBrand.brand_id}`]) {
      try {
        const r = await fetch(BASE + p, { headers: COOKIE ? { cookie: COOKIE } : {}, redirect: 'manual' })
        if (r.status === 200) rec(`GET ${p}`, 'PASS', 'rendered')
        else if ((r.status === 307 || r.status === 302) && !COOKIE) rec(`GET ${p}`, 'SKIP', '→ /admin-access (auth needed)')
        else rec(`GET ${p}`, 'FAIL', `status=${r.status}`)
      } catch (e) { rec(`GET ${p}`, 'FAIL', e.message) }
    }
  }
  if (sampleUser) {
    try {
      const r = await fetch(BASE + `/admin/users/${sampleUser}`, { headers: COOKIE ? { cookie: COOKIE } : {}, redirect: 'manual' })
      if (r.status === 200) rec(`GET /admin/users/${sampleUser.slice(0,8)}…`, 'PASS')
      else if ((r.status === 307 || r.status === 302) && !COOKIE) rec(`GET /admin/users/${sampleUser.slice(0,8)}…`, 'SKIP', '→ /admin-access (auth needed)')
      else rec(`GET /admin/users/${sampleUser.slice(0,8)}…`, 'FAIL', `status=${r.status}`)
    } catch (e) { rec('GET /admin/users/<id>', 'FAIL', e.message) }
  }
}

// ════════════════════════════════════════════════════════════════════
// 2. Pick a target brand for write tests
// ════════════════════════════════════════════════════════════════════
const TARGET_BID = process.argv.find((a) => a.startsWith('--brand='))?.split('=')[1]
  ?? (await db.from('brand_profiles').select('brand_id').eq('onboarding_status', 'complete').order('completeness_score', { ascending: false }).limit(1).maybeSingle()).data?.brand_id

if (!TARGET_BID) { console.error('No complete brand to test against'); process.exit(1) }
console.log(`\n=== Target brand: ${TARGET_BID} ===\n`)

// ════════════════════════════════════════════════════════════════════
// 3. WRITE actions — exercise each
// ════════════════════════════════════════════════════════════════════
console.log('=== 3. WRITE actions — DB-level ===')

// 3.1 addNegativePattern (via Memory Controller queue)
let testPatternId = null
{
  const PATTERN_TEXT = `TEST: admin-e2e ${Date.now()}`
  const { error: e1 } = await db.from('memory_controller_queue').insert({
    brand_id: TARGET_BID,
    nomination_type: 'negative_pattern_add',
    nomination_data: { pattern_text: PATTERN_TEXT, severity: 'SOFT_WARN', reasoning: 'admin-e2e test' },
    nominated_by: 'admin_e2e',
    status: 'pending',
  })
  if (e1) { rec('addNegativePattern: enqueue', 'FAIL', e1.message) }
  else { rec('addNegativePattern: enqueue', 'PASS') }

  // Drain via HTTP (HMAC required for /api/memory/process)
  const HMAC = process.env.N8N_WEBHOOK_SECRET
  const body = JSON.stringify({ flow_id: 'admin_e2e', batch_size: 50 })
  const ts = new Date().toISOString()
  const sig = crypto.createHmac('sha256', HMAC).update(body).digest('hex')
  try {
    const r = await fetch(BASE + '/api/memory/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-n8n-signature': sig, 'x-n8n-request-id': crypto.randomUUID(), 'x-n8n-timestamp': ts },
      body,
    })
    const j = await r.json()
    rec('Memory drain', r.ok ? 'PASS' : 'FAIL', `${r.status} written=${j?.result?.written ?? '?'}`)
  } catch (e) { rec('Memory drain', 'FAIL', e.message) }

  const { data: pattern } = await db.from('negative_patterns').select('pattern_id').eq('brand_id', TARGET_BID).eq('pattern_text', PATTERN_TEXT).maybeSingle()
  testPatternId = pattern?.pattern_id ?? null
  rec('addNegativePattern: persisted', testPatternId ? 'PASS' : 'FAIL', testPatternId ? `pattern_id=${testPatternId.slice(0,8)}…` : 'pattern not found in DB after drain')
}

// 3.2 deleteNegativePattern
if (testPatternId) {
  const { error } = await db.from('negative_patterns').delete().eq('pattern_id', testPatternId).eq('brand_id', TARGET_BID)
  rec('deleteNegativePattern', error ? 'FAIL' : 'PASS', error?.message)
  const { data: gone } = await db.from('negative_patterns').select('pattern_id').eq('pattern_id', testPatternId).maybeSingle()
  rec('deleteNegativePattern: verified absent', gone ? 'FAIL' : 'PASS')
}

// 3.3 addOverrideRule via queue
let testRuleId = null
{
  const RULE_KEY = `test_rule_${Date.now()}`
  const { error: e1 } = await db.from('memory_controller_queue').insert({
    brand_id: TARGET_BID,
    nomination_type: 'override_rule_add',
    nomination_data: { rule_key: RULE_KEY, rule_value: { test: true, ts: Date.now() }, reasoning: 'admin-e2e test' },
    nominated_by: 'admin_e2e',
    status: 'pending',
  })
  rec('addOverrideRule: enqueue', e1 ? 'FAIL' : 'PASS', e1?.message)

  const HMAC = process.env.N8N_WEBHOOK_SECRET
  const body = JSON.stringify({ flow_id: 'admin_e2e', batch_size: 50 })
  const ts = new Date().toISOString()
  const sig = crypto.createHmac('sha256', HMAC).update(body).digest('hex')
  await fetch(BASE + '/api/memory/process', { method: 'POST', headers: { 'content-type': 'application/json', 'x-n8n-signature': sig, 'x-n8n-request-id': crypto.randomUUID(), 'x-n8n-timestamp': ts }, body })

  const { data: rule } = await db.from('override_rules').select('rule_id').eq('brand_id', TARGET_BID).eq('rule_key', RULE_KEY).maybeSingle()
  testRuleId = rule?.rule_id ?? null
  rec('addOverrideRule: persisted', testRuleId ? 'PASS' : 'FAIL', testRuleId ? `rule_id=${testRuleId.slice(0,8)}…` : 'rule not found after drain')

  if (testRuleId) {
    const { error: delErr } = await db.from('override_rules').delete().eq('rule_id', testRuleId)
    rec('deleteOverrideRule', delErr ? 'FAIL' : 'PASS', delErr?.message)
  }
}

// 3.4 forceMemoryDrain (already exercised twice above — confirm route works standalone)
{
  const HMAC = process.env.N8N_WEBHOOK_SECRET
  const body = JSON.stringify({ flow_id: 'admin_e2e', batch_size: 100 })
  const ts = new Date().toISOString()
  const sig = crypto.createHmac('sha256', HMAC).update(body).digest('hex')
  try {
    const r = await fetch(BASE + '/api/memory/process', { method: 'POST', headers: { 'content-type': 'application/json', 'x-n8n-signature': sig, 'x-n8n-request-id': crypto.randomUUID(), 'x-n8n-timestamp': ts }, body })
    rec('forceMemoryDrain (HTTP route)', r.ok ? 'PASS' : 'FAIL', `status=${r.status}`)
  } catch (e) { rec('forceMemoryDrain', 'FAIL', e.message) }
}

// 3.5 recomputeCompleteness via RPC
{
  const { error } = await db.rpc('refresh_brand_completeness', { p_brand_id: TARGET_BID })
  rec('recomputeCompleteness RPC', error ? 'FAIL' : 'PASS', error?.message)
  const { data: bp } = await db.from('brand_profiles').select('completeness_score').eq('brand_id', TARGET_BID).maybeSingle()
  rec('recomputeCompleteness: score readable', bp ? 'PASS' : 'FAIL', `completeness_score=${bp?.completeness_score}`)
}

// 3.6 relinkSectorBaseline
{
  const { data: before } = await db.from('brand_profiles').select('sector, arabic_dialect, sector_baseline_id').eq('brand_id', TARGET_BID).maybeSingle()
  // simulate: clear then re-link
  await db.from('brand_profiles').update({ sector_baseline_id: null }).eq('brand_id', TARGET_BID)
  let { data: baseline } = await db.from('sector_baselines').select('baseline_id').eq('sector', before.sector).eq('dialect', before.arabic_dialect).maybeSingle()
  if (!baseline) {
    const { data: fb } = await db.from('sector_baselines').select('baseline_id').eq('sector', before.sector).limit(1).maybeSingle()
    baseline = fb
  }
  if (baseline) {
    await db.from('brand_profiles').update({ sector_baseline_id: baseline.baseline_id }).eq('brand_id', TARGET_BID)
  }
  const { data: after } = await db.from('brand_profiles').select('sector_baseline_id').eq('brand_id', TARGET_BID).maybeSingle()
  rec('relinkSectorBaseline', after?.sector_baseline_id ? 'PASS' : 'FAIL', `baseline=${after?.sector_baseline_id?.slice(0,8) ?? 'NULL'}`)
}

// 3.7 resolveAnomaly — create a fake anomaly + resolve it
{
  const { data: anom, error: e1 } = await db.from('anomaly_records').insert({
    brand_id: TARGET_BID,
    anomaly_type: 'admin_e2e_test',
    severity: 'warning',
    details: { test: true, ts: new Date().toISOString() },
  }).select('anomaly_id').maybeSingle()
  rec('createTestAnomaly', e1 ? 'FAIL' : 'PASS', anom?.anomaly_id?.slice(0,8))
  if (anom) {
    const { error } = await db.from('anomaly_records').update({ resolved: true }).eq('anomaly_id', anom.anomaly_id)
    rec('resolveAnomaly', error ? 'FAIL' : 'PASS', error?.message)
    const { data: check } = await db.from('anomaly_records').select('resolved').eq('anomaly_id', anom.anomaly_id).maybeSingle()
    rec('resolveAnomaly: verified resolved=true', check?.resolved === true ? 'PASS' : 'FAIL')
    // cleanup
    await db.from('anomaly_records').delete().eq('anomaly_id', anom.anomaly_id)
  }
}

// 3.8 bulkResolveAnomalies — create 3 fakes + bulk resolve
{
  const rows = [
    { brand_id: TARGET_BID, anomaly_type: 'admin_e2e_bulk', severity: 'info', details: { i: 1 } },
    { brand_id: TARGET_BID, anomaly_type: 'admin_e2e_bulk', severity: 'info', details: { i: 2 } },
    { brand_id: TARGET_BID, anomaly_type: 'admin_e2e_bulk', severity: 'info', details: { i: 3 } },
  ]
  const { data: created, error: e1 } = await db.from('anomaly_records').insert(rows).select('anomaly_id')
  rec('bulk: create 3 test anomalies', e1 ? 'FAIL' : 'PASS', `count=${created?.length}`)
  const { error: e2 } = await db.from('anomaly_records').update({ resolved: true })
    .eq('brand_id', TARGET_BID).eq('anomaly_type', 'admin_e2e_bulk').eq('resolved', false)
  rec('bulkResolveAnomalies', e2 ? 'FAIL' : 'PASS', e2?.message)
  // cleanup
  if (created) await db.from('anomaly_records').delete().in('anomaly_id', created.map(c => c.anomaly_id))
}

// 3.9 queueDecision — create a rejected nomination + retry it
{
  const { data: nom, error: e1 } = await db.from('memory_controller_queue').insert({
    brand_id: TARGET_BID,
    nomination_type: 'negative_pattern_add',
    nomination_data: { pattern_text: `TEST: queueDecision retry ${Date.now()}`, severity: 'SOFT_WARN' },
    nominated_by: 'admin_e2e',
    status: 'rejected',
    rejection_reason: 'test rejection',
  }).select('nomination_id').maybeSingle()
  rec('queueDecision: create rejected', e1 ? 'FAIL' : 'PASS')
  if (nom) {
    const { error } = await db.from('memory_controller_queue')
      .update({ status: 'pending', processed_at: null, rejection_reason: null })
      .eq('nomination_id', nom.nomination_id)
    rec('queueDecision: approve_retry (re-pend)', error ? 'FAIL' : 'PASS')
    // cleanup
    await db.from('memory_controller_queue').delete().eq('nomination_id', nom.nomination_id)
  }
}

// 3.10 banUser → unban (use a real test user)
{
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
  // Pick a user that owns NO brands (safest to test on)
  const userIds = users?.users?.map(u => u.id) ?? []
  const { data: bp } = await db.from('brand_profiles').select('auth_user_id').in('auth_user_id', userIds)
  const ownerSet = new Set((bp ?? []).map(b => b.auth_user_id))
  const target = users?.users?.find(u => !ownerSet.has(u.id))
  if (!target) {
    rec('banUser', 'SKIP', 'no user without brands available — would be invasive to test on owner')
  } else {
    // ban for 1 hour
    const { error: e1 } = await db.auth.admin.updateUserById(target.id, { ban_duration: '1h' })
    rec('banUser (1h)', e1 ? 'FAIL' : 'PASS', e1?.message)
    const { data: re1 } = await db.auth.admin.getUserById(target.id)
    const isBanned = re1?.user?.banned_until && new Date(re1.user.banned_until) > new Date()
    rec('banUser: verified banned', isBanned ? 'PASS' : 'FAIL', `banned_until=${re1?.user?.banned_until}`)
    // unban (duration 'none')
    const { error: e2 } = await db.auth.admin.updateUserById(target.id, { ban_duration: 'none' })
    rec('banUser: unban', e2 ? 'FAIL' : 'PASS')
    const { data: re2 } = await db.auth.admin.getUserById(target.id)
    const stillBanned = re2?.user?.banned_until && new Date(re2.user.banned_until) > new Date()
    rec('banUser: verified unbanned', !stillBanned ? 'PASS' : 'FAIL')
  }
}

// 3.11 listAdminUsers data freshness
{
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
  const userIds = users?.users?.map(u => u.id) ?? []
  const { data: brands } = await db.from('brand_profiles').select('auth_user_id, brand_id').in('auth_user_id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000'])
  const ownersWithBrand = new Set((brands ?? []).map(b => b.auth_user_id)).size
  rec('listAdminUsers data', users?.users?.length > 0 ? 'PASS' : 'FAIL', `${users?.users?.length} users · ${brands?.length} brand_profiles · ${ownersWithBrand} unique owners`)
}

// 3.12 audit/routing/flows/baselines/anomalies/usage_logs all queryable
for (const tbl of ['routing_decisions', 'branddna_event_log', 'usage_logs', 'sector_baselines', 'anomaly_records', 'qa_review_queue', 'content_performance_patterns']) {
  try {
    const { error } = await db.from(tbl).select('*', { count: 'exact', head: true }).limit(1)
    rec(`SELECT ${tbl}`, error ? 'FAIL' : 'PASS', error?.message)
  } catch (e) {
    rec(`SELECT ${tbl}`, 'FAIL', e.message)
  }
}

// ════════════════════════════════════════════════════════════════════
// Done
// ════════════════════════════════════════════════════════════════════
console.log(`\n${pass} pass · ${fail} fail · ${skip} skip\n`)
process.exit(fail > 0 ? 1 : 0)
