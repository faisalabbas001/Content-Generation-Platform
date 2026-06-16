-- 0078_qa_fk_and_indexes.sql
--
-- 1. Adds formal FK from qa_review_queue.post_id → calendar_posts(post_id).
--    Orphaned post_ids are nulled first to avoid constraint violations.
--    Uses DEFERRABLE INITIALLY DEFERRED + ON DELETE SET NULL so QA audit
--    history survives post deletion.
-- 2. Defaults qa_review_queue.cco_score to 0 and backfills existing NULLs.
--    Score 0 = "CCO did not run" — distinguishable in the UI from a real score.
-- 3. Adds operational indexes for video monitoring and QA admin queries.
-- Idempotent: FK guarded by DO block; indexes use IF NOT EXISTS.

BEGIN;

-- ── QA_REVIEW_QUEUE: add FK for post_id ──────────────────────────────────────

-- Step 1: Null out orphaned post_ids to avoid FK constraint violation on add.
UPDATE public.qa_review_queue q
SET    post_id = NULL
WHERE  q.post_id IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1 FROM public.calendar_posts cp
    WHERE  cp.post_id = q.post_id
  );

-- Step 2: Add the FK constraint (idempotent via DO block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE  constraint_name = 'qa_review_queue_post_id_fkey'
      AND  table_name      = 'qa_review_queue'
      AND  table_schema    = 'public'
  ) THEN
    ALTER TABLE public.qa_review_queue
      ADD CONSTRAINT qa_review_queue_post_id_fkey
      FOREIGN KEY (post_id)
      REFERENCES public.calendar_posts (post_id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

COMMENT ON COLUMN public.qa_review_queue.post_id IS
  'FK to calendar_posts(post_id). NULL for brand-level QA items (anomaly routing, '
  'blocked brands). SET NULL on post deletion to preserve audit history.';

-- ── QA_REVIEW_QUEUE: cco_score default ───────────────────────────────────────

ALTER TABLE public.qa_review_queue
  ALTER COLUMN cco_score SET DEFAULT 0;

UPDATE public.qa_review_queue
SET    cco_score = 0
WHERE  cco_score IS NULL;

-- ── OPERATIONAL INDEXES ───────────────────────────────────────────────────────

-- Admin "video jobs" panel: find all in-flight or failed video posts.
CREATE INDEX IF NOT EXISTS idx_calendar_posts_video_status
  ON public.calendar_posts (format_tier, video_status)
  WHERE format_tier = 'video';

-- Admin QA panel: find pending QA items per brand.
CREATE INDEX IF NOT EXISTS idx_qa_review_queue_brand_status
  ON public.qa_review_queue (brand_id, status)
  WHERE status = 'pending';

-- Log correlation: look up a calendar by its n8n execution ID.
CREATE INDEX IF NOT EXISTS idx_calendars_n8n_execution_id
  ON public.calendars (n8n_execution_id)
  WHERE n8n_execution_id IS NOT NULL;

COMMIT;
