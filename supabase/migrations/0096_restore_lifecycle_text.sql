-- 0096_restore_lifecycle_text.sql
--
-- The `lifecycle` text column was created in migration 0072 (v6 onboarding)
-- but was never actually present in the live DB because 0081 only referenced
-- it without ensuring it existed first. The onboarding-v2.ts submitFinal
-- action writes to it in 3 places (lines 653, 819, 958).
--
-- This is SEPARATE from lifecycle_stage (enum) which is COO-inferred.
-- lifecycle = raw form answer ('launch'|'growth'|'established'|'mature'|'legacy')
-- lifecycle_stage = COO axis inference ('pre_launch'|'launch'|'growth'|'maturity'|'recovery')

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS lifecycle text NULL;

COMMENT ON COLUMN public.brand_profiles.lifecycle IS
  'Raw v6 form answer for business lifecycle stage. Written by onboarding-v2 submitFinal. Separate from lifecycle_stage enum which is COO-inferred via Memory Controller.';
