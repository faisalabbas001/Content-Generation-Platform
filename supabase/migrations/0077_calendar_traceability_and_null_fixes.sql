-- 0077_calendar_traceability_and_null_fixes.sql
--
-- Adds traceability columns to calendars (generated_at, n8n_execution_id,
-- workflow_trigger, regeneration_count, review_required).
-- Adds video tracking columns to calendar_posts (video_status, generation_attempt,
-- last_error). The video_status column has been referenced in the N8N-A01
-- "Insert Video Placeholder" node since the flow was written but was never created
-- in Postgres — Supabase was silently discarding it on every insert.
-- Backfills existing null storage_url rows on failed video posts.
-- Idempotent: all ADD COLUMN statements use IF NOT EXISTS.
-- RLS policies are NOT modified.

BEGIN;

-- ── CALENDARS: traceability ───────────────────────────────────────────────────

ALTER TABLE public.calendars
  ADD COLUMN IF NOT EXISTS generated_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS n8n_execution_id   TEXT,
  ADD COLUMN IF NOT EXISTS workflow_trigger   TEXT
    CHECK (workflow_trigger IS NULL OR workflow_trigger IN
           ('cron_monthly', 'cron_weekly', 'webhook_manual', 'manual')),
  ADD COLUMN IF NOT EXISTS regeneration_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_required    BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.calendars.generated_at IS
  'Timestamp when n8n brand_complete fires (generation finished, posts exist). '
  'NULL for rows created before this migration; backfilled from delivered_at below.';
COMMENT ON COLUMN public.calendars.n8n_execution_id IS
  'n8n $execution.id for the A01 run that produced this calendar. '
  'Enables log correlation between n8n cloud and Supabase.';
COMMENT ON COLUMN public.calendars.workflow_trigger IS
  'How the calendar run was initiated: cron_monthly, cron_weekly, webhook_manual, manual.';
COMMENT ON COLUMN public.calendars.regeneration_count IS
  'Number of times this calendar has been regenerated (0 = first run).';
COMMENT ON COLUMN public.calendars.review_required IS
  'True when any post was HOLD-routed during generation — admin must review before delivery.';

-- Backfill generated_at from delivered_at for already-completed calendars.
-- delivered_at is the best available approximation for pre-migration rows.
UPDATE public.calendars
SET    generated_at = delivered_at
WHERE  generated_at IS NULL
  AND  delivered_at IS NOT NULL;

-- ── CALENDAR_POSTS: video tracking + retry ────────────────────────────────────

ALTER TABLE public.calendar_posts
  ADD COLUMN IF NOT EXISTS video_status       TEXT
    CHECK (video_status IS NULL OR video_status IN ('processing', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS generation_attempt INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error         TEXT;

COMMENT ON COLUMN public.calendar_posts.video_status IS
  'For video posts: processing while fal.ai async job is in-flight, '
  'completed on success, failed on FAILED webhook. NULL for image posts.';
COMMENT ON COLUMN public.calendar_posts.generation_attempt IS
  'Number of times generation has been attempted for this post. '
  '0 = not yet attempted, 1 = first try, 2+ = retried.';
COMMENT ON COLUMN public.calendar_posts.last_error IS
  'Last error message from a failed generation or webhook callback. '
  'Cleared (set to NULL) on successful regeneration.';

-- Backfill video posts that failed: storage_url is NULL, format_tier='video',
-- status='draft'. These were left in a broken state by the incomplete FAILED
-- webhook path that previously did not set storage_url.
UPDATE public.calendar_posts
SET    storage_url     = 'https://app.openclaw.com/assets/visual-placeholder.png',
       video_status    = 'failed',
       last_error      = 'video_generation_failed_no_url'
WHERE  format_tier     = 'video'
  AND  status          = 'draft'
  AND  storage_url     IS NULL;

-- Backfill in-flight video posts (processing state): storage_url NULL, status='generated'.
UPDATE public.calendar_posts
SET    video_status = 'processing'
WHERE  format_tier  = 'video'
  AND  video_status IS NULL
  AND  storage_url  IS NULL;

-- Backfill completed video posts (real Supabase URL present, not placeholder).
UPDATE public.calendar_posts
SET    video_status = 'completed'
WHERE  format_tier  = 'video'
  AND  video_status IS NULL
  AND  storage_url  IS NOT NULL
  AND  storage_url  NOT LIKE '%visual-placeholder%';

COMMIT;
