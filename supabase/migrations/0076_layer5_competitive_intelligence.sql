-- Migration 0076: Layer 5 — Competitive Intelligence
-- Adds competitor_accounts, competitor_snapshots, competitor_alerts tables
-- Aligned with OGZ spec §7 — full competitor tracking per brand

-- ── Competitor accounts ────────────────────────────────────────────────────────

create table if not exists public.competitor_accounts (
  competitor_id   uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brand_profiles(brand_id) on delete cascade,
  handle_instagram text,
  handle_tiktok    text,
  handle_snapchat  text,
  handle_youtube   text,
  handle_x         text,
  display_name     text,
  sector           text,
  tier             text default 'light',   -- 'light' | 'deep' (deep = quarterly full extraction)
  is_active        boolean not null default true,
  added_at         timestamptz not null default now(),
  last_extracted_at timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_competitor_accounts_brand on public.competitor_accounts(brand_id);
create index if not exists idx_competitor_accounts_active on public.competitor_accounts(brand_id, is_active);

-- ── Competitor snapshots (periodic extraction results) ─────────────────────────

create table if not exists public.competitor_snapshots (
  snapshot_id        uuid primary key default gen_random_uuid(),
  competitor_id      uuid not null references public.competitor_accounts(competitor_id) on delete cascade,
  brand_id           uuid not null references public.brand_profiles(brand_id) on delete cascade,
  snapshot_type      text not null default 'light',   -- 'light' | 'deep'
  extracted_at       timestamptz not null default now(),

  -- Posting patterns
  posting_frequency_per_week  numeric(5,2),
  best_posting_days            text[],      -- ['Sunday','Tuesday']
  best_posting_hours           int[],       -- [18, 20, 21]

  -- Platform presence
  platforms_active             text[],      -- ['Instagram','TikTok','Snapchat']
  follower_counts              jsonb,        -- {"Instagram": 12400, "TikTok": 8900}

  -- Content categories
  content_category_distribution jsonb,      -- {"product":35,"lifestyle":30,"occasion":20,"behind_scenes":15}
  estimated_engagement_rate     numeric(5,4),

  -- Occasion approach
  occasion_approach            jsonb,        -- {"ramadan":"full","national_day":"reduced","eid":"full"}

  -- Cultural patterns (deep extraction only)
  top_performing_content_types  text[],
  top_performing_tones          text[],
  caption_style_observed        text,
  visual_style_observed         text,
  cultural_tensions_used        text[],

  -- Competitive gaps & threats
  gaps_identified              text[],       -- what they're NOT doing
  threats_identified           text[],       -- what they're doing well that this brand should respond to

  -- Raw extraction payload
  raw_payload                  jsonb,

  created_at                   timestamptz not null default now()
);

create index if not exists idx_competitor_snapshots_competitor on public.competitor_snapshots(competitor_id);
create index if not exists idx_competitor_snapshots_brand      on public.competitor_snapshots(brand_id);
create index if not exists idx_competitor_snapshots_extracted  on public.competitor_snapshots(brand_id, extracted_at desc);

-- ── Competitor alerts ──────────────────────────────────────────────────────────

create table if not exists public.competitor_alerts (
  alert_id        uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brand_profiles(brand_id) on delete cascade,
  competitor_id   uuid references public.competitor_accounts(competitor_id) on delete set null,
  alert_type      text not null,   -- 'major_campaign' | 'platform_join' | 'engagement_spike' | 'occasion_move' | 'gap_opportunity' | 'weekly_summary'
  severity        text not null default 'info',   -- 'info' | 'warning' | 'urgent'
  title           text not null,
  body            text not null,
  suggested_content_direction text,
  is_read         boolean not null default false,
  is_actioned     boolean not null default false,
  actioned_at     timestamptz,
  client_decision text,   -- 'accepted' | 'ignored' | 'adjusted'
  created_at      timestamptz not null default now()
);

create index if not exists idx_competitor_alerts_brand    on public.competitor_alerts(brand_id, created_at desc);
create index if not exists idx_competitor_alerts_unread   on public.competitor_alerts(brand_id, is_read) where is_read = false;

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.competitor_accounts  enable row level security;
alter table public.competitor_snapshots enable row level security;
alter table public.competitor_alerts    enable row level security;

-- Brand owners read/write their own competitors
create policy "owner_rw_competitor_accounts" on public.competitor_accounts
  for all using (
    brand_id in (
      select brand_id from public.brand_profiles
      where auth_user_id = auth.uid()
    )
  );

create policy "owner_rw_competitor_snapshots" on public.competitor_snapshots
  for all using (
    brand_id in (
      select brand_id from public.brand_profiles
      where auth_user_id = auth.uid()
    )
  );

create policy "owner_rw_competitor_alerts" on public.competitor_alerts
  for all using (
    brand_id in (
      select brand_id from public.brand_profiles
      where auth_user_id = auth.uid()
    )
  );

-- Service role bypass
create policy "service_role_all_competitor_accounts" on public.competitor_accounts
  for all using (auth.role() = 'service_role');

create policy "service_role_all_competitor_snapshots" on public.competitor_snapshots
  for all using (auth.role() = 'service_role');

create policy "service_role_all_competitor_alerts" on public.competitor_alerts
  for all using (auth.role() = 'service_role');

-- ── updated_at trigger ─────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger trg_competitor_accounts_updated_at
  before update on public.competitor_accounts
  for each row execute function public.set_updated_at();
