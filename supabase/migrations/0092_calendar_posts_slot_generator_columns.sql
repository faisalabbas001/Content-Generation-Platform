-- Migration 0092 — Calendar slot generator columns
--
-- Adds fields required by POST /api/calendar/generate-slots (Phase 0 Spine-05).
-- The slot generator pre-populates calendar_posts with skeleton rows covering
-- a 3-month rolling window; downstream COO/V01 pipelines fill caption/image.
--
-- New columns:
--   scheduled_date       — date the post is planned (DATE, no TZ) — used instead
--                          of posting_time for calendar grid display (posting_time
--                          is set at publish time).
--   channel              — platform (Instagram | TikTok | Snapchat | Twitter),
--                          typed against the existing channel_type enum.
--   format               — slot format within platform (feed | reel | story | video
--                          | tweet | spotlight).
--   chain_id             — FK to chains.chain_id; null = COO picks at generation.
--   requires_human_review — true for religious-register content (spec §12.1).
--   strategic_rationale  — human-readable explanation of why this slot was
--                          scheduled (occasion context, content-mix logic).
--   occasion_flags       — array of active occasion_keys on this date.
--
-- All ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE public.calendar_posts
  ADD COLUMN IF NOT EXISTS scheduled_date        DATE,
  ADD COLUMN IF NOT EXISTS channel               channel_type,
  ADD COLUMN IF NOT EXISTS format                TEXT,
  ADD COLUMN IF NOT EXISTS chain_id              TEXT REFERENCES public.chains(chain_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requires_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS strategic_rationale   TEXT,
  ADD COLUMN IF NOT EXISTS occasion_flags        TEXT[] NOT NULL DEFAULT '{}';

-- Index: calendar grid lookups (brand + date range)
CREATE INDEX IF NOT EXISTS idx_calendar_posts_brand_date
  ON public.calendar_posts (brand_id, scheduled_date);

-- Index: pending slots awaiting COO generation
CREATE INDEX IF NOT EXISTS idx_calendar_posts_pending
  ON public.calendar_posts (brand_id, status, scheduled_date)
  WHERE status = 'pending';

COMMENT ON COLUMN public.calendar_posts.scheduled_date IS
  'Calendar grid date for this slot. Set at slot-generation time. posting_time is set at publish time.';
COMMENT ON COLUMN public.calendar_posts.channel IS
  'Target platform for this slot (Instagram | TikTok | Snapchat | Twitter).';
COMMENT ON COLUMN public.calendar_posts.format IS
  'Content format within the platform (feed | reel | story | video | tweet | spotlight).';
COMMENT ON COLUMN public.calendar_posts.chain_id IS
  'Creative chain to use at generation. NULL = COO selects at generation time.';
COMMENT ON COLUMN public.calendar_posts.requires_human_review IS
  'True for religious-register content (Quran, prayer, high-sensitivity occasions). Spec §12.1.';
COMMENT ON COLUMN public.calendar_posts.strategic_rationale IS
  'Human-readable rationale for why this slot was scheduled (occasion, content-mix logic).';
COMMENT ON COLUMN public.calendar_posts.occasion_flags IS
  'Active Saudi occasion keys on this scheduled_date (e.g. eid_al_fitr, national_day).';
