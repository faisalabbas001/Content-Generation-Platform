-- OpenClaw — 0003_seed_baselines
-- Sector baselines pre-loaded per Doc §4.3.
-- F&B, Retail, Beauty_Wellness for the Najdi dialect as the primary baseline row per sector.

begin;

insert into public.sector_baselines
  (sector, dialect, sample_size, recommended_content_mix, top_performing_tones, worst_performing_tones, occasion_insights, common_negative_patterns, confidence_benchmarks)
values
  ('F&B', 'Najdi', 0,
   '{"emotional":0.40,"lifestyle":0.35,"offer":0.25}'::jsonb,
   '[{"tone_id":"warm_casual","approval_rate":0.91,"sample":234},{"tone_id":"family_focused","approval_rate":0.88,"sample":198}]'::jsonb,
   '[{"tone_id":"aggressive_cta","approval_rate":0.42,"sample":87}]'::jsonb,
   '{"ramadan":{"best_type":"emotional","optimal_lead_weeks":2,"avg_score":88},"eid_fitr":{"best_type":"lifestyle","optimal_lead_weeks":1,"avg_score":85}}'::jsonb,
   '[]'::jsonb,
   '{"emotional":{"avg":84,"p25":71,"p75":92},"lifestyle":{"avg":79,"p25":66,"p75":88},"offer":{"avg":72,"p25":58,"p75":84}}'::jsonb),

  ('Retail', 'Najdi', 0,
   '{"emotional":0.30,"lifestyle":0.35,"offer":0.35}'::jsonb,
   '[{"tone_id":"aspirational","approval_rate":0.87,"sample":180},{"tone_id":"warm_casual","approval_rate":0.82,"sample":140}]'::jsonb,
   '[{"tone_id":"overly_formal","approval_rate":0.48,"sample":60}]'::jsonb,
   '{"ramadan":{"best_type":"lifestyle","optimal_lead_weeks":3,"avg_score":82},"national_day":{"best_type":"emotional","optimal_lead_weeks":3,"avg_score":89}}'::jsonb,
   '[]'::jsonb,
   '{"emotional":{"avg":80,"p25":68,"p75":88},"lifestyle":{"avg":82,"p25":70,"p75":90},"offer":{"avg":78,"p25":65,"p75":87}}'::jsonb),

  ('Beauty_Wellness', 'Najdi', 0,
   '{"emotional":0.35,"lifestyle":0.45,"offer":0.20}'::jsonb,
   '[{"tone_id":"aspirational","approval_rate":0.89,"sample":155},{"tone_id":"confident","approval_rate":0.85,"sample":120}]'::jsonb,
   '[{"tone_id":"aggressive_cta","approval_rate":0.40,"sample":50}]'::jsonb,
   '{"ramadan":{"best_type":"lifestyle","optimal_lead_weeks":2,"avg_score":83},"eid_fitr":{"best_type":"emotional","optimal_lead_weeks":1,"avg_score":86}}'::jsonb,
   '[]'::jsonb,
   '{"emotional":{"avg":82,"p25":70,"p75":90},"lifestyle":{"avg":85,"p25":73,"p75":92},"offer":{"avg":74,"p25":60,"p75":85}}'::jsonb)
on conflict (sector, dialect) do update set
  recommended_content_mix = excluded.recommended_content_mix,
  top_performing_tones    = excluded.top_performing_tones,
  worst_performing_tones  = excluded.worst_performing_tones,
  occasion_insights       = excluded.occasion_insights,
  confidence_benchmarks   = excluded.confidence_benchmarks,
  last_updated            = now();

-- Onboarding questions catalogue (15 questions — maps to BrandDNA fields)
insert into public.onboarding_questions (question_id, question_text_ar, question_text_en, maps_to_field, sector_relevance, importance_score)
values
  (gen_random_uuid(),'ما اسم علامتك التجارية بالعربية؟',            'Brand name in Arabic',            'brand_name_ar',         '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 10),
  (gen_random_uuid(),'ما اسم علامتك التجارية بالإنجليزية؟',          'Brand name in English',           'brand_name_en',         '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 6),
  (gen_random_uuid(),'في أي قطاع تعمل علامتك؟',                      'Sector',                          'sector',                '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 10),
  (gen_random_uuid(),'في أي مدينة تتواجد علامتك رئيسياً؟',           'Primary city',                    'city_primary',          '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 7),
  (gen_random_uuid(),'ما اللهجة المفضلة للعلامة؟ (نجدي/حجازي/خليجي/فصحى)', 'Preferred dialect',        'arabic_dialect',        '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 10),
  (gen_random_uuid(),'ما موقع سعر علامتك؟',                           'Price position',                  'price_position',        '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 9),
  (gen_random_uuid(),'ما الذي يميّز علامتك عن المنافسين؟',            'Brand differentiator',            'brand_differentiator',  '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 9),
  (gen_random_uuid(),'ما مستوى الرسمية في التواصل؟',                 'Formality level',                 'formality_level',       '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 7),
  (gen_random_uuid(),'ما مدى قبول الفكاهة؟',                           'Humor tolerance',                 'humor_tolerance',       '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 6),
  (gen_random_uuid(),'ما حساسية المحتوى الديني؟',                     'Religious sensitivity',           'religious_sensitivity', '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 10),
  (gen_random_uuid(),'ما نسبة العربية مقابل الإنجليزية؟',             'Bilingual ratio',                 'bilingual_ratio',       '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 7),
  (gen_random_uuid(),'ما أهمية رمضان لعلامتك؟',                       'Ramadan relevance',               'ramadan_relevance',     '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 9),
  (gen_random_uuid(),'ما أهمية اليوم الوطني لعلامتك؟',                'National Day relevance',          'national_day_relevance','{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 7),
  (gen_random_uuid(),'ما المنصة الاجتماعية الرئيسية؟',                 'Primary channel',                 'primary_channel',       '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 8),
  (gen_random_uuid(),'ما اللون الأساسي لعلامتك؟ (hex)',                'Primary brand color (hex)',       'primary_color_hex',     '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb, 6)
on conflict do nothing;

commit;
