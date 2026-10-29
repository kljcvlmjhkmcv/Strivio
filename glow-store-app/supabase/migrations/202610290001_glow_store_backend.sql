begin;

create table public.glow_wilayas (
  code smallint primary key check (code between 1 and 69),
  name text not null,
  name_ar text not null
);

create table public.glow_communes (
  id integer primary key,
  post_code text,
  name text not null,
  name_ar text not null,
  wilaya_code smallint not null references public.glow_wilayas(code) on delete restrict,
  daira text,
  daira_ar text,
  unique(id, wilaya_code)
);
create index glow_communes_wilaya_idx on public.glow_communes(wilaya_code, name);

create table public.glow_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create or replace function public.is_glow_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.glow_admins a where a.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_glow_admin() from public, anon;
grant execute on function public.is_glow_admin() to authenticated;

create table public.glow_store_settings (
  id boolean primary key default true check (id),
  bundle_price_dzd integer not null check (bundle_price_dzd between 0 and 10000000),
  delivery_home_dzd integer not null check (delivery_home_dzd between 0 and 1000000),
  delivery_office_dzd integer not null check (delivery_office_dzd between 0 and 1000000)
);
insert into public.glow_store_settings(id, bundle_price_dzd, delivery_home_dzd, delivery_office_dzd)
values (true, 3200, 600, 400);

create table public.glow_products (
  id text primary key check (id in ('foundation', 'powder', 'lipstick')),
  name_en text not null,
  item_price_dzd integer check (item_price_dzd is null or item_price_dzd between 0 and 10000000),
  included_in_bundle boolean not null default false,
  is_active boolean not null default true
);
insert into public.glow_products(id, name_en, included_in_bundle, item_price_dzd) values
  ('foundation', 'Gabrini Derma Foundation', true, null),
  ('powder', 'Gabrini Matte Powder', true, null),
  ('lipstick', 'Gabrini Matte Lipstick Crayon', true, null);

create table public.glow_product_shades (
  product_id text not null references public.glow_products(id) on delete cascade,
  shade_code text not null check (shade_code ~ '^[0-9]{2,3}$'),
  color_hex text not null check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  primary key(product_id, shade_code)
);
insert into public.glow_product_shades(product_id, shade_code, color_hex) values
 ('foundation','101','#E9C4B2'),('foundation','102','#E6BEA8'),('foundation','103','#DDB49E'),('foundation','104','#D2A58C'),
 ('powder','01','#E7D5BE'),('powder','02','#EBD0B4'),
 ('lipstick','01','#A7735A'),('lipstick','02','#94665C'),('lipstick','03','#955D53'),('lipstick','04','#BC6164'),('lipstick','05','#9C6447'),('lipstick','06','#B7705A'),('lipstick','07','#9C5559');

create table public.glow_orders (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  order_number text not null unique,
  created_at timestamptz not null default now(),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  phone text not null check (phone ~ '^0[567][0-9]{8}$'),
  wilaya_code smallint not null references public.glow_wilayas(code),
  commune_id integer not null,
  delivery_method text not null check (delivery_method in ('home', 'office')),
  address text not null default '' check (char_length(address) <= 500),
  foundation_shade text not null,
  powder_shade text not null,
  lipstick_shade text not null,
  bundle_price_dzd integer not null check (bundle_price_dzd between 0 and 10000000),
  delivery_fee_dzd integer not null check (delivery_fee_dzd between 0 and 1000000),
  total_dzd integer not null check (total_dzd = bundle_price_dzd + delivery_fee_dzd),
  status text not null default 'new' check (status in ('new','confirmed','preparing','shipped','delivered','cancelled')),
  updated_at timestamptz not null default now(),
  constraint glow_orders_commune_belongs_to_wilaya
    foreign key (commune_id, wilaya_code) references public.glow_communes(id, wilaya_code),
  constraint glow_orders_shades_match_products check (
    foundation_shade ~ '^[0-9]{3}$' and powder_shade ~ '^[0-9]{2}$' and lipstick_shade ~ '^[0-9]{2}$'
  )
);
create index glow_orders_created_at_idx on public.glow_orders(created_at desc);
create index glow_orders_status_created_idx on public.glow_orders(status, created_at desc);
create index glow_orders_phone_created_idx on public.glow_orders(phone, created_at desc);

create table public.glow_admin_audit (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.glow_orders(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default now()
);

create or replace function public.audit_glow_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.glow_admin_audit(order_id, actor_id, from_status, to_status)
    values (new.id, (select auth.uid()), old.status, new.status);
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger glow_order_status_audit
before update of status on public.glow_orders
for each row execute function public.audit_glow_order_status();

alter table public.glow_wilayas enable row level security;
alter table public.glow_communes enable row level security;
alter table public.glow_admins enable row level security;
alter table public.glow_store_settings enable row level security;
alter table public.glow_products enable row level security;
alter table public.glow_product_shades enable row level security;
alter table public.glow_orders enable row level security;
alter table public.glow_admin_audit enable row level security;

create policy glow_wilayas_public_read on public.glow_wilayas for select to anon, authenticated using (true);
create policy glow_communes_public_read on public.glow_communes for select to anon, authenticated using (true);
create policy glow_products_public_read on public.glow_products for select to anon, authenticated using (is_active);
create policy glow_products_admin_manage on public.glow_products for all to authenticated
  using (public.is_glow_admin() and (select auth.jwt()->>'aal') = 'aal2')
  with check (public.is_glow_admin() and (select auth.jwt()->>'aal') = 'aal2');
create policy glow_shades_public_read on public.glow_product_shades for select to anon, authenticated using (is_active);
create policy glow_shades_admin_manage on public.glow_product_shades for all to authenticated
  using (public.is_glow_admin() and (select auth.jwt()->>'aal') = 'aal2')
  with check (public.is_glow_admin() and (select auth.jwt()->>'aal') = 'aal2');
create policy glow_settings_admin_read on public.glow_store_settings for select to authenticated
  using (public.is_glow_admin() and (select auth.jwt()->>'aal') = 'aal2');
create policy glow_settings_public_pricing_read on public.glow_store_settings for select to anon, authenticated using (true);
create policy glow_settings_admin_update on public.glow_store_settings for update to authenticated
  using (public.is_glow_admin() and (select auth.jwt()->>'aal') = 'aal2')
  with check (public.is_glow_admin() and (select auth.jwt()->>'aal') = 'aal2');
create policy glow_admins_read_own on public.glow_admins for select to authenticated using (user_id = (select auth.uid()));
create policy glow_orders_admin_read on public.glow_orders for select to authenticated
  using (public.is_glow_admin() and (select auth.jwt()->>'aal') = 'aal2');
create policy glow_audit_admin_read on public.glow_admin_audit for select to authenticated
  using (public.is_glow_admin() and (select auth.jwt()->>'aal') = 'aal2');

revoke all on public.glow_admins, public.glow_store_settings, public.glow_orders, public.glow_admin_audit from anon, authenticated;
revoke all on public.glow_wilayas, public.glow_communes, public.glow_products, public.glow_product_shades from anon, authenticated;
grant select on public.glow_wilayas, public.glow_communes to anon, authenticated;
grant select on public.glow_products, public.glow_product_shades to anon, authenticated;
grant select, insert, update, delete on public.glow_products, public.glow_product_shades to authenticated;
grant select on public.glow_store_settings to anon, authenticated;
grant update on public.glow_store_settings to authenticated;
grant select on public.glow_admins, public.glow_orders, public.glow_admin_audit to authenticated;

create or replace function public.submit_glow_order(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_wilaya_code smallint,
  p_commune_id integer,
  p_delivery_method text,
  p_address text,
  p_foundation_shade text,
  p_powder_shade text,
  p_lipstick_shade text,
  p_website text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[[:space:]()-]', '', 'g');
  v_delivery text := coalesce(p_delivery_method, '');
  v_address text := btrim(coalesce(p_address, ''));
  v_price integer;
  v_fee integer;
  v_order_id uuid;
  v_order_number text;
begin
  if coalesce(p_website, '') <> '' then raise exception 'Unable to accept this order'; end if;
  if char_length(v_first) not between 1 and 80 or char_length(v_last) not between 1 and 80 then
    raise exception 'Enter a valid first and last name';
  end if;
  if v_phone ~ '^\+213[567][0-9]{8}$' then
    v_phone := '0' || substr(v_phone, 5);
  elsif v_phone ~ '^00213[567][0-9]{8}$' then
    v_phone := '0' || substr(v_phone, 6);
  elsif v_phone !~ '^0[567][0-9]{8}$' then
    raise exception 'Enter a valid Algerian mobile phone number';
  end if;
  if v_delivery not in ('home', 'office') or char_length(v_address) > 500 then
    raise exception 'Select a valid delivery method and address';
  end if;
  if not exists(select 1 from public.glow_wilayas w where w.code = p_wilaya_code) or
     not exists(select 1 from public.glow_communes c where c.id = p_commune_id and c.wilaya_code = p_wilaya_code) then
    raise exception 'Select a valid wilaya and commune';
  end if;
  if not exists(select 1 from public.glow_product_shades s where s.product_id='foundation' and s.shade_code=p_foundation_shade and s.is_active) or
     not exists(select 1 from public.glow_product_shades s where s.product_id='powder' and s.shade_code=p_powder_shade and s.is_active) or
     not exists(select 1 from public.glow_product_shades s where s.product_id='lipstick' and s.shade_code=p_lipstick_shade and s.is_active) then
    raise exception 'Select available product shades';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_phone, 0));
  if exists(select 1 from public.glow_orders o where o.phone=v_phone and o.created_at > now() - interval '1 minute') then
    raise exception 'Please wait before submitting another order';
  end if;

  select s.bundle_price_dzd,
    case when v_delivery='home' then s.delivery_home_dzd else s.delivery_office_dzd end
    into v_price, v_fee from public.glow_store_settings s where s.id=true;
  if v_price is null or v_fee is null then raise exception 'Orders are temporarily unavailable'; end if;

  v_order_number := 'GS-' || to_char(now() at time zone 'utc', 'YYMMDD') || '-' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 6));
  insert into public.glow_orders(order_number, first_name, last_name, phone, wilaya_code, commune_id,
    delivery_method, address, foundation_shade, powder_shade, lipstick_shade,
    bundle_price_dzd, delivery_fee_dzd, total_dzd)
  values(v_order_number, v_first, v_last, v_phone, p_wilaya_code, p_commune_id,
    v_delivery, v_address, p_foundation_shade, p_powder_shade, p_lipstick_shade,
    v_price, v_fee, v_price + v_fee)
  returning id into v_order_id;

  return jsonb_build_object('order_number', v_order_number, 'bundle_price_dzd', v_price,
    'delivery_fee_dzd', v_fee, 'total_dzd', v_price + v_fee);
end;
$$;
revoke all on function public.submit_glow_order(text,text,text,smallint,integer,text,text,text,text,text,text) from public, authenticated;
grant execute on function public.submit_glow_order(text,text,text,smallint,integer,text,text,text,text,text,text) to anon, authenticated;

create or replace function public.set_glow_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_glow_admin() or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'Administrator MFA is required';
  end if;
  if p_status not in ('new','confirmed','preparing','shipped','delivered','cancelled') then
    raise exception 'Invalid order status';
  end if;
  update public.glow_orders set status=p_status where id=p_order_id;
  if not found then raise exception 'Order not found'; end if;
end;
$$;
revoke all on function public.set_glow_order_status(uuid,text) from public, anon;
grant execute on function public.set_glow_order_status(uuid,text) to authenticated;

commit;
