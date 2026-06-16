-- Migration 0079 — replace FLUX Kontext primary models with a text-to-image model
--
-- ROOT CAUSE: 0071 seeded 16+ chains (T13, etc.) with
--   fal_model_primary = 'fal-ai/flux-pro/kontext'
-- FLUX Kontext is an IMAGE-EDITING model — it REQUIRES an input image_url and
-- cannot do text-to-image generation. For prompt-only on-demand posts (no
-- reference image) fal.ai rejects the request → "fal.ai result fetch failed (422)".
--
-- For IMAGE chains: kontext is the generation model → must be text-to-image.
-- For VIDEO chains: kontext is the keyframe (step 1) model → also must be
-- text-to-image (the keyframe is generated from the prompt, then Kling animates it).
--
-- The application code (packages/image/src/fal-client.ts toTextToImageModel) also
-- guards this at runtime, so generation works even without this migration — but
-- this keeps the DB data correct and self-documenting.
--
-- Safe to re-run — UPDATE with WHERE, no inserts/deletes.

UPDATE chains
SET
  fal_model_primary = 'fal-ai/flux-pro/v1.1',
  notes = COALESCE(notes, '') || ' | 0079: kontext primary replaced with flux-pro/v1.1 (text-to-image)'
WHERE fal_model_primary = 'fal-ai/flux-pro/kontext';
