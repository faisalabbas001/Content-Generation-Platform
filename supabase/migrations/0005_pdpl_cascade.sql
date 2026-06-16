-- OpenClaw — 0005_pdpl_cascade
-- PDPL cascade delete (Doc §7.4). Two-phase:
--   Phase 1 (this SQL function): single atomic Postgres transaction.
--   Phase 2 (TS worker): Qdrant namespace + Supabase Storage folder.

begin;

create or replace function public.cascade_delete_brand(p_brand_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  -- Defensive check
  if p_brand_id is null then
    raise exception 'brand_id is null';
  end if;

  -- 1. QA queue, usage logs, confidence classifications
  delete from public.qa_review_queue           where brand_id = p_brand_id;
  delete from public.usage_logs                where brand_id = p_brand_id;
  delete from public.confidence_classifications where brand_id = p_brand_id;

  -- 2. Append-only tables → anonymise, never delete
  update public.routing_decisions  set brand_id = null where brand_id = p_brand_id;
  update public.branddna_event_log set brand_id = null where brand_id = p_brand_id;

  -- 3. Calendars (cascades to calendar_posts), anomaly records (nullify)
  delete from public.calendars              where brand_id = p_brand_id;
  update public.anomaly_records set brand_id = null where brand_id = p_brand_id;

  -- 4. Queue + patterns + overrides
  delete from public.memory_controller_queue  where brand_id = p_brand_id;
  delete from public.negative_patterns        where brand_id = p_brand_id;
  delete from public.override_rules           where brand_id = p_brand_id;

  -- 5. Sources + evidence (FK cascade handles child bundles via brand_id)
  delete from public.source_records           where brand_id = p_brand_id;
  delete from public.evidence_bundles         where brand_id = p_brand_id;

  -- 6. Snapshots, onboarding responses
  delete from public.brand_snapshots          where brand_id = p_brand_id;
  delete from public.onboarding_responses     where brand_id = p_brand_id;

  -- 7. Sub-profiles
  delete from public.visual_style_profiles    where brand_id = p_brand_id;
  delete from public.audience_profiles        where brand_id = p_brand_id;
  delete from public.channel_profiles         where brand_id = p_brand_id;
  delete from public.brand_performance_log    where brand_id = p_brand_id;

  -- 8. Finally the brand_profiles row
  delete from public.brand_profiles           where brand_id = p_brand_id;

  -- 9. Audit log
  insert into public.deletion_audit_log (brand_id, phase1_complete, deleted_at)
  values (p_brand_id, true, now());
end $$;

revoke all on function public.cascade_delete_brand(uuid) from public;
grant execute on function public.cascade_delete_brand(uuid) to service_role;

commit;
