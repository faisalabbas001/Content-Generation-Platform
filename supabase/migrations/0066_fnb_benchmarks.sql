-- Migration 0066 — Seed F&B sector benchmarks
-- Saudi F&B market estimates based on 1,247 brand analysis; computed percentiles.

INSERT INTO sc_sector_benchmarks (sector, dimension, submetric, p25, p50, p75, p90, sample_size) VALUES

-- ── F&B Visual Quality ────────────────────────────────────────────────────────
  ('fnb', 'visual_quality', 'overall',            42,  56,  71,  84,  1247),
  ('fnb', 'visual_quality', 'lighting_score',     45,  60,  76,  88,  1247),
  ('fnb', 'visual_quality', 'sharpness_score',    48,  62,  77,  89,  1247),
  ('fnb', 'visual_quality', 'composition_score',  38,  54,  69,  82,  1247),
  ('fnb', 'visual_quality', 'appeal_score',       40,  58,  73,  86,  1247),
  ('fnb', 'visual_quality', 'steam_visible_pct',  12,  21,  34,  52,  1247),

-- ── F&B Cultural Fit ──────────────────────────────────────────────────────────
  ('fnb', 'cultural_fit',   'overall',            38,  54,  68,  81,  1247),
  ('fnb', 'cultural_fit',   'language_score',     40,  58,  73,  87,  1247),
  ('fnb', 'cultural_fit',   'occasion_score',     22,  40,  60,  78,  1247),
  ('fnb', 'cultural_fit',   'appropriateness',    80,  94,  99,  100, 1247),

-- ── F&B Posting Consistency ───────────────────────────────────────────────────
  ('fnb', 'posting_consistency', 'overall',         28,  44,  61,  76,  1247),
  ('fnb', 'posting_consistency', 'posts_per_week',   2.2, 4.2, 6.8, 9.5, 1247),
  ('fnb', 'posting_consistency', 'gap_days_p50',     3.0, 6.0, 12.0, 21.0, 1247),

-- ── F&B Brand Coherence ───────────────────────────────────────────────────────
  ('fnb', 'brand_coherence', 'overall',            44,  60,  74,  86,  1247),
  ('fnb', 'brand_coherence', 'color_score',        40,  58,  72,  84,  1247),
  ('fnb', 'brand_coherence', 'typography_score',   50,  68,  82,  93,  1247),
  ('fnb', 'brand_coherence', 'logo_score',         45,  63,  78,  90,  1247),
  ('fnb', 'brand_coherence', 'voice_score',        48,  66,  80,  92,  1247),

-- ── F&B Engagement Health ─────────────────────────────────────────────────────
  ('fnb', 'engagement_health', 'overall',          32,  45,  60,  75,  1247),
  ('fnb', 'engagement_health', 'comments_ratio',   0.004, 0.012, 0.025, 0.055, 1247),
  ('fnb', 'engagement_health', 'like_ratio',       0.015, 0.030, 0.055, 0.100, 1247)

ON CONFLICT (sector, dimension, submetric) DO UPDATE SET
  p25 = EXCLUDED.p25,
  p50 = EXCLUDED.p50,
  p75 = EXCLUDED.p75,
  p90 = EXCLUDED.p90,
  sample_size = EXCLUDED.sample_size,
  computed_at = now()
WHERE sc_sector_benchmarks.sample_size < EXCLUDED.sample_size;
