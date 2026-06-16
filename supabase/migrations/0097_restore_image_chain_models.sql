-- Migration 0097 — restore Tier 1 image chains to correct models
--
-- ROOT CAUSE: 0071_chains_v2_real_seed.sql set fal_model_secondary =
-- 'fal-ai/kling-video/v1.6/pro/image-to-video' on ALL 88 chains, including the
-- 21 static-image chains (U01–U06, F01–F05, B01–B05, R01–R05). output_type was
-- left as 'image' so n8n routing is unaffected, but the admin UI flags every
-- chain as video via: output_type='video' || fal_model_secondary != null.
--
-- SECONDARY: 0079_fix_kontext_primary_model.sql replaced kontext with
-- flux-pro/v1.1 for ALL chains including F05, B01, B03 which intentionally
-- use kontext (reference-image editing model, requires image_url input).
--
-- SAFE: UPDATE … WHERE chain_id IN (…). Re-runnable. No inserts, no deletes.
-- V01–V05 are only touched for requires_ref_img; their models are already
-- correct from migrations 0074→0076→0077→0080.

-- ── Add requires_ref_img column ─────────────────────────────────────────────
ALTER TABLE chains ADD COLUMN IF NOT EXISTS requires_ref_img BOOLEAN NOT NULL DEFAULT false;

-- ── Step A: clear secondary model + assert output_type for plain image chains ─
UPDATE chains
SET
  output_type         = 'image',
  fal_model_secondary = NULL,
  requires_ref_img    = false,
  updated_at          = now()
WHERE chain_id IN (
  'U01','U02','U03','U04','U05','U06',
  'F01','F02','F03','F04',
  'B02','B04','B05',
  'R01','R02','R03','R04'
);

-- ── Step B: correct primary models per Production Chain Library v1.0 ─────────
-- flux/dev chains
UPDATE chains SET fal_model_primary = 'fal-ai/flux/dev', updated_at = now()
WHERE chain_id IN ('U01','U03','U04','U05','F01','F02','B02','B04','R01');

-- gpt-image-2 chains (Arabic text compositionally integrated, no overlay)
UPDATE chains SET fal_model_primary = 'fal-ai/gpt-image-2', updated_at = now()
WHERE chain_id IN ('U02','F04','R03');

-- flux-pro/v1.1 chains
UPDATE chains SET fal_model_primary = 'fal-ai/flux-pro/v1.1', updated_at = now()
WHERE chain_id IN ('U06','F03','B05','R02','R04');

-- flux-pro/v1.1-ultra (R05 Fragrance/Oud — premium visual quality)
UPDATE chains SET fal_model_primary = 'fal-ai/flux-pro/v1.1-ultra', updated_at = now()
WHERE chain_id = 'R05';

-- ── Step C: reference-image chains (Kontext, requires image_url) ─────────────
-- Restores F05 (Cloud Kitchen Packaging), B01 (Before/After Service), B03
-- (Product Flat Lay) which were incorrectly overwritten by 0079.
UPDATE chains
SET
  output_type         = 'image',
  fal_model_primary   = 'fal-ai/flux-pro/kontext',
  fal_model_secondary = NULL,
  requires_ref_img    = true,
  updated_at          = now()
WHERE chain_id IN ('F05','B01','B03');

-- R05 uses ultra model but requires a reference product image for oud/fragrance
UPDATE chains
SET requires_ref_img = true, updated_at = now()
WHERE chain_id = 'R05';

-- ── Step D: assert video chains carry requires_ref_img (i2v needs a keyframe) ─
UPDATE chains
SET requires_ref_img = true, updated_at = now()
WHERE chain_id IN ('V01','V02','V03','V04','V05');
