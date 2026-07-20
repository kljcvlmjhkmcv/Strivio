-- Serialize fulfillment work per order. The short lease protects inventory from
-- concurrent Edge Function invocations while still recovering automatically if
-- a worker crashes before releasing its claim.

alter table public.orders
  add column if not exists fulfillment_worker_id text,
  add column if not exists fulfillment_locked_until timestamptz;

create index if not exists orders_fulfillment_lease_idx
  on public.orders (fulfillment_locked_until)
  where fulfillment_locked_until is not null;

create or replace function public.claim_order_fulfillment(
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
  v_row_count integer := 0;
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 900));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server only';
  end if;
  if p_order_id is null or nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'Order id and worker id are required';
  end if;

  update public.orders
     set fulfillment_worker_id = p_worker_id,
         fulfillment_locked_until = v_now + make_interval(secs => v_lease_seconds)
   where id = p_order_id
     and (
       fulfillment_locked_until is null
       or fulfillment_locked_until <= v_now
       or fulfillment_worker_id = p_worker_id
     );

  get diagnostics v_row_count = row_count;
  return v_row_count = 1;
end;
$$;

create or replace function public.release_order_fulfillment_claim(
  p_order_id uuid,
  p_worker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server only';
  end if;
  if p_order_id is null or nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'Order id and worker id are required';
  end if;

  update public.orders
     set fulfillment_worker_id = null,
         fulfillment_locked_until = null
   where id = p_order_id
     and fulfillment_worker_id = p_worker_id;

  get diagnostics v_row_count = row_count;
  return v_row_count = 1;
end;
$$;

revoke all on function public.claim_order_fulfillment(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.release_order_fulfillment_claim(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_order_fulfillment(uuid,text,integer) to service_role;
grant execute on function public.release_order_fulfillment_claim(uuid,text) to service_role;
