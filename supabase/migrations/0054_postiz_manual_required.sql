-- Extend publish_status to include manual_required.
-- manual_required: posting_time had already passed at approval time — Postiz would
-- reject a scheduled post in the past. The agency must upload manually via Instagram.
-- Post status stays 'approved'; only publish_status reflects the manual path.
ALTER TABLE public.calendar_posts
  DROP CONSTRAINT IF EXISTS calendar_posts_publish_status_check;

ALTER TABLE public.calendar_posts
  ADD CONSTRAINT calendar_posts_publish_status_check
  CHECK (publish_status IN ('unscheduled', 'scheduled', 'published', 'failed', 'manual_required'));
