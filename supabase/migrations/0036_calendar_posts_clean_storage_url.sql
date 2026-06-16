-- OpenClaw — 0036_calendar_posts_clean_storage_url
--
-- Adds calendar_posts.clean_storage_url — the Supabase Storage URL of the
-- pre-overlay (no Arabic text) version of the generated image. The existing
-- storage_url column continues to hold the public-facing version with the
-- Arabic typography overlay applied.
--
-- Why a separate column instead of deriving by path convention:
--   Explicitly tracking NULL lets the UI distinguish "no clean version
--   exists" (older posts created before this migration) from "should exist
--   but storage is missing". It also keeps admin tooling/reporting honest.
--
-- Hard Rule #4 still holds: only Supabase Storage URLs are persisted. The
-- pre-overlay buffer is uploaded inside the same generation pipeline and
-- this column receives that uploaded URL only.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

alter table public.calendar_posts
  add column if not exists clean_storage_url text;

comment on column public.calendar_posts.clean_storage_url is
  'Supabase Storage URL of the pre-overlay (no Arabic text) image variant. '
  'NULL = no clean version exists (legacy post created before migration 0036).';
