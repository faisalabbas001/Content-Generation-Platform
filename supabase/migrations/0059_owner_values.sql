-- Migration 0059 — Layer 2: owner_values column
--
-- Adds the `owner_values` field to brand_profiles.
-- Documented in OGZ_COMPLETE_SYSTEM_DOCUMENT §2.2 Layer 2 as
-- "What the owner believes — captured progressively".
-- Stored as free text (max 1000 chars), written by onboarding form
-- and updated progressively via Memory Controller nominations.

begin;

alter table public.brand_profiles
  add column if not exists owner_values text null;

comment on column public.brand_profiles.owner_values is
  'Layer 2: Owner beliefs and values — captured progressively via onboarding and AI chat.';

commit;
