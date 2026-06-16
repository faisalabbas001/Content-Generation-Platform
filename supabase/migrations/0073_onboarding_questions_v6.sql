-- migration 0073: seed BrandDNA v6 onboarding questions
-- These 20 questions map to the v6 onboarding form (5-chapter, 20-question UI).
-- The onboarding action inserts onboarding_responses rows referencing these IDs.
-- All question_ids are stable UUIDs so the action can look them up by maps_to_field.

begin;

insert into public.onboarding_questions
  (question_id, question_text_ar, question_text_en, maps_to_field, sector_relevance, importance_score, introduced_because)
values
  -- Ch1: Foundation
  ('00000073-0001-0000-0000-000000000001', 'ما اسم علامتك بالعربية؟',                        'Brand name in Arabic',                    'brand_name_ar',          '{"all":true}'::jsonb, 10, 'v6 foundation'),
  ('00000073-0002-0000-0000-000000000002', 'ما اسم علامتك بالإنجليزية؟',                     'Brand name in English',                   'brand_name_en',          '{"all":true}'::jsonb,  6, 'v6 foundation'),
  ('00000073-0003-0000-0000-000000000003', 'ما معنى أو قصة اسم العلامة؟',                    'Meaning or story behind the name',        'name_meaning',           '{"all":true}'::jsonb,  5, 'v6 foundation'),
  ('00000073-0004-0000-0000-000000000004', 'صورة المنتج البطل — لماذا هذا المنتج؟',           'Hero product photo + why',                'hero_why',               '{"all":true}'::jsonb,  7, 'v6 foundation'),
  ('00000073-0005-0000-0000-000000000005', 'في أي قطاع تعمل؟',                                'Sector',                                  'sector',                 '{"all":true}'::jsonb, 10, 'v6 foundation'),
  ('00000073-0006-0000-0000-000000000006', 'ما مرحلة دورة حياة علامتك؟',                     'Brand lifecycle stage',                   'lifecycle',              '{"all":true}'::jsonb,  7, 'v6 foundation'),
  ('00000073-0007-0000-0000-000000000007', 'أين يجدك جمهورك؟ (المنصات)',                      'Platforms',                               'platforms',              '{"all":true}'::jsonb,  8, 'v6 foundation'),
  -- Ch2: The Feel
  ('00000073-0008-0000-0000-000000000008', 'أين تقع علامتك على مقاييس الأسلوب؟',             'Style scales (min/max, quiet/loud, etc.)', 'scale_minmax',           '{"all":true}'::jsonb,  7, 'v6 feel'),
  ('00000073-0009-0000-0000-000000000009', 'أي العلامات تتمنى أن تبدو مثلها؟',               'Brand references (up to 3)',               'brand_refs',             '{"all":true}'::jsonb,  6, 'v6 feel'),
  ('00000073-0010-0000-0000-000000000010', 'ما نمط حياة أفضل عميل لديك؟',                    'Customer lifestyle',                      'lifestyle',              '{"all":true}'::jsonb,  6, 'v6 feel'),
  ('00000073-0011-0000-0000-000000000011', 'ما موقع سعرك في السوق؟',                          'Price position + actual price range',     'price_position',         '{"all":true}'::jsonb,  9, 'v6 feel'),
  ('00000073-0012-0000-0000-000000000012', 'كيف تريد أن يشعر الناس؟ (المشاعر)',              'Emotions (up to 3)',                       'emotions',               '{"all":true}'::jsonb,  7, 'v6 feel'),
  -- Ch3: The Voice
  ('00000073-0013-0000-0000-000000000013', 'إذا كانت علامتك شخصاً، من سيكون؟ (الأركيتايب)', 'Brand archetype family + specific type',  'archetype_family',       '{"all":true}'::jsonb,  8, 'v6 voice'),
  ('00000073-0014-0000-0000-000000000014', 'ما الموسيقى التي تناسب علامتك؟',                 'Brand soundtrack / music',                'music',                  '{"all":true}'::jsonb,  5, 'v6 voice'),
  ('00000073-0015-0000-0000-000000000015', 'ما الذي يجب ألا نُظهره أبداً؟ (القيود)',         'Content restrictions',                    'restrictions',           '{"all":true}'::jsonb,  9, 'v6 voice'),
  ('00000073-0016-0000-0000-000000000016', 'اللغة وأسلوب التواصل (اللهجة، الرسمية، إلخ)',    'Language & communication style',          'arabic_dialect',         '{"all":true}'::jsonb, 10, 'v6 voice'),
  ('00000073-0017-0000-0000-000000000017', 'رتّب المناسبات الأهم لعلامتك',                   'Ranked occasions',                        'occasions_ranked',       '{"all":true}'::jsonb,  8, 'v6 voice'),
  -- Ch4: The Business
  ('00000073-0018-0000-0000-000000000018', 'من تحترم في مجالك؟ (علامتان)',                   'Respected brands + why',                  'respected_brands',       '{"all":true}'::jsonb,  6, 'v6 business'),
  ('00000073-0019-0000-0000-000000000019', 'ما الهدف الرئيسي للمحتوى؟',                      'Primary content goal',                    'goal',                   '{"all":true}'::jsonb,  9, 'v6 business'),
  ('00000073-0020-0000-0000-000000000020', 'هل سبق أن لم ينجح المحتوى معك؟',                'Past content problems',                   'problems',               '{"all":true}'::jsonb,  6, 'v6 business'),
  ('00000073-0021-0000-0000-000000000021', 'أخبرنا قصة تأسيس علامتك',                        'Founding story',                          'founding_story',         '{"all":true}'::jsonb,  7, 'v6 business'),
  ('00000073-0022-0000-0000-000000000022', 'ما الذي يميزك عن منافسيك؟',                      'Brand differentiator',                    'brand_differentiator',   '{"all":true}'::jsonb, 10, 'v6 business'),
  ('00000073-0023-0000-0000-000000000023', 'أهمية المناسبات (رمضان، اليوم الوطني، إلخ)',     'Occasion relevance (all 5)',               'ramadan_relevance',      '{"all":true}'::jsonb,  9, 'v6 business'),
  -- Ch5: The Vision
  ('00000073-0024-0000-0000-000000000024', 'شارك كل ما لديك (الأصول)',                        'Brand asset files upload',                'brand_assets_bundle',    '{"all":true}'::jsonb,  6, 'v6 vision'),
  ('00000073-0025-0000-0000-000000000025', 'ما يبدو عليه النجاح بعد 12 شهراً؟',             'Vision + vision text',                    'vision',                 '{"all":true}'::jsonb,  8, 'v6 vision')
on conflict (question_id) do nothing;

commit;
