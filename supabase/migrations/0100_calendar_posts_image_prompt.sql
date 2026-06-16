-- Migration 0100: Add image_prompt_en to calendar_posts
--
-- Stores the final English fal.ai image prompt that was used to generate
-- this post's visual. Previously this lived only in memory during the pipeline.
-- Persisting it allows:
--   - Admins to audit what prompt produced a given image
--   - Chain matcher to reference prompt history for approval rate learning
--   - Future regeneration of the same image with the same prompt
--   - Calendar page to display/edit the prompt before image generation
--
-- chain_id already exists in calendar_posts (migration 0092).
-- This migration only adds image_prompt_en.

ALTER TABLE calendar_posts
  ADD COLUMN IF NOT EXISTS image_prompt_en TEXT;

COMMENT ON COLUMN calendar_posts.image_prompt_en IS
  'Final English fal.ai image prompt used to generate this post visual. '
  'Written by DeepSeek during caption generation. Stored for audit, '
  'regeneration, and chain approval rate learning.';
