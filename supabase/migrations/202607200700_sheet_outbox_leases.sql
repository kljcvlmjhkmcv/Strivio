-- Atomic, ordered Google Sheets outbox processing.
-- Only one worker may own live sheet events at a time so later snapshots cannot
-- overtake an earlier failed webhook request.

alter table public.integration_outbox
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text;

-- A Sheet event represents the latest database projection, not an immutable
-- business event. Collapse the historical retry storm to the newest event for
-- each aggregate before starting the ordered worker.
with ranked as (
  select id,
         row_number() over (
           partition by event_type,aggregate_id
           order by id desc
         ) as position
  from public.integration_outbox
  where status in ('pending','failed','processing')
)
update public.integration_outbox o
set status='sent',
    processed_at=now(),
    last_error='Superseded by a newer Sheet projection during queue repair',
    locked_at=null,
    locked_by=null
from ranked r
where o.id=r.id and r.position>1;

create or replace function public.coalesce_sheet_outbox_insert()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_existing_id bigint;
begin
  if nullif(trim(coalesce(new.event_type,'')),'') is null
     or nullif(trim(coalesce(new.aggregate_id,'')),'') is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'strivio:sheet:'||new.event_type||':'||new.aggregate_id,0
  ));

  select id into v_existing_id
  from public.integration_outbox
  where event_type=new.event_type
    and aggregate_id=new.aggregate_id
    and status in ('pending','failed')
  order by id desc
  limit 1
  for update;

  if v_existing_id is not null then
    update public.integration_outbox
    set payload=coalesce(new.payload,'{}'::jsonb),
        status='pending',attempts=0,processed_at=null,last_error=null,
        locked_at=null,locked_by=null
    where id=v_existing_id;
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists coalesce_sheet_outbox_before_insert on public.integration_outbox;
create trigger coalesce_sheet_outbox_before_insert
before insert on public.integration_outbox
for each row execute function public.coalesce_sheet_outbox_insert();

create index if not exists integration_outbox_sheet_queue_idx
  on public.integration_outbox(status, id)
  where attempts < 5;

create index if not exists integration_outbox_sheet_lease_idx
  on public.integration_outbox(locked_at)
  where status = 'processing';

create or replace function public.claim_sheet_outbox(
  p_worker_id text,
  p_limit integer default 8,
  p_lease_seconds integer default 300
)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 20);
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 60), 900);
begin
  if auth.role() <> 'service_role' then
    raise exception 'Server only';
  end if;
  if nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'Worker id is required';
  end if;

  -- Serialize claims globally. Google Sheets is a single ordered projection;
  -- concurrent batches can otherwise finish in the opposite order.
  perform pg_advisory_xact_lock(hashtextextended('strivio:google-sheets-outbox', 0));

  -- A crashed/expired worker counts as a failed attempt. Rows at five attempts
  -- remain failed for inspection and are never claimed again automatically.
  update public.integration_outbox
  set status = 'failed',
      attempts = least(attempts + 1, 5),
      last_error = coalesce(last_error, 'Google Sheets worker lease expired'),
      processed_at = case when attempts + 1 >= 5 then now() else null end,
      locked_at = null,
      locked_by = null
  where status = 'processing'
    and (locked_at is null or locked_at < now() - make_interval(secs => v_lease_seconds));

  -- Do not claim a later batch while an earlier batch still owns its lease.
  if exists (
    select 1
    from public.integration_outbox
    where status = 'processing'
      and locked_at >= now() - make_interval(secs => v_lease_seconds)
  ) then
    return;
  end if;

  return query
  with next_events as (
    select id
    from public.integration_outbox
    where status in ('pending', 'failed')
      and attempts < 5
    order by id
    for update skip locked
    limit v_limit
  )
  update public.integration_outbox as outbox
  set status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      processed_at = null
  from next_events
  where outbox.id = next_events.id
  returning outbox.*;
end;
$$;

create or replace function public.complete_sheet_outbox(
  p_event_id bigint,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Server only';
  end if;

  update public.integration_outbox
  set status = 'sent',
      processed_at = now(),
      last_error = null,
      locked_at = null,
      locked_by = null
  where id = p_event_id
    and status = 'processing'
    and locked_by = p_worker_id;
  return found;
end;
$$;

create or replace function public.renew_sheet_outbox_lease(p_worker_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_renewed integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Server only';
  end if;

  update public.integration_outbox
  set locked_at = now()
  where status = 'processing'
    and locked_by = p_worker_id;
  get diagnostics v_renewed = row_count;
  return v_renewed;
end;
$$;

create or replace function public.fail_sheet_outbox(
  p_event_id bigint,
  p_worker_id text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Server only';
  end if;

  update public.integration_outbox
  set status = 'failed',
      attempts = least(attempts + 1, 5),
      last_error = left(coalesce(nullif(p_error, ''), 'Google Sheets sync failed'), 500),
      processed_at = case when attempts + 1 >= 5 then now() else null end,
      locked_at = null,
      locked_by = null
  where id = p_event_id
    and status = 'processing'
    and locked_by = p_worker_id;
  return found;
end;
$$;

create or replace function public.release_sheet_outbox_lease(p_worker_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Server only';
  end if;

  update public.integration_outbox
  set status = 'pending',
      locked_at = null,
      locked_by = null
  where status = 'processing'
    and locked_by = p_worker_id;
  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

revoke all on function public.claim_sheet_outbox(text, integer, integer) from public;
revoke all on function public.complete_sheet_outbox(bigint, text) from public;
revoke all on function public.renew_sheet_outbox_lease(text) from public;
revoke all on function public.fail_sheet_outbox(bigint, text, text) from public;
revoke all on function public.release_sheet_outbox_lease(text) from public;
revoke all on function public.coalesce_sheet_outbox_insert() from public,anon,authenticated;

grant execute on function public.claim_sheet_outbox(text, integer, integer) to service_role;
grant execute on function public.complete_sheet_outbox(bigint, text) to service_role;
grant execute on function public.renew_sheet_outbox_lease(text) to service_role;
grant execute on function public.fail_sheet_outbox(bigint, text, text) to service_role;
grant execute on function public.release_sheet_outbox_lease(text) to service_role;
