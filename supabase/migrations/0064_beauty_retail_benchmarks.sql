-- Migration 0064 — Seed Beauty and Retail sector benchmarks
-- Estimates based on Saudi market research; replace with computed values post-launch.

INSERT INTO sc_sector_benchmarks (sector, dimension, submetric, p25, p50, p75, p90, sample_size) VALUES

-- ── Beauty ────────────────────────────────────────────────────────────────────
  ('beauty', 'visual_quality',      'overall',           48,  62,  76,  89,  0),
  ('beauty', 'visual_quality',      'lighting_score',    50,  68,  82,  92,  0),
  ('beauty', 'cultural_fit',        'overall',           44,  60,  74,  87,  0),
  ('beauty', 'posting_consistency', 'posts_per_week',    3.0, 5.5, 8.0, 11.0, 0),
  ('beauty', 'posting_consistency', 'overall',           35,  52,  68,  82,  0),
  ('beauty', 'brand_coherence',     'overall',           50,  66,  80,  91,  0),
  ('beauty', 'engagement_health',   'comments_ratio',    0.008, 0.018, 0.035, 0.065, 0),
  ('beauty', 'engagement_health',   'overall',           38,  54,  70,  84,  0),

-- ── Retail ────────────────────────────────────────────────────────────────────
  ('retail', 'visual_quality',      'overall',           38,  52,  67,  82,  0),
  ('retail', 'visual_quality',      'lighting_score',    42,  58,  72,  86,  0),
  ('retail', 'cultural_fit',        'overall',           40,  56,  71,  84,  0),
  ('retail', 'posting_consistency', 'posts_per_week',    2.0, 3.8, 6.0, 8.5, 0),
  ('retail', 'posting_consistency', 'overall',           28,  44,  60,  75,  0),
  ('retail', 'brand_coherence',     'overall',           42,  58,  73,  86,  0),
  ('retail', 'engagement_health',   'comments_ratio',    0.004, 0.010, 0.022, 0.045, 0),
  ('retail', 'engagement_health',   'overall',           28,  42,  58,  73,  0)

ON CONFLICT (sector, dimension, submetric) DO NOTHING;
