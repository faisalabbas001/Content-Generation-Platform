-- Migration 0080: C2PA watermark compliance columns
-- SDAIA Deepfakes Guidelines active May 2026 (spec §12.2)
-- Adds c2pa_signed + ai_generated flags to calendar_posts

alter table public.calendar_posts
  add column if not exists c2pa_signed    boolean not null default false,
  add column if not exists ai_generated   boolean not null default true,
  add column if not exists generation_model text;  -- fal.ai model ID used

-- Index for audit queries: "show all AI-generated posts not yet C2PA signed"
create index if not exists idx_calendar_posts_c2pa
  on public.calendar_posts(brand_id, c2pa_signed)
  where ai_generated = true and c2pa_signed = false;

-- View for compliance dashboard
create or replace view public.v_c2pa_compliance as
select
  count(*)                                                    as total_ai_posts,
  count(*) filter (where c2pa_signed = true)                  as c2pa_signed_count,
  count(*) filter (where c2pa_signed = false)                 as c2pa_pending_count,
  round(
    100.0 * count(*) filter (where c2pa_signed = true)
    / nullif(count(*), 0), 1
  )                                                           as compliance_pct
from public.calendar_posts
where ai_generated = true;
