-- 0041_global_negative_patterns_and_override_rules_v2.sql
--
-- 1. global_negative_patterns  — platform-wide blocklist that applies to ALL brands
-- 2. negative_patterns          — add missing columns (reasoning, source, updated_at)
--                               + unique constraint (brand_id, pattern_text)
-- 3. override_rules             — add missing columns (description, reasoning, is_active, updated_at)
--                               + unique constraint (brand_id, rule_key)
-- 4. RLS policies for the new table
-- 5. Seed global negative patterns

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. global_negative_patterns
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.global_negative_patterns (
  pattern_id    uuid primary key default gen_random_uuid(),
  pattern_text  text not null,
  severity      negpat_severity_type not null default 'HARD_BLOCK',
  category      text not null default 'general',
  description   text,
  is_active     boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- unique: same pattern text only once globally
create unique index if not exists global_negative_patterns_text_uq
  on public.global_negative_patterns (lower(pattern_text));

-- index for active lookup
create index if not exists global_negative_patterns_active_idx
  on public.global_negative_patterns (is_active) where is_active = true;

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'global_neg_pat_updated_at'
  ) then
    create trigger global_neg_pat_updated_at
      before update on public.global_negative_patterns
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- RLS
alter table public.global_negative_patterns enable row level security;

-- All authenticated users can read active global patterns
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='global_negative_patterns' and policyname='gnp_authenticated_read'
  ) then
    create policy gnp_authenticated_read on public.global_negative_patterns
      for select to authenticated
      using (is_active = true);
  end if;
end $$;

-- service_role full access
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename='global_negative_patterns' and policyname='gnp_service_role_all'
  ) then
    create policy gnp_service_role_all on public.global_negative_patterns
      for all to service_role
      using (true) with check (true);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. negative_patterns — add missing columns
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='negative_patterns' and column_name='reasoning'
  ) then
    alter table public.negative_patterns add column reasoning text;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='negative_patterns' and column_name='source'
  ) then
    alter table public.negative_patterns add column source text not null default 'admin';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='negative_patterns' and column_name='updated_at'
  ) then
    alter table public.negative_patterns add column updated_at timestamptz not null default now();
  end if;
end $$;

-- unique constraint: one pattern_text per brand (schema-level dedup)
do $$ begin
  if not exists (
    select 1 from pg_indexes
    where tablename='negative_patterns' and indexname='negative_patterns_brand_text_uq'
  ) then
    create unique index negative_patterns_brand_text_uq
      on public.negative_patterns (brand_id, lower(pattern_text));
  end if;
end $$;

-- updated_at trigger
do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'neg_pat_updated_at'
  ) then
    create trigger neg_pat_updated_at
      before update on public.negative_patterns
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. override_rules — add missing columns
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='override_rules' and column_name='description'
  ) then
    alter table public.override_rules add column description text;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='override_rules' and column_name='reasoning'
  ) then
    alter table public.override_rules add column reasoning text;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='override_rules' and column_name='is_active'
  ) then
    alter table public.override_rules add column is_active boolean not null default true;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='override_rules' and column_name='updated_at'
  ) then
    alter table public.override_rules add column updated_at timestamptz not null default now();
  end if;
end $$;

-- unique constraint: one rule_key per brand
do $$ begin
  if not exists (
    select 1 from pg_indexes
    where tablename='override_rules' and indexname='override_rules_brand_key_uq'
  ) then
    create unique index override_rules_brand_key_uq
      on public.override_rules (brand_id, rule_key);
  end if;
end $$;

-- updated_at trigger
do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'override_rules_updated_at'
  ) then
    create trigger override_rules_updated_at
      before update on public.override_rules
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed global_negative_patterns
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.global_negative_patterns (pattern_text, severity, category, description) values
  -- Alcohol & substances
  ('اشرب', 'HARD_BLOCK', 'alcohol_substances', 'Direct command to drink — prohibited in Saudi/GCC context'),
  ('كحول', 'HARD_BLOCK', 'alcohol_substances', 'Arabic word for alcohol'),
  ('بيرة', 'HARD_BLOCK', 'alcohol_substances', 'Beer in Arabic'),
  ('نبيذ', 'HARD_BLOCK', 'alcohol_substances', 'Wine in Arabic'),
  ('مسكر', 'HARD_BLOCK', 'alcohol_substances', 'Intoxicant/alcohol reference'),
  ('خمر', 'HARD_BLOCK', 'alcohol_substances', 'Alcohol/wine (Quran reference) — highly sensitive'),
  ('alcohol', 'HARD_BLOCK', 'alcohol_substances', 'Alcohol in English'),
  ('beer', 'HARD_BLOCK', 'alcohol_substances', 'Beer in English'),
  ('wine', 'HARD_BLOCK', 'alcohol_substances', 'Wine in English'),
  ('whiskey', 'HARD_BLOCK', 'alcohol_substances', 'Whiskey in English'),
  ('cocktail', 'HARD_BLOCK', 'alcohol_substances', 'Cocktail (alcoholic drink)'),
  ('مخدرات', 'HARD_BLOCK', 'alcohol_substances', 'Drugs/narcotics in Arabic'),
  ('drugs', 'HARD_BLOCK', 'alcohol_substances', 'Drugs in English'),

  -- Gambling
  ('قمار', 'HARD_BLOCK', 'gambling', 'Gambling in Arabic'),
  ('كازينو', 'HARD_BLOCK', 'gambling', 'Casino in Arabic transliteration'),
  ('casino', 'HARD_BLOCK', 'gambling', 'Casino in English'),
  ('gambling', 'HARD_BLOCK', 'gambling', 'Gambling in English'),
  ('bet now', 'HARD_BLOCK', 'gambling', 'Betting call-to-action'),
  ('place your bet', 'HARD_BLOCK', 'gambling', 'Betting call-to-action'),

  -- Adult/explicit content
  ('18+', 'HARD_BLOCK', 'adult_content', 'Adult content age gate — inappropriate for brand use'),
  ('للكبار فقط', 'HARD_BLOCK', 'adult_content', 'For adults only in Arabic'),
  ('محتوى صريح', 'HARD_BLOCK', 'adult_content', 'Explicit content in Arabic'),

  -- Political & sectarian
  ('انتخابات', 'STRONG_WARN', 'political', 'Elections — politically sensitive in GCC'),
  ('حزب', 'STRONG_WARN', 'political', 'Political party in Arabic'),
  ('سياسة', 'STRONG_WARN', 'political', 'Politics in Arabic — avoid in brand content'),
  ('طائفية', 'HARD_BLOCK', 'political', 'Sectarianism in Arabic'),
  ('sectarian', 'HARD_BLOCK', 'political', 'Sectarian reference in English'),

  -- Religious violations
  ('الله كذاب', 'HARD_BLOCK', 'religious', 'Blasphemous Arabic phrase'),
  ('against islam', 'HARD_BLOCK', 'religious', 'Anti-Islamic statement'),
  ('ضد الإسلام', 'HARD_BLOCK', 'religious', 'Anti-Islamic statement in Arabic'),
  ('يهودي', 'STRONG_WARN', 'religious', 'Religious slur context — use with extreme care'),

  -- Discriminatory / hate speech
  ('عنصرية', 'HARD_BLOCK', 'hate_speech', 'Racism in Arabic'),
  ('racism', 'HARD_BLOCK', 'hate_speech', 'Racism in English'),
  ('تمييز', 'STRONG_WARN', 'hate_speech', 'Discrimination in Arabic'),

  -- False claims / regulatory
  ('مضمون 100%', 'STRONG_WARN', 'false_claims', 'Guaranteed 100% — unsubstantiated claim'),
  ('علاج سحري', 'HARD_BLOCK', 'false_claims', 'Miracle cure — prohibited health claim'),
  ('يشفي', 'HARD_BLOCK', 'false_claims', 'Cures (disease) — prohibited health claim unless licensed healthcare'),
  ('cure', 'HARD_BLOCK', 'false_claims', 'Disease cure claim — prohibited unless licensed healthcare'),
  ('guaranteed results', 'STRONG_WARN', 'false_claims', 'Unsubstantiated guarantee'),
  ('clinically proven', 'STRONG_WARN', 'false_claims', 'Requires substantiation — use only with evidence'),

  -- Financial / investment violations
  ('استثمر الآن واربح', 'HARD_BLOCK', 'financial', 'Invest now and earn — unlicensed investment solicitation'),
  ('ضمان ربح', 'HARD_BLOCK', 'financial', 'Guaranteed profit — prohibited financial claim'),
  ('guaranteed profit', 'HARD_BLOCK', 'financial', 'Guaranteed profit in English'),
  ('get rich quick', 'HARD_BLOCK', 'financial', 'Get-rich-quick scheme language'),

  -- Urgency manipulation
  ('ينتهي العرض خلال ثوانٍ', 'SOFT_WARN', 'urgency_manipulation', 'Fake countdown urgency'),
  ('fake urgency', 'SOFT_WARN', 'urgency_manipulation', 'Artificial scarcity/urgency'),
  ('limited time only', 'SOFT_WARN', 'urgency_manipulation', 'Overused urgency phrase — use sparingly')

on conflict (lower(pattern_text)) do nothing;
