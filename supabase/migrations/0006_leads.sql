-- OpenClaw — 0006_leads
-- Marketing /apply form submissions (waitlist / sales pipeline).
-- Independent of brand_profiles — applicants don't need an auth account.

begin;

create table if not exists public.leads (
  lead_id           uuid primary key default gen_random_uuid(),
  brand_name_ar     text not null,
  brand_name_en     text,
  sector            sector_type,
  city              text,
  channel           channel_type,
  dialect           dialect_type,
  full_name         text not null,
  email             text not null,
  phone             text,
  notes             text,
  source            text not null default 'apply_form',
  status            text not null default 'new'  -- new | contacted | converted | dropped
                    check (status in ('new','contacted','converted','dropped')),
  user_agent        text,
  ip_hash           text,  -- sha256 of remote_addr (PDPL — no raw IPs)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_leads_email on public.leads (email);
create index if not exists idx_leads_status_created on public.leads (status, created_at desc);

alter table public.leads enable row level security;

-- Anonymous insert (the marketing form is public). No-PII reads only via service_role.
drop policy if exists leads_anon_insert on public.leads;
create policy leads_anon_insert on public.leads
  for insert with check (true);

drop policy if exists leads_admin_read on public.leads;
create policy leads_admin_read on public.leads
  for select using (auth.role() = 'service_role' OR (auth.jwt() ->> 'is_admin')::boolean = true);

commit;
