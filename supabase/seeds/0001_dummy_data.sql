-- OpenClaw — dummy data seed (DEV-ONLY)
-- Creates 3 representative Saudi SME brands + 1 month calendar each + QA queue + anomalies.
-- Idempotent: re-running replaces data via deterministic UUIDs.

begin;

-- Deterministic UUIDs so the seed is idempotent
-- Three brand ids (public UUID constants — no real user mapping needed for dev)
do $$
declare
  fb_id  uuid := '11111111-1111-1111-1111-111111111111';
  rt_id  uuid := '22222222-2222-2222-2222-222222222222';
  bw_id  uuid := '33333333-3333-3333-3333-333333333333';
  fb_cal uuid := '44444444-4444-4444-4444-444444444444';
  rt_cal uuid := '55555555-5555-5555-5555-555555555555';
  bw_cal uuid := '66666666-6666-6666-6666-666666666666';
  i int;
begin
  -- Clear previous dummy rows (only the 3 dev brands) to keep seed idempotent
  delete from public.brand_profiles where brand_id in (fb_id, rt_id, bw_id);

  -- ── Brand 1: F&B — Najdi (Riyadh)
  insert into public.brand_profiles
    (brand_id, brand_name_ar, brand_name_en, sector, city_primary, arabic_dialect,
     price_position, brand_differentiator, formality_level, humor_tolerance,
     religious_sensitivity, bilingual_ratio, ramadan_relevance, eid_fitr_relevance,
     eid_adha_relevance, national_day_relevance, founding_day_relevance,
     primary_channel, tier, pipeline_tier, batch_shard, client_slug,
     primary_color_hex, completeness_score, total_calendars_generated)
  values
    (fb_id, 'مطعم نجد', 'Najd Restaurant', 'F&B', 'Riyadh', 'Najdi',
     'mid_market', 'Authentic Najdi home cooking with family recipes', 'casual', 'light',
     'Medium', 'arabic_primary', 'Critical', 'Critical',
     'High', 'Critical', 'High',
     'Instagram', 'free', 'Starter', 0, 'najd-restaurant',
     '#C8860A', 78, 3);

  -- ── Brand 2: Retail — Hejazi (Jeddah)
  insert into public.brand_profiles
    (brand_id, brand_name_ar, brand_name_en, sector, city_primary, arabic_dialect,
     price_position, brand_differentiator, formality_level, humor_tolerance,
     religious_sensitivity, bilingual_ratio, ramadan_relevance, eid_fitr_relevance,
     eid_adha_relevance, national_day_relevance, founding_day_relevance,
     primary_channel, tier, pipeline_tier, batch_shard, client_slug,
     primary_color_hex, completeness_score, total_calendars_generated)
  values
    (rt_id, 'بوتيك السلام', 'Al-Salam Boutique', 'Retail', 'Jeddah', 'Hejazi',
     'premium', 'Curated modest fashion for modern Saudi women', 'semi_formal', 'light',
     'High', 'arabic_primary', 'High', 'Critical',
     'Medium', 'Critical', 'High',
     'Instagram', 'paid_starter', 'Starter', 1, 'al-salam-boutique',
     '#6B2E2E', 86, 5);

  -- ── Brand 3: Beauty_Wellness — Gulf (Dammam)
  insert into public.brand_profiles
    (brand_id, brand_name_ar, brand_name_en, sector, city_primary, arabic_dialect,
     price_position, brand_differentiator, formality_level, humor_tolerance,
     religious_sensitivity, bilingual_ratio, ramadan_relevance, eid_fitr_relevance,
     eid_adha_relevance, national_day_relevance, founding_day_relevance,
     primary_channel, tier, pipeline_tier, batch_shard, client_slug,
     primary_color_hex, completeness_score, total_calendars_generated)
  values
    (bw_id, 'واحة الجمال', 'Beauty Oasis', 'Beauty_Wellness', 'Dammam', 'Gulf',
     'luxury', 'High-end organic skincare using local Saudi ingredients', 'semi_formal', 'moderate',
     'Medium', 'balanced', 'High', 'High',
     'Medium', 'High', 'Medium',
     'Instagram', 'paid_pro', 'Pro', 2, 'beauty-oasis',
     '#4A5D4A', 92, 8);

  -- ── Sub-profiles per brand
  insert into public.audience_profiles (brand_id, description_ar, gender_mix, age_range, language_preference)
  values
    (fb_id, 'عائلات سعودية 25-45 سنة، محبو الأكل التقليدي', '{"male":0.5,"female":0.5}'::jsonb, '{"min":25,"max":45}'::jsonb, 'arabic_primary'),
    (rt_id, 'نساء سعوديات 22-40 سنة، مهتمات بالأزياء المحتشمة العصرية', '{"male":0.05,"female":0.95}'::jsonb, '{"min":22,"max":40}'::jsonb, 'arabic_primary'),
    (bw_id, 'نساء 28-50 سنة، شريحة عالية الدخل، يفضلن المنتجات الطبيعية', '{"male":0.1,"female":0.9}'::jsonb, '{"min":28,"max":50}'::jsonb, 'balanced');

  insert into public.visual_style_profiles (brand_id, style_descriptor, color_palette, platform_specs)
  values
    (fb_id, 'warm food photography, natural light, family gathering settings',
     array['#C8860A','#FFFFFF','#3E2C1C'],
     '{"canvas":"1080x1080","safe_zone":"bottom-third"}'::jsonb),
    (rt_id, 'elegant flatlay, soft daylight, muted earth palette',
     array['#6B2E2E','#F5EFE6','#2C2118'],
     '{"canvas":"1080x1350","safe_zone":"top-and-bottom"}'::jsonb),
    (bw_id, 'minimalist product photography, botanical styling, clean white',
     array['#4A5D4A','#F8F4EE','#B9A77F'],
     '{"canvas":"1080x1080","safe_zone":"center"}'::jsonb);

  insert into public.channel_profiles (brand_id, channel, handle, followers_count, engagement_rate, synced_at)
  values
    (fb_id, 'Instagram', '@najd_restaurant', 12400, 0.042, now() - interval '2 days'),
    (rt_id, 'Instagram', '@alsalam_boutique', 28900, 0.038, now() - interval '1 day'),
    (bw_id, 'Instagram', '@beauty_oasis', 47200, 0.051, now() - interval '3 hours');

  -- ── Evidence bundles (10 critical fields per brand — a sample)
  insert into public.evidence_bundles (brand_id, field_name, agreement_ratio, recency_score, field_confidence)
  values
    (fb_id,'arabic_dialect',       1.00, 1.00, 'explicitly_confirmed'),
    (fb_id,'price_position',       0.85, 0.90, 'inferred_high'),
    (fb_id,'primary_channel',      1.00, 1.00, 'explicitly_confirmed'),
    (fb_id,'ramadan_relevance',    0.95, 0.95, 'explicitly_confirmed'),
    (fb_id,'religious_sensitivity',0.70, 0.85, 'inferred_medium'),

    (rt_id,'arabic_dialect',       1.00, 1.00, 'explicitly_confirmed'),
    (rt_id,'price_position',       0.90, 0.95, 'inferred_high'),
    (rt_id,'primary_channel',      1.00, 1.00, 'explicitly_confirmed'),
    (rt_id,'ramadan_relevance',    0.80, 0.90, 'inferred_high'),
    (rt_id,'religious_sensitivity',0.95, 1.00, 'explicitly_confirmed'),

    (bw_id,'arabic_dialect',       1.00, 1.00, 'explicitly_confirmed'),
    (bw_id,'price_position',       1.00, 1.00, 'explicitly_confirmed'),
    (bw_id,'primary_channel',      1.00, 1.00, 'explicitly_confirmed'),
    (bw_id,'ramadan_relevance',    0.85, 0.90, 'inferred_high'),
    (bw_id,'religious_sensitivity',0.75, 0.85, 'inferred_medium');

  -- ── Confidence classifications (current state per brand)
  insert into public.confidence_classifications (brand_id, mode, reasons)
  values
    (fb_id, 'Standard', '["all critical fields confirmed or inferred_high"]'::jsonb),
    (rt_id, 'Standard', '["all critical fields confirmed"]'::jsonb),
    (bw_id, 'Standard', '["all critical fields confirmed"]'::jsonb);

  -- ── Calendars + 20 posts each
  insert into public.calendars (calendar_id, brand_id, month, status, delivered_at)
  values
    (fb_cal, fb_id, '2026-05', 'delivered', now() - interval '3 days'),
    (rt_cal, rt_id, '2026-05', 'delivered', now() - interval '1 day'),
    (bw_cal, bw_id, '2026-05', 'draft',     null);

  -- Helper loop to insert 20 posts per calendar with varied content
  for i in 1..20 loop
    insert into public.calendar_posts
      (calendar_id, brand_id, position, caption_ar, hashtags, content_type, posting_time, storage_url, confidence_score, watermark, status)
    values
      (fb_cal, fb_id, i,
       case (i % 3)
         when 0 then 'اكتشف أشهى أطباق نجد التقليدية بنكهة البيت 🍲'
         when 1 then 'نقدّم لك تجربة طعام عائلية دافئة في قلب الرياض'
         else 'عروض حصرية لشهر رمضان المبارك 🌙'
       end,
       array['#مطعم_نجد','#الرياض','#أكل_سعودي'],
       case (i % 3) when 0 then 'lifestyle' when 1 then 'emotional' else 'offer' end,
       (current_date + make_interval(days => i))::timestamptz + time '10:30',
       'https://your-project.supabase.co/storage/v1/object/public/clients/' || fb_id::text || '/calendars/2026-05/post_' || i || '.jpg',
       75 + (i * 1.1),
       (i % 7 = 0),
       case (i % 5) when 0 then 'approved' when 1 then 'pending' else 'draft' end);

    insert into public.calendar_posts
      (calendar_id, brand_id, position, caption_ar, hashtags, content_type, posting_time, storage_url, confidence_score, watermark, status)
    values
      (rt_cal, rt_id, i,
       case (i % 3)
         when 0 then 'إطلالة رمضانية أنيقة بلمسات محتشمة ✨'
         when 1 then 'قطع جديدة من مجموعتنا الربيعية'
         else 'خصم خاص لعضوات النادي هذا الأسبوع'
       end,
       array['#بوتيك_السلام','#جدة','#أزياء_محتشمة'],
       case (i % 3) when 0 then 'emotional' when 1 then 'lifestyle' else 'offer' end,
       (current_date + make_interval(days => i))::timestamptz + time '18:00',
       'https://your-project.supabase.co/storage/v1/object/public/clients/' || rt_id::text || '/calendars/2026-05/post_' || i || '.jpg',
       80 + (i * 0.8),
       false,
       case (i % 5) when 0 then 'approved' when 1 then 'pending' else 'draft' end);

    insert into public.calendar_posts
      (calendar_id, brand_id, position, caption_ar, hashtags, content_type, posting_time, storage_url, confidence_score, watermark, status)
    values
      (bw_cal, bw_id, i,
       case (i % 3)
         when 0 then 'عناية طبيعية مستوحاة من كنوز الأرض السعودية 🌿'
         when 1 then 'روتين جمال فاخر يناسب بشرتك'
         else 'نهدي عميلاتنا تجربة عناية متكاملة'
       end,
       array['#واحة_الجمال','#جمال_طبيعي','#سعودي'],
       case (i % 3) when 0 then 'lifestyle' when 1 then 'emotional' else 'offer' end,
       (current_date + make_interval(days => i))::timestamptz + time '20:00',
       'https://your-project.supabase.co/storage/v1/object/public/clients/' || bw_id::text || '/calendars/2026-05/post_' || i || '.jpg',
       85 + (i * 0.6),
       false,
       'draft');
  end loop;

  -- ── QA queue (held posts for Production Copilot)
  insert into public.qa_review_queue (brand_id, post_id, caption_ar, cco_score, flags, trigger_reason, status)
  values
    (fb_id, null, 'عرض حصري لوجبتنا الجديدة — لا تفوّت الفرصة!', 62,
     '{"dialect_flag":false,"negpat_flag":"SOFT_WARN","cultural_flag":false}'::jsonb,
     'Trigger #10 — CCO score < 75 (watermark required)', 'pending'),
    (rt_id, null, 'قطعة جديدة تناسب كل المناسبات الدينية', 48,
     '{"dialect_flag":false,"negpat_flag":"NONE","cultural_flag":true}'::jsonb,
     'Trigger #6 — High religious sensitivity + religious reference detected', 'pending'),
    (bw_id, null, 'ثوري روتين عنايتك اليوم!', 71,
     '{"dialect_flag":false,"negpat_flag":"SOFT_WARN","cultural_flag":false,"brave_route_flag":true}'::jsonb,
     'Trigger #2 — CCO brave_route flag', 'pending');

  -- ── Routing decisions (audit trail samples — append only, fresh rows each seed)
  insert into public.routing_decisions (brand_id, flow_id, request_type, pipeline_assigned, agents_dispatched, constraints_applied, confidence_mode, outcome)
  values
    (fb_id, 'N8N-A01', 'batch_generation', 'Starter',
     '["CEO","COO","DeepSeek","CCO","CEO"]'::jsonb,
     '{"cost_constraint":"normal","occasion_flags":["ramadan_approaching"]}'::jsonb,
     'Standard', 'completed'),
    (rt_id, 'N8N-A01', 'batch_generation', 'Starter',
     '["CEO","COO","DeepSeek","CCO","CEO"]'::jsonb,
     '{"cost_constraint":"normal"}'::jsonb,
     'Standard', 'completed'),
    (bw_id, 'N8N-A02', 'on_demand', 'Pro',
     '["CEO","COO","DeepSeek","CCO","CEO","N8N-V01"]'::jsonb,
     '{"priority":"high"}'::jsonb,
     'Standard', 'completed');

  -- ── Anomaly records
  insert into public.anomaly_records (brand_id, anomaly_type, severity, details, resolved)
  values
    (null,  'weavy_timeout',    'warning',  '{"flow":"N8N-V01","retries":3}'::jsonb, true),
    (fb_id, 'cost_threshold_70','warning',  '{"monthly_spend_usd":35.2,"ceiling":50}'::jsonb, false),
    (null,  'batch_queue_high', 'info',     '{"flow":"N8N-A01","queue_depth":42}'::jsonb, false);

  -- ── Usage logs (recent activity for admin cost view)
  insert into public.usage_logs (brand_id, flow_id, node_name, cost_usd, duration_ms, status)
  select
    (array[fb_id, rt_id, bw_id])[ceil(random()*3)::int],
    (array['N8N-A01','N8N-A02','N8N-A03','N8N-V01'])[ceil(random()*4)::int],
    (array['CEO_call','COO_call','DeepSeek_call','CCO_call','Weavy_call'])[ceil(random()*5)::int],
    round((random()*0.4 + 0.05)::numeric, 4),
    (random()*8000 + 500)::int,
    case when random() > 0.1 then 'success' else 'retry' end
  from generate_series(1, 60);

  -- ── BrandDNA event log
  insert into public.branddna_event_log (brand_id, event_type, event_data)
  values
    (fb_id, 'source_ingested',     '{"source":"onboarding_form","fields":11}'::jsonb),
    (fb_id, 'client_confirmed',    '{"field":"arabic_dialect","value":"Najdi"}'::jsonb),
    (rt_id, 'source_ingested',     '{"source":"onboarding_form","fields":12}'::jsonb),
    (rt_id, 'confidence_upgraded', '{"field":"price_position","from":"inferred_medium","to":"inferred_high"}'::jsonb),
    (bw_id, 'source_ingested',     '{"source":"onboarding_form","fields":14}'::jsonb),
    (bw_id, 'brand_graduated',     '{"from":"paid_starter","to":"paid_pro"}'::jsonb);

  -- ── Brand snapshots
  insert into public.brand_snapshots (brand_id, is_partial, snapshot_data)
  values
    (fb_id, false, '{"tones":["warm_casual","family_focused","proud_saudi"],"visual_style":"warm food photography","audience":"Saudi families 25-45","completeness":78,"dialect_confirmed":true}'::jsonb),
    (rt_id, false, '{"tones":["aspirational","elegant","warm_casual"],"visual_style":"elegant flatlay","audience":"Saudi women 22-40 interested in modest fashion","completeness":86,"dialect_confirmed":true}'::jsonb),
    (bw_id, false, '{"tones":["aspirational","confident","natural"],"visual_style":"minimalist product photography","audience":"Women 28-50 high income","completeness":92,"dialect_confirmed":true}'::jsonb);

end $$;

commit;
