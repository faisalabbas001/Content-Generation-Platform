-- 0093_phase4_learning_knowledge.sql
-- Phase 4: Learning Agent + Knowledge Extraction Agent infrastructure
-- Adds brand_performance_log (real performance data ingestion),
-- enhances brand_content_patterns (already exists from 0078 but may need columns),
-- and adds knowledge_corpus for cross-brand sector learning.

-- ─────────────────────────────────────────────────────────────────────
-- 1. brand_performance_log — real performance data from Instagram Graph API
--    This is what the Learning Agent reads. One row per post per metric pull.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_performance_log (
  log_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID NOT NULL REFERENCES brand_profiles(brand_id) ON DELETE CASCADE,
  post_id           UUID REFERENCES calendar_posts(post_id) ON DELETE SET NULL,
  platform_post_id  TEXT,                        -- Instagram/TikTok native post ID
  channel           TEXT NOT NULL,
  posted_at         TIMESTAMPTZ,
  content_type      TEXT,
  chain_id          TEXT,
  creative_formula  TEXT,

  -- Raw metrics
  reach             INTEGER DEFAULT 0,
  impressions       INTEGER DEFAULT 0,
  likes             INTEGER DEFAULT 0,
  comments          INTEGER DEFAULT 0,
  shares            INTEGER DEFAULT 0,
  saves             INTEGER DEFAULT 0,
  engagement_rate   NUMERIC(6,4) DEFAULT 0,      -- (likes+comments+shares+saves)/reach

  -- Computed scores
  brand_score       NUMERIC(5,2),                -- 0-100 vs brand own history
  sector_score      NUMERIC(5,2),                -- 0-100 vs sector benchmark
  platform_score    NUMERIC(5,2),                -- 0-100 vs platform benchmark

  -- Attribution
  caption_variant   TEXT,                        -- which caption variant was used
  chain_approved    BOOLEAN DEFAULT FALSE,        -- did client approve chain for reuse?

  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(brand_id, platform_post_id)
);

CREATE INDEX IF NOT EXISTS idx_perf_log_brand_date ON brand_performance_log(brand_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_log_chain ON brand_performance_log(brand_id, chain_id) WHERE chain_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_perf_log_formula ON brand_performance_log(brand_id, creative_formula) WHERE creative_formula IS NOT NULL;

-- RLS
ALTER TABLE brand_performance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand_perf_log_owner_read" ON brand_performance_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM brand_memberships
      WHERE brand_memberships.brand_id = brand_performance_log.brand_id
        AND brand_memberships.user_id = auth.uid()
    )
  );
-- Service role inserts (Learning Agent, Instagram webhook)
CREATE POLICY "brand_perf_log_service_insert" ON brand_performance_log
  FOR INSERT WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- 2. brand_content_patterns — add missing columns if not present
--    (table created in 0078 but may lack learning_agent columns)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE brand_content_patterns
  ADD COLUMN IF NOT EXISTS chain_id         TEXT,
  ADD COLUMN IF NOT EXISTS creative_formula TEXT,
  ADD COLUMN IF NOT EXISTS content_type     TEXT,
  ADD COLUMN IF NOT EXISTS avg_score        NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS sample_count     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_winner        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS period_start     DATE,
  ADD COLUMN IF NOT EXISTS period_end       DATE,
  ADD COLUMN IF NOT EXISTS insight          TEXT,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

-- Unique constraint for upsert from Learning Agent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brand_content_patterns_brand_chain_period'
  ) THEN
    ALTER TABLE brand_content_patterns
      ADD CONSTRAINT brand_content_patterns_brand_chain_period
      UNIQUE (brand_id, chain_id, period_start);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. knowledge_corpus — sector-level generalised patterns
--    Written by Knowledge Extraction Agent, read by chain selection
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_corpus (
  corpus_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key   TEXT NOT NULL,
  sector        TEXT NOT NULL,
  dialect       TEXT NOT NULL DEFAULT 'MSA_accessible',
  pattern_type  TEXT NOT NULL CHECK (pattern_type IN ('gold', 'anti', 'neutral')),
  description   TEXT NOT NULL,
  chain_id      TEXT,
  formula       TEXT,
  content_type  TEXT,
  confidence    NUMERIC(3,2) NOT NULL DEFAULT 0.70 CHECK (confidence BETWEEN 0 AND 1),
  source        TEXT DEFAULT 'knowledge_extraction',
  sample_count  INTEGER DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pattern_key, sector, dialect)
);

CREATE INDEX IF NOT EXISTS idx_corpus_sector ON knowledge_corpus(sector, dialect);
CREATE INDEX IF NOT EXISTS idx_corpus_type ON knowledge_corpus(pattern_type, confidence DESC);

-- Service role manages (no RLS needed — admin/system only)
ALTER TABLE knowledge_corpus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corpus_service_all" ON knowledge_corpus USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- 4. learning_cycles — audit log of each Learning Agent run
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_cycles (
  cycle_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES brand_profiles(brand_id) ON DELETE CASCADE,
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  posts_analysed   INTEGER DEFAULT 0,
  patterns_found   INTEGER DEFAULT 0,
  winners_count    INTEGER DEFAULT 0,
  losers_count     INTEGER DEFAULT 0,
  nominations_sent INTEGER DEFAULT 0,
  cost_usd         NUMERIC(10,6) DEFAULT 0,
  status           TEXT DEFAULT 'complete' CHECK (status IN ('running', 'complete', 'failed')),
  ran_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_cycles_brand ON learning_cycles(brand_id, ran_at DESC);

ALTER TABLE learning_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "learning_cycles_owner_read" ON learning_cycles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM brand_memberships
      WHERE brand_memberships.brand_id = learning_cycles.brand_id
        AND brand_memberships.user_id = auth.uid()
    )
  );
CREATE POLICY "learning_cycles_service_insert" ON learning_cycles
  FOR INSERT WITH CHECK (true);
