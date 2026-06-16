-- Migration 0035: chain_fal_workflow_mapping
--
-- Maps a client-supplied chain_id (e.g. "product_hero", "ramadan_promo") to the
-- fal.ai workflow ID the client has configured in their fal.ai account.
-- CEO selects the chain_id in its routing_decision; N8N-A02 passes it to V01;
-- V01 passes it to /api/image/generate which does the lookup here.
--
-- If no row matches the chain_id the route falls back to the standard
-- fal-client.ts model-routing logic (no change to existing behaviour).

CREATE TABLE IF NOT EXISTS chain_fal_workflow_mapping (
  chain_id        TEXT PRIMARY KEY,
  fal_workflow_id TEXT NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service-role only; no user-facing RLS needed (internal lookup table).
ALTER TABLE chain_fal_workflow_mapping ENABLE ROW LEVEL SECURITY;

-- Admins (service role) can read/write; authenticated users have no access.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='chain_fal_workflow_mapping' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON chain_fal_workflow_mapping
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
