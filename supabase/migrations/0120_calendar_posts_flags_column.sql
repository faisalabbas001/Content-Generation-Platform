-- Migration 0120: Add flags JSONB column to calendar_posts
-- Stores confidence-gate output: { pillars: { visual, caption, brand_fit, occasion } }
-- Written by confidence-gate route on every scoring pass.
-- Used by score-insight.tsx to show the 4-pillar breakdown in admin QA.

ALTER TABLE calendar_posts
  ADD COLUMN IF NOT EXISTS flags jsonb DEFAULT NULL;

COMMENT ON COLUMN calendar_posts.flags IS
  'Stores confidence-gate pillar scores: { pillars: { visual, caption, brand_fit, occasion } }. '
  'Also carries A01 skeleton builder metadata. Written by /api/agents/ceo/confidence-gate.';
