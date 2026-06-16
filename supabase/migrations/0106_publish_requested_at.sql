-- Explicit two-step publish: client Approve is a content decision; publishing is a
-- separate, deliberate click ("Publish now").
--
-- publish_status defaults to 'unscheduled' for EVERY post, so it can't distinguish
-- "approved, not yet asked to publish" from "publish in flight". This column is that
-- signal: NULL = client has not requested publishing yet (show the Publish button);
-- set = the client clicked Publish (publishPost ran, N8N-P01 fired) → show the live
-- publish-status badge instead.

ALTER TABLE public.calendar_posts
  ADD COLUMN IF NOT EXISTS publish_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN public.calendar_posts.publish_requested_at IS
  'When the client clicked "Publish" (explicit step after their own approval). '
  'NULL = not requested yet → show the Publish button; set = publishPost ran and '
  'N8N-P01 was fired → show the publish_status badge (unscheduled→scheduled→published).';
