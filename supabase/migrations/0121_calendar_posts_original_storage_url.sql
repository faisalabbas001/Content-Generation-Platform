-- Migration 0121: Add original_storage_url to calendar_posts
-- Stores the very first A01/V01-generated image URL, written once, never overwritten.
-- Admin regen approvals update storage_url but must NEVER touch original_storage_url.
-- This allows the History tab to always show the true original alongside all regens.

ALTER TABLE calendar_posts
  ADD COLUMN IF NOT EXISTS original_storage_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS original_clean_storage_url text DEFAULT NULL;

-- Back-fill: for posts that have no regen (admin_regenerations) approved yet,
-- original = current storage_url. For posts that already had a regen approved
-- we can't recover the original — leave NULL (UI will show a "not available" placeholder).
-- The correct URL going forward will be set by V01/image-generate at generation time.
UPDATE calendar_posts
SET original_storage_url = storage_url,
    original_clean_storage_url = clean_storage_url
WHERE original_storage_url IS NULL
  AND storage_url IS NOT NULL;
