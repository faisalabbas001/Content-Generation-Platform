-- Migration 0087 — Strategy version increment → auto-log strategy_updates_log
--
-- Gap: strategy_version column is incremented (manually by CEO/agents) but
-- no DB-side mechanism ensures a corresponding row in strategy_updates_log.
-- client_notified stays false forever with no trigger to set it.
--
-- Solution: a BEFORE UPDATE trigger on brand_profiles that fires whenever
-- strategy_version increases. It inserts a strategy_updates_log row with
-- client_notified=false. The notification job (Phase 2 email system) reads
-- strategy_updates_log WHERE client_notified=false and sends the email,
-- then marks client_notified=true. This keeps the trigger lean — it only
-- ensures auditability; delivery is the notification service's job.

begin;

create or replace function public.on_strategy_version_increment()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Only fire when strategy_version actually increased (not just updated)
  if new.strategy_version is not null
     and (old.strategy_version is null or new.strategy_version > old.strategy_version)
  then
    insert into public.strategy_updates_log (
      brand_id,
      strategy_version,
      changed_fields,
      change_summary,
      trigger_type,
      triggered_by,
      client_notified,
      created_at
    ) values (
      new.brand_id,
      new.strategy_version,
      -- Detect which strategic fields actually changed and record them
      array_remove(array[
        case when old.permission_level         is distinct from new.permission_level         then 'permission_level'         end,
        case when old.cultural_tension_owned   is distinct from new.cultural_tension_owned   then 'cultural_tension_owned'   end,
        case when old.creative_formulas_approved is distinct from new.creative_formulas_approved then 'creative_formulas_approved' end,
        case when old.content_mix_ratios       is distinct from new.content_mix_ratios       then 'content_mix_ratios'       end,
        case when old.platform_weights         is distinct from new.platform_weights         then 'platform_weights'         end,
        case when old.goal_phase               is distinct from new.goal_phase               then 'goal_phase'               end,
        case when old.occasion_approach        is distinct from new.occasion_approach        then 'occasion_approach'        end,
        case when old.brave_safe_default       is distinct from new.brave_safe_default       then 'brave_safe_default'       end,
        case when old.archetype_primary        is distinct from new.archetype_primary        then 'archetype_primary'        end,
        case when old.lifecycle_stage          is distinct from new.lifecycle_stage          then 'lifecycle_stage'          end,
        case when old.intent_state             is distinct from new.intent_state             then 'intent_state'             end
      ], null),
      'Strategy updated to v' || new.strategy_version::text,
      'strategy_version_increment',
      'system',
      false,  -- notification service sets this true after sending
      now()
    );
  end if;
  return new;
end;
$$;

-- Drop if already exists from prior attempt, then recreate
drop trigger if exists trg_strategy_version_increment on public.brand_profiles;

create trigger trg_strategy_version_increment
  after update of strategy_version on public.brand_profiles
  for each row
  execute function public.on_strategy_version_increment();

-- Index to let the notification service efficiently poll for unsent notifications
create index if not exists idx_strategy_updates_log_unsent
  on public.strategy_updates_log (brand_id, created_at desc)
  where client_notified = false;

commit;
