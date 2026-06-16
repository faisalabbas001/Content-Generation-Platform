-- OpenClaw — 0014_calendar_posts_position_drop_old
-- Follow-up to 0009. The 0009 migration tried to drop the original
-- position-range check that 0001 created with `position between 1 and 20`,
-- but the regex used to find it matched the SQL source form. Postgres
-- stores the check as `("position" >= 1) AND ("position" <= 20)` after
-- parsing, so the regex missed it and both checks now coexist:
--   calendar_posts_position_check       — the OLD strict 1..20 (still active)
--   calendar_posts_position_range_chk   — the NEW 0..50 from 0009
--
-- The strict one shadows the new one (any insert with position=0 is rejected).
-- This migration drops the legacy constraint by exact name.

begin;

alter table public.calendar_posts
  drop constraint if exists calendar_posts_position_check;

commit;
