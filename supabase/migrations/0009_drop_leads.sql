-- OpenClaw — 0009_drop_leads
-- Removes the marketing /apply leads table. The /apply form has been deleted
-- from the UI; no application code references public.leads anymore.

begin;

drop policy if exists leads_anon_insert on public.leads;
drop policy if exists leads_admin_read  on public.leads;

drop index if exists public.idx_leads_email;
drop index if exists public.idx_leads_status_created;

drop table if exists public.leads;

commit;
