/**
 * Seed 3 famous Saudi brand profiles for N8N-A01 workflow testing.
 *
 * Creates auth users via Supabase Admin API, then inserts full brand profiles
 * for 3 well-known Saudi brand archetypes. Deliberately does NOT create a
 * calendar for the current target month so the workflow generates a fresh one.
 *
 * Today is late May → workflow will target June 2026 automatically.
 *
 * Brands:
 *   1. البيك      (Al-Baik)       F&B,            Jeddah,  Gulf
 *   2. مكتبة جرير (Jarir)         Retail,         Riyadh,  Najdi
 *   3. صيدليات النهدي (Nahdi)     Beauty_Wellness, Dammam,  Gulf
 *
 * Usage:
 *   pnpm tsx scripts/db/seed-sa-test-brands.ts
 *
 * After running:
 *   pnpm tsx scripts/db/trigger-a01-test.ts
 */

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { loadEnv, getPgConnectionString, requireEnv } from './lib/env.js'

// ── Brand definitions ──────────────────────────────────────────────────────
const TEST_BRANDS = [
  {
    email:         'test.albaik@openclaw.dev',
    password:      'Test@1234!',
    brand_name_ar: 'البيك',
    brand_name_en: 'Al-Baik',
    sector:        'F&B',
    city:          'Jeddah',
    dialect:       'Gulf',
    price:         'mid_market',
    differentiator:'Crispy fried chicken using a secret spice blend — the most iconic Saudi fast food',
    formality:     'casual',
    humor:         'light',
    religion:      'High',
    bilingual:     'arabic_primary',
    ramadan:       'Critical',
    eid_fitr:      'Critical',
    eid_adha:      'High',
    national_day:  'Critical',
    founding_day:  'High',
    channel:       'Instagram',
    tier:          'paid_pro',
    pipeline:      'Pro',
    shard:         0,
    color:         '#C0392B',
    completeness:  91,
    calendars_done: 6,
    ig_handle:     '@albaik_official',
    followers:     285000,
    engagement:    0.048,
    style:         'appetising fried chicken closeups, warm golden lighting, family and friends moments',
    palette:       ['#C0392B', '#F39C12', '#FFFFFF'],
    audience_ar:   'شباب وعائلات سعودية 15-40 سنة، يبحثون عن وجبة سريعة بنكهة سعودية أصيلة',
    gender:        '{"male":0.55,"female":0.45}',
    age:           '{"min":15,"max":40}',
  },
  {
    email:         'test.jarir@openclaw.dev',
    password:      'Test@1234!',
    brand_name_ar: 'مكتبة جرير',
    brand_name_en: 'Jarir Bookstore',
    sector:        'Retail',
    city:          'Riyadh',
    dialect:       'Najdi',
    price:         'mid_market',
    differentiator:'Saudi Arabia\'s leading bookstore and electronics retailer with 60+ branches',
    formality:     'semi_formal',
    humor:         'light',
    religion:      'Medium',
    bilingual:     'balanced',
    ramadan:       'High',
    eid_fitr:      'Critical',
    eid_adha:      'High',
    national_day:  'Critical',
    founding_day:  'Critical',
    channel:       'Instagram',
    tier:          'paid_pro',
    pipeline:      'Pro',
    shard:         1,
    color:         '#1A5276',
    completeness:  88,
    calendars_done: 9,
    ig_handle:     '@jarir',
    followers:     1200000,
    engagement:    0.032,
    style:         'clean product photography, educational flat-lays, family lifestyle settings',
    palette:       ['#1A5276', '#F4D03F', '#FFFFFF'],
    audience_ar:   'طلاب ومهنيون سعوديون 18-45 سنة، مهتمون بالكتب والتقنية والتعليم',
    gender:        '{"male":0.6,"female":0.4}',
    age:           '{"min":18,"max":45}',
  },
  {
    email:         'test.nahdi@openclaw.dev',
    password:      'Test@1234!',
    brand_name_ar: 'صيدليات النهدي',
    brand_name_en: 'Al Nahdi Pharmacy',
    sector:        'Beauty_Wellness',
    city:          'Dammam',
    dialect:       'Gulf',
    price:         'mid_market',
    differentiator:'Saudi Arabia\'s largest pharmacy chain with 1,100+ branches, trusted health partner',
    formality:     'semi_formal',
    humor:         'none',
    religion:      'High',
    bilingual:     'arabic_primary',
    ramadan:       'High',
    eid_fitr:      'High',
    eid_adha:      'Medium',
    national_day:  'High',
    founding_day:  'Medium',
    channel:       'Instagram',
    tier:          'paid_starter',
    pipeline:      'Starter',
    shard:         2,
    color:         '#1E8449',
    completeness:  85,
    calendars_done: 4,
    ig_handle:     '@nahdicares',
    followers:     420000,
    engagement:    0.041,
    style:         'clean clinical photography, wellness lifestyle, soft pastel tones, health-focused',
    palette:       ['#1E8449', '#AED6F1', '#FFFFFF'],
    audience_ar:   'نساء ورجال سعوديون 25-55 سنة، مهتمون بالصحة والعناية والجمال',
    gender:        '{"male":0.35,"female":0.65}',
    age:           '{"min":25,"max":55}',
  },
]

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  loadEnv()

  const supabaseUrl = requireEnv('SUPABASE_URL')
  const serviceKey  = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const c = new pg.Client({
    connectionString: getPgConnectionString(),
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()

  const results: Array<{ slug: string; brand_id: string; email: string; brand_name_ar: string }> = []

  for (const b of TEST_BRANDS) {
    console.log(`\n── ${b.brand_name_ar} (${b.brand_name_en}) ──────────────`)

    // 1. Create or reuse auth user
    const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
      email:             b.email,
      password:          b.password,
      email_confirm:     true,
      user_metadata:     { brand_name_ar: b.brand_name_ar },
    })

    let authUserId: string
    if (createErr) {
      // User already exists — look them up
      const { data: listData } = await supabase.auth.admin.listUsers()
      const existing = listData?.users.find(u => u.email === b.email)
      if (!existing) throw new Error(`Cannot create or find user ${b.email}: ${createErr.message}`)
      authUserId = existing.id
      console.log(`  · reusing existing auth user  ${authUserId}`)
    } else {
      authUserId = createData.user.id
      console.log(`  · created auth user           ${authUserId}`)
    }

    // 2. Wipe any prior brand for this user
    const { rowCount: deleted } = await c.query(
      `delete from public.brand_profiles where auth_user_id = $1`,
      [authUserId],
    )
    if ((deleted ?? 0) > 0) console.log(`  · removed ${deleted} prior brand(s)`)

    // 3. Generate IDs + slug
    const { rows: [{ brand_id }] } = await c.query<{ brand_id: string }>(
      `select gen_random_uuid()::text as brand_id`,
    )
    const slugSuffix = Math.random().toString(36).slice(2, 6)
    const slug = `${b.brand_name_en.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 25)}-${slugSuffix}`

    console.log(`  · brand_id   ${brand_id}`)
    console.log(`  · slug       ${slug}`)

    await c.query('begin')
    try {
      // 4. brand_profiles
      await c.query(
        `insert into public.brand_profiles
          (brand_id, brand_name_ar, brand_name_en, sector, city_primary, arabic_dialect,
           price_position, brand_differentiator, formality_level, humor_tolerance,
           religious_sensitivity, bilingual_ratio, ramadan_relevance, eid_fitr_relevance,
           eid_adha_relevance, national_day_relevance, founding_day_relevance,
           primary_channel, tier, pipeline_tier, batch_shard, client_slug,
           primary_color_hex, completeness_score, total_calendars_generated, auth_user_id)
         values
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
        [
          brand_id, b.brand_name_ar, b.brand_name_en, b.sector, b.city, b.dialect,
          b.price, b.differentiator, b.formality, b.humor,
          b.religion, b.bilingual, b.ramadan, b.eid_fitr,
          b.eid_adha, b.national_day, b.founding_day,
          b.channel, b.tier, b.pipeline, b.shard, slug,
          b.color, b.completeness, b.calendars_done, authUserId,
        ],
      )

      // 5. audience_profiles
      await c.query(
        `insert into public.audience_profiles (brand_id, description_ar, gender_mix, age_range, language_preference)
         values ($1, $2, $3::jsonb, $4::jsonb, $5)`,
        [brand_id, b.audience_ar, b.gender, b.age, b.bilingual],
      )

      // 6. visual_style_profiles
      await c.query(
        `insert into public.visual_style_profiles (brand_id, style_descriptor, color_palette, platform_specs)
         values ($1, $2, $3, $4::jsonb)`,
        [
          brand_id,
          b.style,
          b.palette,
          JSON.stringify({ canvas: '1080x1080', safe_zone: 'bottom-third' }),
        ],
      )

      // 7. channel_profiles
      await c.query(
        `insert into public.channel_profiles (brand_id, channel, handle, followers_count, engagement_rate, synced_at)
         values ($1, $2, $3, $4, $5, now() - interval '1 hour')`,
        [brand_id, b.channel, b.ig_handle, b.followers, b.engagement],
      )

      // 8. evidence_bundles — 10 critical fields
      await c.query(
        `insert into public.evidence_bundles
          (brand_id, field_name, agreement_ratio, recency_score, conflict_score, field_confidence)
         values
          ($1,'arabic_dialect',        1.00,1.00,0.00,'explicitly_confirmed'),
          ($1,'brand_differentiator',  0.90,0.95,0.05,'inferred_high'),
          ($1,'price_position',        0.85,0.90,0.05,'inferred_high'),
          ($1,'primary_channel',       1.00,1.00,0.00,'explicitly_confirmed'),
          ($1,'ramadan_relevance',     0.95,1.00,0.00,'explicitly_confirmed'),
          ($1,'primary_audience_gender',0.80,0.85,0.10,'inferred_high'),
          ($1,'primary_kpi_type',      0.75,0.80,0.15,'inferred_medium'),
          ($1,'religious_sensitivity', 0.85,0.90,0.05,'inferred_high'),
          ($1,'tone_anti_attributes',  0.70,0.75,0.15,'inferred_medium'),
          ($1,'bilingual_ratio',       1.00,1.00,0.00,'explicitly_confirmed')`,
        [brand_id],
      )

      // 9. confidence_classification
      await c.query(
        `insert into public.confidence_classifications (brand_id, mode, reasons)
         values ($1, 'Standard', '["all 10 critical fields confirmed or inferred_high"]'::jsonb)`,
        [brand_id],
      )

      // 10. source_records
      await c.query(
        `insert into public.source_records (brand_id, source_type, raw_payload, recency_score)
         values
          ($1,'form',         '{"submitted":"15-question onboarding","fields_filled":15}'::jsonb, 1.00),
          ($1,'instagram',    '{"posts_scraped":30,"avg_engagement":${b.engagement}}'::jsonb, 0.95),
          ($1,'google_places','{"category":"${b.sector}","rating":4.5,"reviews":320}'::jsonb, 0.90)`,
        [brand_id],
      )

      // 11. brand_snapshot
      await c.query(
        `insert into public.brand_snapshots (brand_id, is_partial, snapshot_data)
         values ($1, false, $2::jsonb)`,
        [
          brand_id,
          JSON.stringify({
            tones:             ['warm_casual', 'proud_saudi', 'family_focused'],
            visual_style:      b.style.slice(0, 80),
            audience:          b.audience_ar,
            completeness:      b.completeness,
            dialect_confirmed: true,
          }),
        ],
      )

      // 12. BrandDNA event log
      await c.query(
        `insert into public.branddna_event_log (brand_id, event_type, event_data)
         values
          ($1,'source_ingested',  '{"source":"onboarding_form","fields":15}'::jsonb),
          ($1,'client_confirmed', '{"field":"arabic_dialect","value":"${b.dialect}"}'::jsonb),
          ($1,'client_confirmed', '{"field":"primary_channel","value":"${b.channel}"}'::jsonb)`,
        [brand_id],
      )

      // NOTE: NO calendar inserted for June 2026 — workflow will generate it.

      await c.query('commit')
      console.log(`  ✓ brand seeded — no calendar for 2026-06 (workflow will create it)`)
      results.push({ slug, brand_id, email: b.email, brand_name_ar: b.brand_name_ar })

    } catch (e) {
      await c.query('rollback').catch(() => {})
      throw e
    }
  }

  await c.end()

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════')
  console.log('✓ 3 Saudi test brands seeded. Next step: trigger workflow.')
  console.log('═══════════════════════════════════════════════════════\n')
  console.log('Run this to fire N8N-A01 for all 3 brands:')
  console.log('  pnpm tsx scripts/db/trigger-a01-test.ts\n')
  console.log('Or trigger one brand at a time:')
  for (const r of results) {
    console.log(`  pnpm tsx scripts/db/trigger-a01-test.ts ${r.brand_id}   # ${r.brand_name_ar}`)
  }
  console.log('\nLogin credentials for each brand (after workflow completes):')
  for (const r of results) {
    console.log(`  ${r.brand_name_ar.padEnd(18)} → ${r.email}  /  Test@1234!  →  /${r.slug}/calendar`)
  }
  console.log('\nAdmin review (after workflow):  /admin/content-release')
}

main().catch((e) => { console.error('✗ seed failed:', e.message); process.exit(1) })
