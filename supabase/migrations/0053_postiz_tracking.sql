-- Postiz publishing state for approved social posts.
-- Keeps OAuth/token ownership in Postiz while OpenClaw tracks linkage + lifecycle.
ALTER TABLE public.calendar_posts
  ADD COLUMN IF NOT EXISTS postiz_post_id TEXT,
  ADD COLUMN IF NOT EXISTS publish_status TEXT DEFAULT 'unscheduled',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

UPDATE public.calendar_posts
SET publish_status = 'unscheduled'
WHERE publish_status IS NULL;

ALTER TABLE public.calendar_posts
  ALTER COLUMN publish_status SET DEFAULT 'unscheduled',
  ALTER COLUMN publish_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'calendar_posts_publish_status_check'
  ) THEN
    ALTER TABLE public.calendar_posts
      ADD CONSTRAINT calendar_posts_publish_status_check
      CHECK (publish_status IN ('unscheduled', 'scheduled', 'published', 'failed'));
  END IF;
END $$;

ALTER TABLE public.channel_profiles
  ADD COLUMN IF NOT EXISTS postiz_channel_id TEXT;

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS postiz_workspace_id TEXT;

CREATE INDEX IF NOT EXISTS idx_calendar_posts_publish_status_time
  ON public.calendar_posts (publish_status, posting_time)
  WHERE publish_status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_channel_profiles_postiz_channel_id
  ON public.channel_profiles (postiz_channel_id)
  WHERE postiz_channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brand_profiles_postiz_workspace_id
  ON public.brand_profiles (postiz_workspace_id)
  WHERE postiz_workspace_id IS NOT NULL;
