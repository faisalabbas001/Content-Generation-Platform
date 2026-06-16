-- Migration 0122: Trigger to auto-populate original_storage_url on first image write
-- Fires on UPDATE of storage_url — if original_storage_url is still NULL, copies
-- the new storage_url into it. This means whoever first sets storage_url (n8n V01,
-- video-callback webhook) automatically preserves the original, with zero code changes
-- needed in n8n flows or Next.js routes.

CREATE OR REPLACE FUNCTION fn_preserve_original_storage_url()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only act when storage_url is being set for the first time
  IF NEW.storage_url IS NOT NULL AND OLD.original_storage_url IS NULL THEN
    NEW.original_storage_url := NEW.storage_url;
    NEW.original_clean_storage_url := NEW.clean_storage_url;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_original_storage_url ON calendar_posts;

CREATE TRIGGER trg_preserve_original_storage_url
  BEFORE UPDATE OF storage_url ON calendar_posts
  FOR EACH ROW
  EXECUTE FUNCTION fn_preserve_original_storage_url();
