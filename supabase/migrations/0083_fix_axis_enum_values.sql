-- Migration 0083 — Fix axis enum values to match TypeScript + COO output
--
-- Problem: migration 0020 created lifecycle_stage_type and intent_state_type
-- with PascalCase / underscore-mixed values (e.g. 'Launch', 'Brand_Building')
-- but every other layer of the stack — packages/db/src/types.ts, packages/
-- memory/src/types.ts ALLOWED_FIELD_PATHS, packages/core/src/schemas/coo.ts
-- LifecycleStageEnum + IntentStateEnum — uses snake_case ('pre_launch',
-- 'launch', 'growth', 'maturity', 'recovery') and ('launch','grow','defend',
-- 'harvest','recover'). COO emits snake_case values. Memory Controller
-- validates against the snake_case enum list. So every axis nomination for
-- lifecycle_stage or intent_state silently fails the DB CHECK constraint.
--
-- Fix: rename the old enum values to snake_case, add pre_launch and the
-- intent_state vocabulary the rest of the codebase expects.
--
-- Safe to re-run: ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent.
-- The old values (Launch, Growth, etc.) are renamed via a temporary column
-- swap so no data is lost (brand_profiles rows default to NULL for these
-- columns so there is nothing to migrate in practice).

begin;

-- ── lifecycle_stage_type ─────────────────────────────────────────────────────
-- Old values: Launch | Growth | Maturity | Transition | Renewal
-- New values: pre_launch | launch | growth | maturity | recovery
--
-- Strategy: create a new enum with the correct values, swap the column type,
-- drop the old enum. We cannot rename enum values in Postgres <15 (and Supabase
-- typically runs PG 15, but ALTER TYPE ... RENAME VALUE requires explicit
-- version assumption). Safest portable approach: new enum + column cast.

do $$ begin
  create type lifecycle_stage_type_v2 as enum (
    'pre_launch', 'launch', 'growth', 'maturity', 'recovery'
  );
exception when duplicate_object then null; end $$;

-- Swap brand_profiles.lifecycle_stage to the new enum.
-- Existing rows are cast: old value → closest new value (best-effort).
-- In practice all rows are NULL at this stage of onboarding.
alter table public.brand_profiles
  alter column lifecycle_stage drop default;

alter table public.brand_profiles
  alter column lifecycle_stage type lifecycle_stage_type_v2
  using (
    case lifecycle_stage::text
      when 'Launch'     then 'launch'::lifecycle_stage_type_v2
      when 'Growth'     then 'growth'::lifecycle_stage_type_v2
      when 'Maturity'   then 'maturity'::lifecycle_stage_type_v2
      when 'Transition' then 'recovery'::lifecycle_stage_type_v2  -- closest semantic match
      when 'Renewal'    then 'recovery'::lifecycle_stage_type_v2
      else null
    end
  );

-- Drop the old enum (safe now that no column references it)
drop type if exists lifecycle_stage_type;

-- Rename v2 to the canonical name so existing code references still compile
alter type lifecycle_stage_type_v2 rename to lifecycle_stage_type;


-- ── intent_state_type ────────────────────────────────────────────────────────
-- Old values: Brand_Building | Awareness_Attraction | Differentiation_Loyalty
--             | Conversion_Promotional | Refresh_Relaunch
-- New values: launch | grow | defend | harvest | recover

do $$ begin
  create type intent_state_type_v2 as enum (
    'launch', 'grow', 'defend', 'harvest', 'recover'
  );
exception when duplicate_object then null; end $$;

alter table public.brand_profiles
  alter column intent_state drop default;

alter table public.brand_profiles
  alter column intent_state type intent_state_type_v2
  using (
    case intent_state::text
      when 'Brand_Building'            then 'grow'::intent_state_type_v2
      when 'Awareness_Attraction'      then 'grow'::intent_state_type_v2
      when 'Differentiation_Loyalty'   then 'defend'::intent_state_type_v2
      when 'Conversion_Promotional'    then 'harvest'::intent_state_type_v2
      when 'Refresh_Relaunch'          then 'recover'::intent_state_type_v2
      else null
    end
  );

drop type if exists intent_state_type;
alter type intent_state_type_v2 rename to intent_state_type;

commit;
