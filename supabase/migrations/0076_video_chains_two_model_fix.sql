-- Migration 0076 — make the video chains runnable by the two-model pipeline
--
-- WHY: packages/image/src/fal-client.ts:generateFalVideoChain() is a strict
-- TWO-model pipeline:
--     1. fal_model_primary    → generate a still keyframe (Flux)
--     2. upload keyframe to Fal storage
--     3. fal_model_secondary  → animate the keyframe (Kling image-to-video,
--        called with image_url = keyframe). fal_model_secondary is REQUIRED;
--        the request URL is `${FAL_QUEUE_BASE}/${fal_model_secondary}`.
--
-- The 0071 seed left every output_type='video' chain with fal_model_secondary
-- = NULL (U06's primary is Flux but no animator; V01–V05 even had Kling as the
-- *primary*, which would be fed to the keyframe step that expects images[]).
-- As seeded, NO video chain could run. This migration sets the same proven
-- model pair the image chains already use as their (vestigial) secondary:
--     primary   = fal-ai/flux-pro/v1.1                       (keyframe)
--     secondary = fal-ai/kling-video/v1.6/pro/image-to-video (animator)
--
-- SAFETY: only rows with output_type = 'video' are touched. Image generation
-- (output_type='image') is completely unaffected — those chains keep their
-- existing primary model and never enter the video branch.

UPDATE chains
SET
  fal_model_primary   = 'fal-ai/flux-pro/v1.1',
  fal_model_secondary = 'fal-ai/kling-video/v1.6/pro/image-to-video',
  notes               = 'img+vid two-model: fal-ai/flux-pro/v1.1 -> fal-ai/kling-video/v1.6/pro/image-to-video (0076 fix)'
WHERE output_type = 'video';
