-- Add revision_count to calendar_posts so the UI can enforce the 3-revision cap.
-- Default 0 keeps all existing rows valid without a data migration.
ALTER TABLE public.calendar_posts
  ADD COLUMN IF NOT EXISTS revision_count INT NOT NULL DEFAULT 0;
