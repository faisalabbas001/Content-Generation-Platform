-- ─────────────────────────────────────────────────────────────────────────────
-- 0022_notifications_hardening.sql
--
-- Post-launch hardening for the notification system:
--   1. Foreign-key constraints (orphan rows are no longer possible)
--   2. Improved indexes (cover ORDER BY clauses + queued poller)
--   3. Brand rename: "OpenClaw" → "OGz Studios" in seeded HTML templates
--   4. Retry tracking column for failed Resend sends
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Foreign keys ───────────────────────────────────────────────────────────
-- Orphan notifications referencing deleted brands/users are now impossible.
-- Posts and calendars use SET NULL so a notification can survive their deletion
-- (the rendered_* content is the user-facing payload — context links are optional).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_notifications_brand') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT fk_notifications_brand
        FOREIGN KEY (brand_id) REFERENCES public.brand_profiles(brand_id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_notifications_user') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT fk_notifications_user
        FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_notifications_post') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT fk_notifications_post
        FOREIGN KEY (post_id) REFERENCES public.calendar_posts(post_id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_notifications_cal') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT fk_notifications_cal
        FOREIGN KEY (calendar_id) REFERENCES public.calendars(calendar_id) ON DELETE SET NULL;
  END IF;
END $$;


-- ── 2. Improved indexes ───────────────────────────────────────────────────────
-- The inbox query is `WHERE auth_user_id = ? AND read_at IS NULL ORDER BY created_at DESC`.
-- The old index covered the filter but Postgres still had to sort. The new
-- composite covers both.

DROP INDEX IF EXISTS idx_notifications_unread;
CREATE INDEX idx_notifications_unread
  ON public.notifications (auth_user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Retry poller picks oldest queued first. Old index didn't help with ORDER BY.
DROP INDEX IF EXISTS idx_notifications_queued;
CREATE INDEX idx_notifications_queued
  ON public.notifications (created_at)
  WHERE resend_status = 'queued';


-- ── 3. Retry tracking column ──────────────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS retry_count SMALLINT NOT NULL DEFAULT 0;


-- ── 4. Brand rename in seeded templates ───────────────────────────────────────
-- Templates seeded in 0021 hard-coded "OpenClaw" as the email header brand.
-- This single statement covers all 6 templates × 1 language (en is not seeded yet).

UPDATE public.notification_templates
SET    body_html = REPLACE(body_html, '>OpenClaw<', '>OGz Studios<'),
       updated_at = NOW()
WHERE  body_html LIKE '%>OpenClaw<%';
