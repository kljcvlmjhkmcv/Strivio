-- Keep promotional gift subscriptions aligned when the paid parent
-- subscription is renewed.  Renewal gifts are not recreated as a second
-- free order: the already-delivered gift allocation is extended atomically
-- with the paid renewal instead.

create or replace function public.extend_bundle_gifts_for_renewal(
  p_source_order_id uuid,
  p_source_item_indices integer[],
  p_months integer,
  p_renewal_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $function$
declare
  v_b record;
  v_old_end timestamptz;
  v_new_end timestamptz;
  v_updated integer;
  v_rows integer;
  v_parent_end timestamptz;
  v_gift_updates jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.is_admin() then
    raise exception 'Server only';
  end if;
  if p_source_order_id is null
     or p_source_item_indices is null
     or cardinality(p_source_item_indices) = 0
     or p_months is null
     or p_months < 1
     or p_months > 36 then
    return jsonb_build_object('success',true,'updated',0,'updates','[]'::jsonb);
  end if;

  -- The gift follows the current parent subscription end.  This keeps a
  -- Netflix + Prime offer on one clear date even after earlier renewals.
  select max(a.ends_at)
    into v_parent_end
    from public.fulfillment_allocations a
    join public.fulfillments f on f.id=a.fulfillment_id
   where f.order_id=p_source_order_id
     and f.order_item_index=any(p_source_item_indices)
     and a.status='active';
  if v_parent_end is null then
    select max(nullif(f.delivery_summary->>'ends_at','')::timestamptz)
      into v_parent_end
      from public.fulfillments f
     where f.order_id=p_source_order_id
       and f.order_item_index=any(p_source_item_indices)
       and lower(coalesce(f.status,'')) in ('delivered','completed');
  end if;

  for v_b in
    select
      b.id,
      b.fulfillment_id,
      b.gift_service_id,
      b.source_item_index,
      gf.delivery_summary,
      gf.status as gift_status
    from public.order_benefits b
    join public.fulfillments gf on gf.id=b.fulfillment_id
    where b.order_id=p_source_order_id
      and b.source_item_index=any(p_source_item_indices)
      and b.fulfillment_id is not null
      and lower(coalesce(b.status,'')) not in ('cancelled','failed')
    order by b.id
    for update of b
  loop
    select max(x.ends_at)
      into v_old_end
      from (
        select s.ends_at
          from public.shared_profile_allocations s
         where s.benefit_id=v_b.id
           and s.status='active'
        union all
        select a.ends_at
          from public.fulfillment_allocations a
         where a.fulfillment_id=v_b.fulfillment_id
           and a.status='active'
      ) x;
    v_new_end=null;
    v_updated=0;
    -- Lock and extend reusable gift profiles.
    update public.shared_profile_allocations s
       set ends_at=coalesce(
             v_parent_end,
             greatest(coalesce(s.ends_at,now()),now())
               + make_interval(months=>p_months)
           ),
           renewal_count=coalesce(s.renewal_count,0)+1,
           sheet_version=coalesce(s.sheet_version,0)+1,
           updated_at=now()
     where s.benefit_id=v_b.id
       and s.status='active';
    get diagnostics v_updated=row_count;

    -- Also support an exclusive gift allocation if an offer uses one.
    update public.fulfillment_allocations a
       set ends_at=coalesce(
             v_parent_end,
             greatest(coalesce(a.ends_at,now()),now())
               + make_interval(months=>p_months)
           ),
           renewal_count=coalesce(a.renewal_count,0)+1,
           sheet_version=coalesce(a.sheet_version,0)+1,
           admin_notes=concat_ws(
             E'\n',
             nullif(a.admin_notes,''),
             'Gift extended by renewal #'||coalesce(p_renewal_order_id::text,'')
           )
     where a.fulfillment_id=v_b.fulfillment_id
       and a.status='active';
    get diagnostics v_rows=row_count;
    v_updated=v_updated+v_rows;

    select max(x.ends_at)
      into v_new_end
      from (
        select s.ends_at
          from public.shared_profile_allocations s
         where s.benefit_id=v_b.id
           and s.status='active'
        union all
        select a.ends_at
          from public.fulfillment_allocations a
         where a.fulfillment_id=v_b.fulfillment_id
           and a.status='active'
      ) x;

    -- Manual gifts have no allocation row; extend their fulfillment summary
    -- so the same customer-facing date is still updated.
    if v_new_end is null
       and lower(coalesce(v_b.gift_status,'')) in ('delivered','completed') then
      v_old_end=nullif(v_b.delivery_summary->>'ends_at','')::timestamptz;
      if v_old_end is not null then
        v_new_end=coalesce(v_parent_end,
          greatest(v_old_end,now())+make_interval(months=>p_months));
      end if;
    end if;

    if v_new_end is not null then
      update public.fulfillments
         set delivery_summary=coalesce(delivery_summary,'{}'::jsonb)
           ||jsonb_build_object(
             'ends_at',v_new_end,
             'renewed_by_order_id',p_renewal_order_id,
             'bundle_gift_renewed',true
           ),
             updated_at=now()
       where id=v_b.fulfillment_id;
    end if;

    insert into public.operations_audit_log(
      actor_id,action,entity_type,entity_id,order_id,service_id,
      before_data,after_data,metadata
    ) values (
      null,
      'renew_bundle_gift',
      'order_benefit',
      v_b.id::text,
      p_renewal_order_id,
      v_b.gift_service_id,
      jsonb_build_object('ends_at',v_old_end),
      jsonb_build_object(
        'ends_at',v_new_end,
        'months',p_months,
        'source_order_id',p_source_order_id,
        'source_item_index',v_b.source_item_index
      ),
      jsonb_build_object('updated_rows',v_updated)
    );

    insert into public.integration_outbox(event_type,aggregate_id,payload)
    values (
      'subscription_updated',
      v_b.fulfillment_id::text,
      jsonb_build_object(
        'order_id',p_source_order_id,
        'renewal_order_id',p_renewal_order_id,
        'fulfillment_id',v_b.fulfillment_id,
        'benefit_id',v_b.id,
        'service_id',v_b.gift_service_id,
        'ends_at',v_new_end,
        'scope','bundle_gift',
        'inventory',true,
        'source','paid_renewal'
      )
    );

    v_gift_updates=v_gift_updates||jsonb_build_object(
      'benefit_id',v_b.id,
      'fulfillment_id',v_b.fulfillment_id,
      'service_id',v_b.gift_service_id,
      'ends_at',v_new_end,
      'updated_rows',v_updated
    );
  end loop;

  return jsonb_build_object(
    'success',true,
    'updated',jsonb_array_length(v_gift_updates),
    'updates',v_gift_updates
  );
end;
$function$;

revoke all on function public.extend_bundle_gifts_for_renewal(uuid,integer[],integer,uuid)
from public,anon,authenticated;
grant execute on function public.extend_bundle_gifts_for_renewal(uuid,integer[],integer,uuid)
to service_role;

create or replace function public.apply_paid_renewal_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $function$
declare
  req public.renewal_requests%rowtype;
  ord public.orders%rowtype;
  target uuid;
  sorted_targets uuid[];
  new_end timestamptz;
  base_end timestamptz;
  f_id uuid;
  source_order_id uuid;
  source_item_index integer;
  source_row record;
  updates jsonb='[]'::jsonb;
  gift_updates jsonb='[]'::jsonb;
  latest_end timestamptz;
  gift_result jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and not public.is_admin() then
    raise exception 'Server only';
  end if;

  select * into ord
    from public.orders
   where id=p_order_id
   for update;
  if not found or ord.status not in ('paid','completed') then
    raise exception 'Renewal order is not paid';
  end if;

  select * into req
    from public.renewal_requests
   where order_id=p_order_id
   for update;
  if not found then raise exception 'Renewal request not found'; end if;
  if req.status='applied' then
    return jsonb_build_object(
      'success',true,
      'already_applied',true,
      'order_id',p_order_id
    );
  end if;
  if req.status not in ('pending_payment','paid') then
    raise exception 'Renewal request is not payable';
  end if;

  select array_agg(value order by value)
    into sorted_targets
    from unnest(req.target_ids) as values(value);

  foreach target in array sorted_targets loop
    if req.target_kind='allocation' then
      select a.ends_at,a.fulfillment_id
        into base_end,f_id
        from public.fulfillment_allocations a
       where a.id=target
         and a.status='active'
       for update;
      if not found then
        raise exception 'Renewal allocation is no longer active';
      end if;
      new_end=greatest(coalesce(base_end,now()),now())
        +make_interval(months=>req.months);
      update public.fulfillment_allocations
         set ends_at=new_end,
             renewal_count=coalesce(renewal_count,0)+1,
             sheet_version=coalesce(sheet_version,0)+1,
             admin_notes=concat_ws(
               E'\n',
               nullif(admin_notes,''),
               'Renewed by order #'||p_order_id::text
             )
       where id=target;
      update public.fulfillments
         set delivery_summary=coalesce(delivery_summary,'{}'::jsonb)
           ||jsonb_build_object(
             'ends_at',(
               select max(ends_at)
                 from public.fulfillment_allocations
                where fulfillment_id=f_id
                  and status='active'
             ),
             'renewed_by_order_id',p_order_id,
             'renewal_count',
               coalesce(nullif(delivery_summary->>'renewal_count','')::integer,0)+1
           ),
             updated_at=now()
       where id=f_id;
    else
      select nullif(f.delivery_summary->>'ends_at','')::timestamptz
        into base_end
        from public.fulfillments f
       where f.id=target
       for update;
      if not found then
        raise exception 'Renewal fulfillment no longer exists';
      end if;
      new_end=greatest(coalesce(base_end,now()),now())
        +make_interval(months=>req.months);
      update public.fulfillments
         set delivery_summary=coalesce(delivery_summary,'{}'::jsonb)
           ||jsonb_build_object(
             'ends_at',new_end,
             'renewed_by_order_id',p_order_id,
             'renewal_count',
               coalesce(nullif(delivery_summary->>'renewal_count','')::integer,0)+1
           ),
             updated_at=now()
       where id=target;
      f_id=target;
    end if;

    latest_end=case
      when latest_end is null then new_end
      else greatest(latest_end,new_end)
    end;
    updates=updates||jsonb_build_object(
      'target_id',target,
      'fulfillment_id',f_id,
      'ends_at',new_end
    );

    insert into public.operations_audit_log(
      actor_id,action,entity_type,entity_id,order_id,service_id,
      before_data,after_data
    ) values (
      req.user_id,
      'renew_subscription',
      req.target_kind,
      target::text,
      p_order_id,
      req.service_id,
      jsonb_build_object('ends_at',base_end),
      jsonb_build_object('ends_at',new_end,'months',req.months)
    );
  end loop;

  -- Extend the gift(s) that were actually attached to the original order.
  -- This is derived from order_benefits, never from browser-supplied fields.
  -- A single renewal can target profiles from one or more original orders.
  for source_row in
    select
      f.order_id as source_order_id,
      array_agg(distinct f.order_item_index)::integer[] as source_item_indices
    from public.fulfillment_allocations a
    join public.fulfillments f on f.id=a.fulfillment_id
    where req.target_kind='allocation'
      and a.id=any(req.target_ids)
    group by f.order_id
    union all
    select
      f.order_id as source_order_id,
      array_agg(distinct f.order_item_index)::integer[] as source_item_indices
    from public.fulfillments f
    where req.target_kind='fulfillment'
      and f.id=any(req.target_ids)
    group by f.order_id
  loop
    gift_result=public.extend_bundle_gifts_for_renewal(
      source_row.source_order_id,
      source_row.source_item_indices,
      req.months,
      p_order_id
    );
    if jsonb_array_length(coalesce(gift_result->'updates','[]'::jsonb))>0 then
      gift_updates=gift_updates||(gift_result->'updates');
    end if;
  end loop;

  update public.renewal_requests
     set status='applied',applied_at=now()
   where id=req.id;
  update public.orders
     set fulfillment_status='delivered',
         fulfilled_at=now(),
         updated_at=now()
   where id=p_order_id;
  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values(
    'subscription_renewed',
    p_order_id::text,
    jsonb_build_object(
      'order_id',p_order_id,
      'service_id',req.service_id,
      'target_kind',req.target_kind,
      'target_ids',req.target_ids,
      'months',req.months,
      'inventory',true,
      'gift_updates',gift_updates
    )
  );

  return jsonb_build_object(
    'success',true,
    'order_id',p_order_id,
    'months',req.months,
    'updates',updates,
    'gift_updates',gift_updates,
    'new_ends_at',latest_end
  );
end;
$function$;

revoke all on function public.apply_paid_renewal_order(uuid)
from public,anon,authenticated;
grant execute on function public.apply_paid_renewal_order(uuid)
to service_role,authenticated;

notify pgrst,'reload schema';
