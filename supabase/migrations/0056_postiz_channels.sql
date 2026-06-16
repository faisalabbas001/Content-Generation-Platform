-- 0036 — Postiz channel credential column on channel_profiles
--
-- Stores the Postiz channel ID returned after a brand owner connects
-- their Instagram account via the Postiz OAuth / onboarding flow.
-- Uses the existing (brand_id, channel) unique index from 0026 for upserts.

begin;

ALTER TABLE public.channel_profiles
  ADD COLUMN IF NOT EXISTS postiz_channel_id TEXT;

COMMENT ON COLUMN public.channel_profiles.postiz_channel_id IS
  'Postiz channel ID assigned after the brand owner completes the Postiz Instagram onboarding flow.';

CREATE INDEX IF NOT EXISTS idx_channel_profiles_postiz_channel_id
  ON public.channel_profiles (postiz_channel_id)
  WHERE postiz_channel_id IS NOT NULL;

commit;
