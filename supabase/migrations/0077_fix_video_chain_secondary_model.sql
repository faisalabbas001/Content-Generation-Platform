-- Migration 0077 — fix video chain secondary model + duration values
--
-- FIX 1: fal_model_secondary was 'fal-ai/kling-video/v1.6/pro' (text-to-video).
-- Correct value: 'fal-ai/kling-video/v1.6/pro/image-to-video' (image-to-video).
-- Wrong model caused response_url 404 because text-to-video has a different result format.
--
-- FIX 2: output_duration_s was 7 for some chains (e.g. V05).
-- Kling image-to-video ONLY accepts duration = 5 or 10.
-- Any other value causes a 422 validation error: "Input should be '5' or '10'".
-- Snap all video chain durations to 5 (the shorter, lower-cost option).
--
-- Safe to re-run — uses UPDATE with WHERE, never inserts or deletes.

-- Fix 1: correct secondary model for image-to-video
UPDATE chains
SET
  fal_model_secondary = 'fal-ai/kling-video/v1.6/pro/image-to-video',
  notes = COALESCE(notes, '') || ' | 0077: secondary corrected to image-to-video'
WHERE
  output_type = 'video'
  AND (
    fal_model_secondary IS NULL
    OR fal_model_secondary = 'fal-ai/kling-video/v1.6/pro'
  );

-- Fix 2: snap invalid durations to 5 (Kling only accepts 5 or 10)
UPDATE chains
SET
  output_duration_s = 5,
  notes = COALESCE(notes, '') || ' | 0077: duration snapped to 5 (Kling accepts 5 or 10 only)'
WHERE
  output_type = 'video'
  AND output_duration_s IS NOT NULL
  AND output_duration_s NOT IN (5, 10);
