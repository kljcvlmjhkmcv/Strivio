-- Trivance is isolated from Strivio's public and operations tables.
create schema if not exists trivance_private;
revoke all on schema trivance_private from public, anon, authenticated;

create table if not exists trivance_private.settings (
  id boolean primary key default true check (id),
  price_dzd integer not null check (price_dzd >= 0),
  home_fee_dzd integer not null check (home_fee_dzd >= 0),
  office_fee_dzd integer not null check (office_fee_dzd >= 0),
  accepting_orders boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into trivance_private.settings (id, price_dzd, home_fee_dzd, office_fee_dzd)
values (true, 2900, 600, 400)
on conflict (id) do nothing;

create table if not exists trivance_private.wilayas (
  code integer primary key,
  name_ar text not null,
  name_latin text not null
);
create table if not exists trivance_private.communes (
  id integer primary key,
  wilaya_code integer not null references trivance_private.wilayas(code),
  name_ar text not null,
  name_latin text not null
);
create index if not exists trivance_communes_wilaya_idx on trivance_private.communes(wilaya_code);

create table if not exists trivance_private.orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  customer_name text not null,
  phone text not null,
  wilaya_code integer not null references trivance_private.wilayas(code),
  commune_id integer not null references trivance_private.communes(id),
  delivery_method text not null check (delivery_method in ('home', 'office')),
  address text not null default '',
  note text not null default '',
  quantity integer not null check (quantity between 1 and 3),
  unit_price_dzd integer not null,
  delivery_fee_dzd integer not null,
  total_dzd integer not null,
  payment_method text not null default 'cash_on_delivery' check (payment_method = 'cash_on_delivery'),
  status text not null default 'pending_phone_confirmation' check (status in ('pending_phone_confirmation','confirmed','cancelled','shipped','delivered')),
  attribution jsonb not null default '{}'::jsonb
);
create index if not exists trivance_orders_created_idx on trivance_private.orders(created_at desc);

create table if not exists trivance_private.rate_limits (
  fingerprint text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 1
);

revoke all on all tables in schema trivance_private from public, anon, authenticated;

create or replace function public.trivance_public_config()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'available', accepting_orders,
    'price', price_dzd,
    'home_fee', home_fee_dzd,
    'office_fee', office_fee_dzd
  ) from trivance_private.settings where id = true;
$$;
revoke all on function public.trivance_public_config() from public, anon, authenticated;
grant execute on function public.trivance_public_config() to service_role;

create or replace function public.trivance_place_order(p_order jsonb, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_settings trivance_private.settings%rowtype;
  v_id uuid;
  v_request_id uuid;
  v_name text := btrim(coalesce(p_order->>'name', ''));
  v_phone text := regexp_replace(coalesce(p_order->>'phone', ''), '[ .()\-]', '', 'g');
  v_address text := btrim(coalesce(p_order->>'address', ''));
  v_note text := btrim(coalesce(p_order->>'note', ''));
  v_delivery text := coalesce(p_order->>'delivery_method', '');
  v_wilaya integer;
  v_commune integer;
  v_quantity integer;
  v_fee integer;
begin
  if p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request'; end if;

  insert into trivance_private.rate_limits (fingerprint, window_started_at, attempt_count)
  values (p_fingerprint, now(), 1)
  on conflict (fingerprint) do update set
    window_started_at = case when trivance_private.rate_limits.window_started_at < now() - interval '10 minutes' then now() else trivance_private.rate_limits.window_started_at end,
    attempt_count = case when trivance_private.rate_limits.window_started_at < now() - interval '10 minutes' then 1 else trivance_private.rate_limits.attempt_count + 1 end
  returning attempt_count into v_count;
  if v_count > 5 then return jsonb_build_object('ok', false, 'rate_limited', true); end if;

  if coalesce(p_order->>'website', '') <> '' then raise exception 'Invalid request'; end if;
  if length(v_name) < 2 or length(v_name) > 80 or v_name ~ '[[:cntrl:]]' then raise exception 'Invalid name'; end if;
  if v_phone ~ '^\+213[567][0-9]{8}$' then v_phone := '0' || substring(v_phone from 5); end if;
  if v_phone !~ '^0[567][0-9]{8}$' then raise exception 'Invalid phone'; end if;
  if length(v_note) > 300 or v_note ~ '[[:cntrl:]]' then raise exception 'Invalid note'; end if;
  if v_delivery not in ('home', 'office') then raise exception 'Invalid delivery'; end if;
  if v_delivery = 'home' and (length(v_address) < 5 or length(v_address) > 180 or v_address ~ '[[:cntrl:]]') then raise exception 'Invalid address'; end if;
  if v_delivery = 'office' then v_address := ''; end if;

  begin
    v_request_id := (p_order->>'request_id')::uuid;
    v_wilaya := (p_order->>'wilaya_code')::integer;
    v_commune := (p_order->>'commune_id')::integer;
    v_quantity := (p_order->>'quantity')::integer;
  exception when others then raise exception 'Invalid selection';
  end;
  if v_quantity not between 1 and 3 then raise exception 'Invalid quantity'; end if;
  if not exists (select 1 from trivance_private.communes where id = v_commune and wilaya_code = v_wilaya) then raise exception 'Invalid location'; end if;

  select * into v_settings from trivance_private.settings where id = true;
  if not found or not v_settings.accepting_orders then raise exception 'Orders unavailable'; end if;
  v_fee := case when v_delivery = 'home' then v_settings.home_fee_dzd else v_settings.office_fee_dzd end;

  insert into trivance_private.orders (
    request_id, customer_name, phone, wilaya_code, commune_id, delivery_method,
    address, note, quantity, unit_price_dzd, delivery_fee_dzd, total_dzd, attribution
  ) values (
    v_request_id, v_name, v_phone, v_wilaya, v_commune, v_delivery,
    v_address, v_note, v_quantity, v_settings.price_dzd, v_fee,
    v_settings.price_dzd * v_quantity + v_fee,
    jsonb_build_object(
      'utm_source', left(coalesce(p_order->'attribution'->>'utm_source', ''), 100),
      'utm_medium', left(coalesce(p_order->'attribution'->>'utm_medium', ''), 100),
      'utm_campaign', left(coalesce(p_order->'attribution'->>'utm_campaign', ''), 100),
      'utm_content', left(coalesce(p_order->'attribution'->>'utm_content', ''), 100),
      'utm_term', left(coalesce(p_order->'attribution'->>'utm_term', ''), 100)
    )
  ) on conflict (request_id) do nothing returning id into v_id;
  if v_id is null then select id into v_id from trivance_private.orders where request_id = v_request_id; end if;
  return jsonb_build_object('ok', true, 'reference', upper(left(replace(v_id::text, '-', ''), 8)));
end;
$$;
revoke all on function public.trivance_place_order(jsonb, text) from public, anon, authenticated;
grant execute on function public.trivance_place_order(jsonb, text) to service_role;
