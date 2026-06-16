-- Migration 0080 — restore per-chain video models + real prompt templates
--
-- CONTEXT (TechDoc v1.0, Production Chain Library):
--   Each video chain has its OWN image-to-video model:
--     V01 Brand Story Video            → fal-ai/kling-video/v1.6/pro/image-to-video
--     V02 Beauty Before/After Video    → fal-ai/kling-video/v1.6/pro/image-to-video
--     V03 Product Interaction Video    → fal-ai/kling-video/v1.6/pro/image-to-video
--     V04 National Day Brand Video     → Seedance (image-to-video)
--     V05 Cinematic Reveal Video       → fal-ai/kling-video/v1.6/pro/image-to-video
--
-- WHAT 0076 DID (and why we adjust it here):
--   0076 collapsed EVERY output_type='video' chain to the SAME pair
--   (flux-pro/v1.1 + kling image-to-video). That made video runnable but threw
--   away the client's per-chain model assignment — V04's Seedance was lost.
--
-- WHAT THIS MIGRATION DOES:
--   1. fal_model_secondary holds each chain's REAL image-to-video (video) model.
--      The runtime (packages/image/src/fal-client.ts:generateFalVideoChain) treats
--      fal_model_secondary as the animator and builds a model-aware request body
--      (Kling vs Seedance). fal_model_primary stays as the keyframe model
--      (flux-pro/v1.1) used ONLY when no reference image is supplied.
--   2. V04 → Seedance image-to-video. NOTE: the TechDoc lists 'fal-ai/seedance-2.0',
--      but that endpoint is early-access/B2B-gated and NOT generally available on
--      fal.ai. We route to the GA endpoint 'fal-ai/bytedance/seedance/v1/pro/image-to-video'
--      (same model family, publicly reachable). Override per-brand via
--      chain_brand_overrides if a brand has Seedance 2.0 access.
--   3. Replace the stub prompt_templates ('V01'…'V05') with real, English-only
--      (Hard Rule #3) motion prompts that carry the {product_descriptor} placeholder.
--
-- SAFE: only touches V01–V05 rows. Re-runnable (UPDATE … WHERE). Image chains and
-- U06 are untouched. Durations were already snapped to 5 by 0077 (valid for both
-- Kling and Seedance).

-- ── V01 — Brand Story Video (Kling i2v) ──────────────────────────────────────
UPDATE chains
SET fal_model_secondary = 'fal-ai/kling-video/v1.6/pro/image-to-video',
    prompt_template = 'Cinematic brand story sequence featuring {product_descriptor}, slow smooth camera push-in, soft natural lighting, gentle ambient motion, premium lifestyle setting, shallow depth of field, photorealistic, no text, no watermark',
    notes = COALESCE(notes, '') || ' | 0080: V01 model=kling i2v + real template'
WHERE chain_id = 'V01';

-- ── V02 — Beauty Before/After Video (Kling i2v) ──────────────────────────────
UPDATE chains
SET fal_model_secondary = 'fal-ai/kling-video/v1.6/pro/image-to-video',
    prompt_template = 'Beauty transformation reveal of {product_descriptor}, smooth elegant transition, clean studio lighting, soft radiant glow, slow graceful camera motion, photorealistic, no text, no watermark',
    notes = COALESCE(notes, '') || ' | 0080: V02 model=kling i2v + real template'
WHERE chain_id = 'V02';

-- ── V03 — Product Interaction Hands Video (Kling i2v) ────────────────────────
UPDATE chains
SET fal_model_secondary = 'fal-ai/kling-video/v1.6/pro/image-to-video',
    prompt_template = 'Close-up of hands gently using {product_descriptor}, natural tactile motion, soft diffused light, shallow focus, authentic documentary feel, subtle handheld camera movement, photorealistic, no text, no watermark',
    notes = COALESCE(notes, '') || ' | 0080: V03 model=kling i2v + real template'
WHERE chain_id = 'V03';

-- ── V04 — National Day Brand Video (Seedance i2v, GA endpoint) ───────────────
UPDATE chains
SET fal_model_secondary = 'fal-ai/bytedance/seedance/v1/pro/image-to-video',
    prompt_template = 'Celebratory Saudi National Day brand moment featuring {product_descriptor}, slow cinematic motion, warm festive atmosphere, elegant flowing fabric and light, premium patriotic ambience, photorealistic, no text, no watermark',
    notes = COALESCE(notes, '') || ' | 0080: V04 model=seedance pro i2v (GA) + real template'
WHERE chain_id = 'V04';

-- ── V05 — Cinematic Reveal Video (Kling i2v) ─────────────────────────────────
UPDATE chains
SET fal_model_secondary = 'fal-ai/kling-video/v1.6/pro/image-to-video',
    prompt_template = 'Cinematic product reveal of {product_descriptor}, dramatic slow dolly motion, controlled lighting, elegant shadows, premium atmosphere, smooth focus pull, photorealistic, no text, no watermark',
    notes = COALESCE(notes, '') || ' | 0080: V05 model=kling i2v + real template'
WHERE chain_id = 'V05';

-- Ensure the keyframe-fallback model is a text-to-image model for these chains
-- (only relevant when no reference image is supplied). flux-pro/v1.1 from 0076 is
-- already correct; re-assert defensively without overwriting any later tuning.
UPDATE chains
SET fal_model_primary = 'fal-ai/flux-pro/v1.1'
WHERE chain_id IN ('V01', 'V02', 'V03', 'V04', 'V05')
  AND (fal_model_primary IS NULL OR fal_model_primary = 'fal-ai/kling-video/v1.6/pro' OR fal_model_primary = 'fal-ai/seedance-2.0');
