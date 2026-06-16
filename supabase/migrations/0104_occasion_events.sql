-- Migration 0104: Dynamic, dated occasion-events engine.
--
-- Replaces N8N-A01's hardcoded static month→occasions table (SAUDI_OCCASIONS) with
-- a data-driven, DATE-WINDOWED model. Each event has a real date plus lead/active/tail
-- windows, so the calendar can target SPECIFIC days (e.g. a Saudi World Cup match day)
-- instead of theming a whole month. New events (sports, campaigns, holidays) are added
-- as rows — no code change. Matches the documented "Calendar Engine / OccasionLayer"
-- (active occasion + phase + days-remaining) from OGZ_COMPLETE_SYSTEM_DOCUMENT.
--
-- A post on date D gets event E when:
--   E.event_date - lead_days  <=  D  <=  E.event_date + active_days + tail_days
-- (active_days lets multi-day events like Ramadan span 30 days).
--
-- Idempotent: guarded with IF NOT EXISTS; seeds use ON CONFLICT (event_key) DO UPDATE.

create table if not exists public.occasion_events (
  event_key       text primary key,                 -- stable id, e.g. 'fifa_wc26_ksa_uruguay'
  name            text not null,                     -- human label
  occasion_flag   text not null,                     -- value pushed into occasions[] (CEO/COO/DeepSeek read this)
  event_date      date not null,                     -- anchor date (match day, holiday, Eid day 1, etc.)
  lead_days       int  not null default 3,           -- days BEFORE event_date the occasion is active
  active_days     int  not null default 0,           -- extra days the event itself spans (Ramadan=30)
  tail_days       int  not null default 1,           -- days AFTER it stays active
  engagement_multiplier numeric not null default 1.0,
  themes          jsonb not null default '[]'::jsonb,
  avoid           jsonb not null default '[]'::jsonb,
  -- scope: which brands this applies to. NULL/empty sectors = all sectors.
  sectors         jsonb not null default '[]'::jsonb,  -- e.g. ["F&B","Retail"]; [] = all
  priority        int  not null default 100,          -- lower = wins when multiple events overlap a date
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.occasion_events is
  'Dated occasion engine for N8N-A01. Each row is a real-dated event with lead/active/tail '
  'windows; the calendar attaches the occasion only to posts whose date falls in the window. '
  'Add events as rows (FIFA matches, holidays, campaigns) — no flow code change needed.';

-- Fast window scan: events active anywhere near a target month.
create index if not exists idx_occasion_events_date
  on public.occasion_events (event_date) where is_active;

-- Readable by the service role (n8n) and authenticated users; writable by service role only.
alter table public.occasion_events enable row level security;
drop policy if exists occasion_events_read on public.occasion_events;
create policy occasion_events_read on public.occasion_events
  for select using (true);

-- ── Seed: 5 canonical Saudi occasions (2026) — per OGZ_COMPLETE_SYSTEM_DOCUMENT ──
insert into public.occasion_events
  (event_key, name, occasion_flag, event_date, lead_days, active_days, tail_days,
   engagement_multiplier, themes, avoid, sectors, priority)
values
  ('ramadan_2026', 'Ramadan 2026', 'ramadan_2026', '2026-02-18', 14, 30, 3, 2.8,
   '["iftar_specials","suhoor_menu","saudi_heritage_food","family_gathering","generosity"]'::jsonb,
   '["daytime_food_photos","alcohol_adjacent","western_valentine_push"]'::jsonb, '[]'::jsonb, 10),
  ('founding_day_2026', 'Saudi Founding Day', 'founding_day', '2026-02-22', 14, 0, 3, 1.9,
   '["saudi_heritage","founding_day_pride","traditional_architecture"]'::jsonb,
   '["non_saudi_cultural_references"]'::jsonb, '[]'::jsonb, 20),
  ('eid_al_fitr_2026', 'Eid Al-Fitr 2026', 'eid_al_fitr_2026', '2026-03-20', 5, 3, 7, 2.5,
   '["eid_celebration","family_feast","sweets_gifting","joy_togetherness"]'::jsonb,
   '[]'::jsonb, '[]'::jsonb, 10),
  ('eid_al_adha_2026', 'Eid Al-Adha 2026', 'eid_al_adha_2026', '2026-05-27', 5, 3, 7, 2.2,
   '["meat_grills","mandi","kabsa","family_feast","sacrifice_generosity"]'::jsonb,
   '["heavy_vegetarian_push","pork_adjacent"]'::jsonb, '[]'::jsonb, 10),
  ('national_day_2026', 'Saudi National Day', 'national_day', '2026-09-23', 14, 0, 3, 1.9,
   '["saudi_pride","traditional_saudi_cuisine","green_gold_colors","heritage_dishes","national_day_offer"]'::jsonb,
   '["non_saudi_cultural_references","western_themed_content"]'::jsonb, '[]'::jsonb, 20)
on conflict (event_key) do update set
  name=excluded.name, occasion_flag=excluded.occasion_flag, event_date=excluded.event_date,
  lead_days=excluded.lead_days, active_days=excluded.active_days, tail_days=excluded.tail_days,
  engagement_multiplier=excluded.engagement_multiplier, themes=excluded.themes,
  avoid=excluded.avoid, sectors=excluded.sectors, priority=excluded.priority, is_active=true;

-- ── Seed: FIFA World Cup 2026 — Saudi Arabia (Group H) match days (real dates) ──
-- Tournament Jun 11 – Jul 19 2026. KSA matches: Jun 15 (vs Uruguay), Jun 21 (vs Spain),
-- Jun 26 (vs Cape Verde). Each match = match-day offer window (2 days before → 1 after).
-- priority 5 (beats generic occasions) — a match day should dominate that day's post.
insert into public.occasion_events
  (event_key, name, occasion_flag, event_date, lead_days, active_days, tail_days,
   engagement_multiplier, themes, avoid, sectors, priority)
values
  ('fifa_wc26_opening', 'FIFA World Cup 2026 — Kickoff', 'fifa_world_cup_2026', '2026-06-11', 5, 0, 1, 1.6,
   '["world_cup_excitement","watch_party_deal","football_celebration","green_team_pride"]'::jsonb,
   '["gambling_references","alcohol_adjacent"]'::jsonb, '[]'::jsonb, 30),
  ('fifa_wc26_ksa_uruguay', 'Saudi Arabia vs Uruguay (World Cup)', 'fifa_ksa_match', '2026-06-15', 2, 0, 1, 2.6,
   '["match_day_offer","saudi_team_pride","green_falcons_support","watch_party_deal","goal_celebration_menu"]'::jsonb,
   '["gambling_references","alcohol_adjacent","mocking_opponents"]'::jsonb, '[]'::jsonb, 5),
  ('fifa_wc26_ksa_spain', 'Spain vs Saudi Arabia (World Cup)', 'fifa_ksa_match', '2026-06-21', 2, 0, 1, 2.6,
   '["match_day_offer","saudi_team_pride","green_falcons_support","watch_party_deal","goal_celebration_menu"]'::jsonb,
   '["gambling_references","alcohol_adjacent","mocking_opponents"]'::jsonb, '[]'::jsonb, 5),
  ('fifa_wc26_ksa_capeverde', 'Cape Verde vs Saudi Arabia (World Cup)', 'fifa_ksa_match', '2026-06-26', 2, 0, 1, 2.6,
   '["match_day_offer","saudi_team_pride","green_falcons_support","watch_party_deal","goal_celebration_menu"]'::jsonb,
   '["gambling_references","alcohol_adjacent","mocking_opponents"]'::jsonb, '[]'::jsonb, 5)
on conflict (event_key) do update set
  name=excluded.name, occasion_flag=excluded.occasion_flag, event_date=excluded.event_date,
  lead_days=excluded.lead_days, active_days=excluded.active_days, tail_days=excluded.tail_days,
  engagement_multiplier=excluded.engagement_multiplier, themes=excluded.themes,
  avoid=excluded.avoid, sectors=excluded.sectors, priority=excluded.priority, is_active=true;
