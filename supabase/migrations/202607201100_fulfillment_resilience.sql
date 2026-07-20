-- Keep paid-order fulfillment recoverable under worker crashes and transient
-- failures. Inventory mutations below run in a single database transaction and
-- are accepted only while the caller still owns the order fulfillment lease.

create or replace function public.renew_order_fulfillment_claim(
  p_order_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer := 0;
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 900));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server only';
  end if;
  if p_order_id is null or nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'Order id and worker id are required';
  end if;

  -- Whichever transaction updates the order row first wins. A stale worker can
  -- never renew a lease after a replacement worker has claimed the order.
  update public.orders
     set fulfillment_locked_until = v_now + make_interval(secs => v_lease_seconds)
   where id = p_order_id
     and fulfillment_worker_id = p_worker_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.release_fulfillment_inventory_atomic(
  p_fulfillment_id uuid,
  p_worker_id text,
  p_note text default 'reallocated',
  p_reserved_slot_ids uuid[] default '{}'::uuid[],
  p_reserved_license_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_slot_ids uuid[] := '{}'::uuid[];
  v_license_ids uuid[] := '{}'::uuid[];
  v_allocations integer := 0;
  v_slots integer := 0;
  v_licenses integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server only';
  end if;
  if p_fulfillment_id is null or nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'Fulfillment id and worker id are required';
  end if;

  select f.order_id
    into v_order_id
    from public.fulfillments f
   where f.id = p_fulfillment_id;
  if not found then
    raise exception 'Fulfillment not found';
  end if;

  -- Lock and validate the order before touching inventory. If the lease expired
  -- and another worker claimed it, this stale worker is rejected atomically.
  perform 1
    from public.orders o
   where o.id = v_order_id
     and o.fulfillment_worker_id = p_worker_id
     and o.fulfillment_locked_until > clock_timestamp()
   for update;
  if not found then
    raise exception 'Fulfillment claim was lost before inventory release'
      using errcode = '40001';
  end if;

  perform a.id
    from public.fulfillment_allocations a
   where a.fulfillment_id = p_fulfillment_id
     and a.status = 'active'
   order by a.id
   for update;

  select
    coalesce(array_agg(distinct a.slot_id) filter (where a.slot_id is not null), '{}'::uuid[]),
    coalesce(array_agg(distinct a.license_id) filter (where a.license_id is not null), '{}'::uuid[])
    into v_slot_ids, v_license_ids
    from public.fulfillment_allocations a
   where a.fulfillment_id = p_fulfillment_id
     and a.status = 'active';

  select coalesce(array_agg(distinct value), '{}'::uuid[])
    into v_slot_ids
    from unnest(coalesce(v_slot_ids, '{}'::uuid[]) || coalesce(p_reserved_slot_ids, '{}'::uuid[])) value;
  select coalesce(array_agg(distinct value), '{}'::uuid[])
    into v_license_ids
    from unnest(coalesce(v_license_ids, '{}'::uuid[]) || coalesce(p_reserved_license_ids, '{}'::uuid[])) value;

  update public.fulfillment_allocations
     set status = 'expired',
         admin_notes = concat_ws(E'\n', nullif(admin_notes, ''), nullif(left(coalesce(p_note, ''), 500), '')),
         sheet_version = coalesce(sheet_version, 0) + 1
   where fulfillment_id = p_fulfillment_id
     and status = 'active';
  get diagnostics v_allocations = row_count;

  update public.inventory_slots s
     set status = 'available',
         updated_at = clock_timestamp()
   where s.id = any(v_slot_ids)
     and not exists (
       select 1 from public.fulfillment_allocations a
        where a.slot_id = s.id and a.status = 'active'
     );
  get diagnostics v_slots = row_count;

  update public.inventory_licenses l
     set status = 'available',
         updated_at = clock_timestamp()
   where l.id = any(v_license_ids)
     and not exists (
       select 1 from public.fulfillment_allocations a
        where a.license_id = l.id and a.status = 'active'
     );
  get diagnostics v_licenses = row_count;

  return jsonb_build_object(
    'success', true,
    'fulfillment_id', p_fulfillment_id,
    'released_allocations', v_allocations,
    'released_slots', v_slots,
    'released_licenses', v_licenses
  );
end;
$$;

create or replace function public.allocate_fulfillment_licenses_atomic(
  p_fulfillment_id uuid,
  p_service_id text,
  p_quantity integer,
  p_ends_at timestamptz,
  p_worker_id text
)
returns table(
  allocation_id uuid,
  license_id uuid,
  label text,
  encrypted_secret text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_fulfillment_service text;
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server only';
  end if;
  if p_quantity < 1 or p_quantity > 500 then
    raise exception 'Invalid quantity';
  end if;
  if nullif(btrim(coalesce(p_service_id, '')), '') is null
     or nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'Service id and worker id are required';
  end if;

  select f.order_id, f.service_id
    into v_order_id, v_fulfillment_service
    from public.fulfillments f
   where f.id = p_fulfillment_id;
  if not found or v_fulfillment_service is distinct from p_service_id then
    raise exception 'Fulfillment service mismatch';
  end if;

  perform 1
    from public.orders o
   where o.id = v_order_id
     and o.fulfillment_worker_id = p_worker_id
     and o.fulfillment_locked_until > clock_timestamp()
   for update;
  if not found then
    raise exception 'Fulfillment claim was lost before license allocation'
      using errcode = '40001';
  end if;

  return query
  with candidates as (
    select l.id
      from public.inventory_licenses l
     where l.service_id = p_service_id
       and l.status = 'available'
     order by l.created_at, l.id
     for update skip locked
     limit p_quantity
  ), marked as (
    update public.inventory_licenses l
       set status = 'assigned', updated_at = clock_timestamp()
      from candidates c
     where l.id = c.id
    returning l.id, l.label, l.encrypted_secret
  ), allocated as (
    insert into public.fulfillment_allocations(
      fulfillment_id, license_id, ends_at
    )
    select p_fulfillment_id, m.id, p_ends_at
      from marked m
    returning id, fulfillment_allocations.license_id
  )
  select a.id, m.id, m.label, m.encrypted_secret
    from marked m
    join allocated a on a.license_id = m.id
   order by m.id;

  get diagnostics v_count = row_count;
  if v_count <> p_quantity then
    -- Raising rolls back both the license status changes and allocations.
    raise exception 'OUT_OF_STOCK';
  end if;
end;
$$;

revoke all on function public.renew_order_fulfillment_claim(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.release_fulfillment_inventory_atomic(uuid,text,text,uuid[],uuid[]) from public, anon, authenticated;
revoke all on function public.allocate_fulfillment_licenses_atomic(uuid,text,integer,timestamptz,text) from public, anon, authenticated;
grant execute on function public.renew_order_fulfillment_claim(uuid,text,integer) to service_role;
grant execute on function public.release_fulfillment_inventory_atomic(uuid,text,text,uuid[],uuid[]) to service_role;
grant execute on function public.allocate_fulfillment_licenses_atomic(uuid,text,integer,timestamptz,text) to service_role;
