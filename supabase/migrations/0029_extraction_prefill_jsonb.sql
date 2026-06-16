-- 0029_extraction_prefill_jsonb.sql
--
-- Adds a single jsonb column where the LLM-generated extraction pre-fill is
-- persisted. Replaces ~150 lines of brittle field-by-field heuristics in the
-- `/api/onboarding/extraction-status` route — the route now reads this jsonb
-- once instead of re-deriving from raw_payload on every poll.
--
-- Shape (validated by ExtractionPrefillSchema in @repo/ai):
--   {
--     "brand_name_en":        "string | null",
--     "business_category":    "string | null",
--     "sector_hint":          "F&B | Beauty_Wellness | Healthcare | Finance | Government | Retail | null",
--     "dialect_hint":         "Najdi | Hejazi | Gulf | MSA_formal | MSA_accessible | Mixed | null",
--     "lifecycle_stage_hint": "pre_launch | launch | growth | maturity | recovery | null",
--     "differentiator_seed":  "string ≤240 | null",
--     "online_native":        "boolean | null",
--     "has_holding_page":     "boolean | null",
--     "confidence":           { "<field>": "high|medium|low" }
--   }
--
-- NULL on the column itself = pre-fill not yet computed (extraction still
-- running, or extraction returned no usable data and the cost-guard skipped
-- the LLM call). The status route treats NULL the same as an all-null prefill
-- → review form shows blank fields for the user to type.

alter table public.brand_profiles
  add column if not exists extraction_prefill jsonb;

comment on column public.brand_profiles.extraction_prefill is
  'LLM-generated pre-fill for the Step-3 review form. NULL = not computed yet '
  'or no usable scraping data. Written once by /api/extraction/run after A06 '
  'finishes. Read by /api/onboarding/extraction-status. User edits in the '
  'review form override every field.';
