-- Migration 0061 — Brand Scorecard scoring schema
-- Implements the scoring engine spec (scoring-engine-spec.md)
-- All tables live under the `scoring` schema for namespace isolation.

CREATE SCHEMA IF NOT EXISTS scoring;

-- ── score_cards ─────────────────────────────────────────────────────────────
-- One row per scan. Free scans expire in 7 days; paid scans in 30 days.

CREATE TABLE scoring.score_cards (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle                 text NOT NULL,
  brand_name_en          text,
  brand_name_ar          text,
  sector                 text NOT NULL DEFAULT 'fnb',  -- 'fnb' | 'beauty' | 'retail' | 'other'
  location_city          text,
  location_neighborhood  text,
  location_lat           numeric,
  location_lng           numeric,
  followers_count        int,
  posts_analyzed         int NOT NULL DEFAULT 0,
  overall_score          int NOT NULL DEFAULT 0,       -- 0–100
  score_status           text NOT NULL DEFAULT 'complete', -- 'complete'|'preliminary'|'stale'|'error'
  tier                   text NOT NULL DEFAULT 'low',  -- 'low'|'mid'|'high'
  scanned_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  brand_dna_id           uuid,                         -- null for unauthenticated scans
  share_slug             text UNIQUE NOT NULL,
  share_views            int NOT NULL DEFAULT 0,
  share_count            int NOT NULL DEFAULT 0,
  scan_tier              text NOT NULL DEFAULT 'free', -- 'free'|'paid'|'subscription'
  error_message          text,
  raw_posts_json         jsonb,                        -- cached scrape (avoid re-fetching)
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sc_handle       ON scoring.score_cards(handle);
CREATE INDEX idx_sc_share_slug   ON scoring.score_cards(share_slug);
CREATE INDEX idx_sc_expires      ON scoring.score_cards(expires_at);
CREATE INDEX idx_sc_sector_score ON scoring.score_cards(sector, overall_score DESC);
CREATE INDEX idx_sc_location     ON scoring.score_cards(location_lat, location_lng)
  WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL;

-- ── score_dimensions ─────────────────────────────────────────────────────────
-- Five rows per scan — one per dimension.

CREATE TABLE scoring.score_dimensions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id  uuid NOT NULL REFERENCES scoring.score_cards(id) ON DELETE CASCADE,
  dimension      text NOT NULL,   -- 'visual_quality'|'cultural_fit'|'posting_consistency'|'brand_coherence'|'engagement_health'
  score          int NOT NULL,    -- 0–100
  weight         numeric NOT NULL, -- 0.0–1.0
  benchmark      int,             -- sector p50 for this dimension
  submetrics     jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dim_card ON scoring.score_dimensions(score_card_id);

-- ── score_findings ────────────────────────────────────────────────────────────
-- Evidence strings shown on the card (1–3 per dimension).

CREATE TABLE scoring.score_findings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id    uuid NOT NULL REFERENCES scoring.score_cards(id) ON DELETE CASCADE,
  dimension        text NOT NULL,
  finding_en       text NOT NULL,
  finding_ar       text NOT NULL,
  evidence_count   int,
  evidence_total   int,
  benchmark_count  int,
  severity         text NOT NULL DEFAULT 'mid',  -- 'high'|'mid'|'low'
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_findings_card ON scoring.score_findings(score_card_id);

-- ── score_actions ─────────────────────────────────────────────────────────────
-- Recommended workflows + estimated point lifts.

CREATE TABLE scoring.score_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id    uuid NOT NULL REFERENCES scoring.score_cards(id) ON DELETE CASCADE,
  dimension        text NOT NULL,
  workflow_id      text NOT NULL,   -- 'workflow_3'|'chain_c1'|'branddna_onboarding' etc.
  action_label_en  text NOT NULL,
  action_label_ar  text NOT NULL,
  estimated_lift   int NOT NULL,    -- 0–50
  timeframe_weeks  int NOT NULL,
  icon_emoji       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_actions_card ON scoring.score_actions(score_card_id);

-- ── competitor_scores ─────────────────────────────────────────────────────────
-- Up to 6 competitor rows per scan (including the focal brand as is_focal=true).

CREATE TABLE scoring.competitor_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_card_id       uuid NOT NULL REFERENCES scoring.score_cards(id) ON DELETE CASCADE,
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

CREATE INDEX idx_comp_card ON scoring.competitor_scores(score_card_id);

-- ── sector_benchmarks ─────────────────────────────────────────────────────────
-- Refreshed monthly. Used by scorers as reference points.
-- Seed data for F&B (fnb) is below — conservative initial values.

CREATE TABLE scoring.sector_benchmarks (
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

-- ── known_brands ──────────────────────────────────────────────────────────────
-- Seeded from Google Places + manual curation. Used for competitor discovery.

CREATE TABLE scoring.known_brands (
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

CREATE INDEX idx_kb_sector ON scoring.known_brands(sector);
CREATE INDEX idx_kb_location ON scoring.known_brands(lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- score_cards: public can read non-expired rows (share pages are public).
-- Writes are service-role only (scoring engine runs server-side).

ALTER TABLE scoring.score_cards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring.score_dimensions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring.score_findings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring.score_actions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring.competitor_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring.sector_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring.known_brands      ENABLE ROW LEVEL SECURITY;

-- Public read of active score cards (used by share pages)
CREATE POLICY "public_read_active_scorecards"
  ON scoring.score_cards FOR SELECT
  USING (expires_at > now());

CREATE POLICY "public_read_dimensions"
  ON scoring.score_dimensions FOR SELECT
  USING (true);

CREATE POLICY "public_read_findings"
  ON scoring.score_findings FOR SELECT
  USING (true);

CREATE POLICY "public_read_actions"
  ON scoring.score_actions FOR SELECT
  USING (true);

CREATE POLICY "public_read_competitors"
  ON scoring.competitor_scores FOR SELECT
  USING (true);

CREATE POLICY "public_read_benchmarks"
  ON scoring.sector_benchmarks FOR SELECT
  USING (true);

CREATE POLICY "public_read_known_brands"
  ON scoring.known_brands FOR SELECT
  USING (true);

-- ── Seed: F&B sector benchmarks (conservative initial values) ─────────────────
-- These will be replaced after the 1,247-brand scrape. Conservative = honest.

INSERT INTO scoring.sector_benchmarks (sector, dimension, submetric, p25, p50, p75, p90, sample_size) VALUES
  -- Visual Quality
  ('fnb', 'visual_quality', 'sharpness',             40,  55,  70,  85,  0),
  ('fnb', 'visual_quality', 'lighting',               45,  60,  75,  88,  0),
  ('fnb', 'visual_quality', 'composition',            38,  52,  68,  82,  0),
  ('fnb', 'visual_quality', 'appeal',                 42,  58,  72,  86,  0),
  ('fnb', 'visual_quality', 'overall',                41,  56,  71,  85,  0),
  -- Cultural Fit
  ('fnb', 'cultural_fit',  'language_score',          45,  62,  78,  90,  0),
  ('fnb', 'cultural_fit',  'occasion_score',          30,  48,  65,  80,  0),
  ('fnb', 'cultural_fit',  'appropriateness',         75,  88,  96, 100,  0),
  ('fnb', 'cultural_fit',  'overall',                 46,  62,  76,  88,  0),
  -- Posting Consistency
  ('fnb', 'posting_consistency', 'posts_per_week',    2.5, 4.2, 6.5, 9.0, 0),
  ('fnb', 'posting_consistency', 'gap_days',          3.0, 5.5, 9.0,14.0, 0),
  ('fnb', 'posting_consistency', 'prime_time_pct',    35,  52,  68,  80,  0),
  ('fnb', 'posting_consistency', 'overall',           30,  48,  65,  78,  0),
  -- Brand Coherence
  ('fnb', 'brand_coherence', 'color_coherence',       40,  58,  74,  88,  0),
  ('fnb', 'brand_coherence', 'typography_coherence',  45,  62,  78,  90,  0),
  ('fnb', 'brand_coherence', 'logo_coherence',        50,  65,  80,  92,  0),
  ('fnb', 'brand_coherence', 'voice_coherence',       40,  55,  70,  84,  0),
  ('fnb', 'brand_coherence', 'overall',               44,  60,  75,  88,  0),
  -- Engagement Health
  ('fnb', 'engagement_health', 'comments_ratio',      0.005, 0.012, 0.025, 0.05, 0),
  ('fnb', 'engagement_health', 'follower_growth_pct', 1.0,   2.5,   5.0,  10.0,  0),
  ('fnb', 'engagement_health', 'overall',             30,    45,    62,    78,    0);
