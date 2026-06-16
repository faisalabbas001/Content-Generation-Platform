-- Migration 0066: Chain Library
--
-- Replaces the minimal chain_fal_workflow_mapping (0055) with a full chain
-- registry that stores every creative recipe: prompt templates, model
-- assignments, eligibility rules, cultural constraints, cost/latency
-- estimates, and brand-level overrides.
--
-- The /api/image/generate route reads from this table to:
--   1. Auto-select the best chain for a given brand/occasion/sector/tier
--   2. Render the parameterised prompt template with context variables
--   3. Route to the correct fal.ai model(s) (including two-model video chains)
--
-- Backward-compat: chain_fal_workflow_mapping (0055) is kept for a
-- transition period. The image/generate route prefers chains rows when
-- a matching chain_id exists and falls back to chain_fal_workflow_mapping
-- only when not found here.

-- ─── 1. CHAINS (the library) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chains (
  -- Identity
  chain_id            TEXT PRIMARY KEY,                 -- e.g. "tf01_01_native_quote_card"
  chain_ulid          TEXT,                             -- 26-char ULID (sortable, global unique)
  family              TEXT NOT NULL,                    -- "TF01" … "TF23"
  schema_version      INT  NOT NULL DEFAULT 1,

  -- Names
  name_en             TEXT NOT NULL,
  name_ar             TEXT NOT NULL,
  purpose             TEXT,                             -- ≥ 30 chars describing the business job

  -- fal.ai models (primary always required; secondary for video chains: Flux→Kling)
  fal_model_primary   TEXT NOT NULL,                   -- e.g. "fal-ai/flux-pro/v1.1-ultra"
  fal_model_secondary TEXT,                            -- e.g. "fal-ai/kling-video/v2.1-pro"

  -- Prompt
  prompt_template     TEXT NOT NULL,                   -- English template with {{variable}} slots
  negative_prompt     TEXT,                            -- overrides global negative_prompt when set

  -- Input contract (JSON Schema subset — which variables the template needs)
  input_schema        JSONB NOT NULL DEFAULT '{}',     -- { "required": ["hero_subject_description"], "optional": [...] }

  -- Output spec
  output_type         TEXT NOT NULL DEFAULT 'image'    -- 'image' | 'video' | 'carousel' | 'audio' | 'mixed'
    CHECK (output_type IN ('image','video','carousel','audio','mixed')),
  output_width        INT,
  output_height       INT,
  output_duration_s   INT,                             -- NULL for images
  aspect_ratio        TEXT,                            -- "1:1" | "4:5" | "9:16" | "16:9" | "4:3"

  -- Eligibility filters (NULL array = no restriction / allow all)
  eligible_sectors    TEXT[],                          -- NULL = all sectors
  excluded_sectors    TEXT[],
  eligible_occasions  TEXT[],                          -- NULL = all occasions
  excluded_occasions  TEXT[],
  quality_tiers       TEXT[] NOT NULL DEFAULT ARRAY['starter','growth','enterprise'],
  min_maturity_days   INT  NOT NULL DEFAULT 0,

  -- Cultural constraints (stored as a flat JSONB object of boolean flags)
  cultural_constraints JSONB NOT NULL DEFAULT '{}',
  -- Expected keys: requires_wardrobe_check, requires_gesture_check,
  --                requires_cultural_coherence_check, requires_arabic_text_validation,
  --                high_religious_sensitivity, high_gender_sensitivity,
  --                human_review_recommended_above_quality_tier

  -- Anti-patterns (string array of failure modes to document)
  anti_patterns       TEXT[],

  -- Cost & latency estimates (informational; used by COO cost ceiling logic)
  cost_estimate_usd   NUMERIC(8,4),
  latency_estimate_s  INT,

  -- CD brain affinities (e.g. ["cd_01","cd_04"])
  best_for_cd_brains  TEXT[],

  -- Provenance (from chain_v1.schema.json spec)
  provenance_source   TEXT,
  provenance_confirmer TEXT,
  provenance_confidence TEXT DEFAULT 'experimental'
    CHECK (provenance_confidence IN ('experimental','inferred','confirmed')),
  provenance_scope    TEXT DEFAULT 'universal',

  -- Lifecycle
  is_active           BOOLEAN NOT NULL DEFAULT true,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION chains_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS chains_updated_at ON chains;
CREATE TRIGGER chains_updated_at
  BEFORE UPDATE ON chains
  FOR EACH ROW EXECUTE FUNCTION chains_set_updated_at();

-- Indexes for auto-selection query
CREATE INDEX IF NOT EXISTS idx_chains_family        ON chains (family);
CREATE INDEX IF NOT EXISTS idx_chains_is_active     ON chains (is_active);
CREATE INDEX IF NOT EXISTS idx_chains_output_type   ON chains (output_type);
CREATE INDEX IF NOT EXISTS idx_chains_quality_tiers ON chains USING GIN (quality_tiers);
CREATE INDEX IF NOT EXISTS idx_chains_sectors       ON chains USING GIN (eligible_sectors);
CREATE INDEX IF NOT EXISTS idx_chains_occasions     ON chains USING GIN (eligible_occasions);

-- ─── 2. CHAIN BRAND OVERRIDES ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chain_brand_overrides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id            TEXT NOT NULL REFERENCES chains (chain_id) ON DELETE CASCADE,
  brand_id            UUID NOT NULL REFERENCES brand_profiles (brand_id) ON DELETE CASCADE,

  -- When set, this text is appended to the rendered prompt_template before
  -- sending to fal.ai. Allows per-brand prompt injection without editing the
  -- canonical chain definition.
  prompt_suffix       TEXT,

  -- When set, overrides the chain's negative_prompt entirely for this brand.
  negative_prompt_override TEXT,

  -- Optionally force a different fal model for this brand (e.g. downgrade for cost)
  fal_model_override  TEXT,

  is_active           BOOLEAN NOT NULL DEFAULT true,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (chain_id, brand_id)
);

CREATE OR REPLACE FUNCTION chain_brand_overrides_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS chain_brand_overrides_updated_at ON chain_brand_overrides;
CREATE TRIGGER chain_brand_overrides_updated_at
  BEFORE UPDATE ON chain_brand_overrides
  FOR EACH ROW EXECUTE FUNCTION chain_brand_overrides_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_chain_brand_overrides_brand  ON chain_brand_overrides (brand_id);
CREATE INDEX IF NOT EXISTS idx_chain_brand_overrides_chain  ON chain_brand_overrides (chain_id);

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE chains                ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_brand_overrides ENABLE ROW LEVEL SECURITY;

-- chains: service role full access (admin UI + image/generate route)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='chains' AND policyname='service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON chains
      USING     (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- chains: authenticated users may read active chains (client UI / CEO agent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='chains' AND policyname='authenticated_read_active'
  ) THEN
    CREATE POLICY "authenticated_read_active" ON chains
      FOR SELECT
      USING (auth.role() = 'authenticated' AND is_active = true);
  END IF;
END $$;

-- chain_brand_overrides: service role only
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='chain_brand_overrides' AND policyname='service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON chain_brand_overrides
      USING     (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
