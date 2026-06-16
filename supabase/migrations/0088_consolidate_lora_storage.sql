-- Migration 0088 — Consolidate LoRA storage onto brand_profiles only
--
-- Problem: Two migrations created LoRA storage in two tables:
--   0077 → brand_profiles.lora_model_id, lora_trained_at, lora_training_status,
--            lora_approved_content_types, lora_training_photo_count
--   0086 → visual_style_profiles.lora_reference (a separate redundant pointer)
--
-- The spec (§6.3) is clear: LoRA reference belongs on brand_profiles because
-- it is brand-level metadata, not visual-style metadata. visual_style_profiles
-- stores visual grammar (colours, style descriptor). LoRA model training state
-- is a brand operational concern.
--
-- Fix: drop visual_style_profiles.lora_reference (added in 0086). The
-- authoritative pointer is brand_profiles.lora_model_id (from 0077).
-- Memory Controller ALLOWED_FIELD_PATHS is updated in packages/memory/src/types.ts
-- to map 'VisualStyleProfile.lora_reference' → null (removed) and add
-- 'BrandProfile.lora_model_id' instead.

begin;

alter table public.visual_style_profiles
  drop column if exists lora_reference;

-- Also remove the style_register enum clash: 0086 added it to visual_style_profiles
-- which is correct. Remove duplicate approved/rejected columns from visual_style_profiles
-- since 0077's asset_library table is the authoritative store for those.
-- The JSONB columns on visual_style_profiles are redundant with asset_library rows.
alter table public.visual_style_profiles
  drop column if exists approved_examples,
  drop column if exists rejected_examples;

-- Add lora_model_id to ALLOWED_FIELD_PATHS note (handled in TS, not SQL):
-- 'BrandProfile.lora_model_id': { table: 'brand_profiles', column: 'lora_model_id', enum: null }
-- 'BrandProfile.lora_training_status': { table: 'brand_profiles', column: 'lora_training_status',
--    enum: ['not_started','collecting_photos','training','ready','failed'] }

commit;
