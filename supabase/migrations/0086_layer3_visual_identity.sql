-- Migration 0086 — Layer 3 Visual Identity: style_register + lora_reference
--
-- Spec §2.2 Layer 3 requires:
--   • style_register — the visual register (Traditional/Modern/Youth/Mixed)
--   • lora_reference — pointer to the brand's trained LoRA model (Phase 2+)
--   • approved_content_examples — URLs/IDs of confirmed on-brand content
--   • rejected_content_examples — URLs/IDs of rejected content with reason
--
-- visual_style_profiles already has color_palette and style_descriptor but
-- is missing the structured style_register enum and the LoRA pointer.
-- approved/rejected examples are stored as JSONB arrays for flexibility.

begin;

-- Style register enum (spec §2.2 Layer 3 "visual register")
do $$ begin
  create type style_register_type as enum (
    'traditional',
    'modern',
    'youth',
    'mixed'
  );
exception when duplicate_object then null; end $$;

-- Add columns to visual_style_profiles
alter table public.visual_style_profiles
  add column if not exists style_register     style_register_type,
  add column if not exists lora_reference     text,           -- e.g. "replicate://user/model:version"
  add column if not exists approved_examples  jsonb default '[]'::jsonb,  -- [{"url":"...", "type":"product", "confirmed_at":"..."}]
  add column if not exists rejected_examples  jsonb default '[]'::jsonb;  -- [{"url":"...", "reason":"...", "rejected_at":"..."}]

comment on column public.visual_style_profiles.style_register is
  'Visual register: traditional | modern | youth | mixed — determines image composition and colour temperature guidance.';
comment on column public.visual_style_profiles.lora_reference is
  'Pointer to brand LoRA model (Phase 2+). Format: "replicate://user/model:version" or fal.ai equivalent.';
comment on column public.visual_style_profiles.approved_examples is
  'Array of confirmed on-brand content examples: [{url, type, source, confirmed_at}]. Used for composition matrix reference images.';
comment on column public.visual_style_profiles.rejected_examples is
  'Array of rejected content with reasons: [{url, reason, rejected_at}]. Feeds into negative_patterns for visual layer.';

-- Add style_register to Memory Controller whitelist (types.ts handles TS side;
-- this comment documents the required ALLOWED_FIELD_PATHS entry):
-- 'VisualStyleProfile.style_register': { table: 'visual_style_profiles', column: 'style_register', enum: ['traditional','modern','youth','mixed'] }
-- 'VisualStyleProfile.lora_reference': { table: 'visual_style_profiles', column: 'lora_reference', enum: null }

commit;
