-- 0095_restore_archetype_secondary.sql
--
-- Migration 0081 dropped archetype_secondary from brand_profiles incorrectly.
-- The column IS used by:
--   - compile-caption-context/route.ts (reads for caption voice direction)
--   - COO Prompt v2 Pass 2 (axis inference nominates it)
--   - Memory Controller ALLOWED_FIELD_PATHS (5 whitelist entries)
--   - coo-to-nominations.ts (synthesises field_update + confidence_upgrade nominations)
--
-- Restore the column with the archetype_type enum.

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS archetype_secondary archetype_type NULL;

COMMENT ON COLUMN public.brand_profiles.archetype_secondary IS
  'Secondary Jungian archetype — inferred by COO Pass 2 from scraped content. Used by compile-caption-context for nuanced voice direction.';
