-- Operations-managed promotional bundles.
-- This migration tightens rule validation, keeps updated_at reliable, gives
-- package-specific rules precedence over wildcard rules for the same gift.
-- Renewal gifts and per-screen multipliers stay disabled until their
-- subscription-extension semantics can be guaranteed server-side.

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.service_bundle_rules'::regclass
       and conname = 'service_bundle_rules_source_duration_range'
  ) then
    alter table public.service_bundle_rules
      add constraint service_bundle_rules_source_duration_range
      check (source_duration_idx between 0 and 4);
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.service_bundle_rules'::regclass
       and conname = 'service_bundle_rules_gift_duration_range'
  ) then
    alter table public.service_bundle_rules
      add constraint service_bundle_rules_gift_duration_range
      check (gift_duration_idx is null or gift_duration_idx between 0 and 4);
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.service_bundle_rules'::regclass
       and conname = 'service_bundle_rules_pool_policy_match'
  ) then
    alter table public.service_bundle_rules
      add constraint service_bundle_rules_pool_policy_match
      check (
        (allocation_policy = 'shared_reusable' and inventory_pool = 'promotion_shared')
        or (allocation_policy = 'exclusive' and inventory_pool = 'standard')
      );
  end if;
end;
$$;

create or replace function public.touch_service_bundle_rule()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists touch_service_bundle_rule_trigger
  on public.service_bundle_rules;
create trigger touch_service_bundle_rule_trigger
before update on public.service_bundle_rules
for each row execute function public.touch_service_bundle_rule();

revoke insert, update, delete on table public.service_bundle_rules
  from anon, authenticated;

-- Historical rules remain immutable for order history, while an archived rule
-- no longer blocks a new campaign with the same source/gift combination.
drop index if exists public.service_bundle_rules_unique_offer_idx;
create unique index if not exists service_bundle_rules_current_offer_idx
  on public.service_bundle_rules (
    source_service_id,
    source_duration_idx,
    coalesce(source_type_idx, -1),
    gift_service_id
  )
  where coalesce(metadata->>'archived_at', '') = '';

-- These two modes require subscription-aware rules that are intentionally not
-- exposed by the Operations API yet.
update public.service_bundle_rules
   set include_renewals = false,
       quantity_mode = case
         when quantity_mode = 'per_screen' then 'per_unit'
         else quantity_mode
       end,
       gift_quantity = case
         when quantity_mode in ('per_screen', 'per_unit') then 1
         else gift_quantity
       end
 where include_renewals
    or quantity_mode = 'per_screen'
    or (quantity_mode = 'per_unit' and gift_quantity <> 1);

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
  v_is_renewal boolean :=
    lower(coalesce(new.customer_info->>'order_kind', '')) = 'renewal';
begin
  if new.items is null or jsonb_typeof(new.items) <> 'array' then
    return new;
  end if;

  -- Client-provided promotion fields are never trusted. Every entitlement is
  -- rebuilt below from an active database rule.
  for v_source, v_source_ordinal in
    select value, ordinality
      from jsonb_array_elements(new.items) with ordinality
  loop
    v_clean := v_source - array[
      'promotion_gift', 'is_promotional_gift', 'included_free',
      'bundle_rule_id', 'bundle_source_item_index', 'bundle_label_i18n',
      'bundle_renewal_gift', 'allocation_policy', 'inventory_pool',
      'fulfillment_mode_override', 'gift_duration_months', 'benefit_id',
      'bundlePreview', 'bundlePreviews', 'renewal'
    ]::text[];
    v_clean_items := v_clean_items || jsonb_build_array(v_clean);
  end loop;
  new.items := v_clean_items;

  for v_source, v_source_ordinal in
    select value, ordinality
      from jsonb_array_elements(v_clean_items) with ordinality
  loop
    for v_rule in
      select chosen.*
        from (
          select distinct on (r.gift_service_id) r.*
            from public.service_bundle_rules r
           where r.active
             and r.source_service_id = v_source->>'id'
             and r.source_duration_idx =
               coalesce((v_source->>'durIdx')::integer, 0)
             and (
               r.source_type_idx is null
               or r.source_type_idx =
                 coalesce((v_source->>'typeIdx')::integer, 0)
             )
             and not v_is_renewal
             and (r.starts_at is null or r.starts_at <= clock_timestamp())
             and (r.ends_at is null or r.ends_at > clock_timestamp())
             and coalesce(r.metadata->>'archived_at', '') = ''
           order by
             r.gift_service_id,
             (r.source_type_idx is not null) desc,
             r.priority,
             r.created_at,
             r.id
        ) chosen
       order by chosen.priority, chosen.created_at, chosen.id
    loop
      select *
        into v_gift
        from public.services
       where id = v_rule.gift_service_id;
      if not found then
        continue;
      end if;

      v_gift_duration_idx := case
        when v_rule.gift_duration_strategy = 'fixed'
          then v_rule.gift_duration_idx
        else coalesce((v_source->>'durIdx')::integer, 0)
      end;
      v_duration_months := (array[1, 2, 3, 6, 12])[
        least(greatest(coalesce(v_gift_duration_idx, 0) + 1, 1), 5)
      ];
      -- All allocators accept at most twenty entries per fulfillment.
      v_gift_quantity := least(20, case v_rule.quantity_mode
        when 'per_unit' then
          v_rule.gift_quantity
          * greatest(1, coalesce((v_source->>'qty')::integer, 1))
        else v_rule.gift_quantity
      end);
      v_duration_labels := case v_gift_duration_idx
        when 0 then jsonb_build_object(
          'ar', 'شهر واحد', 'fr', '1 mois', 'en', '1 month'
        )
        when 1 then jsonb_build_object(
          'ar', 'شهران', 'fr', '2 mois', 'en', '2 months'
        )
        when 2 then jsonb_build_object(
          'ar', '3 أشهر', 'fr', '3 mois', 'en', '3 months'
        )
        when 3 then jsonb_build_object(
          'ar', '6 أشهر', 'fr', '6 mois', 'en', '6 months'
        )
        when 4 then jsonb_build_object(
          'ar', 'سنة كاملة', 'fr', '1 an', 'en', '1 year'
        )
        else coalesce(v_source->'durLabelData', '{}'::jsonb)
      end;

      new.items := new.items || jsonb_build_array(jsonb_build_object(
        'id', v_gift.id,
        'name', coalesce(
          v_gift.n->>'ar', v_gift.n->>'fr', v_gift.n->>'en', v_gift.id
        ),
        'title', coalesce(
          v_gift.n->>'ar', v_gift.n->>'fr', v_gift.n->>'en', v_gift.id
        ),
        'nameData', v_gift.n,
        'durIdx', v_gift_duration_idx,
        'durMonths', v_duration_months,
        'durLabel', coalesce(
          v_duration_labels->>'ar',
          v_duration_labels->>'fr',
          v_duration_labels->>'en',
          ''
        ),
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
        'bundle_renewal_gift', v_is_renewal,
        'allocation_policy', v_rule.allocation_policy,
        'inventory_pool', v_rule.inventory_pool,
        'fulfillment_mode_override', case
          when v_rule.allocation_policy = 'shared_reusable'
            then 'automatic_shared_slot'
          else null
        end,
        'gift_duration_months', v_duration_months
      ));
    end loop;
  end loop;

  return new;
end;
$$;

-- Manual activation/delivery gifts share the same completion state as their
-- fulfillment. Without this bridge the customer could receive the gift while
-- Operations and Sheets kept showing the benefit as "processing".
create or replace function public.sync_order_benefit_from_fulfillment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(new.status, '')) in ('delivered', 'completed') then
    update public.order_benefits
       set status = 'delivered',
           updated_at = clock_timestamp(),
           metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object('fulfilled_at', coalesce(new.delivered_at, clock_timestamp()))
     where fulfillment_id = new.id
       and status <> 'delivered';
  elsif lower(coalesce(new.status, '')) in ('failed', 'cancelled') then
    update public.order_benefits
       set status = lower(new.status),
           updated_at = clock_timestamp()
     where fulfillment_id = new.id
       and status not in ('delivered', lower(new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists sync_order_benefit_from_fulfillment_trigger
  on public.fulfillments;
create trigger sync_order_benefit_from_fulfillment_trigger
after insert or update of status on public.fulfillments
for each row execute function public.sync_order_benefit_from_fulfillment();

notify pgrst, 'reload schema';
