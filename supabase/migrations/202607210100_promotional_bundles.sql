-- Server-authoritative promotional bundles and reusable shared-profile stock.
--
-- A bundle gift is appended to the verified order snapshot by a database
-- trigger. The browser can display an offer, but it can neither manufacture a
-- free item nor change its quantity, duration, allocation policy, or price.

create table if not exists public.service_bundle_rules (
  id uuid primary key default gen_random_uuid(),
  source_service_id text not null references public.services(id) on delete cascade,
  source_duration_idx integer not null check (source_duration_idx >= 0),
  source_type_idx integer,
  gift_service_id text not null references public.services(id) on delete restrict,
  gift_duration_strategy text not null default 'same'
    check (gift_duration_strategy in ('same', 'fixed')),
  gift_duration_idx integer,
  gift_quantity integer not null default 1 check (gift_quantity between 1 and 20),
  quantity_mode text not null default 'fixed'
    check (quantity_mode in ('fixed', 'per_unit', 'per_screen')),
  allocation_policy text not null default 'shared_reusable'
    check (allocation_policy in ('shared_reusable', 'exclusive')),
  inventory_pool text not null default 'promotion_shared'
    check (inventory_pool in ('promotion_shared', 'standard')),
  include_renewals boolean not null default false,
  label_i18n jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_type_idx is null or source_type_idx >= 0),
  check (gift_duration_idx is null or gift_duration_idx >= 0),
  check (gift_duration_strategy <> 'fixed' or gift_duration_idx is not null),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create unique index if not exists service_bundle_rules_unique_offer_idx
  on public.service_bundle_rules (
    source_service_id,
    source_duration_idx,
    coalesce(source_type_idx, -1),
    gift_service_id
  );
create index if not exists service_bundle_rules_lookup_idx
  on public.service_bundle_rules (source_service_id, source_duration_idx, active, priority);

alter table public.inventory_accounts
  add column if not exists pool_kind text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.inventory_accounts'::regclass
       and conname = 'inventory_accounts_pool_kind_check'
  ) then
    alter table public.inventory_accounts
      add constraint inventory_accounts_pool_kind_check
      check (pool_kind in ('standard', 'promotion_shared'));
  end if;
end;
$$;

alter table public.inventory_slots
  add column if not exists max_shared_allocations integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.inventory_slots'::regclass
       and conname = 'inventory_slots_max_shared_allocations_check'
  ) then
    alter table public.inventory_slots
      add constraint inventory_slots_max_shared_allocations_check
      check (max_shared_allocations is null or max_shared_allocations > 0);
  end if;
end;
$$;

create index if not exists inventory_accounts_service_pool_idx
  on public.inventory_accounts (service_id, pool_kind, status, created_at);

create table if not exists public.order_benefits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  source_item_index integer not null check (source_item_index >= 0),
  gift_item_index integer not null check (gift_item_index >= 0),
  rule_id uuid not null references public.service_bundle_rules(id) on delete restrict,
  gift_service_id text not null references public.services(id) on delete restrict,
  duration_months integer not null check (duration_months between 1 and 120),
  quantity integer not null default 1 check (quantity between 1 and 100),
  allocation_policy text not null default 'shared_reusable',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'allocated', 'delivered', 'awaiting_stock', 'failed', 'cancelled', 'expired')),
  fulfillment_id uuid references public.fulfillments(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, rule_id, source_item_index)
);

create index if not exists order_benefits_order_idx
  on public.order_benefits (order_id, gift_item_index);
create index if not exists order_benefits_fulfillment_idx
  on public.order_benefits (fulfillment_id) where fulfillment_id is not null;

create table if not exists public.shared_profile_allocations (
  id uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references public.fulfillments(id) on delete cascade,
  benefit_id uuid not null references public.order_benefits(id) on delete cascade,
  account_id uuid not null references public.inventory_accounts(id) on delete restrict,
  slot_id uuid not null references public.inventory_slots(id) on delete restrict,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked', 'cancelled')),
  renewal_count integer not null default 0,
  sheet_version integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fulfillment_id, benefit_id, slot_id)
);

create index if not exists shared_profile_allocations_fulfillment_idx
  on public.shared_profile_allocations (fulfillment_id, status);
create index if not exists shared_profile_allocations_slot_load_idx
  on public.shared_profile_allocations (slot_id, status, ends_at);
create index if not exists shared_profile_allocations_benefit_idx
  on public.shared_profile_allocations (benefit_id, status);

alter table public.service_bundle_rules enable row level security;
alter table public.order_benefits enable row level security;
alter table public.shared_profile_allocations enable row level security;

drop policy if exists service_bundle_rules_public_read on public.service_bundle_rules;
create policy service_bundle_rules_public_read on public.service_bundle_rules
  for select using (
    public.is_admin()
    or (
      active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now())
    )
  );

drop policy if exists service_bundle_rules_admin_write on public.service_bundle_rules;
create policy service_bundle_rules_admin_write on public.service_bundle_rules
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists order_benefits_owner_read on public.order_benefits;
create policy order_benefits_owner_read on public.order_benefits
  for select using (
    public.is_admin()
    or exists (
      select 1
        from public.orders o
       where o.id = order_benefits.order_id
         and (
           o.user_id = auth.uid()
           or (
             o.user_id is null
             and lower(coalesce(o.customer_info->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
           )
         )
    )
  );

drop policy if exists order_benefits_admin_write on public.order_benefits;
create policy order_benefits_admin_write on public.order_benefits
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists shared_profile_allocations_owner_read on public.shared_profile_allocations;
create policy shared_profile_allocations_owner_read on public.shared_profile_allocations
  for select using (
    public.is_admin()
    or exists (
      select 1
        from public.fulfillments f
        join public.orders o on o.id = f.order_id
       where f.id = shared_profile_allocations.fulfillment_id
         and (
           o.user_id = auth.uid()
           or (
             o.user_id is null
             and lower(coalesce(o.customer_info->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
           )
         )
    )
  );

drop policy if exists shared_profile_allocations_admin_write on public.shared_profile_allocations;
create policy shared_profile_allocations_admin_write on public.shared_profile_allocations
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.service_bundle_rules to anon, authenticated;
grant select on public.order_benefits, public.shared_profile_allocations to authenticated;

-- Remove all promotion-control fields supplied by a client, then append gifts
-- from active server rules. This trigger runs after create_order_secure has
-- completed its normal price verification, and before the order is inserted.
create or replace function public.orders_attach_active_bundle_gifts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source jsonb;
  v_clean jsonb;
  v_clean_items jsonb := '[]'::jsonb;
  v_source_ordinal bigint;
  v_rule record;
  v_gift public.services%rowtype;
  v_gift_duration_idx integer;
  v_duration_months integer;
  v_gift_quantity integer;
  v_duration_labels jsonb;
begin
  if new.items is null or jsonb_typeof(new.items) <> 'array' then
    return new;
  end if;

  for v_source, v_source_ordinal in
    select value, ordinality
      from jsonb_array_elements(new.items) with ordinality
  loop
    v_clean := v_source - array[
      'promotion_gift', 'is_promotional_gift', 'included_free',
      'bundle_rule_id', 'bundle_source_item_index', 'bundle_label_i18n',
      'allocation_policy', 'inventory_pool', 'fulfillment_mode_override',
      'gift_duration_months', 'benefit_id', 'renewal'
    ]::text[];
    v_clean_items := v_clean_items || jsonb_build_array(v_clean);
  end loop;
  new.items := v_clean_items;

  -- Renewal orders extend the original subscription and deliberately do not
  -- create another free entitlement unless a rule explicitly opts in later.
  if lower(coalesce(new.customer_info->>'order_kind', '')) = 'renewal' then
    return new;
  end if;

  for v_source, v_source_ordinal in
    select value, ordinality
      from jsonb_array_elements(v_clean_items) with ordinality
  loop
    for v_rule in
      select r.*
        from public.service_bundle_rules r
       where r.active
         and r.source_service_id = v_source->>'id'
         and r.source_duration_idx = coalesce((v_source->>'durIdx')::integer, 0)
         and (r.source_type_idx is null or r.source_type_idx = coalesce((v_source->>'typeIdx')::integer, 0))
         and not r.include_renewals
         and (r.starts_at is null or r.starts_at <= clock_timestamp())
         and (r.ends_at is null or r.ends_at > clock_timestamp())
       order by r.priority, r.created_at, r.id
    loop
      select * into v_gift from public.services where id = v_rule.gift_service_id;
      if not found then
        continue;
      end if;

      v_gift_duration_idx := case
        when v_rule.gift_duration_strategy = 'fixed' then v_rule.gift_duration_idx
        else coalesce((v_source->>'durIdx')::integer, 0)
      end;
      v_duration_months := (array[1, 2, 3, 6, 12])[
        least(greatest(coalesce(v_gift_duration_idx, 0) + 1, 1), 5)
      ];
      v_gift_quantity := least(100, case v_rule.quantity_mode
        when 'per_unit' then v_rule.gift_quantity * greatest(1, coalesce((v_source->>'qty')::integer, 1))
        when 'per_screen' then v_rule.gift_quantity
          * greatest(1, coalesce((v_source->>'qty')::integer, 1))
          * greatest(1, coalesce((v_source->>'typeIdx')::integer, 0) + 1)
        else v_rule.gift_quantity
      end);
      v_duration_labels := case v_gift_duration_idx
        when 0 then jsonb_build_object('ar', 'شهر واحد', 'fr', '1 mois', 'en', '1 month')
        when 1 then jsonb_build_object('ar', 'شهران', 'fr', '2 mois', 'en', '2 months')
        when 2 then jsonb_build_object('ar', '3 أشهر', 'fr', '3 mois', 'en', '3 months')
        when 3 then jsonb_build_object('ar', '6 أشهر', 'fr', '6 mois', 'en', '6 months')
        when 4 then jsonb_build_object('ar', 'سنة كاملة', 'fr', '1 an', 'en', '1 year')
        else coalesce(v_source->'durLabelData', '{}'::jsonb)
      end;

      new.items := new.items || jsonb_build_array(jsonb_build_object(
        'id', v_gift.id,
        'name', coalesce(v_gift.n->>'ar', v_gift.n->>'fr', v_gift.n->>'en', v_gift.id),
        'title', coalesce(v_gift.n->>'ar', v_gift.n->>'fr', v_gift.n->>'en', v_gift.id),
        'nameData', v_gift.n,
        'durIdx', v_gift_duration_idx,
        'durMonths', v_duration_months,
        'durLabel', coalesce(v_duration_labels->>'ar', v_duration_labels->>'fr', v_duration_labels->>'en', ''),
        'durLabelData', v_duration_labels,
        'typeIdx', 0,
        'typeLabel', '',
        'typeLabelData', coalesce(v_gift.types, '{}'::jsonb),
        'qty', v_gift_quantity,
        'unitPrice', 0,
        'price', 0,
        'iconType', v_gift.icon_type,
        'iconSrc', v_gift.icon_src,
        'bg', v_gift.bg,
        'promotion_gift', true,
        'is_promotional_gift', true,
        'included_free', true,
        'bundle_rule_id', v_rule.id,
        'bundle_source_item_index', v_source_ordinal - 1,
        'bundle_label_i18n', v_rule.label_i18n,
        'allocation_policy', v_rule.allocation_policy,
        'inventory_pool', v_rule.inventory_pool,
        'fulfillment_mode_override', case
          when v_rule.allocation_policy = 'shared_reusable' then 'automatic_shared_slot'
          else null
        end,
        'gift_duration_months', v_duration_months
      ));
    end loop;
  end loop;

  return new;
end;
$$;

drop trigger if exists orders_attach_active_bundle_gifts_trigger on public.orders;
create trigger orders_attach_active_bundle_gifts_trigger
before insert on public.orders
for each row execute function public.orders_attach_active_bundle_gifts();

create or replace function public.orders_record_bundle_benefits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_ordinal bigint;
  v_rule_id uuid;
begin
  for v_item, v_ordinal in
    select value, ordinality
      from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) with ordinality
  loop
    if not coalesce((v_item->>'is_promotional_gift')::boolean, false) then
      continue;
    end if;
    if coalesce(v_item->>'bundle_rule_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      continue;
    end if;
    v_rule_id := (v_item->>'bundle_rule_id')::uuid;
    if not exists (select 1 from public.service_bundle_rules where id = v_rule_id) then
      continue;
    end if;

    insert into public.order_benefits (
      order_id,
      source_item_index,
      gift_item_index,
      rule_id,
      gift_service_id,
      duration_months,
      quantity,
      allocation_policy,
      metadata
    ) values (
      new.id,
      greatest(0, coalesce((v_item->>'bundle_source_item_index')::integer, 0)),
      v_ordinal - 1,
      v_rule_id,
      v_item->>'id',
      greatest(1, coalesce((v_item->>'gift_duration_months')::integer, 1)),
      greatest(1, coalesce((v_item->>'qty')::integer, 1)),
      coalesce(v_item->>'allocation_policy', 'shared_reusable'),
      jsonb_build_object(
        'label_i18n', coalesce(v_item->'bundle_label_i18n', '{}'::jsonb),
        'inventory_pool', coalesce(v_item->>'inventory_pool', 'promotion_shared')
      )
    )
    on conflict (order_id, rule_id, source_item_index) do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists orders_record_bundle_benefits_trigger on public.orders;
create trigger orders_record_bundle_benefits_trigger
after insert on public.orders
for each row execute function public.orders_record_bundle_benefits();

-- Allocate shared promotional profiles atomically. A profile is intentionally
-- not marked assigned and can therefore serve multiple active gift recipients.
-- Selection balances load across all six Prime profiles before reusing one.
create or replace function public.allocate_shared_promotion_slots_atomic(
  p_fulfillment_id uuid,
  p_benefit_id uuid,
  p_service_id text,
  p_quantity integer,
  p_ends_at timestamptz,
  p_worker_id text
)
returns table (
  allocation_id uuid,
  account_id uuid,
  slot_id uuid,
  account_label text,
  slot_label text,
  encrypted_credentials text,
  credentials_version integer,
  encrypted_secret text,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_fulfillment_service text;
  v_benefit public.order_benefits%rowtype;
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server only';
  end if;
  if p_quantity < 1 or p_quantity > 20 then
    raise exception 'Invalid quantity';
  end if;
  if nullif(btrim(coalesce(p_worker_id, '')), '') is null
     or nullif(btrim(coalesce(p_service_id, '')), '') is null then
    raise exception 'Worker id and service id are required';
  end if;

  select f.order_id, f.service_id
    into v_order_id, v_fulfillment_service
    from public.fulfillments f
   where f.id = p_fulfillment_id;
  if not found or v_fulfillment_service is distinct from p_service_id then
    raise exception 'Fulfillment service mismatch';
  end if;

  select * into v_benefit
    from public.order_benefits b
   where b.id = p_benefit_id
     and b.order_id = v_order_id
     and b.gift_service_id = p_service_id
   for update;
  if not found then
    raise exception 'Promotion benefit mismatch';
  end if;

  perform 1
    from public.orders o
   where o.id = v_order_id
     and o.fulfillment_worker_id = p_worker_id
     and o.fulfillment_locked_until > clock_timestamp()
   for update;
  if not found then
    raise exception 'Fulfillment claim was lost before shared profile allocation'
      using errcode = '40001';
  end if;

  -- Idempotent replay: return the exact active rows already committed for the
  -- fulfillment instead of consuming a different profile.
  return query
    select a.id, a.account_id, a.slot_id, account.label, slot.label,
           account.encrypted_credentials, account.credentials_version,
           slot.encrypted_secret, a.ends_at
      from public.shared_profile_allocations a
      join public.inventory_accounts account on account.id = a.account_id
      join public.inventory_slots slot on slot.id = a.slot_id
     where a.fulfillment_id = p_fulfillment_id
       and a.benefit_id = p_benefit_id
       and a.status = 'active'
     order by a.created_at, a.id;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    if v_count <> p_quantity then
      raise exception 'Promotion allocation quantity mismatch';
    end if;
    return;
  end if;

  return query
  with candidates as materialized (
    select slot.id as slot_id, account.id as account_id,
           account.label as account_label, slot.label as slot_label,
           account.encrypted_credentials, account.credentials_version,
           slot.encrypted_secret
      from public.inventory_slots slot
      join public.inventory_accounts account on account.id = slot.account_id
     where account.service_id = p_service_id
       and account.status = 'active'
       and account.pool_kind = 'promotion_shared'
       and slot.status in ('available', 'assigned')
       and (
         slot.max_shared_allocations is null
         or (
           select count(*)
             from public.shared_profile_allocations load
            where load.slot_id = slot.id
              and load.status = 'active'
              and (load.ends_at is null or load.ends_at > clock_timestamp())
         ) < slot.max_shared_allocations
       )
     order by (
       select count(*)
         from public.shared_profile_allocations load
        where load.slot_id = slot.id
          and load.status = 'active'
          and (load.ends_at is null or load.ends_at > clock_timestamp())
     ),
     account.created_at,
     coalesce(((regexp_match(slot.label, '[0-9]+'))[1])::integer, 2147483647),
     slot.created_at,
     slot.id
     for update of slot, account skip locked
     limit p_quantity
  ), inserted as (
    insert into public.shared_profile_allocations (
      fulfillment_id, benefit_id, account_id, slot_id, ends_at,
      metadata
    )
    select p_fulfillment_id, p_benefit_id, c.account_id, c.slot_id, p_ends_at,
           jsonb_build_object('allocation_policy', 'shared_reusable', 'source', 'promotional_bundle')
      from candidates c
    returning id, shared_profile_allocations.account_id, shared_profile_allocations.slot_id,
              shared_profile_allocations.ends_at
  )
  select i.id, i.account_id, i.slot_id, c.account_label, c.slot_label,
         c.encrypted_credentials, c.credentials_version,
         c.encrypted_secret, i.ends_at
    from inserted i
    join candidates c on c.slot_id = i.slot_id
   order by c.account_label,
            coalesce(((regexp_match(c.slot_label, '[0-9]+'))[1])::integer, 2147483647),
            c.slot_label;
  get diagnostics v_count = row_count;
  if v_count <> p_quantity then
    raise exception 'OUT_OF_STOCK';
  end if;

  update public.order_benefits
     set status = 'allocated',
         fulfillment_id = p_fulfillment_id,
         updated_at = clock_timestamp(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'allocated_count', v_count,
           'allocated_at', clock_timestamp()
         )
   where id = p_benefit_id;
end;
$$;

revoke all on function public.allocate_shared_promotion_slots_atomic(uuid,uuid,text,integer,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.allocate_shared_promotion_slots_atomic(uuid,uuid,text,integer,timestamptz,text)
  to service_role;

-- Extend atomic credential rotation so a Prime account update reaches both
-- exclusive subscribers and every active shared-promotion recipient in the
-- same transaction. Expected rows use allocation_kind='shared' for the new
-- table; omitted allocation_kind remains backwards-compatible as 'standard'.
create or replace function public.ops_update_inventory_account_credentials_atomic(
  p_account_id uuid,
  p_expected_credentials text,
  p_expected_credentials_version integer,
  p_new_credentials text,
  p_expected_allocations jsonb,
  p_fulfillment_updates jsonb,
  p_actor_id uuid,
  p_before_data jsonb,
  p_after_data jsonb,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.inventory_accounts%rowtype;
  v_actual_allocation_count integer := 0;
  v_expected_allocation_count integer := 0;
  v_distinct_expected_allocation_count integer := 0;
  v_current_fulfillment_count integer := 0;
  v_update_count integer := 0;
  v_distinct_update_count integer := 0;
  v_rows integer := 0;
  v_update jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_actor_id is null or not exists (
    select 1 from public.admin_users where user_id = p_actor_id
  ) then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if coalesce(p_new_credentials, '') = '' then
    raise exception 'Encrypted credentials are required';
  end if;
  if jsonb_typeof(coalesce(p_expected_allocations, 'null'::jsonb)) <> 'array' then
    raise exception 'Expected allocations must be a JSON array';
  end if;
  if jsonb_typeof(coalesce(p_fulfillment_updates, 'null'::jsonb)) <> 'array' then
    raise exception 'Fulfillment updates must be a JSON array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_expected_allocations) item
     where coalesce(nullif(item->>'allocation_kind', ''), 'standard') not in ('standard', 'shared')
  ) then
    raise exception 'Unknown allocation kind';
  end if;

  select * into v_account
    from public.inventory_accounts
   where id = p_account_id
   for update;
  if not found then raise exception 'Account not found'; end if;
  if v_account.encrypted_credentials is distinct from p_expected_credentials
     or coalesce(v_account.credentials_version, 0) <> coalesce(p_expected_credentials_version, 0) then
    raise exception 'Account credentials changed while this update was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  perform a.id
    from public.fulfillment_allocations a
   where a.account_id = p_account_id and a.status = 'active'
   order by a.id for update;
  perform a.id
    from public.shared_profile_allocations a
   where a.account_id = p_account_id and a.status = 'active'
   order by a.id for update;

  select
    (select count(*) from public.fulfillment_allocations a
      where a.account_id = p_account_id and a.status = 'active')
    +
    (select count(*) from public.shared_profile_allocations a
      where a.account_id = p_account_id and a.status = 'active')
    into v_actual_allocation_count;
  select count(*), count(distinct (
           coalesce(nullif(item->>'allocation_kind', ''), 'standard') || ':' || coalesce(item->>'id', '')
         ))
    into v_expected_allocation_count, v_distinct_expected_allocation_count
    from jsonb_array_elements(p_expected_allocations) item;

  if v_expected_allocation_count <> v_distinct_expected_allocation_count
     or v_expected_allocation_count <> v_actual_allocation_count
     or exists (
       select 1 from public.fulfillment_allocations a
        where a.account_id = p_account_id and a.status = 'active'
          and not exists (
            select 1 from jsonb_array_elements(p_expected_allocations) expected
             where coalesce(nullif(expected->>'allocation_kind', ''), 'standard') = 'standard'
               and expected->>'id' = a.id::text
               and expected->>'fulfillment_id' = a.fulfillment_id::text
               and coalesce(expected->>'slot_id', '') = coalesce(a.slot_id::text, '')
               and coalesce((expected->>'sheet_version')::integer, 0) = coalesce(a.sheet_version, 0)
               and (
                 (nullif(expected->>'ends_at', '') is null and a.ends_at is null)
                 or a.ends_at = (expected->>'ends_at')::timestamptz
               )
          )
     )
     or exists (
       select 1 from public.shared_profile_allocations a
        where a.account_id = p_account_id and a.status = 'active'
          and not exists (
            select 1 from jsonb_array_elements(p_expected_allocations) expected
             where coalesce(nullif(expected->>'allocation_kind', ''), 'standard') = 'shared'
               and expected->>'id' = a.id::text
               and expected->>'fulfillment_id' = a.fulfillment_id::text
               and expected->>'slot_id' = a.slot_id::text
               and coalesce((expected->>'sheet_version')::integer, 0) = coalesce(a.sheet_version, 0)
               and (
                 (nullif(expected->>'ends_at', '') is null and a.ends_at is null)
                 or a.ends_at = (expected->>'ends_at')::timestamptz
               )
          )
     ) then
    raise exception 'Active subscriptions changed while this update was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  select count(*) into v_current_fulfillment_count
    from (
      select a.fulfillment_id
        from public.fulfillment_allocations a
       where a.account_id = p_account_id and a.status = 'active'
         and (a.ends_at is null or a.ends_at > transaction_timestamp())
      union
      select a.fulfillment_id
        from public.shared_profile_allocations a
       where a.account_id = p_account_id and a.status = 'active'
         and (a.ends_at is null or a.ends_at > transaction_timestamp())
    ) active_fulfillments;

  select count(*), count(distinct item->>'id')
    into v_update_count, v_distinct_update_count
    from jsonb_array_elements(p_fulfillment_updates) item;

  if v_update_count <> v_distinct_update_count
     or v_update_count <> v_current_fulfillment_count
     or exists (
       select 1
         from (
           select a.fulfillment_id
             from public.fulfillment_allocations a
            where a.account_id = p_account_id and a.status = 'active'
              and (a.ends_at is null or a.ends_at > transaction_timestamp())
           union
           select a.fulfillment_id
             from public.shared_profile_allocations a
            where a.account_id = p_account_id and a.status = 'active'
              and (a.ends_at is null or a.ends_at > transaction_timestamp())
         ) active_fulfillments
        where not exists (
          select 1 from jsonb_array_elements(p_fulfillment_updates) change_set
           where change_set->>'id' = active_fulfillments.fulfillment_id::text
        )
     )
     or exists (
       select 1 from jsonb_array_elements(p_fulfillment_updates) change_set
        where coalesce(change_set->>'id', '') = ''
           or coalesce(change_set->>'encrypted_delivery', '') = ''
           or not exists (
             select 1 from (
               select a.fulfillment_id
                 from public.fulfillment_allocations a
                where a.account_id = p_account_id and a.status = 'active'
                  and (a.ends_at is null or a.ends_at > transaction_timestamp())
               union
               select a.fulfillment_id
                 from public.shared_profile_allocations a
                where a.account_id = p_account_id and a.status = 'active'
                  and (a.ends_at is null or a.ends_at > transaction_timestamp())
             ) active_fulfillments
             where active_fulfillments.fulfillment_id::text = change_set->>'id'
           )
     ) then
    raise exception 'Customer deliveries changed while this update was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  perform f.id
    from public.fulfillments f
   where exists (
     select 1 from jsonb_array_elements(p_fulfillment_updates) change_set
      where change_set->>'id' = f.id::text
   )
   order by f.id for update;

  if exists (
    select 1
      from public.fulfillments f
      join lateral jsonb_array_elements(p_fulfillment_updates) change_set
        on change_set->>'id' = f.id::text
     where coalesce(f.encrypted_delivery, '') is distinct from
           coalesce(change_set->>'expected_encrypted_delivery', '')
  ) then
    raise exception 'A customer delivery changed while this update was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  update public.inventory_accounts
     set encrypted_credentials = p_new_credentials,
         credentials_version = coalesce(credentials_version, 0) + 1,
         credentials_updated_at = v_now,
         updated_at = v_now
   where id = p_account_id
     and encrypted_credentials is not distinct from p_expected_credentials
     and coalesce(credentials_version, 0) = coalesce(p_expected_credentials_version, 0);
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Account changed concurrently; refresh and try again' using errcode = '40001';
  end if;

  for v_update in select item from jsonb_array_elements(p_fulfillment_updates) item
  loop
    update public.fulfillments
       set encrypted_delivery = v_update->>'encrypted_delivery',
           sheet_version = coalesce(sheet_version, 0) + 1,
           updated_at = v_now
     where id::text = v_update->>'id'
       and coalesce(encrypted_delivery, '') is not distinct from
           coalesce(v_update->>'expected_encrypted_delivery', '');
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'A customer delivery changed concurrently; no credentials were updated'
        using errcode = '40001';
    end if;
  end loop;

  update public.fulfillment_allocations
     set sheet_version = coalesce(sheet_version, 0) + 1
   where account_id = p_account_id and status = 'active';
  update public.shared_profile_allocations
     set sheet_version = coalesce(sheet_version, 0) + 1,
         updated_at = v_now
   where account_id = p_account_id and status = 'active';

  insert into public.operations_audit_log (
    actor_id, action, entity_type, entity_id, service_id,
    before_data, after_data, metadata
  ) values (
    p_actor_id, 'update_account_credentials', 'inventory_account',
    p_account_id::text, v_account.service_id,
    coalesce(p_before_data, '{}'::jsonb), coalesce(p_after_data, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'credentials_version', coalesce(v_account.credentials_version, 0) + 1,
      'active_allocations', v_actual_allocation_count,
      'atomic_commit', true,
      'shared_promotions_included', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'account_id', p_account_id,
    'credentials_version', coalesce(v_account.credentials_version, 0) + 1,
    'active_allocations', v_actual_allocation_count,
    'updated_fulfillments', v_update_count
  );
end;
$$;

revoke all on function public.ops_update_inventory_account_credentials_atomic(
  uuid, text, integer, text, jsonb, jsonb, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.ops_update_inventory_account_credentials_atomic(
  uuid, text, integer, text, jsonb, jsonb, uuid, jsonb, jsonb, jsonb
) to service_role;

-- Sheet projection remains asynchronous; these events make every benefit and
-- shared assignment visible to the existing outbox worker without making Sheet
-- the source of truth.
create or replace function public.bundle_enqueue_sheet_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row_id text;
  v_order_id uuid;
  v_service_id text;
begin
  -- The current Sheet projection is an upsert-only historical mirror. During a
  -- cascading order/fulfillment delete the parent row is already unavailable,
  -- so enqueueing a DELETE would create an order-scoped event that can never be
  -- resolved and would poison the retry queue. Status transitions are projected
  -- before normal lifecycle cleanup; physical deletes deliberately stay silent.
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_table_name = 'order_benefits' then
    v_row_id := new.id::text;
    v_order_id := new.order_id;
    v_service_id := new.gift_service_id;
  else
    v_row_id := new.id::text;
    select f.order_id, f.service_id into v_order_id, v_service_id
      from public.fulfillments f
     where f.id = new.fulfillment_id;
  end if;

  insert into public.integration_outbox (event_type, aggregate_id, payload)
  values (
    'promotion_benefit_updated',
    v_row_id,
    jsonb_build_object(
      'table', tg_table_name,
      'operation', tg_op,
      'order_id', v_order_id,
      'service_id', v_service_id,
      'inventory', true,
      'source', 'database_trigger'
    )
  );
  return new;
end;
$$;

drop trigger if exists project_order_benefits_to_sheet on public.order_benefits;
create trigger project_order_benefits_to_sheet
after insert or update on public.order_benefits
for each row execute function public.bundle_enqueue_sheet_projection();

drop trigger if exists project_shared_allocations_to_sheet on public.shared_profile_allocations;
create trigger project_shared_allocations_to_sheet
after insert or update on public.shared_profile_allocations
for each row execute function public.bundle_enqueue_sheet_projection();

-- Prime uses six profiles per account. Its storefront fulfillment mode remains
-- unchanged; only a trusted synthetic gift item uses automatic_shared_slot.
insert into public.service_operations_config (
  service_id, inventory_model, profiles_per_account, settings
)
select 'prime', 'profiles', 6,
       jsonb_build_object('promotion_shared_supported', true)
where exists (select 1 from public.services where id = 'prime')
on conflict (service_id) do update set
  inventory_model = 'profiles',
  profiles_per_account = 6,
  settings = coalesce(public.service_operations_config.settings, '{}'::jsonb)
    || jsonb_build_object('promotion_shared_supported', true),
  updated_at = clock_timestamp();

insert into public.service_bundle_rules (
  id, source_service_id, source_duration_idx, gift_service_id,
  gift_duration_strategy, gift_quantity, quantity_mode,
  allocation_policy, inventory_pool, include_renewals, label_i18n,
  active, priority, metadata
)
select
  '9a36e937-5a48-4ea9-8e1f-3e7297da0003'::uuid,
  'netflix', 2, 'prime', 'same', 1, 'fixed',
  'shared_reusable', 'promotion_shared', false,
  jsonb_build_object(
    'ar', 'يشمل بروفايل Prime Video مجانًا لنفس المدة',
    'fr', 'Profil Prime Video offert pendant la même durée',
    'en', 'Includes a free Prime Video profile for the same duration'
  ),
  true, 100, jsonb_build_object('campaign', 'netflix_prime_same_duration')
where exists (select 1 from public.services where id = 'netflix')
  and exists (select 1 from public.services where id = 'prime')
on conflict (id) do update set
  gift_duration_strategy = excluded.gift_duration_strategy,
  gift_quantity = excluded.gift_quantity,
  quantity_mode = excluded.quantity_mode,
  allocation_policy = excluded.allocation_policy,
  inventory_pool = excluded.inventory_pool,
  include_renewals = excluded.include_renewals,
  label_i18n = excluded.label_i18n,
  active = excluded.active,
  priority = excluded.priority,
  metadata = excluded.metadata,
  updated_at = clock_timestamp();

insert into public.service_bundle_rules (
  id, source_service_id, source_duration_idx, gift_service_id,
  gift_duration_strategy, gift_quantity, quantity_mode,
  allocation_policy, inventory_pool, include_renewals, label_i18n,
  active, priority, metadata
)
select
  '9a36e937-5a48-4ea9-8e1f-3e7297da0006'::uuid,
  'netflix', 3, 'prime', 'same', 1, 'fixed',
  'shared_reusable', 'promotion_shared', false,
  jsonb_build_object(
    'ar', 'يشمل بروفايل Prime Video مجانًا لنفس المدة',
    'fr', 'Profil Prime Video offert pendant la même durée',
    'en', 'Includes a free Prime Video profile for the same duration'
  ),
  true, 100, jsonb_build_object('campaign', 'netflix_prime_same_duration')
where exists (select 1 from public.services where id = 'netflix')
  and exists (select 1 from public.services where id = 'prime')
on conflict (id) do update set
  gift_duration_strategy = excluded.gift_duration_strategy,
  gift_quantity = excluded.gift_quantity,
  quantity_mode = excluded.quantity_mode,
  allocation_policy = excluded.allocation_policy,
  inventory_pool = excluded.inventory_pool,
  include_renewals = excluded.include_renewals,
  label_i18n = excluded.label_i18n,
  active = excluded.active,
  priority = excluded.priority,
  metadata = excluded.metadata,
  updated_at = clock_timestamp();

notify pgrst, 'reload schema';
