-- Migration 0075 — media_type for video generation
--
-- Adds an explicit media_type discriminator so the on-demand pipeline can
-- generate VIDEO (Fal Flux keyframe → Kling animate) in addition to images,
-- without overloading the existing content_type enum (lifestyle | offer | …).
--
-- Design rule: every column defaults to 'image' so EVERY existing row and the
-- entire current image flow behaves exactly as before. Video is strictly
-- opt-in per request.
--
--   on_demand_requests.media_type — what the user asked for (set at submit time)
--   calendar_posts.media_type      — what was actually produced (set by n8n on insert)
--   calendar_posts.video_duration_s — clip length in seconds for video posts (NULL for images)
--
-- The generated artifact URL still lives in calendar_posts.storage_url; for
-- video that column holds the .mp4 URL (Supabase Storage only — Hard Rule #4).
-- clean_storage_url is NULL for video (no text-free variant — Hard Rule #3:
-- Arabic is never burned into video in v1).

ALTER TABLE on_demand_requests
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image';

ALTER TABLE calendar_posts
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image';

ALTER TABLE calendar_posts
  ADD COLUMN IF NOT EXISTS video_duration_s INTEGER DEFAULT NULL;

-- Constrain to the values the pipeline understands. Use NOT VALID-free guarded
-- adds so re-running the migration is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'on_demand_requests_media_type_chk'
  ) THEN
    ALTER TABLE on_demand_requests
      ADD CONSTRAINT on_demand_requests_media_type_chk
      CHECK (media_type IN ('image', 'video'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_posts_media_type_chk'
  ) THEN
    ALTER TABLE calendar_posts
      ADD CONSTRAINT calendar_posts_media_type_chk
      CHECK (media_type IN ('image', 'video'));
  END IF;
END $$;

COMMENT ON COLUMN on_demand_requests.media_type IS
  'Requested output medium: image (default) | video. Drives CEO video-chain selection and the V01 video branch.';
COMMENT ON COLUMN calendar_posts.media_type IS
  'Produced output medium: image (default) | video. The frontend renders <video> when video, <img> otherwise.';
COMMENT ON COLUMN calendar_posts.video_duration_s IS
  'Clip length in seconds for video posts (from the selected chain''s output_duration_s). NULL for images.';
