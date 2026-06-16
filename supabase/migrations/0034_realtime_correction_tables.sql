-- 0034 — Enable Supabase Realtime for branddna_event_log and memory_controller_queue.
--
-- The brand correction flow (N8N-A04) uses Supabase Realtime instead of
-- server-side polling so the UI reacts instantly when the Memory Controller
-- writes the outcome — same pattern as brand_snapshots on the /processing page.
--
-- branddna_event_log  → client watches for INSERT (client_confirmed / confidence_upgraded)
--                        to detect a successful field write.
-- memory_controller_queue → client watches for UPDATE where status='rejected'
--                            to detect a Memory Controller rejection.
--
-- REPLICA IDENTITY FULL is required for UPDATE payloads (memory_controller_queue)
-- so the Realtime broadcast includes the full new row, not just the PK.
-- branddna_event_log is INSERT-only so DEFAULT is sufficient, but we set FULL
-- for consistency and future-proofing.

begin;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'branddna_event_log'
  ) then
    execute 'alter publication supabase_realtime add table public.branddna_event_log';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'memory_controller_queue'
  ) then
    execute 'alter publication supabase_realtime add table public.memory_controller_queue';
  end if;
end $$;

alter table public.branddna_event_log     replica identity full;
alter table public.memory_controller_queue replica identity full;

commit;
