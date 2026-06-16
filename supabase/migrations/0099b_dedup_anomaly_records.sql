-- Migration 0099b: Deduplicate anomaly_records before the UNIQUE(brand_id, anomaly_type)
-- constraint in 0099_chain_scoring_and_cost_ceiling.sql can be created.
--
-- Why: anomaly_records accumulated multiple rows for the same (brand_id, anomaly_type)
-- during testing (e.g. repeated 'ceo_call_failed' / 'agent_call_failed' per brand).
-- 0099 tries to ADD a UNIQUE constraint on (brand_id, anomaly_type) and fails with
-- 23505 (duplicate key) until these are collapsed to one row per pair.
--
-- Strategy: keep the SINGLE most relevant row per (brand_id, anomaly_type) and delete
-- the rest. "Most relevant" = prefer an UNRESOLVED row (resolved=false) over a resolved
-- one, then the most RECENT (created_at desc), then a stable tiebreak on anomaly_id.
-- This preserves the live/open anomaly a human still needs to see.
--
-- Rows with brand_id IS NULL are left untouched — NULLs never collide in a UNIQUE
-- constraint, so they don't block the index and represent system-level anomalies we
-- must not lose.
--
-- Naming: filed as 0099b so it sorts immediately AFTER 0099 in the migration runner.
-- IMPORTANT: this must be APPLIED BEFORE 0099. If 0099 already failed and is unapplied,
-- run 0099b first (e.g. via psql or by ordering), then re-run the migrator so 0099's
-- ADD CONSTRAINT succeeds. The DELETE below is idempotent — re-running is a no-op once
-- there are no duplicates.

BEGIN;

-- Collapse duplicates: delete every row that is NOT the "winner" within its
-- (brand_id, anomaly_type) group. Winner = unresolved first, then newest, then
-- lowest anomaly_id as a deterministic final tiebreak.
WITH ranked AS (
  SELECT
    anomaly_id,
    row_number() OVER (
      PARTITION BY brand_id, anomaly_type
      ORDER BY
        resolved ASC,            -- false (0) before true (1) → keep the open one
        created_at DESC,         -- then the most recent
        anomaly_id ASC           -- deterministic final tiebreak
    ) AS rn
  FROM public.anomaly_records
  WHERE brand_id IS NOT NULL     -- NULL brand_id rows can't violate the UNIQUE constraint
)
DELETE FROM public.anomaly_records a
USING ranked r
WHERE a.anomaly_id = r.anomaly_id
  AND r.rn > 1;

-- Safety assertion: fail loudly if any duplicate (brand_id, anomaly_type) survives,
-- so we never let the migrator proceed to 0099 only to hit 23505 again.
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
  FROM (
    SELECT 1
    FROM public.anomaly_records
    WHERE brand_id IS NOT NULL
    GROUP BY brand_id, anomaly_type
    HAVING count(*) > 1
  ) d;

  IF remaining > 0 THEN
    RAISE EXCEPTION
      '0099b dedup incomplete: % duplicate (brand_id, anomaly_type) groups remain', remaining;
  END IF;
END;
$$;

COMMIT;
