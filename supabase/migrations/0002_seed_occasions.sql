-- OpenClaw — 0002_seed_occasions
-- Pre-loaded Saudi Occasion Calendar (Doc §4.4 + glossary).
-- Idempotent via ON CONFLICT on (occasion_key, year).

begin;

insert into public.occasion_intelligence
  (occasion_key, occasion_name_ar, occasion_name_en, year, gregorian_date, lead_weeks, priority, recommended_mix, sector_applicability)
values
  -- 2026
  ('ramadan',       'رمضان',           'Ramadan',             2026, '2026-02-17', 4, 'Critical',
   '{"emotional":0.55,"lifestyle":0.30,"offer":0.15}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true,"Healthcare":true,"Finance":true}'::jsonb),
  ('eid_fitr',      'عيد الفطر',       'Eid al-Fitr',         2026, '2026-03-20', 2, 'Critical',
   '{"emotional":0.45,"lifestyle":0.35,"offer":0.20}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb),
  ('eid_adha',      'عيد الأضحى',      'Eid al-Adha',         2026, '2026-05-26', 2, 'High',
   '{"emotional":0.40,"lifestyle":0.40,"offer":0.20}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb),
  ('founding_day',  'يوم التأسيس',     'Saudi Founding Day',  2026, '2026-02-22', 2, 'High',
   '{"emotional":0.50,"lifestyle":0.35,"offer":0.15}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb),
  ('national_day',  'اليوم الوطني',    'Saudi National Day',  2026, '2026-09-23', 3, 'Critical',
   '{"emotional":0.55,"lifestyle":0.30,"offer":0.15}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true,"Healthcare":true,"Finance":true}'::jsonb),

  -- 2027
  ('ramadan',       'رمضان',           'Ramadan',             2027, '2027-02-07', 4, 'Critical',
   '{"emotional":0.55,"lifestyle":0.30,"offer":0.15}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true,"Healthcare":true,"Finance":true}'::jsonb),
  ('eid_fitr',      'عيد الفطر',       'Eid al-Fitr',         2027, '2027-03-09', 2, 'Critical',
   '{"emotional":0.45,"lifestyle":0.35,"offer":0.20}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb),
  ('eid_adha',      'عيد الأضحى',      'Eid al-Adha',         2027, '2027-05-16', 2, 'High',
   '{"emotional":0.40,"lifestyle":0.40,"offer":0.20}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb),
  ('founding_day',  'يوم التأسيس',     'Saudi Founding Day',  2027, '2027-02-22', 2, 'High',
   '{"emotional":0.50,"lifestyle":0.35,"offer":0.15}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb),
  ('national_day',  'اليوم الوطني',    'Saudi National Day',  2027, '2027-09-23', 3, 'Critical',
   '{"emotional":0.55,"lifestyle":0.30,"offer":0.15}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true,"Healthcare":true,"Finance":true}'::jsonb),

  -- 2028
  ('ramadan',       'رمضان',           'Ramadan',             2028, '2028-01-28', 4, 'Critical',
   '{"emotional":0.55,"lifestyle":0.30,"offer":0.15}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true,"Healthcare":true,"Finance":true}'::jsonb),
  ('eid_fitr',      'عيد الفطر',       'Eid al-Fitr',         2028, '2028-02-26', 2, 'Critical',
   '{"emotional":0.45,"lifestyle":0.35,"offer":0.20}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb),
  ('eid_adha',      'عيد الأضحى',      'Eid al-Adha',         2028, '2028-05-05', 2, 'High',
   '{"emotional":0.40,"lifestyle":0.40,"offer":0.20}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb),
  ('founding_day',  'يوم التأسيس',     'Saudi Founding Day',  2028, '2028-02-22', 2, 'High',
   '{"emotional":0.50,"lifestyle":0.35,"offer":0.15}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true}'::jsonb),
  ('national_day',  'اليوم الوطني',    'Saudi National Day',  2028, '2028-09-23', 3, 'Critical',
   '{"emotional":0.55,"lifestyle":0.30,"offer":0.15}'::jsonb,
   '{"F&B":true,"Retail":true,"Beauty_Wellness":true,"Healthcare":true,"Finance":true}'::jsonb)
on conflict (occasion_key, year) do update
  set gregorian_date = excluded.gregorian_date,
      lead_weeks     = excluded.lead_weeks,
      priority       = excluded.priority,
      recommended_mix = excluded.recommended_mix,
      sector_applicability = excluded.sector_applicability;

commit;
