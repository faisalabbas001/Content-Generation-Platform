-- Migration 0062 — Move scoring tables from `scoring` schema to `public` schema
-- with sc_ prefix. Supabase JS v2 client does not support .schema() chaining
-- without explicit configuration; public schema works with all client variants.

-- Drop old schema tables (cascade drops their indexes, policies, constraints)
DROP TABLE IF EXISTS scoring.competitor_scores  CASCADE;
DROP TABLE IF EXISTS scoring.score_actions      CASCADE;
DROP TABLE IF EXISTS scoring.score_findings     CASCADE;
DROP TABLE IF EXISTS scoring.score_dimensions   CASCADE;
DROP TABLE IF EXISTS scoring.sector_benchmarks  CASCADE;
DROP TABLE IF EXISTS scoring.known_brands       CASCADE;
DROP TABLE IF EXISTS scoring.score_cards        CASCADE;
DROP SCHEMA IF EXISTS scoring CASCADE;

-- ── sc_score_cards ────────────────────────────────────────────────────────────
CREATE TABLE sc_score_cards (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle                 text NOT NULL,
  brand_name_en          text,
  brand_name_ar          text,
  sector                 text NOT NULL DEFAULT 'fnb',
  location_city          text,
  location_neighborhood  text,
  location_lat           numeric,
  location_lng           numeric,
  followers_count        int,
  posts_analyzed         int NOT NULL DEFAULT 0,
  overall_score          int NOT NULL DEFAULT 0,
  score_status           text NOT NULL DEFAULT 'complete',
  tier                   text NOT NULL DEFAULT 'low',
  scanned_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  brand_dna_id           uuid,
  share_slug             text UNIQUE NOT NULL,
  share_views            int NOT NULL DEFAULT 0,
  share_count            int NOT NULL DEFAULT 0,
  scan_tier              text NOT NULL DEFAULT 'free',
  error_message          text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sc_cards_handle     ON sc_score_cards(handle);
CREATE INDEX idx_sc_cards_slug       ON sc_score_cards(share_slug);
CREATE INDEX idx_sc_cards_expires    ON sc_score_cards(expires_at);
CREATE INDEX idx_sc_cards_sector     ON sc_score_cards(sector, overall_score DESC);

-- ── sc_score_dimensions ───────────────────────────────────────────────────────
CREATE TABLE sc_score_dimensions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id  uuid NOT NULL REFERENCES sc_score_cards(id) ON DELETE CASCADE,
  dimension      text NOT NULL,
  score          int NOT NULL,
  weight         numeric NOT NULL,
  benchmark      int,
  submetrics     jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sc_dims_card ON sc_score_dimensions(score_card_id);

-- ── sc_score_findings ─────────────────────────────────────────────────────────
CREATE TABLE sc_score_findings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id    uuid NOT NULL REFERENCES sc_score_cards(id) ON DELETE CASCADE,
  dimension        text NOT NULL,
  finding_en       text NOT NULL,
  finding_ar       text NOT NULL,
  evidence_count   int,
  evidence_total   int,
  benchmark_count  int,
  severity         text NOT NULL DEFAULT 'mid',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sc_findings_card ON sc_score_findings(score_card_id);

-- ── sc_score_actions ──────────────────────────────────────────────────────────
CREATE TABLE sc_score_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id    uuid NOT NULL REFERENCES sc_score_cards(id) ON DELETE CASCADE,
  dimension        text NOT NULL,
  workflow_id      text NOT NULL,
  action_label_en  text NOT NULL,
  action_label_ar  text NOT NULL,
  estimated_lift   int NOT NULL,
  timeframe_weeks  int NOT NULL,
  icon_emoji       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sc_actions_card ON sc_score_actions(score_card_id);

-- ── sc_competitor_scores ──────────────────────────────────────────────────────
CREATE TABLE sc_competitor_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id       uuid NOT NULL REFERENCES sc_score_cards(id) ON DELETE CASCADE,
  competitor_handle   text NOT NULL,
  competitor_name     text NOT NULL,
  competitor_score    int NOT NULL,
  distance_meters     int,
  location_label_en   text,
  location_label_ar   text,
  rank                int NOT NULL,
  is_focal_brand      boolean NOT NULL DEFAULT false,
  tier                text NOT NULL DEFAULT 'mid',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sc_comp_card ON sc_competitor_scores(score_card_id);

-- ── sc_sector_benchmarks ──────────────────────────────────────────────────────
CREATE TABLE sc_sector_benchmarks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector        text NOT NULL,
  dimension     text NOT NULL,
  submetric     text NOT NULL,
  p25           numeric,
  p50           numeric,
  p75           numeric,
  p90           numeric,
  sample_size   int NOT NULL DEFAULT 0,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sector, dimension, submetric)
);

-- ── sc_known_brands ───────────────────────────────────────────────────────────
CREATE TABLE sc_known_brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle      text,
  name_en     text NOT NULL,
  name_ar     text,
  sector      text NOT NULL,
  city        text,
  lat         numeric,
  lng         numeric,
  is_chain    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE sc_score_cards        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_score_dimensions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_score_findings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_score_actions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_competitor_scores  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_sector_benchmarks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_known_brands       ENABLE ROW LEVEL SECURITY;

-- Public read of non-expired cards (share pages are public)
CREATE POLICY "sc_public_read_cards"
  ON sc_score_cards FOR SELECT USING (expires_at > now());

CREATE POLICY "sc_public_read_dimensions"
  ON sc_score_dimensions FOR SELECT USING (true);

CREATE POLICY "sc_public_read_findings"
  ON sc_score_findings FOR SELECT USING (true);

CREATE POLICY "sc_public_read_actions"
  ON sc_score_actions FOR SELECT USING (true);

CREATE POLICY "sc_public_read_competitors"
  ON sc_competitor_scores FOR SELECT USING (true);

CREATE POLICY "sc_public_read_benchmarks"
  ON sc_sector_benchmarks FOR SELECT USING (true);

CREATE POLICY "sc_public_read_known_brands"
  ON sc_known_brands FOR SELECT USING (true);

-- ── Seed F&B benchmarks ───────────────────────────────────────────────────────
INSERT INTO sc_sector_benchmarks (sector, dimension, submetric, p25, p50, p75, p90, sample_size) VALUES
  ('fnb', 'visual_quality',      'overall',           41,  56,  71,  85,  0),
  ('fnb', 'visual_quality',      'steam_visible_pct', 8,   14,  21,  26,  0),
  ('fnb', 'cultural_fit',        'overall',           46,  62,  76,  88,  0),
  ('fnb', 'posting_consistency', 'posts_per_week',    2.5, 4.2, 6.5, 9.0, 0),
  ('fnb', 'posting_consistency', 'overall',           30,  48,  65,  78,  0),
  ('fnb', 'brand_coherence',     'overall',           44,  60,  75,  88,  0),
  ('fnb', 'engagement_health',   'comments_ratio',    0.005, 0.012, 0.025, 0.05, 0),
  ('fnb', 'engagement_health',   'overall',           30,  45,  62,  78,  0);
