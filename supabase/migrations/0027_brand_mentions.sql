-- Migration 0027 — Brand collaboration network (@-mentions across IG posts)
--
-- Background:
--   The Apify IG scraper returns `mentions[]` per post (e.g. "@partnerCafe").
--   These were dropped during normalisation. They're a valuable network signal:
--     • Who does this brand collaborate with regularly?
--     • Who has the brand mentioned recently (sponsorship cycle hint)?
--     • For D02 maintenance: are mentioned partners still active?
--
-- Schema:
--   One row per (brand_id × mentioned_username). Aggregated counts +
--   timestamps + a small set of caption excerpts where the mention occurred
--   (so admins can see context without joining brand_post_observations).
--
-- Idempotent — safe to re-run.

begin;

create table if not exists public.brand_mentions (
  brand_id            uuid not null references public.brand_profiles(brand_id) on delete cascade,
  mentioned_username  text not null,

  -- Aggregates
  mention_count       int  not null default 1,
  contexts            text[] not null default '{}',  -- up to 5 caption excerpts
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),

  primary key (brand_id, mentioned_username)
);

create index if not exists idx_brand_mentions_brand
  on public.brand_mentions (brand_id, mention_count desc);
create index if not exists idx_brand_mentions_recent
  on public.brand_mentions (brand_id, last_seen_at desc);

alter table public.brand_mentions enable row level security;

-- RLS — same shape as other Layer 1 brand-private tables.
drop policy if exists brand_mentions_owner_read on public.brand_mentions;
create policy brand_mentions_owner_read on public.brand_mentions
  for select using (
    brand_id in (
      select brand_id from public.brand_profiles where auth_user_id = auth.uid()
    )
  );

drop policy if exists brand_mentions_service_write on public.brand_mentions;
create policy brand_mentions_service_write on public.brand_mentions
  for insert with check (auth.role() = 'service_role');

drop policy if exists brand_mentions_service_update on public.brand_mentions;
create policy brand_mentions_service_update on public.brand_mentions
  for update using (auth.role() = 'service_role');

drop policy if exists brand_mentions_no_delete on public.brand_mentions;
create policy brand_mentions_no_delete on public.brand_mentions
  for delete using (false);

comment on table public.brand_mentions is
  'Collaboration network — who this brand @-mentions across IG posts. One row
   per (brand_id, mentioned_username); upserted with running aggregates by
   /api/extraction/persist-ig. Read by D02 maintenance + Production Copilot
   when surfacing partner-relationship suggestions.';

commit;
