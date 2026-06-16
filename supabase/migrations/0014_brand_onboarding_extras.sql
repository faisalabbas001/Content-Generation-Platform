-- OpenClaw — 0014_brand_onboarding_extras
-- Adds the columns needed for the full N8N-A03 onboarding flow + creates the
-- public Storage bucket for brand assets (logos).
--
-- Why these columns:
--   instagram_handle / website_url / place_id  → inputs N8N-A03 needs to run
--                                                  Apify, fetch, and Google Places
--   primary_kpi_type                            → drives DeepSeek tone (Doc §6.2 Job 1)
--   tone_anti_attribute_ids                     → "what this brand must NEVER sound like"
--   audience_gender_mix                         → jsonb { female, male } (Doc §4.2)
--   onboarding_status / onboarding_started_at   → drives /processing UI state
--                                                  + N8N-A03 timeout handling
--
-- All new columns are nullable + RLS continues to work via the existing
-- Layer 1 isolation policy (brand_profiles is owner-scoped).

begin;

-- ── Add the missing columns ──────────────────────────────────────
alter table public.brand_profiles
  add column if not exists instagram_handle        text,
  add column if not exists website_url             text,
  add column if not exists place_id                text,
  add column if not exists primary_kpi_type        text
    check (primary_kpi_type is null or primary_kpi_type in ('engagement','conversion','awareness','trust')),
  add column if not exists tone_anti_attribute_ids text[] not null default '{}',
  add column if not exists audience_gender_mix     jsonb,
  add column if not exists onboarding_status       text not null default 'submitted'
    check (onboarding_status in ('submitted','scraping','dna_building','memory_writing','complete','failed','blocked')),
  add column if not exists onboarding_started_at   timestamptz,
  add column if not exists onboarding_completed_at timestamptz;

create index if not exists idx_brand_profiles_onboarding_status
  on public.brand_profiles (onboarding_status)
  where onboarding_status not in ('complete','failed');

-- ── Storage bucket for brand assets (logos) ─────────────────────
-- Public-read (logos are not sensitive), upload only via service-role from
-- the onboarding server action. RLS on storage.objects governs writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-assets', 'brand-assets', true, 2097152, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── Storage RLS — allow brand owners to read their own folder, ──
-- and service-role / brand owners to upload to their own folder.
drop policy if exists brand_assets_owner_read   on storage.objects;
drop policy if exists brand_assets_owner_write  on storage.objects;
drop policy if exists brand_assets_public_read  on storage.objects;

-- Public read for the whole bucket (logos can be embedded anywhere).
create policy brand_assets_public_read on storage.objects
  for select using (bucket_id = 'brand-assets');

-- Owner-write: a user can write to brand-assets/{brand_id}/* if they own
-- a brand_profiles row with that brand_id.
create policy brand_assets_owner_write on storage.objects
  for insert with check (
    bucket_id = 'brand-assets'
    AND (
      auth.role() = 'service_role'
      OR (auth.uid() is not null AND (
        (storage.foldername(name))[1] = 'temp'
        OR (storage.foldername(name))[1] in (
          select brand_id::text from public.brand_profiles where auth_user_id = auth.uid()
        )
      ))
    )
  );

-- Owner can also overwrite/delete their own logo (e.g. on re-upload).
drop policy if exists brand_assets_owner_update on storage.objects;
create policy brand_assets_owner_update on storage.objects
  for update using (
    bucket_id = 'brand-assets'
    AND (
      auth.role() = 'service_role'
      OR (auth.uid() is not null AND (storage.foldername(name))[1] in (
        select brand_id::text from public.brand_profiles where auth_user_id = auth.uid()
      ))
    )
  );

drop policy if exists brand_assets_owner_delete on storage.objects;
create policy brand_assets_owner_delete on storage.objects
  for delete using (
    bucket_id = 'brand-assets'
    AND (
      auth.role() = 'service_role'
      OR (auth.uid() is not null AND (storage.foldername(name))[1] in (
        select brand_id::text from public.brand_profiles where auth_user_id = auth.uid()
      ))
    )
  );

commit;
