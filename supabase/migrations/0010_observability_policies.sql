-- OpenClaw — 0010_observability_policies
-- Adds RLS policies for usage_logs + anomaly_records.
--
-- Why: 0001_init.sql enabled RLS on these system-observability tables but
-- never added policies. Without a policy, every INSERT is blocked — including
-- by service_role when the project is configured with the anon key in the
-- service-role slot (a common mis-config flagged in HANDOVER.md).
--
-- Doc §7.2 says: "Tech Copilot has NO policy on brand_profiles — zero access"
-- and similar fine-grained Copilot rules. usage_logs + anomaly_records are
-- written by AI agents via service_role; readable by admin / Tech Copilot.
--
-- This migration:
--   - Allows service_role to INSERT (real service_role bypasses RLS by default
--     anyway, but this is a no-op safety net + documents intent).
--   - Allows authenticated users with `is_admin` JWT claim to read.
--   - Tech Copilot reads anomaly_records (Doc §7.2).
--   - Allows brand-owners to read their own usage_logs (cost transparency).

begin;

-- ── usage_logs ────────────────────────────────────────────────────
drop policy if exists usage_logs_service_insert  on public.usage_logs;
drop policy if exists usage_logs_admin_read       on public.usage_logs;
drop policy if exists usage_logs_owner_read       on public.usage_logs;

create policy usage_logs_service_insert on public.usage_logs
  for insert with check (true);    -- AI agents (service-role) write here

create policy usage_logs_admin_read on public.usage_logs
  for select using (
    auth.role() = 'service_role'
    OR (auth.jwt() ->> 'is_admin')::boolean = true
  );

create policy usage_logs_owner_read on public.usage_logs
  for select using (
    brand_id is not null
    AND brand_id in (
      select brand_id from public.brand_profiles where auth_user_id = auth.uid()
    )
  );

-- ── anomaly_records ───────────────────────────────────────────────
drop policy if exists anomaly_records_service_insert on public.anomaly_records;
drop policy if exists anomaly_records_admin_read      on public.anomaly_records;
drop policy if exists anomaly_records_tech_copilot    on public.anomaly_records;

create policy anomaly_records_service_insert on public.anomaly_records
  for insert with check (true);

create policy anomaly_records_admin_read on public.anomaly_records
  for select using (
    auth.role() = 'service_role'
    OR (auth.jwt() ->> 'is_admin')::boolean = true
  );

-- Tech Copilot — read-only on anomaly_records per Doc §7.2.
create policy anomaly_records_tech_copilot on public.anomaly_records
  for select using ((auth.jwt() ->> 'copilot_role') = 'tech');

commit;
