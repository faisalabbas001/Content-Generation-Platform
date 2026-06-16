-- Migration 0038 — Add intent_override to calendars table
--
-- Allows a client to set a per-calendar intent override (e.g. "this Ramadan
-- calendar = grow" instead of their brand default intent_state). The override
-- is read by N8N-A01 (batch) and N8N-A02 (on-demand) when building the CEO
-- brief — if set, it takes precedence over brand_profiles.intent_state for
-- posts generated under this calendar.
--
-- Intent values mirror intent_state_type enum (migration 0020):
--   'launch', 'grow', 'defend', 'harvest', 'recover'
-- Null = use brand default.

begin;

alter table public.calendars
  add column if not exists intent_override text
  check (intent_override in ('launch', 'grow', 'defend', 'harvest', 'recover'));

comment on column public.calendars.intent_override is
  'Per-calendar intent override. Null = use brand_profiles.intent_state. Values: launch|grow|defend|harvest|recover.';

commit;
