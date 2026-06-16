-- Migration 0102: Drop the redundant qa_review_queue.hold_reason column.
--
-- 0101 added qa_review_queue.hold_reason, but investigation showed nothing reads it:
--   - The Admin UI renders the QA reason from `trigger_reason` (TriggerReasonBadges).
--   - The Production Copilot scans the pre-existing `held_reason` column (migration 0046,
--     `held_reason ilike 'cco_%'`, indexed).
-- So `hold_reason` on this table is dead weight. The N8N-V01-Worker now writes
-- `held_reason` + `trigger_reason` instead. Drop the unused column.
--
-- NOTE: this only affects qa_review_queue. calendar_posts.hold_reason is the canonical
-- per-post reason column there and is intentionally KEPT.

alter table public.qa_review_queue
  drop column if exists hold_reason;
