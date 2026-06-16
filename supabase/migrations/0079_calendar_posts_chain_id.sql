-- Add chain_id to calendar_posts for per-slot chain traceability.
-- Set from the deterministic calendar slot planner (/api/agents/calendar/plan-slots)
-- which replaces the old CEO-picks-one-chain model. Nullable: posts whose slot
-- resolved to no eligible chain fall back to standard model routing.
ALTER TABLE calendar_posts
  ADD COLUMN IF NOT EXISTS chain_id TEXT;

COMMENT ON COLUMN calendar_posts.chain_id IS
  'Deterministically selected chain for this slot (Doc §9.5). NULL = standard model routing.';
