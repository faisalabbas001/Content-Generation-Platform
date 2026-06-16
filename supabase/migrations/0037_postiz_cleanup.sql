-- 0037 — Postiz cleanup: rename ig_media_id → postiz_post_id, drop legacy Meta columns
--
-- Context:
--   0025_postiz_tracking.sql was applied when the column was still named ig_media_id
--   (Meta Graph API era). After pivoting to Postiz, the migration file was updated but
--   the DB never received the rename. N8N-P01 writes postiz_post_id — this makes the
--   live column name match what the code expects.
--
--   channel_profiles had ig_business_account_id / ig_access_token / ig_token_expires_at
--   added directly via Supabase SQL editor (not tracked in any migration file). These are
--   unused after the Postiz pivot and are dropped here.

begin;

-- ── calendar_posts: rename column ──────────────────────────────────────────────
ALTER TABLE public.calendar_posts
  RENAME COLUMN ig_media_id TO postiz_post_id;

-- ── channel_profiles: drop legacy Meta credentials ─────────────────────────────
ALTER TABLE public.channel_profiles
  DROP COLUMN IF EXISTS ig_business_account_id,
  DROP COLUMN IF EXISTS ig_access_token,
  DROP COLUMN IF EXISTS ig_token_expires_at;

commit;
