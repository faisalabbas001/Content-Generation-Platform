-- Add format_tier to calendar_posts to track image vs video per post.
-- Set by CEO classify route based on selected chain output_type.
ALTER TABLE calendar_posts
  ADD COLUMN IF NOT EXISTS format_tier TEXT NOT NULL DEFAULT 'image'
    CHECK (format_tier IN ('image', 'video'));

COMMENT ON COLUMN calendar_posts.format_tier IS
  'image = standard static post; video = async video post generated via fal.ai queue.';

-- Add async video tracking columns to usage_logs for fal.ai request correlation.
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS fal_request_id TEXT,
  ADD COLUMN IF NOT EXISTS post_id        UUID REFERENCES calendar_posts(post_id) ON DELETE SET NULL;

COMMENT ON COLUMN usage_logs.fal_request_id IS 'fal.ai async queue request ID for video generation jobs.';
COMMENT ON COLUMN usage_logs.post_id        IS 'Link from usage_log entry back to the calendar_post being generated.';
