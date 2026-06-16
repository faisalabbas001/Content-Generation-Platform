-- 0042_drop_negative_pattern_library.sql
--
-- Drops the legacy negative_pattern_library table.
-- Superseded by global_negative_patterns (migration 0041) which has the same
-- purpose but adds is_active, category, created_by, and updated_at columns,
-- plus a platform-wide unique constraint on lower(pattern_text).
--
-- Verified: zero application code references negative_pattern_library.

drop table if exists public.negative_pattern_library;
