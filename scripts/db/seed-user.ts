/**
 * Seed a complete dashboard for a real Supabase user.
 *
 * Looks up auth.users by email, wipes any prior brand owned by them,
 * then inserts a full Saudi-context F&B brand with:
 *   - brand_profiles + audience/visual/channel sub-profiles
 *   - 5 evidence_bundles (10 generation-critical fields, sample)
 *   - 1 confidence_classification (Standard mode)
 *   - source_records (form ingestion audit)
 *   - 1 brand_snapshot (full)
 *   - 1 calendar with 20 calendar_posts (mix of approved/pending/draft)
 *   - 3 qa_review_queue items (the 3 override-trigger archetypes)
 *   - 3 routing_decisions (CEO audit trail)
 *   - 6 branddna_event_log entries
 *   - 60 usage_logs rows for cost view
 *   - 2 anomaly_records
 *
 * Idempotent: re-running drops the user's brand (cascades) and rebuilds.
 *
 * Usage:
 *   pnpm tsx scripts/db/seed-user.ts <email>
 *   pnpm db:seed-user -- <email>
 */
import { loadEnv, getPgConnectionString } from './lib/env.js'
import pg from 'pg'

async function main() {
  loadEnv()
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: pnpm tsx scripts/db/seed-user.ts <email>')
    process.exit(1)
  }

  const c = new pg.Client({
    connectionString: getPgConnectionString(),
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()

  try {
    // 1. Resolve auth_user_id
    const { rows: users } = await c.query<{ id: string; email: string }>(
      `select id, email from auth.users where lower(email) = lower($1)`,
      [email],
    )
    if (users.length === 0) {
      console.error(`✗ no auth user with email ${email}. Sign up first at /signup or via Google OAuth.`)
      process.exit(1)
    }
    const authUserId = users[0]!.id
    console.log(`→ auth_user_id = ${authUserId}`)

    // 2. Wipe any prior brand owned by this user (cascade clears children)
    const { rowCount: deleted } = await c.query(
      `delete from public.brand_profiles where auth_user_id = $1`,
      [authUserId],
    )
    if ((deleted ?? 0) > 0) {
      console.log(`  · removed ${deleted} prior brand(s) (cascade cleared children)`)
    }

    // 3. Build the brand (deterministic-ish UUID derived from auth_user_id for re-run safety)
    const brandId = await c.query<{ id: string }>(`select gen_random_uuid()::text as id`).then(r => r.rows[0]!.id)
    const calendarId = await c.query<{ id: string }>(`select gen_random_uuid()::text as id`).then(r => r.rows[0]!.id)

    const slugBase = (email.split('@')[0] ?? 'user')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .slice(0, 30)
    const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`

    console.log(`→ creating brand ${brandId} (slug: ${slug})`)

    await c.query('begin')

    // brand_profiles
    await c.query(
      `insert into public.brand_profiles
        (brand_id, brand_name_ar, brand_name_en, sector, city_primary, arabic_dialect,
         price_position, brand_differentiator, formality_level, humor_tolerance,
         religious_sensitivity, bilingual_ratio, ramadan_relevance, eid_fitr_relevance,
         eid_adha_relevance, national_day_relevance, founding_day_relevance,
         primary_channel, tier, pipeline_tier, batch_shard, client_slug,
         primary_color_hex, completeness_score, total_calendars_generated, auth_user_id)
       values
        ($1, 'مطعم الأصالة', 'Asalah Restaurant', 'F&B', 'Riyadh', 'Najdi',
         'mid_market', 'Authentic Najdi cuisine with a modern presentation', 'casual', 'light',
         'Medium', 'arabic_primary', 'Critical', 'Critical',
         'High', 'Critical', 'High',
         'Instagram', 'paid_starter', 'Starter', 3, $2,
         '#1F8A4C', 84, 4, $3)`,
      [brandId, slug, authUserId],
    )

    // audience / visual / channel
    await c.query(
      `insert into public.audience_profiles (brand_id, description_ar, gender_mix, age_range, language_preference)
       values ($1, 'عائلات سعودية 25-45 سنة، يحبون التجارب التقليدية بلمسة عصرية',
               '{"male":0.45,"female":0.55}'::jsonb, '{"min":25,"max":45}'::jsonb, 'arabic_primary')`,
      [brandId],
    )
    await c.query(
      `insert into public.visual_style_profiles (brand_id, style_descriptor, color_palette, platform_specs)
       values ($1, 'warm food photography, natural daylight, family-table compositions',
               array['#1F8A4C','#F4EAD5','#3E2C1C'],
               '{"canvas":"1080x1080","safe_zone":"bottom-third"}'::jsonb)`,
      [brandId],
    )
    await c.query(
      `insert into public.channel_profiles (brand_id, channel, handle, followers_count, engagement_rate, synced_at)
       values ($1, 'Instagram', '@asalah_restaurant', 18450, 0.046, now() - interval '6 hours')`,
      [brandId],
    )

    // evidence bundles — 10 generation-critical fields (sample of 5)
    await c.query(
      `insert into public.evidence_bundles (brand_id, field_name, agreement_ratio, recency_score, conflict_score, field_confidence)
       values
         ($1, 'arabic_dialect',        1.00, 1.00, 0.00, 'explicitly_confirmed'),
         ($1, 'price_position',        0.85, 0.95, 0.05, 'inferred_high'),
         ($1, 'primary_channel',       1.00, 1.00, 0.00, 'explicitly_confirmed'),
         ($1, 'ramadan_relevance',     0.95, 1.00, 0.00, 'explicitly_confirmed'),
         ($1, 'religious_sensitivity', 0.70, 0.85, 0.10, 'inferred_medium')`,
      [brandId],
    )

    // confidence classification (current)
    await c.query(
      `insert into public.confidence_classifications (brand_id, mode, reasons)
       values ($1, 'Standard', '["all critical fields confirmed or inferred_high"]'::jsonb)`,
      [brandId],
    )

    // source records (form audit)
    await c.query(
      `insert into public.source_records (brand_id, source_type, raw_payload, recency_score)
       values
         ($1, 'form',          '{"submitted":"15-question onboarding"}'::jsonb, 1.00),
         ($1, 'instagram',     '{"posts_scraped":30,"avg_engagement":0.046}'::jsonb, 0.95),
         ($1, 'website',       '{"pages_scraped":4,"meta_title":"Asalah | مطعم"}'::jsonb, 0.85),
         ($1, 'google_places', '{"category":"Restaurant","rating":4.6,"reviews":182}'::jsonb, 0.90)`,
      [brandId],
    )

    // brand snapshot (full)
    await c.query(
      `insert into public.brand_snapshots (brand_id, is_partial, snapshot_data)
       values ($1, false,
         '{
           "tones":["warm_casual","family_focused","proud_saudi"],
           "visual_style":"warm food photography, natural daylight",
           "audience":"Saudi families 25-45 who love authentic dining",
           "completeness":84,
           "dialect_confirmed":true,
           "top_evidence":["arabic_dialect","ramadan_relevance","primary_channel"],
           "next_actions":["confirm religious_sensitivity bucket","upload logo"]
         }'::jsonb)`,
      [brandId],
    )

    // calendars + 20 posts
    await c.query(
      `insert into public.calendars (calendar_id, brand_id, month, status, delivered_at)
       values ($1, $2, to_char(current_date, 'YYYY-MM'), 'delivered', now() - interval '2 days')`,
      [calendarId, brandId],
    )

    const captions = [
      'تجربة عائلية دافئة على مائدة الأصالة 🍽️ — احجز الآن',
      'أطباق نجد التقليدية بنكهة البيت — نقدّمها لك يومياً',
      'مع اقتراب رمضان، نهيّئ لك أمسيات استثنائية 🌙',
      'وصفة اليوم: كبسة لحم بنكهة جدّاتنا',
    ]
    const types = ['lifestyle', 'emotional', 'offer'] as const
    const statuses = ['approved', 'pending', 'approved', 'draft', 'draft', 'draft'] as const
    const monthLabel = new Date().toISOString().slice(0, 7)
    const supabaseHost =
      process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, '').replace(/\/$/, '') ??
      'ahfwrnhuuqlrbdhdxjmv.supabase.co'

    for (let i = 1; i <= 20; i += 1) {
      const caption = captions[i % captions.length]!
      const type = types[i % types.length]!
      const status = statuses[i % statuses.length]!
      const score = 74 + (i % 5) * 4 + (i % 3) * 2
      const watermark = i % 8 === 0
      const postingTime = new Date(Date.now() + i * 24 * 60 * 60 * 1000)
      postingTime.setHours(19, 30, 0, 0)
      const storageUrl = `https://${supabaseHost}/storage/v1/object/public/clients/${brandId}/calendars/${monthLabel}/post_${i}.jpg`

      await c.query(
        `insert into public.calendar_posts
          (calendar_id, brand_id, position, caption_ar, hashtags, content_type, posting_time, storage_url, confidence_score, watermark, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          calendarId,
          brandId,
          i,
          caption,
          ['#مطعم_الأصالة', '#الرياض', '#أكل_سعودي', '#رمضان_كريم'],
          type,
          postingTime.toISOString(),
          storageUrl,
          score,
          watermark,
          status,
        ],
      )
    }

    // QA queue — 3 archetypes
    await c.query(
      `insert into public.qa_review_queue (brand_id, post_id, caption_ar, cco_score, flags, trigger_reason, status)
       values
         ($1, null, 'عرض حصري لوجبتنا الجديدة — لا تفوت الفرصة!', 62,
          '{"dialect_flag":false,"negpat_flag":"SOFT_WARN","cultural_flag":false}'::jsonb,
          'Trigger #10 — CCO score < 75 (watermark required)', 'pending'),
         ($1, null, 'بمناسبة العيد، اجعل سفرتك مميزة بطعم لا يُنسى', 71,
          '{"dialect_flag":false,"negpat_flag":"NONE","cultural_flag":false,"brave_route_flag":true}'::jsonb,
          'Trigger #2 — CCO brave_route flag', 'pending'),
         ($1, null, 'تجربة طعام تنافس أفضل مطاعم العالم!', 48,
          '{"dialect_flag":false,"negpat_flag":"STRONG_WARN","cultural_flag":true}'::jsonb,
          'Trigger #11 — STRONG_WARN negative pattern detected', 'pending')`,
      [brandId],
    )

    // routing decisions (CEO audit trail — append-only)
    await c.query(
      `insert into public.routing_decisions (brand_id, flow_id, request_type, pipeline_assigned, agents_dispatched, constraints_applied, confidence_mode, outcome)
       values
         ($1, 'N8N-A03', 'onboarding',       'Starter', '["CEO","COO","Memory Controller"]'::jsonb, '{"occasion_flags":["ramadan_approaching"]}'::jsonb, 'Standard', 'completed'),
         ($1, 'N8N-A01', 'batch_generation', 'Starter', '["CEO","COO","DeepSeek","CCO","CEO","N8N-V01"]'::jsonb, '{"cost_constraint":"normal"}'::jsonb, 'Standard', 'completed'),
         ($1, 'N8N-A02', 'on_demand',        'Starter', '["CEO","COO","DeepSeek","CCO","CEO","N8N-V01"]'::jsonb, '{"priority":"high"}'::jsonb, 'Standard', 'completed')`,
      [brandId],
    )

    // BrandDNA event log
    await c.query(
      `insert into public.branddna_event_log (brand_id, event_type, event_data)
       values
         ($1, 'source_ingested',     '{"source":"onboarding_form","fields":13}'::jsonb),
         ($1, 'client_confirmed',    '{"field":"arabic_dialect","value":"Najdi"}'::jsonb),
         ($1, 'confidence_upgraded', '{"field":"ramadan_relevance","from":"inferred_high","to":"explicitly_confirmed"}'::jsonb),
         ($1, 'source_ingested',     '{"source":"instagram_scrape","posts":30}'::jsonb),
         ($1, 'source_ingested',     '{"source":"website_scrape","pages":4}'::jsonb),
         ($1, 'client_confirmed',    '{"field":"primary_channel","value":"Instagram"}'::jsonb)`,
      [brandId],
    )

    // anomalies (1 brand-scoped, 1 system)
    await c.query(
      `insert into public.anomaly_records (brand_id, anomaly_type, severity, details, resolved)
       values
         ($1, 'cost_threshold_70','warning', '{"monthly_spend_usd":35.4,"ceiling":50}'::jsonb, false),
         (null,'weavy_timeout',   'info',    '{"flow":"N8N-V01","retries":2,"resolved":true}'::jsonb, true)`,
      [brandId],
    )

    // usage logs — 60 rows of varied agent calls
    await c.query(
      `insert into public.usage_logs (brand_id, flow_id, node_name, cost_usd, duration_ms, status)
       select
         $1,
         (array['N8N-A01','N8N-A02','N8N-A03','N8N-V01','N8N-A04'])[ceil(random()*5)::int],
         (array['CEO_call','COO_call','DeepSeek_call','CCO_call','Weavy_call','Sharp_overlay'])[ceil(random()*6)::int],
         round((random()*0.4 + 0.05)::numeric, 4),
         (random()*8000 + 500)::int,
         case when random() > 0.1 then 'success' else 'retry' end
       from generate_series(1, 60)`,
      [brandId],
    )

    // notification preferences (override_rules) — make settings page feel "set up"
    await c.query(
      `insert into public.override_rules (brand_id, rule_key, rule_value)
       values ($1, 'notification_prefs',
         '{"calendar_ready":true,"revision_ready":true,"anomaly":false}'::jsonb)`,
      [brandId],
    )

    await c.query('commit')

    console.log('')
    console.log('✓ seed complete')
    console.log(`  email:        ${email}`)
    console.log(`  brand_id:     ${brandId}`)
    console.log(`  client_slug:  ${slug}`)
    console.log(`  dashboard:    /${slug}/dashboard`)
    console.log(`  open with:    http://localhost:3000/${slug}/dashboard  (after signing in as ${email})`)
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

main().catch((err) => {
  console.error('✗ seed-user failed')
  console.error(err)
  process.exit(1)
})
