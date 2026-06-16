-- Add updated_at timestamp and revision_history JSONB to calendar_posts.
-- updated_at: tracks last B03 write; defaults to created_at for existing rows.
-- revision_history: append-only audit trail of every revision; defaults to [].
ALTER TABLE public.calendar_posts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS revision_history JSONB NOT NULL DEFAULT '[]'::jsonb;
