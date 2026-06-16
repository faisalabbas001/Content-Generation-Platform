-- OpenClaw — 0033_post_images_bucket
-- Creates the `post-images` bucket used by packages/image/src/storage.ts to
-- store AI-generated calendar visuals.
--
-- WHY this is a separate migration from 0014:
--   0014 only created `brand-assets` (logos — public bucket).
--   `post-images` contains AI-generated brand content: private to each brand,
--   served via signed URLs, never publicly enumerable. Different security model.
--
-- Bucket layout (per Doc §3.3 Node 9):
--   post-images/
--   └── clients/{brand_id}/
--       └── calendars/{YYYY-MM}/
--           └── {post_id}.jpg
--
-- Access model:
--   - Write:  service_role only (n8n → packages/image → adminClient())
--   - Read:   brand owner can download their own posts (for ZIP export)
--             OR service_role (for admin + export-zip route)
--   - List:   brand owner scoped to their own folder only
--   - Public: FALSE — content is private brand IP, served via signed URLs
--
-- The export-zip route (/api/calendar/[id]/export-zip) already uses
-- adminClient() (service_role) for .download(), so it bypasses RLS and
-- continues to work unchanged.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  false,                              -- NOT public — brand-specific generated content
  10485760,                           -- 10 MB per image (generous for AI outputs)
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Drop any stale policies before recreating (idempotent).
drop policy if exists post_images_service_write  on storage.objects;
drop policy if exists post_images_owner_read     on storage.objects;
drop policy if exists post_images_service_read   on storage.objects;

-- Write: service_role only. n8n Visual chain uploads via adminClient().
-- No client-side uploads ever — Hard Rule #4 enforces server-only writes.
create policy post_images_service_write on storage.objects
  for insert with check (
    bucket_id = 'post-images'
    AND auth.role() = 'service_role'
  );

-- Update (upsert re-uploads): service_role only.
drop policy if exists post_images_service_update on storage.objects;
create policy post_images_service_update on storage.objects
  for update using (
    bucket_id = 'post-images'
    AND auth.role() = 'service_role'
  );

-- Read (SELECT / list / download via API): brand owner sees only their own
-- folder. Path structure: clients/{brand_id}/calendars/...
-- service_role bypasses RLS and always has full access.
create policy post_images_owner_read on storage.objects
  for select using (
    bucket_id = 'post-images'
    AND (
      auth.role() = 'service_role'
      OR (
        auth.uid() is not null
        -- path[1] = 'clients', path[2] = brand_id
        AND (storage.foldername(name))[2] in (
          select brand_id::text
          from public.brand_profiles
          where auth_user_id = auth.uid()
        )
      )
    )
  );

-- Delete: service_role only (PDPL cascade delete, admin tooling).
drop policy if exists post_images_service_delete on storage.objects;
create policy post_images_service_delete on storage.objects
  for delete using (
    bucket_id = 'post-images'
    AND auth.role() = 'service_role'
  );

commit;
