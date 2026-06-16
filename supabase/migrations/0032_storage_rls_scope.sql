-- OpenClaw — 0032_storage_rls_scope
-- Fix: narrow the brand-assets SELECT policy so it is scoped to each brand's
-- own folder instead of the whole bucket.
--
-- WHY:
--   Migration 0014 created a broad `for select using (bucket_id = 'brand-assets')`
--   policy with no path restriction. Supabase flags this as "clients can list ALL
--   files in this bucket" because any authenticated user can call
--   `.storage.from('brand-assets').list('')` and enumerate every brand's folder.
--
--   The bucket is already marked public=true, which means the Supabase CDN serves
--   every object at its public URL without auth — no SELECT policy is needed for
--   that. The SELECT policy is only used when the JS client calls .list() or
--   .download() over the REST API while authenticated.
--
-- CORRECT MODEL (per Doc §7.4 + Hard Rule #4):
--   - Public bucket  → CDN reads need no policy (Supabase handles this automatically)
--   - Authenticated .list() → a user should only list their OWN brand's folder
--   - service_role   → bypasses RLS entirely (no change needed)
--
-- Result: the Supabase dashboard warning disappears; logos remain publicly
-- accessible via their CDN URL; no enumeration of other brands is possible.

begin;

-- Drop the old unrestricted read policy from 0014.
drop policy if exists brand_assets_public_read   on storage.objects;
-- Also drop the legacy scoped read if it exists from an earlier attempt.
drop policy if exists brand_assets_owner_read    on storage.objects;

-- New policy: a user can SELECT (list/download via API) only objects inside
-- their own brand folder: brand-assets/{brand_id}/...
-- Public CDN reads (direct URL) are served by Supabase storage itself when
-- bucket.public = true — they bypass RLS entirely and need no policy here.
create policy brand_assets_owner_read on storage.objects
  for select using (
    bucket_id = 'brand-assets'
    AND (
      -- service_role bypasses RLS; this arm is for anon/authenticated callers.
      auth.role() = 'service_role'
      OR (
        auth.uid() is not null
        AND (storage.foldername(name))[1] in (
          select brand_id::text
          from public.brand_profiles
          where auth_user_id = auth.uid()
        )
      )
    )
  );

commit;
