-- Migration 0078: Layer 6 per-brand patterns + 7th creative formula + calibration period
-- Closes three spec gaps in one migration

-- ── Per-brand content pattern winners/losers (Layer 6) ────────────────────────

create table if not exists public.brand_content_patterns (
  pattern_id      uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brand_profiles(brand_id) on delete cascade,
  pattern_type    text not null,   -- 'winner' | 'loser'
  content_type    text not null,   -- 'product' | 'lifestyle' | 'occasion' | 'brand_story' | 'founder' | 'behind_scenes'
  chain_family    text,            -- 'TF01' | 'TF02' etc — null = cross-chain signal
  formula_used    text,            -- creative formula name
  register_used   text,            -- dialect/register that was used
  occasion        text,            -- null = non-occasion content

  -- Performance signal that triggered this pattern record
  trigger_signal  text not null,   -- '3x_above_avg' | '0.3x_avg' | 'saves_spike' | 'shares_spike' | 'completion_drop'
  avg_engagement_rate  numeric(7,4),
  sample_count         int not null default 1,
  confidence           numeric(4,3) default 0.5,   -- 0.0 – 1.0

  -- Effect on strategy
  content_mix_shift    jsonb,       -- {"product": +5, "lifestyle": -5} — recommended mix adjustment
  is_active            boolean not null default true,
  invalidated_at       timestamptz,
  invalidation_reason  text,

  first_observed_at    timestamptz not null default now(),
  last_updated_at      timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

create index if not exists idx_brand_content_patterns_brand   on public.brand_content_patterns(brand_id);
create index if not exists idx_brand_content_patterns_type    on public.brand_content_patterns(brand_id, pattern_type);
create index if not exists idx_brand_content_patterns_active  on public.brand_content_patterns(brand_id, is_active) where is_active = true;

-- ── 7th creative formula: "Number Reframe" ────────────────────────────────────
-- Spec §4.2 lists 7 formulas; implementation only had 6. Adding the missing one.

insert into public.creative_methods (method_id, name_en, name_ar, description, best_for_sectors, best_for_occasions, best_for_permission_levels, example_hook, notes)
values (
  'number_reframe',
  'Number Reframe',
  'إعادة صياغة الرقم',
  'Makes data emotionally true. Takes a statistic, measurement, or quantity and reframes it so the human meaning lands before the logic does.',
  array['F&B','Retail','Beauty_Wellness','Real_Estate','Healthcare'],
  array['national_day','founding_day','milestone'],
  array['category_leader','challenger','sme_local'],
  'Not 3 years. 1,095 mornings of getting it right.',
  'Spec §4.2 formula 6 — Number Reframe. Added in migration 0078 to complete the 7-formula set.'
)
on conflict (method_id) do nothing;

-- ── Calibration period fields on brand_profiles ───────────────────────────────
-- Tracks whether a brand is in the 90-day calibration window
-- Used by snapshot, dashboard, and COO to contextualise low-confidence recommendations

alter table public.brand_profiles
  add column if not exists is_calibration_period   boolean not null default true,
  add column if not exists calibration_started_at  timestamptz,
  add column if not exists calibration_ends_at     timestamptz,
  add column if not exists calibration_ended_reason text;
  -- calibration_ended_reason: 'performance_data_sufficient' | 'manual_override' | 'elapsed'

-- Auto-set calibration window on first calendar generation
-- (Trigger fires when first calendar row is inserted for this brand)
create or replace function public.start_calibration_period()
returns trigger language plpgsql as $$
declare
  cal_count int;
begin
  -- Only trigger on the FIRST calendar for this brand
  select count(*) into cal_count
  from public.calendars
  where brand_id = new.brand_id;

  if cal_count = 1 then
    update public.brand_profiles
    set
      calibration_started_at = now(),
      calibration_ends_at    = now() + interval '90 days',
      is_calibration_period  = true
    where brand_id = new.brand_id
      and calibration_started_at is null;
  end if;

  return new;
end;
$$;

create trigger trg_start_calibration
  after insert on public.calendars
  for each row execute function public.start_calibration_period();

-- Auto-end calibration when 90 days have elapsed (checked via view)
create or replace view public.v_calibration_status as
select
  bp.brand_id,
  bp.is_calibration_period,
  bp.calibration_started_at,
  bp.calibration_ends_at,
  case
    when bp.calibration_ends_at is null then false
    when now() > bp.calibration_ends_at then true
    else false
  end as is_elapsed,
  case
    when bp.calibration_ends_at is null then null
    else greatest(0, extract(day from (bp.calibration_ends_at - now())))::int
  end as days_remaining
from public.brand_profiles bp;

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.brand_content_patterns enable row level security;

create policy "owner_rw_brand_content_patterns" on public.brand_content_patterns
  for all using (
    brand_id in (
      select brand_id from public.brand_profiles
      where auth_user_id = auth.uid()
    )
  );

create policy "service_role_all_brand_content_patterns" on public.brand_content_patterns
  for all using (auth.role() = 'service_role');
