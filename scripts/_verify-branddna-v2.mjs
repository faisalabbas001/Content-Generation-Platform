// End-to-end verification of BrandDNA v2 backend changes (Phases 1-7).
// Run: node scripts/_verify-branddna-v2.mjs
//
// What it checks:
//   1. All migrations 0020 + 0021 applied
//   2. New tables exist with correct shape
//   3. compute_brand_completeness now uses 12 fields
//   4. composition_matrix has seeded rows
//   5. creative_methods has 6 rows
//   6. nomination_type_enum has 'method_profile_update'
//   7. brand_profiles has the 4 new columns
//   8. The Memory Controller can write to brand_method_profiles end-to-end
//      (creates a test brand, writes a profile, reads back, cleans up)
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('='); if (eq < 0) continue
  const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1)
  if (!(k in process.env)) process.env[k] = v
}

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
await c.connect()

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  const mark = ok ? '✓' : '✗'
  console.log(`  ${mark} ${label}${detail ? ' — ' + detail : ''}`)
  if (ok) pass++
  else fail++
}

console.log('OpenClaw — BrandDNA v2 verification')
console.log('═'.repeat(60))

// ── Test 1: Migrations applied ───────────────────────────────────────
console.log('\n[1] Migrations')
const mig = await c.query(`select filename from public.schema_migrations where filename in ('0020_branddna_v2.sql', '0021_completeness_12_fields.sql')`)
check('0020 applied', mig.rows.some(r => r.filename === '0020_branddna_v2.sql'))
check('0021 applied', mig.rows.some(r => r.filename === '0021_completeness_12_fields.sql'))

// ── Test 2: New tables ───────────────────────────────────────────────
console.log('\n[2] New tables')
const tables = await c.query(`select table_name from information_schema.tables where table_schema='public' and table_name in ('brand_method_profiles','brand_method_profile_history','composition_matrix','creative_methods')`)
check('brand_method_profiles',         tables.rows.some(r => r.table_name === 'brand_method_profiles'))
check('brand_method_profile_history',  tables.rows.some(r => r.table_name === 'brand_method_profile_history'))
check('composition_matrix',            tables.rows.some(r => r.table_name === 'composition_matrix'))
check('creative_methods',              tables.rows.some(r => r.table_name === 'creative_methods'))

// ── Test 3: New columns on brand_profiles ───────────────────────────
console.log('\n[3] brand_profiles new columns')
const cols = await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='brand_profiles' and column_name in ('archetype_primary','archetype_secondary','lifecycle_stage','intent_state')`)
check('archetype_primary',   cols.rows.some(r => r.column_name === 'archetype_primary'))
check('archetype_secondary', cols.rows.some(r => r.column_name === 'archetype_secondary'))
check('lifecycle_stage',     cols.rows.some(r => r.column_name === 'lifecycle_stage'))
check('intent_state',        cols.rows.some(r => r.column_name === 'intent_state'))

// ── Test 4: compute_brand_completeness uses 12 fields ────────────────
console.log('\n[4] Completeness function')
const fnsrc = await c.query(`select pg_get_functiondef(oid) as src from pg_proc where proname = 'compute_brand_completeness'`)
const src = fnsrc.rows[0]?.src ?? ''
check('uses 12.0 divisor', src.includes('12.0'))
check('includes archetype_primary', src.includes('archetype_primary'))
check('includes lifecycle_stage', src.includes('lifecycle_stage'))

// ── Test 5: Composition matrix seeded ────────────────────────────────
console.log('\n[5] Composition matrix')
const cm = await c.query(`select count(*)::int as c, count(distinct (archetype, lifecycle_stage, intent_state))::int as configs from composition_matrix`)
check('has seeded rows', cm.rows[0].c >= 30, `${cm.rows[0].c} rows`)
check('covers ≥ 5 configs', cm.rows[0].configs >= 5, `${cm.rows[0].configs} (archetype × stage × intent) configs`)

// ── Test 6: Creative methods reference table ─────────────────────────
console.log('\n[6] Creative methods')
const meth = await c.query(`select method, coverage_pct from creative_methods order by method`)
check('6 methods seeded', meth.rows.length === 6, meth.rows.map(r => r.method).join(', '))
check('Vulnerability is one of them', meth.rows.some(r => r.method === 'Vulnerability'))

// ── Test 7: nomination_type_enum has method_profile_update ──────────
console.log('\n[7] Memory Controller enum')
const en = await c.query(`select unnest(enum_range(null::nomination_type_enum))::text as v`)
check("'method_profile_update' in enum", en.rows.some(r => r.v === 'method_profile_update'))

// ── Test 8: Round-trip write to brand_method_profiles ───────────────
console.log('\n[8] Round-trip write (Memory Controller path simulation)')
// Create a synthetic brand_id (won't FK-fail because we cascade-clean)
const testBrandId = '00000000-0000-0000-0000-fedcba987654'
try {
  // Ensure no leftover from a previous run
  await c.query(`delete from brand_profiles where brand_id = $1`, [testBrandId])

  // Need an auth_user_id; reuse an existing one or skip if no users
  const u = await c.query(`select auth_user_id from brand_profiles where auth_user_id is not null limit 1`)
  const authUid = u.rows[0]?.auth_user_id
  if (!authUid) {
    console.log('  ⚠ skipped (no existing auth_user_id to borrow)')
  } else {
    // Use a unique slug to avoid the unique constraint
    const slug = `verify-v2-${Date.now()}`
    await c.query(`
      insert into brand_profiles (brand_id, auth_user_id, brand_name_ar, sector, client_slug, completeness_score)
      values ($1, $2, 'تحقق', 'F&B', $3, 0)
    `, [testBrandId, authUid, slug])

    // Write a method profile
    await c.query(`
      insert into brand_method_profiles
        (brand_id, voice_register, diagnostic_pattern, visual_idiom,
         cadence_rule, closing_pattern, composition_blend,
         composition_score, creative_direction_text)
      values ($1,'authoritative_warm','story_opener','minimal_natural_light',
              'steady_drumbeat','soft_invitation','{"voice":"Authenticity"}',
              78,'Test brief — verify the round trip works')
    `, [testBrandId])

    const back = await c.query(`select voice_register, composition_score from brand_method_profiles where brand_id = $1`, [testBrandId])
    check('insert and read back', back.rows.length === 1 && back.rows[0].composition_score === 78)

    // History trigger or manual append? We don't have a trigger — manual append.
    await c.query(`
      insert into brand_method_profile_history
        (brand_id, voice_register, diagnostic_pattern, visual_idiom,
         cadence_rule, closing_pattern, composition_blend,
         composition_score, creative_direction_text, change_reason, changed_by)
      values ($1,'authoritative_warm','story_opener','minimal_natural_light',
              'steady_drumbeat','soft_invitation','{"voice":"Authenticity"}',
              78,'Test brief','onboarding','verifier')
    `, [testBrandId])

    const hist = await c.query(`select count(*)::int as c from brand_method_profile_history where brand_id = $1`, [testBrandId])
    check('history append works', hist.rows[0].c >= 1)

    // compute_brand_completeness on a brand with no evidence → 0
    const score = await c.query(`select public.compute_brand_completeness($1::uuid) as s`, [testBrandId])
    check('compute_brand_completeness returns 0 for empty', score.rows[0].s === 0)

    // Cleanup (cascades through method profiles + history)
    await c.query(`delete from brand_profiles where brand_id = $1`, [testBrandId])
  }
} catch (e) {
  check('round-trip error', false, e.message)
}

// ── Test 9: A03 + A06 flow files ────────────────────────────────────
console.log('\n[9] n8n flow files')
const a03 = JSON.parse(readFileSync('n8n/flows/N8N-A03-onboarding.json', 'utf8'))
const a06 = JSON.parse(readFileSync('n8n/flows/N8N-A06-extraction.json', 'utf8'))
check('A06 flow file exists', a06.nodes.length > 0, `${a06.nodes.length} nodes`)
check('A06 has webhook /openclaw-extraction',
  a06.nodes.some(n => n.type === 'n8n-nodes-base.webhook' && n.parameters?.path === 'openclaw-extraction'))
check('A03 has Load extractions node',
  a03.nodes.some(n => n.name === 'Supabase · LOAD extractions'))
check('A03 no longer has Apify scraper',
  !a03.nodes.some(n => n.name === 'POST · Apify (Instagram)'))

// ── Test 10: Phase 8 — 3-section onboarding files exist ─────────────
console.log('\n[10] 3-section onboarding form (Phase 8)')
{
  const files = [
    'apps/web/src/app/actions/onboarding-v2.ts',
    'apps/web/src/app/onboarding-start/section-1.tsx',
    'apps/web/src/app/onboarding-start/section-2.tsx',
    'apps/web/src/app/onboarding-start/section-3.tsx',
    'apps/web/src/app/onboarding-start/stepper.tsx',
    'apps/web/src/app/api/onboarding/extract/route.ts',
    'apps/web/src/app/api/onboarding/extraction-status/[brand_id]/route.ts',
  ]
  for (const f of files) check(f.split('/').pop(), existsSync(f))
}

// ── Test 11: Phase 9 — UI surfaces wired ────────────────────────────
console.log('\n[11] UI surfaces (Phase 9)')
const snapshot = readFileSync('apps/web/src/app/[slug]/snapshot/page.tsx', 'utf8')
const adminBrandDna = readFileSync('apps/web/src/app/admin/branddna/[brand_id]/page.tsx', 'utf8')
check('snapshot imports BrandDirectionCard',
  snapshot.includes('BrandDirectionCard') && snapshot.includes('@repo/ui/admin/brand-direction-card'))
check('admin/branddna imports BrandDirectionCard',
  adminBrandDna.includes('BrandDirectionCard'))
check('BrandDirectionCard component exists',
  existsSync('packages/ui/src/admin/brand-direction-card.tsx'))

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60))
console.log(`  Passed: ${pass}    Failed: ${fail}`)
if (fail > 0) {
  console.error('\n✗ Some checks failed.')
  await c.end()
  process.exit(1)
}
console.log('\n✓ All BrandDNA v2 backend checks pass.')
console.log('  Next: Phase 8 (3-section onboarding form) + Phase 9 (UI surfaces).')

await c.end()
