-- Allow an administrator to correct the expiry date of a delivered manual
-- service (Spotify and future manual services) without exposing credentials.
create or replace function public.ops_update_manual_fulfillment_end(
  p_fulfillment_id uuid,
  p_ends_at timestamptz,
  p_encrypted_delivery text default null,
  p_notify boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $function$
declare
  v_fulfillment public.fulfillments%rowtype;
  v_old_end text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_ends_at is null then raise exception 'End date is required'; end if;

  select * into v_fulfillment
  from public.fulfillments
  where id=p_fulfillment_id
  for update;
  if not found then raise exception 'Fulfillment not found'; end if;
  if lower(coalesce(v_fulfillment.mode,'')) not in ('manual_activation','manual_delivery') then
    raise exception 'Only a manual service subscription can be updated';
  end if;
  if lower(coalesce(v_fulfillment.status,'')) not in ('delivered','completed') then
    raise exception 'The service must be delivered first';
  end if;

  v_old_end=v_fulfillment.delivery_summary->>'ends_at';
  update public.fulfillments
  set delivery_summary=coalesce(delivery_summary,'{}'::jsonb)||jsonb_build_object(
        'ends_at',p_ends_at,
        'expiry_updated_at',now()
      ),
      encrypted_delivery=coalesce(p_encrypted_delivery,encrypted_delivery),
      updated_at=now()
  where id=v_fulfillment.id;

  insert into public.operations_audit_log(
    actor_id,action,entity_type,entity_id,order_id,service_id,
    before_data,after_data,metadata
  ) values (
    auth.uid(),'update_manual_fulfillment_end','fulfillment',v_fulfillment.id::text,
    v_fulfillment.order_id,v_fulfillment.service_id,
    jsonb_build_object('ends_at',v_old_end),
    jsonb_build_object('ends_at',p_ends_at),
    jsonb_build_object('notify',p_notify)
  );

  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values(
    'subscription_updated',v_fulfillment.id::text,
    jsonb_build_object(
      'order_id',v_fulfillment.order_id,
      'fulfillment_id',v_fulfillment.id,
      'service_id',v_fulfillment.service_id,
      'ends_at',p_ends_at,
      'notify',p_notify,
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
        'ar','تم تحديث تاريخ انتهاء اشتراكك. افتح طلبك لرؤية التاريخ الجديد.',
        'fr','La date d’expiration de votre abonnement a été mise à jour.',
        'en','Your subscription expiry date has been updated.'
      ),
      v_fulfillment.id,
      null,
      v_fulfillment.service_id,
      '/my-account?order='||v_fulfillment.order_id::text,
      jsonb_build_object('ends_at',p_ends_at),
      true,
      'subscription.updated:'||v_fulfillment.id::text||':'||
        to_char(p_ends_at at time zone 'Africa/Algiers','YYYY-MM-DD')
    );
  end if;

  return jsonb_build_object(
    'success',true,
    'fulfillment_id',v_fulfillment.id,
    'order_id',v_fulfillment.order_id,
    'service_id',v_fulfillment.service_id,
    'old_ends_at',v_old_end,
    'ends_at',p_ends_at,
    'notify',p_notify
  );
end;
$function$;

revoke all on function public.ops_update_manual_fulfillment_end(uuid,timestamptz,text,boolean) from public;
grant execute on function public.ops_update_manual_fulfillment_end(uuid,timestamptz,text,boolean) to authenticated;
