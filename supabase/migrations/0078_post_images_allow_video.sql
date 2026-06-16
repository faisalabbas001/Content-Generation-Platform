-- Migration 0078 — allow video/mp4 in the post-images bucket
--
-- ROOT CAUSE: The post-images bucket (migration 0033) was created with
--   allowed_mime_types = ['image/jpeg', 'image/png', 'image/webp']
--   file_size_limit    = 10 MB
--
-- The two-model video pipeline (Flux keyframe → Kling animate) now produces
-- video/mp4 artifacts and uploads them via uploadPostImage(). Supabase Storage
-- rejects the upload:
--   "Supabase Storage upload failed: mime type video/mp4 is not supported"
--
-- This migration:
--   1. Adds video/mp4 (and video/quicktime for completeness) to allowed types.
--   2. Raises file_size_limit to 100 MB — a 5-10s 1080p Kling clip can exceed
--      10 MB. 100 MB is generous headroom for short social video.
--
-- SAFE: only touches the post-images bucket row. RLS policies from 0033 are
-- unchanged (service_role-only write still applies). Re-runnable.

UPDATE storage.buckets
SET
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime'
  ],
  file_size_limit = 104857600  -- 100 MB
WHERE id = 'post-images';
