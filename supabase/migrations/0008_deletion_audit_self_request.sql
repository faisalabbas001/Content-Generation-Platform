-- OpenClaw — 0008_deletion_audit_self_request
-- Lets a user log a deletion request for their own brand (PDPL Phase 1).
-- The actual cascade-delete is still service_role + admin-triggered;
-- this row only records the request.

begin;

drop policy if exists client_self_delete_request on public.deletion_audit_log;
create policy client_self_delete_request on public.deletion_audit_log
  for insert with check (
    exists (
      select 1 from public.brand_profiles bp
      where bp.brand_id = deletion_audit_log.brand_id
        and bp.auth_user_id = auth.uid()
    )
  );

-- Self-read so the user can see the status of their own deletion request.
drop policy if exists client_self_delete_read on public.deletion_audit_log;
create policy client_self_delete_read on public.deletion_audit_log
  for select using (
    exists (
      select 1 from public.brand_profiles bp
      where bp.brand_id = deletion_audit_log.brand_id
        and bp.auth_user_id = auth.uid()
    )
  );

commit;
