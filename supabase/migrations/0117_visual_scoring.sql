-- 0117_visual_scoring.sql
--
-- Adds visual scoring columns so the composite confidence formula can store
-- the image pillar score separately from the caption pillar score.
--
-- Columns:
--   calendar_posts.visual_score        FLOAT   0-100 from CCO vision pass (NULL = not yet scored)
--   calendar_posts.visual_issues       JSONB   array of {code, label, severity} objects
--   qa_review_queue.visual_score       FLOAT   mirrored onto the QA row for admin surface
--   qa_review_queue.visual_issues      JSONB   mirrored visual issues array

-- ── calendar_posts ─────────────────────────────────────────────────────────
ALTER TABLE calendar_posts
  ADD COLUMN IF NOT EXISTS visual_score   FLOAT   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS visual_issues  JSONB   DEFAULT '[]'::jsonb;

COMMENT ON COLUMN calendar_posts.visual_score  IS
  'GPT-4o vision score (0-100) for the generated image. NULL until the visual QC pass runs after fal.ai returns. Hard block violations floor this to 0.';

COMMENT ON COLUMN calendar_posts.visual_issues IS
  'Array of {code, label, severity} objects flagged by the visual QC pass. Empty array = clean.';

-- ── qa_review_queue ─────────────────────────────────────────────────────────
ALTER TABLE qa_review_queue
  ADD COLUMN IF NOT EXISTS visual_score   FLOAT   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS visual_issues  JSONB   DEFAULT '[]'::jsonb;

COMMENT ON COLUMN qa_review_queue.visual_score  IS
  'Mirrored from calendar_posts.visual_score when the QA row is created.';

COMMENT ON COLUMN qa_review_queue.visual_issues IS
  'Mirrored from calendar_posts.visual_issues when the QA row is created.';
