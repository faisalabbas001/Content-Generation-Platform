-- Migration 0112: Chain template_mode + V05 model fix + F02 template fix
--
-- Root cause analysis (June 2026):
--   1. V05 had fal_model_primary = 'fal-ai/kling-video/v1.6/pro' (text-to-video direct)
--      and no fal_model_secondary. The two-stage pipeline (Flux keyframe → Kling i2v)
--      was never firing — every video post went direct to Kling with a text prompt,
--      which Kling handles poorly. Fix: primary = flux-pro (keyframe), secondary = kling i2v.
--
--   2. F02 prompt_template ended with "Appetizing beverage photography, condensation and
--      freshness detail…" — a competing SCENE description appended after {base_visual_brief}.
--      When a shawarma brief was slotted in, fal received two contradictory scenes.
--      Fix: F02 template keeps only style constraints after the brief slot.
--
--   3. The generate route used a fragile char-count heuristic (>= 200 chars = briefComplete)
--      to decide whether to trust DeepSeek's brief over the chain template. This breaks
--      when a short but complete brief comes through. Fix: add an explicit `template_mode`
--      column so each chain declares its relationship to the brief:
--        'scene'        — template is the full scene (used when no DeepSeek brief exists).
--        'style_wrapper'— template wraps {base_visual_brief} with style-only constraints;
--                         DeepSeek brief is always the scene authority.
--        'slot_fill'    — template uses {product_descriptor} etc.; brief used as fallback
--                         when slots cannot be filled.

-- ── 1. Add template_mode column ──────────────────────────────────────────────────
ALTER TABLE chains
  ADD COLUMN IF NOT EXISTS template_mode text NOT NULL DEFAULT 'scene'
    CHECK (template_mode IN ('scene', 'style_wrapper', 'slot_fill'));

COMMENT ON COLUMN chains.template_mode IS
  'scene: template is the full scene (no DeepSeek brief). '
  'style_wrapper: template wraps {base_visual_brief}; brief is always the scene authority. '
  'slot_fill: template uses {product_descriptor} etc.; brief is the fallback.';

-- ── 2. Mark all {base_visual_brief} chains as style_wrapper ──────────────────────
-- These chains slot the brief in and only add style/quality constraints around it.
-- The generate route should trust the brief and use the chain only for model routing
-- + the style suffix — never let the chain's own scene description override the brief.
UPDATE chains
SET template_mode = 'style_wrapper'
WHERE prompt_template LIKE '%{base_visual_brief}%';

-- ── 3. Mark slot-fill chains (product_descriptor / occasion_visual_motif etc.) ────
-- These were built for the old per-slot design. They are a scene fallback only;
-- when a DeepSeek brief is present it takes full authority.
UPDATE chains
SET template_mode = 'slot_fill'
WHERE template_mode = 'scene'
  AND (
    prompt_template LIKE '%{product_descriptor}%'
    OR prompt_template LIKE '%{occasion_visual_motif}%'
    OR prompt_template LIKE '%{beverage_descriptor}%'
    OR prompt_template LIKE '%{glass_style}%'
    OR prompt_template LIKE '%{food_descriptor}%'
    OR prompt_template LIKE '%{process_descriptor}%'
    OR prompt_template LIKE '%{setting_descriptor}%'
    OR prompt_template LIKE '%{brand_color}%'
  );

-- ── 4. Fix V05 — two-stage keyframe + animate pipeline ───────────────────────────
-- Before: fal_model_primary = 'fal-ai/kling-video/v1.6/pro' (direct text-to-video),
--         fal_model_secondary = NULL → submitPostVideoAsync had no i2v model and no
--         keyframe → every video post submitted a raw text prompt to Kling, which
--         is an image-to-video model and produces poor quality on text alone.
-- After: primary = Flux Pro (generates the keyframe still), secondary = Kling i2v
--         (animates that keyframe). Same two-stage pipeline as T47/T48/T49/V01-V04.
UPDATE chains
SET
  fal_model_primary   = 'fal-ai/flux-pro/v1.1',
  fal_model_secondary = 'fal-ai/kling-video/v1.6/pro/image-to-video',
  template_mode       = 'slot_fill'  -- V05 prompt_template = 'V05' (placeholder only)
WHERE chain_id = 'V05';

-- ── 5. Fix F02 template — remove competing scene description ─────────────────────
-- Before: '{base_visual_brief}. Appetizing beverage photography, condensation and
--          freshness detail, soft directional natural light…'
--          → fal received shawarma brief + "beverage photography, condensation" = wrong image.
-- After: brief is the scene; chain only appends neutral F&B quality constraints.
UPDATE chains
SET
  prompt_template = '{base_visual_brief}. Shot in appetizing F&B style, sharp focus, professional color grading, warm natural light, no text, no watermark, no hands.',
  template_mode   = 'style_wrapper'
WHERE chain_id = 'F02';

-- ── 6. Upgrade U05 fal model (was flux/dev, lowest quality) ─────────────────────
-- U05 is assigned to food posts. Its template is ignored for complete briefs anyway
-- (only the fal model matters). Upgrade to flux-pro/v1.1 to match other food chains.
UPDATE chains
SET fal_model_primary = 'fal-ai/flux-pro/v1.1'
WHERE chain_id = 'U05'
  AND fal_model_primary = 'fal-ai/flux/dev';

-- ── 7. Sanity-check: ensure no chain is left with template_mode still ambiguous ──
-- Any chain whose template is ONLY the chain_id string (like V05 was) is slot_fill.
UPDATE chains
SET template_mode = 'slot_fill'
WHERE template_mode = 'scene'
  AND prompt_template ~ '^[A-Z][0-9]{2}$';  -- e.g. 'V05', 'U04' bare chain-id strings
