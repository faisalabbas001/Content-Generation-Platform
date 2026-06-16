-- Migration 0063 — Add cultural_deepdive jsonb column to sc_score_cards
-- Stores the CulturalDeepDive object (language_breakdown, occasions, dialect_multiplier)
-- so the share page can render it without re-running the scorer.

ALTER TABLE sc_score_cards
  ADD COLUMN IF NOT EXISTS cultural_deepdive jsonb;
