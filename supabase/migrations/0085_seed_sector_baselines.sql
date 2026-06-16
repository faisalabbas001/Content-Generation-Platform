-- Migration 0085 — Seed sector_baselines with Saudi-market defaults
--
-- The sector_baselines table was created in 0001 but never populated.
-- COO and compile-caption-context both reference it for tone benchmarks and
-- content mix guidance. Without data, every brand gets no fallback guidance.
--
-- Values sourced from ogz-knowledge §05_sector_defaults (spec §10.3) and the
-- OGZ_COMPLETE_SYSTEM_DOCUMENT §2.2 sector defaults. These are conservative
-- Saudi-market defaults — the CIO agent (Phase 2) will overwrite them with
-- empirically-derived values from actual post performance.
--
-- Upsert-safe: re-running updates all rows to the latest defaults.

begin;

insert into public.sector_baselines (
  sector,
  recommended_content_mix,
  top_performing_tones,
  worst_performing_tones,
  occasion_insights,
  confidence_benchmarks,
  updated_at
) values

-- ── F&B ──────────────────────────────────────────────────────────────────────
(
  'F&B',
  '{"product": 35, "lifestyle": 25, "occasion": 25, "behind_scenes": 15}',
  '["warm_inviting", "sensory_description", "community_gathering", "nostalgic_heritage"]',
  '["corporate_formal", "aggressive_promotional", "western_casual"]',
  '{
    "Ramadan": {"weight": 0.35, "content_shift": "gathering_warmth", "post_frequency_multiplier": 1.5},
    "Eid_Fitr": {"weight": 0.20, "content_shift": "celebration_gift", "post_frequency_multiplier": 1.3},
    "National_Day": {"weight": 0.15, "content_shift": "saudi_pride_local", "post_frequency_multiplier": 1.2},
    "Founding_Day": {"weight": 0.10, "content_shift": "heritage_roots", "post_frequency_multiplier": 1.1}
  }',
  '{"avg_engagement_rate": 0.038, "avg_posting_frequency_week": 4.5, "avg_story_views_ratio": 0.12, "benchmark_likes_per_1k_followers": 42}',
  now()
),

-- ── Retail ───────────────────────────────────────────────────────────────────
(
  'Retail',
  '{"product": 40, "lifestyle": 30, "occasion": 20, "behind_scenes": 10}',
  '["aspirational_accessible", "value_clarity", "trend_aware", "local_pride"]',
  '["overly_formal", "generic_global", "pushy_salesy"]',
  '{
    "Ramadan": {"weight": 0.30, "content_shift": "gift_giving_family", "post_frequency_multiplier": 1.6},
    "Eid_Fitr": {"weight": 0.25, "content_shift": "new_clothes_celebration", "post_frequency_multiplier": 1.4},
    "National_Day": {"weight": 0.15, "content_shift": "local_pride_collection", "post_frequency_multiplier": 1.2},
    "Back_to_School": {"weight": 0.15, "content_shift": "practical_value", "post_frequency_multiplier": 1.3}
  }',
  '{"avg_engagement_rate": 0.032, "avg_posting_frequency_week": 5.0, "avg_story_views_ratio": 0.10, "benchmark_likes_per_1k_followers": 36}',
  now()
),

-- ── Beauty_Wellness ──────────────────────────────────────────────────────────
(
  'Beauty_Wellness',
  '{"product": 30, "lifestyle": 35, "occasion": 15, "behind_scenes": 20}',
  '["aspirational_achievable", "self_care_permission", "transformation_narrative", "intimate_honest"]',
  '["aggressive_claims", "western_casual_ironic", "flashy_loud"]',
  '{
    "Ramadan": {"weight": 0.20, "content_shift": "self_care_spiritual", "post_frequency_multiplier": 1.2},
    "Eid_Fitr": {"weight": 0.20, "content_shift": "celebration_glow", "post_frequency_multiplier": 1.3},
    "Mothers_Day": {"weight": 0.20, "content_shift": "gifting_appreciation", "post_frequency_multiplier": 1.4},
    "National_Day": {"weight": 0.10, "content_shift": "saudi_beauty_pride", "post_frequency_multiplier": 1.1}
  }',
  '{"avg_engagement_rate": 0.045, "avg_posting_frequency_week": 6.0, "avg_story_views_ratio": 0.14, "benchmark_likes_per_1k_followers": 55}',
  now()
),

-- ── Healthcare ───────────────────────────────────────────────────────────────
(
  'Healthcare',
  '{"product": 20, "lifestyle": 25, "occasion": 15, "behind_scenes": 40}',
  '["trusted_authoritative", "empathetic_warm", "educational_clear", "community_reassuring"]',
  '["fear_based", "overpromising", "casual_humor", "ironic"]',
  '{
    "Ramadan": {"weight": 0.25, "content_shift": "health_during_fasting", "post_frequency_multiplier": 1.3},
    "National_Day": {"weight": 0.10, "content_shift": "national_health_pride", "post_frequency_multiplier": 1.1},
    "World_Health_Day": {"weight": 0.15, "content_shift": "awareness_education", "post_frequency_multiplier": 1.2}
  }',
  '{"avg_engagement_rate": 0.028, "avg_posting_frequency_week": 3.5, "avg_story_views_ratio": 0.08, "benchmark_likes_per_1k_followers": 28}',
  now()
),

-- ── Finance ──────────────────────────────────────────────────────────────────
(
  'Finance',
  '{"product": 25, "lifestyle": 20, "occasion": 15, "behind_scenes": 40}',
  '["trusted_precise", "empowering_clear", "educational_accessible", "authoritative_warm"]',
  '["flashy_loud", "casual_humor", "aggressive_promotional", "western_casual"]',
  '{
    "Ramadan": {"weight": 0.20, "content_shift": "savings_zakat_guidance", "post_frequency_multiplier": 1.2},
    "National_Day": {"weight": 0.15, "content_shift": "national_economic_pride", "post_frequency_multiplier": 1.1},
    "New_Year": {"weight": 0.15, "content_shift": "financial_goals_planning", "post_frequency_multiplier": 1.2}
  }',
  '{"avg_engagement_rate": 0.022, "avg_posting_frequency_week": 3.0, "avg_story_views_ratio": 0.07, "benchmark_likes_per_1k_followers": 22}',
  now()
),

-- ── Government ───────────────────────────────────────────────────────────────
(
  'Government',
  '{"product": 15, "lifestyle": 20, "occasion": 35, "behind_scenes": 30}',
  '["authoritative_accessible", "proud_inclusive", "clear_direct", "community_service"]',
  '["casual_humor", "ironic", "edgy", "western_casual"]',
  '{
    "National_Day": {"weight": 0.40, "content_shift": "national_pride_achievement", "post_frequency_multiplier": 2.0},
    "Founding_Day": {"weight": 0.30, "content_shift": "heritage_vision_2030", "post_frequency_multiplier": 1.8},
    "Ramadan": {"weight": 0.20, "content_shift": "community_service_guidance", "post_frequency_multiplier": 1.3}
  }',
  '{"avg_engagement_rate": 0.035, "avg_posting_frequency_week": 4.0, "avg_story_views_ratio": 0.11, "benchmark_likes_per_1k_followers": 38}',
  now()
),

-- ── Other ────────────────────────────────────────────────────────────────────
(
  'Other',
  '{"product": 30, "lifestyle": 30, "occasion": 20, "behind_scenes": 20}',
  '["authentic_honest", "clear_direct", "community_warm"]',
  '["aggressive_promotional", "generic_global", "corporate_formal"]',
  '{
    "Ramadan": {"weight": 0.25, "content_shift": "community_gathering", "post_frequency_multiplier": 1.3},
    "National_Day": {"weight": 0.20, "content_shift": "local_pride", "post_frequency_multiplier": 1.2}
  }',
  '{"avg_engagement_rate": 0.030, "avg_posting_frequency_week": 3.5, "avg_story_views_ratio": 0.09, "benchmark_likes_per_1k_followers": 32}',
  now()
)

on conflict (sector) do update set
  recommended_content_mix = excluded.recommended_content_mix,
  top_performing_tones    = excluded.top_performing_tones,
  worst_performing_tones  = excluded.worst_performing_tones,
  occasion_insights       = excluded.occasion_insights,
  confidence_benchmarks   = excluded.confidence_benchmarks,
  updated_at              = now();

commit;
