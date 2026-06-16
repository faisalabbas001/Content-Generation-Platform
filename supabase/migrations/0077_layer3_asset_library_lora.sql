-- Migration 0077: Layer 3 — Asset Library + LoRA Reference
-- Adds queryable asset_library table and lora_reference column
-- Aligned with OGZ spec §2.2 Layer 3

-- ── Asset library ──────────────────────────────────────────────────────────────

create table if not exists public.asset_library (
  asset_id       uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.brand_profiles(brand_id) on delete cascade,
  storage_url    text not null,                -- Supabase Storage URL (never CDN)
  file_name      text not null,
  mime_type      text not null,                -- 'image/jpeg' | 'image/png' | 'video/mp4' | 'application/pdf'
  file_size_bytes bigint,
  asset_type     text not null default 'brand_asset',
  -- asset_type values:
  --   'logo'          — brand logo file
  --   'product'       — product photography
  --   'location'      — space/store photos
  --   'team'          — team/founder photos
  --   'hero'          — hero product (onboarding upload)
  --   'brand_material'— PDFs, brand guidelines, etc.
  --   'approved_post' — client confirmed as representing their voice
  --   'rejected_post' — client rejected (stored for learning, not display)
  --   'brand_asset'   — generic upload

  -- Content classification
  is_approved    boolean,                      -- null=unclassified, true=approved example, false=rejected
  approved_at    timestamptz,
  rejected_at    timestamptz,
  rejection_reason text,

  -- Visual analysis (populated by extraction-prefill vision pass)
  dominant_colors   text[],                    -- hex codes extracted from image
  visual_style_tags text[],                    -- ['warm_lighting','outdoor','minimal','product_hero']
  detected_objects  text[],                    -- ['coffee_cup','hand','table']

  -- Layer 3 linkage
  used_in_posts     text[],                    -- calendar_post IDs that used this asset
  lora_training_candidate boolean default false, -- flagged for LoRA training

  -- Provenance
  source         text not null default 'client_upload',  -- 'client_upload' | 'extraction' | 'generated'
  uploaded_at    timestamptz not null default now(),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_asset_library_brand      on public.asset_library(brand_id);
create index if not exists idx_asset_library_type       on public.asset_library(brand_id, asset_type);
create index if not exists idx_asset_library_approved   on public.asset_library(brand_id, is_approved);
create index if not exists idx_asset_library_lora       on public.asset_library(brand_id, lora_training_candidate) where lora_training_candidate = true;

-- ── LoRA reference on brand_profiles ──────────────────────────────────────────

alter table public.brand_profiles
  add column if not exists lora_model_id          text,          -- fal.ai LoRA model ID when trained
  add column if not exists lora_trained_at        timestamptz,
  add column if not exists lora_training_status   text default 'not_started',
  -- 'not_started' | 'collecting_photos' | 'training' | 'ready' | 'failed'
  add column if not exists lora_approved_content_types text[],   -- content types owner approved LoRA for
  add column if not exists lora_training_photo_count int default 0;

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.asset_library enable row level security;

create policy "owner_rw_asset_library" on public.asset_library
  for all using (
    brand_id in (
      select brand_id from public.brand_profiles
      where auth_user_id = auth.uid()
    )
  );

create policy "service_role_all_asset_library" on public.asset_library
  for all using (auth.role() = 'service_role');

-- ── updated_at trigger ─────────────────────────────────────────────────────────

create trigger trg_asset_library_updated_at
  before update on public.asset_library
  for each row execute function public.set_updated_at();
