-- Migration 0074 — on_demand_requests.current_step
--
-- Adds a text column that n8n writes at each stage of the A02 workflow so the
-- frontend can show real-time step progress instead of a static "generating" state.
--
-- Values written by n8n (in order):
--   ceo      → CEO has classified the brief
--   coo      → COO has compiled caption context
--   caption  → DeepSeek has generated the Arabic caption
--   qc       → CCO has passed quality check
--   image    → FAL AI has generated the image
--   upload   → image uploaded to Supabase Storage
--   done     → terminal success (set by the Next.js webhook handler)
--
-- NULL means the request is still queued / just triggered.
-- Status 'failed' on the parent row is the authoritative failure signal;
-- current_step is best-effort and may be NULL on failure rows.

ALTER TABLE on_demand_requests
  ADD COLUMN IF NOT EXISTS current_step TEXT DEFAULT NULL;

COMMENT ON COLUMN on_demand_requests.current_step IS
  'Granular A02 step written by n8n at each milestone: ceo | coo | caption | qc | image | upload | done';
