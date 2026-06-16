-- 0094_instagram_analytics_columns.sql
-- Adds Instagram-extractable analytics fields that Apify already scrapes
-- but had no DB columns to store. COO now nominates these via Memory Controller
-- so they persist across onboarding and are available for caption context.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. brand_profiles — Instagram account intelligence
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.brand_profiles
  -- Account facts (from Apify profile scrape)
  ADD COLUMN IF NOT EXISTS followers_count            INTEGER,
  ADD COLUMN IF NOT EXISTS ig_post_count              INTEGER,
  ADD COLUMN IF NOT EXISTS ig_verified                BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS account_type               TEXT,
  -- 'personal' | 'business' | 'creator' — affects strategy permission

  -- Bio signals (extracted from IG bio text)
  ADD COLUMN IF NOT EXISTS bio_text                   TEXT,
  ADD COLUMN IF NOT EXISTS bio_link                   TEXT,

  -- Engagement analytics (computed from post data by Apify)
  ADD COLUMN IF NOT EXISTS avg_engagement_rate        NUMERIC(6,4),
  -- (likes+comments) / followers — median across recent posts

  -- Posting behaviour (computed from post timestamps)
  ADD COLUMN IF NOT EXISTS posting_frequency_per_week NUMERIC(4,2),
  -- Average posts per week over last 90 days

  -- Content mix (computed from post type distribution)
  ADD COLUMN IF NOT EXISTS primary_content_format     TEXT,
  -- 'image' | 'video' | 'carousel' | 'reel' — dominant format
  ADD COLUMN IF NOT EXISTS content_type_distribution  JSONB,
  -- {"image": 0.45, "video": 0.30, "carousel": 0.25}

  -- Caption intelligence (computed from caption analysis)
  ADD COLUMN IF NOT EXISTS caption_avg_length         INTEGER,
  -- Average word count of recent captions
  ADD COLUMN IF NOT EXISTS top_hashtags               TEXT[],
  -- Top 10 most-used hashtags (without #)
  ADD COLUMN IF NOT EXISTS top_mentioned_accounts     TEXT[];
  -- Top mentioned @accounts (influencers, partners, etc.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. audience_profiles — Audience intelligence from scraper signals
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audience_profiles
  ADD COLUMN IF NOT EXISTS audience_location_primary   TEXT,
  -- City or region inferred from follower geography signals (bio, hashtags)
  ADD COLUMN IF NOT EXISTS audience_age_range_estimated TEXT,
  -- Estimated dominant age range: '18-24' | '25-34' | '35-44' | '45+'
  -- Inferred from content style, hashtags, mention patterns
  ADD COLUMN IF NOT EXISTS follower_quality_signal     TEXT;
  -- 'authentic' | 'mixed' | 'inflated' — ratio of engagement to followers

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. visual_style_profiles — Visual analytics from post media
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.visual_style_profiles
  ADD COLUMN IF NOT EXISTS avg_video_duration_secs    INTEGER,
  -- Average video/reel duration from scraped posts
  ADD COLUMN IF NOT EXISTS aspect_ratio_primary       TEXT,
  -- '1:1' | '4:5' | '9:16' | '16:9' — dominant aspect ratio
  ADD COLUMN IF NOT EXISTS filter_style               TEXT,
  -- 'warm' | 'cool' | 'vibrant' | 'muted' | 'bw' | 'natural'
  -- Inferred from image color temperature analysis
  ADD COLUMN IF NOT EXISTS has_arabic_overlay         BOOLEAN DEFAULT FALSE,
  -- Whether brand already uses Arabic text overlays on images
  ADD COLUMN IF NOT EXISTS has_logo_watermark         BOOLEAN DEFAULT FALSE;
  -- Whether brand watermarks generated content with logo

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Indexes for analytics queries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_brand_followers
  ON public.brand_profiles(followers_count DESC)
  WHERE followers_count IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brand_engagement
  ON public.brand_profiles(avg_engagement_rate DESC)
  WHERE avg_engagement_rate IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brand_content_format
  ON public.brand_profiles(primary_content_format)
  WHERE primary_content_format IS NOT NULL;
