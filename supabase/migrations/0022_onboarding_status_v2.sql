-- Migration 0022 — Extend brand_profiles.onboarding_status check constraint
--
-- The v2 onboarding flow (Section 1 → A06 background extraction → Section 2/3
-- → A03 main pipeline) introduces three new states that don't exist in the
-- v1 constraint:
--
--   • 'extraction_pending'      — Section 1 submitted, A06 acked but not yet
--                                 finished scraping. Section 2 polls until
--                                 this flips to extraction_done.
--   • 'extraction_done'         — A06 finished, source_records populated,
--                                 user is filling Section 2.
--   • 'extraction_unavailable'  — A06 was unreachable (network / config).
--                                 User can still proceed manually.
--
-- All three are LIFECYCLE states (during onboarding) — they sit BEFORE the
-- existing 'submitted' state in the v2 timeline:
--
--   extraction_pending → extraction_done → submitted → scraping
--                      ↘ extraction_unavailable ↗
--
-- The existing v1 states stay intact (the A03 pipeline still uses
-- 'scraping' → 'dna_building' → 'memory_writing' → 'complete' on the
-- main path). This migration only widens the allowed set.
--
-- Idempotent: safe to re-run.

begin;

alter table public.brand_profiles
  drop constraint if exists brand_profiles_onboarding_status_check;

alter table public.brand_profiles
  add constraint brand_profiles_onboarding_status_check
  check (onboarding_status = any (array[
    -- v2 onboarding lifecycle (NEW)
    'extraction_pending',
    'extraction_done',
    'extraction_unavailable',
    -- v1 onboarding + main pipeline lifecycle (UNCHANGED)
    'submitted',
    'scraping',
    'dna_building',
    'memory_writing',
    'complete',
    'failed',
    'blocked'
  ]));

commit;
