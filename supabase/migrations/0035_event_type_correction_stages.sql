-- 0035 — Add correction pipeline stage values to event_type_enum.
--
-- The A04 brand-correction flow emits real-time progress events into
-- branddna_event_log so the UI can show live step labels while the
-- pipeline runs. These event_type values are inserted by /api/correction/stage.
--
-- ALTER TYPE … ADD VALUE cannot run inside a transaction block in Postgres,
-- so each statement is outside of begin/commit.

alter type public.event_type_enum add value if not exists 'correction_progress_correction_received';
alter type public.event_type_enum add value if not exists 'correction_progress_ceo_classifying';
alter type public.event_type_enum add value if not exists 'correction_progress_ceo_approved';
alter type public.event_type_enum add value if not exists 'correction_progress_memory_writing';
alter type public.event_type_enum add value if not exists 'correction_progress_correction_applied';
alter type public.event_type_enum add value if not exists 'correction_progress_correction_rejected';
