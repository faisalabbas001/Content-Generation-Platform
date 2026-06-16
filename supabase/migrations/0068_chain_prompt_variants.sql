-- Migration 0068: Chain Prompt Variants
--
-- Adds a chain_prompt_variants table that stores named prompt variants per
-- chain. This allows a single chain to have:
--   - A "standard" variant (default)
--   - Occasion-specific variants (e.g. ramadan_mubarak, national_day)
--   - Sector-specific variants (e.g. f_and_b, real_estate)
--   - Regional variants (e.g. ksa_specific, gcc_generic)
--
-- The /api/image/generate route selects the best variant before rendering.
-- If no variant matches the context, it falls back to chains.prompt_template.

CREATE TABLE IF NOT EXISTS chain_prompt_variants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id              TEXT NOT NULL REFERENCES chains (chain_id) ON DELETE CASCADE,

  -- Variant identity
  variant_name          TEXT NOT NULL,               -- e.g. "standard", "ramadan", "f_and_b_hero"
  variant_label_en      TEXT,                        -- human-readable label
  variant_label_ar      TEXT,

  -- Prompt content
  prompt_text           TEXT NOT NULL,               -- full prompt template with {{variable}} slots
  negative_prompt       TEXT,                        -- NULL = inherit from chain

  -- Selector conditions (NULL array = matches all)
  applicable_occasions  TEXT[],                      -- NULL = applies to all occasions
  applicable_sectors    TEXT[],                      -- NULL = applies to all sectors
  applicable_regions    TEXT[],                      -- NULL = applies globally
  applicable_tiers      TEXT[],                      -- NULL = applies to all tiers

  -- Priority (higher wins when multiple variants match)
  priority              INT NOT NULL DEFAULT 0,

  -- Default variant flag (only one per chain should be true)
  is_default            BOOLEAN NOT NULL DEFAULT false,

  -- Lifecycle
  is_active             BOOLEAN NOT NULL DEFAULT true,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (chain_id, variant_name)
);

CREATE OR REPLACE FUNCTION chain_prompt_variants_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS chain_prompt_variants_updated_at ON chain_prompt_variants;
CREATE TRIGGER chain_prompt_variants_updated_at
  BEFORE UPDATE ON chain_prompt_variants
  FOR EACH ROW EXECUTE FUNCTION chain_prompt_variants_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_chain_prompt_variants_chain    ON chain_prompt_variants (chain_id);
CREATE INDEX IF NOT EXISTS idx_chain_prompt_variants_default  ON chain_prompt_variants (chain_id, is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS idx_chain_prompt_variants_occasions ON chain_prompt_variants USING GIN (applicable_occasions);
CREATE INDEX IF NOT EXISTS idx_chain_prompt_variants_sectors   ON chain_prompt_variants USING GIN (applicable_sectors);

-- RLS
ALTER TABLE chain_prompt_variants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='chain_prompt_variants' AND policyname='service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON chain_prompt_variants
      USING     (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='chain_prompt_variants' AND policyname='authenticated_read_active'
  ) THEN
    CREATE POLICY "authenticated_read_active" ON chain_prompt_variants
      FOR SELECT
      USING (auth.role() = 'authenticated' AND is_active = true);
  END IF;
END $$;
