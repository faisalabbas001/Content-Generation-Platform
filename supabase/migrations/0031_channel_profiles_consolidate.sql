-- 0031 — channel_profiles cleanup + engagement_rate wiring
--
-- Why: the v2 extraction (N8N-A06 → /api/extraction/persist-ig) writes to the
-- newer columns added in 0026/0028 (followers_count, synced_at, posts_count_total,
-- etc.) and leaves the original 0001 columns (followers, last_scraped_at) as
-- NULL forever. Two storage slots for the same fact is a footgun.
--
-- Plan:
--   1. Drop the duplicate columns: `followers` and `last_scraped_at`.
--      All callers now use `followers_count` / `synced_at`.
--   2. Keep `engagement_rate` — but actually populate it. Engagement rate is
--      computed from observed posts and pushed by refresh_brand_engagement_baseline().
--      Formula: mean(likes + comments) per post / followers_count.
--   3. Backfill engagement_rate for any brand that already has observations.
--
-- This is a one-way migration. Downstream UI reads + the seed file are
-- updated in the same commit.

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Drop duplicate columns. CASCADE on `followers` is unnecessary —
--    nothing FK's it and no index references it.
-- ─────────────────────────────────────────────────────────────────────

alter table public.channel_profiles
  drop column if exists followers,
  drop column if exists last_scraped_at;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Extend the existing RPC to also write engagement_rate.
--
--    Mean (not median) because engagement_rate is conventionally an
--    average, not a "typical post" metric. Skip the row if followers_count
--    is NULL or 0 (avoid div-by-zero, leave engagement_rate NULL).
-- ─────────────────────────────────────────────────────────────────────

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
  v_avg_engagement  numeric;
  v_followers       int;
begin
  -- Median likes / comments (across all observed posts) for brand_profiles baselines.
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

  -- ── engagement_rate on channel_profiles (Instagram channel only) ──
  -- Mean (likes + comments) per observed post, divided by followers_count.
  -- Skips channels with no followers_count (NULL/0 → engagement_rate stays NULL).
  select followers_count into v_followers
  from public.channel_profiles
  where brand_id = p_brand_id and channel = 'Instagram'
  limit 1;

  if v_followers is not null and v_followers > 0 and v_count > 0 then
    select avg(likes_count + comments_count)::numeric / v_followers
      into v_avg_engagement
    from public.brand_post_observations
    where brand_id = p_brand_id;

    update public.channel_profiles
       set engagement_rate = v_avg_engagement
     where brand_id = p_brand_id and channel = 'Instagram';
  end if;
end;
$$;

comment on function public.refresh_brand_engagement_baseline(uuid) is
  'Recomputes engagement baselines from brand_post_observations.
   Writes medians to brand_profiles and mean engagement_rate to channel_profiles
   (Instagram only, when followers_count is known). Idempotent.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Backfill: rerun the RPC for every brand that already has observations.
-- ─────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  for r in
    select distinct brand_id from public.brand_post_observations
  loop
    perform public.refresh_brand_engagement_baseline(r.brand_id);
  end loop;
end $$;

commit;
