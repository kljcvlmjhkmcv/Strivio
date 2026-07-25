-- Per-profile subscription control, safe manual release, and automatic expiry.
-- Orders and fulfillment history remain immutable; only active allocations are
-- ended and their inventory capacity is released.

create or replace function public.ops_update_subscription_end(
  p_allocation_id uuid,
  p_ends_at timestamptz,
  p_scope text default 'allocation',
  p_notify boolean default false,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $function$
declare
  v_allocation public.fulfillment_allocations%rowtype;
  v_fulfillment public.fulfillments%rowtype;
  v_scope text;
  v_actor uuid;
  v_old_end timestamptz;
  v_summary_end timestamptz;
  v_updated integer := 0;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if p_ends_at is null then raise exception 'End date is required'; end if;

  v_scope=lower(trim(coalesce(p_scope,'allocation')));
  if v_scope not in ('allocation','fulfillment') then
    raise exception 'Invalid subscription update scope';
  end if;

  select * into v_allocation
  from public.fulfillment_allocations
  where id=p_allocation_id
  for update;
  if not found then raise exception 'Subscription allocation not found'; end if;
  if lower(coalesce(v_allocation.status,''))<>'active' then
    raise exception 'Only an active subscription can be updated';
  end if;

  select * into v_fulfillment
  from public.fulfillments
  where id=v_allocation.fulfillment_id
  for update;
  if not found then raise exception 'Fulfillment not found'; end if;

  if exists (
    select 1
    from public.fulfillment_allocations a
    where a.status='active'
      and (
        (v_scope='allocation' and a.id=v_allocation.id)
        or
        (v_scope='fulfillment' and a.fulfillment_id=v_allocation.fulfillment_id)
      )
      and a.starts_at is not null
      and p_ends_at<a.starts_at
  ) then
    raise exception 'End date cannot be before the start date';
  end if;

  v_old_end=v_allocation.ends_at;
  update public.fulfillment_allocations a
  set
    ends_at=p_ends_at,
    sheet_version=coalesce(a.sheet_version,0)+1,
    admin_notes=concat_ws(
      E'\n',
      nullif(a.admin_notes,''),
      'Expiry updated from Operations ('||v_scope||')'
    )
  where a.status='active'
    and (
      (v_scope='allocation' and a.id=v_allocation.id)
      or
      (v_scope='fulfillment' and a.fulfillment_id=v_allocation.fulfillment_id)
    );
  get diagnostics v_updated=row_count;

  select max(a.ends_at) into v_summary_end
  from public.fulfillment_allocations a
  where a.fulfillment_id=v_allocation.fulfillment_id
    and a.status='active';

  update public.fulfillments
  set
    delivery_summary=coalesce(delivery_summary,'{}'::jsonb)
      ||jsonb_build_object('ends_at',v_summary_end),
    updated_at=now()
  where id=v_allocation.fulfillment_id;

  v_actor=case when auth.role()='service_role' then p_actor_id else auth.uid() end;
  insert into public.operations_audit_log(
    actor_id,action,entity_type,entity_id,order_id,service_id,
    before_data,after_data,metadata
  ) values (
    v_actor,'update_subscription_end','fulfillment_allocation',
    v_allocation.id::text,v_fulfillment.order_id,v_fulfillment.service_id,
    jsonb_build_object('ends_at',v_old_end),
    jsonb_build_object('ends_at',p_ends_at),
    jsonb_build_object(
      'scope',v_scope,
      'notify',coalesce(p_notify,false),
      'updated_allocations',v_updated
    )
  );

  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values(
    'subscription_updated',
    v_allocation.id::text,
    jsonb_build_object(
      'order_id',v_fulfillment.order_id,
      'fulfillment_id',v_allocation.fulfillment_id,
      'allocation_id',v_allocation.id,
      'service_id',v_fulfillment.service_id,
      'ends_at',p_ends_at,
      'scope',v_scope,
      'inventory',true,
      'source','operations_center'
    )
  );

  if coalesce(p_notify,false) then
    perform public.enqueue_customer_notification(
      'subscription.updated',
      v_fulfillment.order_id,
      'subscription_updated',
      jsonb_build_object(
        'ar','تم تحديث تاريخ انتهاء اشتراكك',
        'fr','Date d’expiration mise à jour',
        'en','Subscription expiry updated'
      ),
      jsonb_build_object(
        'ar',case when v_scope='allocation'
          then 'تم تحديث تاريخ انتهاء البروفايل المحدد. افتح طلبك لرؤية التاريخ الجديد.'
          else 'تم تحديث تاريخ انتهاء جميع بروفيلات هذا المنتج. افتح طلبك لرؤية التواريخ الجديدة.'
        end,
        'fr',case when v_scope='allocation'
          then 'La date d’expiration du profil sélectionné a été mise à jour.'
          else 'Les dates d’expiration de tous les profils de ce produit ont été mises à jour.'
        end,
        'en',case when v_scope='allocation'
          then 'The selected profile expiry date was updated.'
          else 'The expiry dates of all profiles for this product were updated.'
        end
      ),
      v_allocation.fulfillment_id,
      null,
      v_fulfillment.service_id,
      '/my-account?order='||v_fulfillment.order_id::text,
      jsonb_build_object(
        'ends_at',p_ends_at,
        'scope',v_scope,
        'updated_allocations',v_updated
      ),
      true,
      'subscription.updated:'||v_allocation.id::text||':'||
        to_char(p_ends_at at time zone 'Africa/Algiers','YYYY-MM-DD')||':'||v_scope
    );
  end if;

  return jsonb_build_object(
    'success',true,
    'allocation_id',v_allocation.id,
    'fulfillment_id',v_allocation.fulfillment_id,
    'order_id',v_fulfillment.order_id,
    'service_id',v_fulfillment.service_id,
    'scope',v_scope,
    'updated_allocations',v_updated,
    'old_ends_at',v_old_end,
    'ends_at',p_ends_at,
    'notify',coalesce(p_notify,false)
  );
end;
$function$;

revoke all on function public.ops_update_subscription_end(uuid,timestamptz,text,boolean,uuid)
from public,anon;
grant execute on function public.ops_update_subscription_end(uuid,timestamptz,text,boolean,uuid)
to authenticated,service_role;

create or replace function public.ops_release_subscription_allocation(
  p_allocation_id uuid,
  p_reason text default 'Released manually from Operations',
  p_notify boolean default true,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $function$
declare
  v_allocation public.fulfillment_allocations%rowtype;
  v_fulfillment public.fulfillments%rowtype;
  v_slot_label text;
  v_actor uuid;
  v_reason text;
  v_summary_end timestamptz;
  v_slots integer := 0;
  v_licenses integer := 0;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.is_admin() then
    raise exception 'Admin only';
  end if;
  v_reason=left(trim(coalesce(p_reason,'')),500);
  if v_reason='' then v_reason='Released manually from Operations'; end if;

  select * into v_allocation
  from public.fulfillment_allocations
  where id=p_allocation_id
  for update;
  if not found then raise exception 'Subscription allocation not found'; end if;

  select * into v_fulfillment
  from public.fulfillments
  where id=v_allocation.fulfillment_id
  for update;
  if not found then raise exception 'Fulfillment not found'; end if;

  if v_allocation.slot_id is not null then
    select label into v_slot_label
    from public.inventory_slots where id=v_allocation.slot_id;
  end if;

  if lower(coalesce(v_allocation.status,''))<>'active' then
    return jsonb_build_object(
      'success',true,
      'allocation_id',v_allocation.id,
      'fulfillment_id',v_allocation.fulfillment_id,
      'order_id',v_fulfillment.order_id,
      'service_id',v_fulfillment.service_id,
      'status',v_allocation.status,
      'released_slots',0,
      'released_licenses',0,
      'already_released',true
    );
  end if;

  update public.fulfillment_allocations
  set
    status='expired',
    ends_at=least(coalesce(ends_at,now()),now()),
    admin_notes=concat_ws(E'\n',nullif(admin_notes,''),v_reason),
    sheet_version=coalesce(sheet_version,0)+1
  where id=v_allocation.id and status='active';

  if v_allocation.slot_id is not null then
    update public.inventory_slots s
    set status='available',updated_at=now()
    where s.id=v_allocation.slot_id
      and not exists (
        select 1 from public.fulfillment_allocations a
        where a.slot_id=s.id and a.status='active'
      );
    get diagnostics v_slots=row_count;
  end if;

  if v_allocation.license_id is not null then
    update public.inventory_licenses l
    set status='available',updated_at=now()
    where l.id=v_allocation.license_id
      and not exists (
        select 1 from public.fulfillment_allocations a
        where a.license_id=l.id and a.status='active'
      );
    get diagnostics v_licenses=row_count;
  end if;

  select max(a.ends_at) into v_summary_end
  from public.fulfillment_allocations a
  where a.fulfillment_id=v_allocation.fulfillment_id
    and a.status='active';
  if v_summary_end is null then
    v_summary_end=least(coalesce(v_allocation.ends_at,now()),now());
  end if;

  update public.fulfillments
  set
    delivery_summary=coalesce(delivery_summary,'{}'::jsonb)
      ||jsonb_build_object(
        'ends_at',v_summary_end,
        'last_released_allocation_id',v_allocation.id,
        'last_release_reason',v_reason
      ),
    updated_at=now()
  where id=v_allocation.fulfillment_id;

  v_actor=case when auth.role()='service_role' then p_actor_id else auth.uid() end;
  insert into public.operations_audit_log(
    actor_id,action,entity_type,entity_id,order_id,service_id,
    before_data,after_data,metadata
  ) values (
    v_actor,'release_subscription','fulfillment_allocation',
    v_allocation.id::text,v_fulfillment.order_id,v_fulfillment.service_id,
    jsonb_build_object(
      'status',v_allocation.status,
      'ends_at',v_allocation.ends_at,
      'slot_id',v_allocation.slot_id,
      'license_id',v_allocation.license_id
    ),
    jsonb_build_object('status','expired','ends_at',least(coalesce(v_allocation.ends_at,now()),now())),
    jsonb_build_object(
      'reason',v_reason,
      'notify',coalesce(p_notify,true),
      'released_slots',v_slots,
      'released_licenses',v_licenses
    )
  );

  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values(
    'subscription_expired',
    v_allocation.id::text,
    jsonb_build_object(
      'order_id',v_fulfillment.order_id,
      'fulfillment_id',v_allocation.fulfillment_id,
      'allocation_id',v_allocation.id,
      'service_id',v_fulfillment.service_id,
      'status','expired',
      'inventory',true,
      'source','operations_center'
    )
  );

  if coalesce(p_notify,true) then
    perform public.enqueue_customer_notification(
      'subscription.expired',
      v_fulfillment.order_id,
      'subscription_expired',
      jsonb_build_object(
        'ar','انتهى اشتراكك',
        'fr','Votre abonnement est terminé',
        'en','Your subscription has ended'
      ),
      jsonb_build_object(
        'ar','انتهى اشتراك '||coalesce(v_slot_label,'الخدمة المحددة')||'. يمكنك فتح طلبك للاطلاع على الحالة.',
        'fr','L’abonnement '||coalesce(v_slot_label,'sélectionné')||' est terminé. Ouvrez votre commande pour consulter son état.',
        'en','The '||coalesce(v_slot_label,'selected')||' subscription has ended. Open your order to view its status.'
      ),
      v_allocation.fulfillment_id,
      null,
      v_fulfillment.service_id,
      '/my-account?order='||v_fulfillment.order_id::text,
      jsonb_build_object(
        'allocation_id',v_allocation.id,
        'profile',v_slot_label,
        'ends_at',least(coalesce(v_allocation.ends_at,now()),now())
      ),
      true,
      'subscription.expired:'||v_allocation.id::text
    );
  end if;

  return jsonb_build_object(
    'success',true,
    'allocation_id',v_allocation.id,
    'fulfillment_id',v_allocation.fulfillment_id,
    'order_id',v_fulfillment.order_id,
    'service_id',v_fulfillment.service_id,
    'status','expired',
    'released_slots',v_slots,
    'released_licenses',v_licenses,
    'already_released',lower(coalesce(v_allocation.status,''))<>'active'
  );
end;
$function$;

revoke all on function public.ops_release_subscription_allocation(uuid,text,boolean,uuid)
from public,anon;
grant execute on function public.ops_release_subscription_allocation(uuid,text,boolean,uuid)
to authenticated,service_role;

create or replace function public.expire_due_subscriptions()
returns jsonb
language plpgsql
security definer
set search_path=public,auth,cron
as $function$
declare
  v_item record;
  v_summary_end timestamptz;
  v_standard integer := 0;
  v_shared integer := 0;
  v_slots integer := 0;
  v_licenses integer := 0;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception 'Server only';
  end if;

  for v_item in
    select
      a.id,a.fulfillment_id,a.slot_id,a.license_id,a.ends_at,
      f.order_id,f.service_id,
      coalesce(s.label,l.label,'Subscription') as allocation_label
    from public.fulfillment_allocations a
    join public.fulfillments f on f.id=a.fulfillment_id
    left join public.inventory_slots s on s.id=a.slot_id
    left join public.inventory_licenses l on l.id=a.license_id
    where a.status='active'
      and a.ends_at is not null
      and a.ends_at<=now()
    order by a.ends_at,a.id
    for update of a skip locked
  loop
    update public.fulfillment_allocations
    set
      status='expired',
      admin_notes=concat_ws(E'\n',nullif(admin_notes,''),'Expired automatically'),
      sheet_version=coalesce(sheet_version,0)+1
    where id=v_item.id and status='active';
    if not found then continue; end if;
    v_standard=v_standard+1;

    if v_item.slot_id is not null then
      update public.inventory_slots s
      set status='available',updated_at=now()
      where s.id=v_item.slot_id
        and not exists (
          select 1 from public.fulfillment_allocations a
          where a.slot_id=s.id and a.status='active'
        );
      v_slots=v_slots+case when found then 1 else 0 end;
    end if;
    if v_item.license_id is not null then
      update public.inventory_licenses l
      set status='available',updated_at=now()
      where l.id=v_item.license_id
        and not exists (
          select 1 from public.fulfillment_allocations a
          where a.license_id=l.id and a.status='active'
        );
      v_licenses=v_licenses+case when found then 1 else 0 end;
    end if;

    select max(a.ends_at) into v_summary_end
    from public.fulfillment_allocations a
    where a.fulfillment_id=v_item.fulfillment_id and a.status='active';
    update public.fulfillments
    set
      delivery_summary=coalesce(delivery_summary,'{}'::jsonb)
        ||jsonb_build_object('ends_at',coalesce(v_summary_end,v_item.ends_at)),
      updated_at=now()
    where id=v_item.fulfillment_id;

    insert into public.operations_audit_log(
      actor_id,action,entity_type,entity_id,order_id,service_id,
      before_data,after_data,metadata
    ) values (
      null,'expire_subscription','fulfillment_allocation',v_item.id::text,
      v_item.order_id,v_item.service_id,
      jsonb_build_object('status','active','ends_at',v_item.ends_at),
      jsonb_build_object('status','expired','ends_at',v_item.ends_at),
      jsonb_build_object('source','subscription_expiry_scheduler')
    );
    insert into public.integration_outbox(event_type,aggregate_id,payload)
    values(
      'subscription_expired',v_item.id::text,
      jsonb_build_object(
        'order_id',v_item.order_id,
        'fulfillment_id',v_item.fulfillment_id,
        'allocation_id',v_item.id,
        'service_id',v_item.service_id,
        'status','expired',
        'inventory',true,
        'source','subscription_expiry_scheduler'
      )
    );
    perform public.enqueue_customer_notification(
      'subscription.expired',
      v_item.order_id,
      'subscription_expired',
      jsonb_build_object(
        'ar','انتهى اشتراكك',
        'fr','Votre abonnement est terminé',
        'en','Your subscription has ended'
      ),
      jsonb_build_object(
        'ar','انتهى اشتراك '||v_item.allocation_label||'. يمكنك فتح طلبك للاطلاع على الحالة أو شراء اشتراك جديد.',
        'fr','L’abonnement '||v_item.allocation_label||' est terminé. Ouvrez votre commande pour consulter son état.',
        'en','The '||v_item.allocation_label||' subscription has ended. Open your order to view its status.'
      ),
      v_item.fulfillment_id,
      null,
      v_item.service_id,
      '/my-account?order='||v_item.order_id::text,
      jsonb_build_object(
        'allocation_id',v_item.id,
        'profile',v_item.allocation_label,
        'ends_at',v_item.ends_at
      ),
      true,
      'subscription.expired:'||v_item.id::text
    );
  end loop;

  for v_item in
    select
      a.id,a.fulfillment_id,a.benefit_id,a.ends_at,
      f.order_id,f.service_id,
      coalesce(s.label,'Shared profile') as allocation_label
    from public.shared_profile_allocations a
    join public.fulfillments f on f.id=a.fulfillment_id
    left join public.inventory_slots s on s.id=a.slot_id
    where a.status='active'
      and a.ends_at is not null
      and a.ends_at<=now()
    order by a.ends_at,a.id
    for update of a skip locked
  loop
    update public.shared_profile_allocations
    set
      status='expired',
      sheet_version=coalesce(sheet_version,0)+1,
      updated_at=now()
    where id=v_item.id and status='active';
    if not found then continue; end if;
    v_shared=v_shared+1;

    update public.order_benefits b
    set status='expired',updated_at=now()
    where b.id=v_item.benefit_id
      and not exists (
        select 1 from public.shared_profile_allocations a
        where a.benefit_id=b.id and a.status='active'
      );

    insert into public.integration_outbox(event_type,aggregate_id,payload)
    values(
      'subscription_expired',v_item.id::text,
      jsonb_build_object(
        'order_id',v_item.order_id,
        'fulfillment_id',v_item.fulfillment_id,
        'shared_allocation_id',v_item.id,
        'service_id',v_item.service_id,
        'status','expired',
        'inventory',true,
        'source','subscription_expiry_scheduler'
      )
    );
    insert into public.operations_audit_log(
      actor_id,action,entity_type,entity_id,order_id,service_id,
      before_data,after_data,metadata
    ) values (
      null,'expire_subscription','shared_profile_allocation',v_item.id::text,
      v_item.order_id,v_item.service_id,
      jsonb_build_object('status','active','ends_at',v_item.ends_at),
      jsonb_build_object('status','expired','ends_at',v_item.ends_at),
      jsonb_build_object('source','subscription_expiry_scheduler')
    );
    perform public.enqueue_customer_notification(
      'subscription.expired',
      v_item.order_id,
      'subscription_expired',
      jsonb_build_object(
        'ar','انتهت مدة الخدمة المجانية',
        'fr','Votre service offert est terminé',
        'en','Your included service has ended'
      ),
      jsonb_build_object(
        'ar','انتهت مدة '||v_item.allocation_label||' المضافة مع طلبك.',
        'fr','La durée du service offert '||v_item.allocation_label||' est terminée.',
        'en','The included '||v_item.allocation_label||' service has ended.'
      ),
      v_item.fulfillment_id,
      null,
      v_item.service_id,
      '/my-account?order='||v_item.order_id::text,
      jsonb_build_object(
        'shared_allocation_id',v_item.id,
        'profile',v_item.allocation_label,
        'ends_at',v_item.ends_at
      ),
      true,
      'subscription.expired:shared:'||v_item.id::text
    );
  end loop;

  return jsonb_build_object(
    'success',true,
    'expired_standard_allocations',v_standard,
    'expired_shared_allocations',v_shared,
    'released_slots',v_slots,
    'released_licenses',v_licenses
  );
end;
$function$;

revoke all on function public.expire_due_subscriptions()
from public,anon,authenticated;
grant execute on function public.expire_due_subscriptions()
to service_role;

do $scheduler$
declare v_job bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    for v_job in
      select jobid from cron.job where jobname='strivio-subscription-expiry'
    loop
      perform cron.unschedule(v_job);
    end loop;
    perform cron.schedule(
      'strivio-subscription-expiry',
      '5 * * * *',
      'select public.expire_due_subscriptions();'
    );
  end if;
end;
$scheduler$;
