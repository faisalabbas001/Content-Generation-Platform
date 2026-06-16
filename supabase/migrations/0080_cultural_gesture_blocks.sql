-- 0080_cultural_gesture_blocks.sql
--
-- The 10 cultural gesture hard blocks (OGZ doc §11.1) as enforceable data.
-- Until now these lived only in the design doc — no schema, no enforcement.
-- The deterministic Compliance Gate (@repo/compliance) scans the English
-- visual brief against detection_keywords here BEFORE the image model runs.
--
-- Detection runs on the English brief only (Hard Rule #3 keeps briefs English),
-- so detection_keywords are English phrasings of each violation.

create table if not exists public.cultural_gesture_blocks (
  gesture_key        text primary key,
  description_en     text not null,
  description_ar     text,
  severity           negpat_severity_type not null default 'HARD_BLOCK',
  detection_keywords text[] not null default '{}',
  applies_to_register text,          -- null = all registers
  applies_to_sector  text,           -- null = all sectors
  occasion_scope     text,           -- null = always; e.g. 'ramadan_daylight'
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- updated_at trigger (set_updated_at() created in 0041)
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'cultural_gesture_blocks_updated_at') then
    create trigger cultural_gesture_blocks_updated_at
      before update on public.cultural_gesture_blocks
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- RLS: authenticated may read active rows; service_role full access.
alter table public.cultural_gesture_blocks enable row level security;

create policy cgb_authenticated_read on public.cultural_gesture_blocks
  for select to authenticated using (is_active = true);

create policy cgb_service_role_all on public.cultural_gesture_blocks
  for all to service_role using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the 10 gesture blocks (doc §11.1)
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.cultural_gesture_blocks
  (gesture_key, description_en, description_ar, severity, detection_keywords, occasion_scope) values
  ('left_hand_serving', 'Left hand serving food or beverages', 'تقديم الطعام أو الشراب باليد اليسرى', 'HARD_BLOCK',
    array['left hand serving','serving with the left hand','left-hand serving','offering food with left hand','pouring with the left hand'], null),
  ('left_hand_exchange', 'Left hand for formal object exchange', 'استخدام اليد اليسرى لتبادل الأشياء', 'HARD_BLOCK',
    array['left hand exchange','handing over with the left hand','giving with the left hand','passing with left hand'], null),
  ('sole_pointing', 'Sole of the foot pointed at a person', 'توجيه باطن القدم نحو شخص', 'HARD_BLOCK',
    array['sole of the foot','soles facing','feet pointed at','showing the sole','sole pointing'], null),
  ('beckoning_palm_up', 'Palm-up beckoning gesture', 'الإشارة بالنداء براحة اليد للأعلى', 'HARD_BLOCK',
    array['palm-up beckoning','beckoning with palm up','come-here gesture'], null),
  ('cross_gender_contact', 'Physical contact between non-mahrams', 'تلامس جسدي بين غير المحارم', 'HARD_BLOCK',
    array['handshake between a man and a woman','man and woman touching','mixed-gender embrace','cross-gender contact','man hugging a woman','couple holding hands'], null),
  ('food_consumption_ramadan_daylight', 'Food/drink consumed during Ramadan daylight', 'تناول الطعام أو الشراب في نهار رمضان', 'HARD_BLOCK',
    array['eating','drinking','taking a bite','sipping','person consuming food','mid-bite','biting into'], 'ramadan_daylight'),
  ('quran_mishandling', 'Quran placed under objects or mishandled', 'سوء التعامل مع المصحف', 'HARD_BLOCK',
    array['quran under','quran on the floor','object on top of the quran','mushaf beneath','stepping near the quran'], null),
  ('index_finger_pointing', 'Index finger pointing directly at a person', 'الإشارة بإصبع السبابة نحو شخص', 'HARD_BLOCK',
    array['pointing with the index finger at a person','index finger pointing at','finger pointing directly at'], null),
  ('western_head_shake_no', 'Western head-shake for "no"', 'هز الرأس بالطريقة الغربية للرفض', 'HARD_BLOCK',
    array['shaking head to say no','western head shake'], null),
  ('counting_wrong_sequence', 'Counting starting at the index finger', 'العد بالبدء من إصبع السبابة', 'HARD_BLOCK',
    array['counting starting at the index finger','counting on fingers starting with index'], null)
on conflict (gesture_key) do nothing;
