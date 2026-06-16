-- Migration 0026 — Capture full Instagram post history + derive engagement baselines
--
-- Background:
--   Currently A06's IG normaliser keeps only 5 of the 50 scraped posts in
--   source_records.raw_payload.posts_sample[]. The other 45 are discarded,
--   and every post's engagement (likes/comments/views) is dropped after the
--   first 5. This wastes ~80% of the IG signal.
--
-- This migration adds:
--   1. brand_post_observations  — one row per scraped post (full archive)
--   2. brand_profiles columns   — derived engagement + signature phrase baselines
--   3. channel_profiles row     — restores the IG handle row that the v1
--                                 onboarding action used to write (regression
--                                 introduced by the v2 split — see CLAUDE.md
--                                 doctrine "every BrandDNA write must be
--                                 traceable").
--
-- These let downstream agents:
--   • COO Pass 2: analyse 50 captions for dialect/voice (not 5) — better signal
--   • COO Pass 1: cite engagement baselines as evidence ("posts averaging
--     380 likes" → BrandDNA Lite confidence math)
--   • CCO + DeepSeek: avoid the brand's own signature phrases (they belong to
--     this brand only — for OTHER brands they'd be plagiarism)
--   • N8N-A05 monthly cycle: compute % delta against the engagement baseline
--   • Memory Controller: use the new fields as evidence sources
--
-- Idempotent — safe to re-run.

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. brand_post_observations — full Instagram post archive per brand
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.brand_post_observations (
  observation_id  uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brand_profiles(brand_id) on delete cascade,
  source_record_id uuid references public.source_records(source_id) on delete set null,

  -- Identity
  ig_post_id      text not null,            -- Instagram's numeric ID
  short_code      text,                      -- e.g. "DXenqGNDvtd" — human-readable URL fragment
  post_url        text,                      -- canonical URL on instagram.com
  post_type       text not null,             -- 'Image' | 'Video' | 'Sidecar'
  product_type    text,                      -- 'clips' (Reel) | 'igtv' | null

  -- Content
  caption                text,
  caption_length         int,
  hashtags               text[] not null default '{}',
  mentions               text[] not null default '{}',
  emoji_count            int not null default 0,
  language_detected      text,                -- 'ar' | 'en' | 'mixed' | null

  -- Engagement
  likes_count            int not null default 0,
  comments_count         int not null default 0,
  video_view_count       int,                 -- only set when post_type=Video
  video_play_count       int,                 -- only set when post_type=Video / Reel
  comments_disabled      boolean not null default false,

  -- Format
  dimensions_width       int,
  dimensions_height      int,
  video_duration_seconds float,
  uses_original_audio    boolean,
  audio_id               text,

  -- Timestamps
  posted_at              timestamptz,         -- when the post went live on IG
  captured_at            timestamptz not null default now(),

  -- Audit
  raw_payload            jsonb not null default '{}'::jsonb,

  unique (brand_id, ig_post_id)
);

create index if not exists idx_brand_post_observations_brand_posted
  on public.brand_post_observations (brand_id, posted_at desc);
create index if not exists idx_brand_post_observations_engagement
  on public.brand_post_observations (brand_id, likes_count desc);

alter table public.brand_post_observations enable row level security;

-- RLS: brand owners can read; admin (service role) can write.
drop policy if exists brand_post_observations_owner_read on public.brand_post_observations;
create policy brand_post_observations_owner_read on public.brand_post_observations
  for select using (
    brand_id in (
      select brand_id from public.brand_profiles where auth_user_id = auth.uid()
    )
  );

drop policy if exists brand_post_observations_service_write on public.brand_post_observations;
create policy brand_post_observations_service_write on public.brand_post_observations
  for insert with check (auth.role() = 'service_role');

drop policy if exists brand_post_observations_no_update on public.brand_post_observations;
create policy brand_post_observations_no_update on public.brand_post_observations
  for update using (false);

drop policy if exists brand_post_observations_no_delete on public.brand_post_observations;
create policy brand_post_observations_no_delete on public.brand_post_observations
  for delete using (false);

comment on table public.brand_post_observations is
  'One row per scraped Instagram post. Append-only ledger of every post observation
   (engagement, content, format, music). Replaces the truncated posts_sample[]
   array previously buried in source_records.raw_payload — keeps all 50 instead
   of 5. Read by COO Pass 2 (voice analysis) + N8N-A05 (performance learning).';

-- ─────────────────────────────────────────────────────────────────────
-- 2. brand_profiles — derived baselines + signatures
-- ─────────────────────────────────────────────────────────────────────

alter table public.brand_profiles
  add column if not exists engagement_baseline_likes      int,
  add column if not exists engagement_baseline_comments   int,
  add column if not exists engagement_baseline_views      int,
  add column if not exists signature_phrases              text[] not null default '{}',
  add column if not exists signature_hashtags             text[] not null default '{}',
  add column if not exists brand_reply_samples            text[] not null default '{}',
  add column if not exists posts_observed_count           int not null default 0;

comment on column public.brand_profiles.engagement_baseline_likes is
  'Median likes across all observed posts. Used by N8N-A05 to score generated posts (under-baseline → flag for review).';
comment on column public.brand_profiles.signature_hashtags is
  'Hashtags appearing on >=40% of observed posts (top 10). The brand "owns" these — other brands must NOT use them.';
comment on column public.brand_profiles.brand_reply_samples is
  'Up to 20 sample texts where the brand replied to a follower comment. Best signal for conversational voice register
   (different from announcement voice in main captions). Read by COO Pass 2.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. channel_profiles — restore the IG handle row (regression fix)
-- ─────────────────────────────────────────────────────────────────────

-- The legacy onboarding action wrote a row here when an IG handle was given:
--   { brand_id, channel: 'Instagram', handle }
-- The v2 split dropped this. Restore it via a function the new submitFinal
-- + A06-ig will both call.
--
-- channel_profiles already exists from migration 0001. Add columns to capture
-- the richer data we now have (followers, posts_count_total, profile_url).

alter table public.channel_profiles
  add column if not exists profile_url      text,
  add column if not exists followers_count  int,
  add column if not exists posts_count_total int,
  add column if not exists is_business      boolean default false,
  add column if not exists is_verified      boolean default false,
  add column if not exists synced_at        timestamptz;

create unique index if not exists ux_channel_profiles_brand_channel
  on public.channel_profiles (brand_id, channel);

comment on column public.channel_profiles.synced_at is
  'When this channel profile was last refreshed from extraction. NULL = never synced (handle exists but no Apify pull yet).';

-- ─────────────────────────────────────────────────────────────────────
-- 4. visual_style_profiles — make sure the unique constraint on brand_id
-- exists so A06 can UPSERT.
-- ─────────────────────────────────────────────────────────────────────

create unique index if not exists ux_visual_style_profiles_brand
  on public.visual_style_profiles (brand_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5. RPC — compute and write engagement baselines from brand_post_observations
-- ─────────────────────────────────────────────────────────────────────

-- Called by A06-ig after all post observations are inserted.
-- Median across observations is more robust than mean (less skewed by viral posts).

create or replace function public.refresh_brand_engagement_baseline(p_brand_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_likes_median    int;
  v_comments_median int;
  v_views_median    int;
  v_count           int;
begin
  -- Median likes (across all observed posts)
  select percentile_cont(0.5) within group (order by likes_count)::int,
         percentile_cont(0.5) within group (order by comments_count)::int,
         count(*)::int
    into v_likes_median, v_comments_median, v_count
  from public.brand_post_observations
  where brand_id = p_brand_id;

  -- Median views (only across video posts that have view_count)
  select percentile_cont(0.5) within group (order by video_view_count)::int
    into v_views_median
  from public.brand_post_observations
  where brand_id = p_brand_id and video_view_count is not null;

  update public.brand_profiles
  set
    engagement_baseline_likes    = coalesce(v_likes_median, 0),
    engagement_baseline_comments = coalesce(v_comments_median, 0),
    engagement_baseline_views    = v_views_median,
    posts_observed_count         = coalesce(v_count, 0)
  where brand_id = p_brand_id;
end;
$$;

comment on function public.refresh_brand_engagement_baseline(uuid) is
  'Recomputes engagement baseline columns on brand_profiles from
   brand_post_observations rows for that brand. Idempotent.
   Call this after a batch of post observations has been INSERTed.';

grant execute on function public.refresh_brand_engagement_baseline(uuid)
  to authenticated, service_role;

commit;
