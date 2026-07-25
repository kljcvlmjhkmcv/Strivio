-- Manual-payment confirmation and per-order manual fulfillment routing.
-- Orders remain the source of truth: no duplicate invoice/order is created.

create or replace function public.ops_confirm_manual_payment(
  p_order_id uuid,
  p_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_order public.orders%rowtype;
  v_note text;
  v_changed boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  v_note=left(trim(coalesce(p_note,'')),1000);

  select * into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;
  if lower(coalesce(v_order.payment_method,'')) not in (
    'baridimob','ccp','wise','usdt','flexy'
  ) then
    raise exception 'Only a manual payment method can be confirmed here';
  end if;
  if lower(coalesce(v_order.status,'')) in (
    'cancelled','canceled','refunded','failed'
  ) then
    raise exception 'A cancelled or refunded order cannot be marked as paid';
  end if;

  if lower(coalesce(v_order.status,'')) not in ('paid','completed') then
    update public.orders
    set
      status='paid',
      payment_completed=true,
      invoice_completed=true,
      invoice_status='paid',
      paid_at=coalesce(paid_at,now()),
      transfer_status='confirmed',
      updated_at=now()
    where id=v_order.id;

    insert into public.order_status_logs(order_id,old_status,new_status,source)
    values(v_order.id,v_order.status,'paid','operations_manual_payment');

    v_changed=true;
  else
    -- Repair historical manually-paid rows without creating another status
    -- transition or another fulfillment.
    update public.orders
    set
      payment_completed=true,
      invoice_completed=true,
      invoice_status='paid',
      paid_at=coalesce(paid_at,now()),
      transfer_status='confirmed',
      updated_at=now()
    where id=v_order.id
      and (
        coalesce(payment_completed,false)=false
        or coalesce(invoice_completed,false)=false
        or paid_at is null
        or lower(coalesce(invoice_status,''))<>'paid'
        or lower(coalesce(transfer_status,''))<>'confirmed'
      );
  end if;

  if v_changed then
    insert into public.operations_audit_log(
      actor_id,action,entity_type,entity_id,order_id,
      before_data,after_data,metadata
    ) values (
      auth.uid(),'confirm_manual_payment','order',v_order.id::text,v_order.id,
      jsonb_build_object(
        'status',v_order.status,
        'payment_completed',coalesce(v_order.payment_completed,false),
        'paid_at',v_order.paid_at
      ),
      jsonb_build_object(
        'status','paid',
        'payment_completed',true,
        'paid_at',coalesce(v_order.paid_at,now())
      ),
      jsonb_build_object(
        'payment_method',v_order.payment_method,
        'note',v_note,
        'source','operations_center'
      )
    );

    perform public.enqueue_customer_notification(
      'payment.confirmed',v_order.id,'payment_confirmed',
      jsonb_build_object(
        'ar','تم تأكيد دفعتك',
        'fr','Votre paiement a été confirmé',
        'en','Your payment has been confirmed'
      ),
      jsonb_build_object(
        'ar','تم اعتماد الدفع اليدوي وبدأ تجهيز طلبك. تابع الطلب من حسابك.',
        'fr','Le paiement manuel a été validé et la préparation de votre commande a commencé.',
        'en','Your manual payment was approved and preparation of your order has started.'
      ),
      null,null,null,
      concat('/my-account?order=',v_order.id::text),
      jsonb_build_object(
        'payment_method',v_order.payment_method,
        'confirmed_at',now()
      ),
      true,
      concat('manual-payment-confirmed:',v_order.id::text)
    );

    insert into public.integration_outbox(event_type,aggregate_id,payload)
    values(
      'manual_payment_confirmed',
      v_order.id::text,
      jsonb_build_object(
        'order_id',v_order.id,
        'status','paid',
        'payment_method',v_order.payment_method,
        'source','operations_center'
      )
    );
  end if;

  return jsonb_build_object(
    'success',true,
    'order_id',v_order.id,
    'status',case
      when lower(coalesce(v_order.status,''))='completed' then 'completed'
      else 'paid'
    end,
    'changed',v_changed,
    'payment_method',v_order.payment_method
  );
end;
$function$;

revoke all on function public.ops_confirm_manual_payment(uuid,text)
from public,anon;
grant execute on function public.ops_confirm_manual_payment(uuid,text)
to authenticated;

create or replace function public.ops_choose_manual_delivery(
  p_fulfillment_id uuid,
  p_strategy text,
  p_admin_message text default ''
) returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_f public.fulfillments%rowtype;
  v_order public.orders%rowtype;
  v_strategy text;
  v_message text;
  v_status text;
  v_had_customer_credentials boolean := false;
  v_previous_strategy text;
  v_changed boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  v_strategy=lower(trim(coalesce(p_strategy,'')));
  if v_strategy not in ('customer_account','store_account') then
    raise exception 'Invalid manual delivery strategy';
  end if;
  v_message=left(trim(coalesce(p_admin_message,'')),2000);

  select * into v_f
  from public.fulfillments
  where id=p_fulfillment_id
  for update;

  if not found then
    raise exception 'Fulfillment not found';
  end if;
  if lower(coalesce(v_f.mode,'')) not in ('manual_activation','manual_delivery') then
    raise exception 'Automatic fulfillment cannot be changed here';
  end if;
  if lower(coalesce(v_f.status,'')) in ('delivered','completed','cancelled','failed') then
    raise exception 'This fulfillment is already closed';
  end if;

  select * into v_order
  from public.orders
  where id=v_f.order_id
  for update;

  if not found or lower(coalesce(v_order.status,'')) not in ('paid','completed') then
    raise exception 'The order must be paid first';
  end if;

  v_had_customer_credentials=coalesce(v_f.customer_input,'{}'::jsonb)
    ? 'account_password_cipher';
  v_previous_strategy=lower(coalesce(
    v_f.delivery_summary->>'delivery_strategy',''
  ));

  if v_strategy='customer_account' then
    v_status=case
      when coalesce(v_f.customer_input,'{}'::jsonb) ? 'account_password_cipher'
        then 'awaiting_admin'
      else 'awaiting_customer'
    end;

    v_changed=not (
      v_previous_strategy='customer_account'
      and lower(coalesce(v_f.mode,''))='manual_activation'
      and lower(coalesce(v_f.status,''))=v_status
      and v_f.encrypted_delivery is null
    );

    if v_changed then
      update public.fulfillments
      set
        mode='manual_activation',
        status=v_status,
        encrypted_delivery=null,
        delivered_at=null,
        email_status='pending',
        email_error=null,
        delivery_summary=coalesce(delivery_summary,'{}'::jsonb)
          ||jsonb_build_object(
            'delivery_strategy','customer_account',
            'strategy_selected_at',now(),
            'message',case
              when v_status='awaiting_admin'
                then 'Customer account information received. Activation is awaiting the Strivio team.'
              else 'Open the order and enter the account information required for activation.'
            end
          ),
        updated_at=now()
      where id=v_f.id;
    end if;
  else
    v_status='awaiting_admin';

    v_changed=not (
      v_previous_strategy='store_account'
      and lower(coalesce(v_f.mode,''))='manual_delivery'
      and lower(coalesce(v_f.status,''))='awaiting_admin'
      and v_f.customer_input is null
      and v_f.encrypted_delivery is null
    );

    if v_changed then
      update public.fulfillments
      set
        mode='manual_delivery',
        status='awaiting_admin',
        customer_input=null,
        encrypted_delivery=null,
        delivered_at=null,
        email_status='pending',
        email_error=null,
        delivery_summary=coalesce(delivery_summary,'{}'::jsonb)
          ||jsonb_build_object(
            'delivery_strategy','store_account',
            'strategy_selected_at',now(),
            'customer_credentials_purged',v_had_customer_credentials,
            'message','Payment confirmed. Strivio is preparing the account for delivery.'
          ),
        updated_at=now()
      where id=v_f.id;
    end if;
  end if;

  if v_message<>'' then
    insert into public.activation_messages(
      fulfillment_id,sender_id,sender_role,message
    ) values (
      v_f.id,auth.uid(),'admin',v_message
    );
  end if;

  if v_changed then
    insert into public.operations_audit_log(
      actor_id,action,entity_type,entity_id,order_id,service_id,
      before_data,after_data,metadata
    ) values (
      auth.uid(),'choose_manual_delivery','fulfillment',v_f.id::text,
      v_f.order_id,v_f.service_id,
      jsonb_build_object(
        'mode',v_f.mode,
        'status',v_f.status,
        'delivery_strategy',v_f.delivery_summary->>'delivery_strategy',
        'had_customer_credentials',v_had_customer_credentials
      ),
      jsonb_build_object(
        'mode',case when v_strategy='customer_account' then 'manual_activation' else 'manual_delivery' end,
        'status',v_status,
        'delivery_strategy',v_strategy
      ),
      jsonb_build_object('source','operations_center')
    );

    insert into public.integration_outbox(event_type,aggregate_id,payload)
    values(
      'manual_delivery_strategy_changed',
      v_f.id::text,
      jsonb_build_object(
        'order_id',v_f.order_id,
        'fulfillment_id',v_f.id,
        'service_id',v_f.service_id,
        'status',v_status,
        'delivery_strategy',v_strategy,
        'source','operations_center'
      )
    );
  end if;

  return jsonb_build_object(
    'success',true,
    'order_id',v_f.order_id,
    'fulfillment_id',v_f.id,
    'strategy',v_strategy,
    'status',v_status,
    'changed',v_changed,
    'customer_credentials_purged',
    v_strategy='store_account' and v_had_customer_credentials
  );
end;
$function$;

revoke all on function public.ops_choose_manual_delivery(uuid,text,text)
from public,anon;
grant execute on function public.ops_choose_manual_delivery(uuid,text,text)
to authenticated;

create or replace function public.ops_complete_manual_delivery(
  p_fulfillment_id uuid,
  p_encrypted_delivery text,
  p_delivery_summary jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_f public.fulfillments%rowtype;
  v_order public.orders%rowtype;
  v_order_fulfillment_status text;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;
  if nullif(trim(coalesce(p_encrypted_delivery,'')),'') is null then
    raise exception 'Encrypted delivery is required';
  end if;
  if jsonb_typeof(coalesce(p_delivery_summary,'{}'::jsonb))<>'object' then
    raise exception 'Invalid delivery summary';
  end if;

  select * into v_f
  from public.fulfillments
  where id=p_fulfillment_id
  for update;

  if not found then
    raise exception 'Fulfillment not found';
  end if;
  if lower(coalesce(v_f.mode,'')) not in ('manual_activation','manual_delivery') then
    raise exception 'Automatic fulfillment cannot be completed here';
  end if;
  if lower(coalesce(v_f.status,'')) in ('cancelled','failed') then
    raise exception 'This fulfillment cannot be delivered';
  end if;
  if lower(coalesce(v_f.status,'')) in ('delivered','completed') then
    return jsonb_build_object(
      'success',true,
      'already_delivered',true,
      'order_id',v_f.order_id,
      'fulfillment_id',v_f.id,
      'status',v_f.status
    );
  end if;

  select * into v_order
  from public.orders
  where id=v_f.order_id
  for update;

  if not found or lower(coalesce(v_order.status,'')) not in ('paid','completed') then
    raise exception 'The order must be paid first';
  end if;

  update public.fulfillments
  set
    mode='manual_delivery',
    status='delivered',
    customer_input=null,
    encrypted_delivery=p_encrypted_delivery,
    delivery_summary=coalesce(delivery_summary,'{}'::jsonb)
      ||coalesce(p_delivery_summary,'{}'::jsonb)
      ||jsonb_build_object(
        'delivery_strategy','store_account',
        'manual_delivery_completed_at',now(),
        'message','The Strivio account has been delivered.'
      ),
    delivered_at=coalesce(delivered_at,now()),
    email_status='pending',
    email_error=null,
    updated_at=now()
  where id=v_f.id;

  v_order_fulfillment_status=case
    when exists (
      select 1 from public.fulfillments
      where order_id=v_f.order_id
        and lower(coalesce(status,''))='out_of_stock'
    ) then 'needs_stock'
    when exists (
      select 1 from public.fulfillments
      where order_id=v_f.order_id
        and lower(coalesce(status,'')) not in ('delivered','completed')
    ) then 'partially_delivered'
    else 'delivered'
  end;

  update public.orders
  set
    fulfillment_status=v_order_fulfillment_status,
    fulfilled_at=case
      when v_order_fulfillment_status='delivered'
        then coalesce(fulfilled_at,now())
      else null
    end,
    updated_at=now()
  where id=v_f.order_id;

  insert into public.operations_audit_log(
    actor_id,action,entity_type,entity_id,order_id,service_id,
    before_data,after_data,metadata
  ) values (
    auth.uid(),'complete_manual_delivery','fulfillment',v_f.id::text,
    v_f.order_id,v_f.service_id,
    jsonb_build_object(
      'mode',v_f.mode,
      'status',v_f.status,
      'had_customer_credentials',
        coalesce(v_f.customer_input,'{}'::jsonb) ? 'account_password_cipher'
    ),
    jsonb_build_object(
      'mode','manual_delivery',
      'status','delivered',
      'order_fulfillment_status',v_order_fulfillment_status
    ),
    jsonb_build_object('source','operations_center')
  );

  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values(
    'manual_delivery_completed',
    v_f.id::text,
    jsonb_build_object(
      'order_id',v_f.order_id,
      'fulfillment_id',v_f.id,
      'service_id',v_f.service_id,
      'status','delivered',
      'fulfillment_status',v_order_fulfillment_status,
      'source','operations_center'
    )
  );

  return jsonb_build_object(
    'success',true,
    'already_delivered',false,
    'order_id',v_f.order_id,
    'fulfillment_id',v_f.id,
    'service_id',v_f.service_id,
    'status','delivered',
    'order_fulfillment_status',v_order_fulfillment_status
  );
end;
$function$;

revoke all on function public.ops_complete_manual_delivery(uuid,text,jsonb)
from public,anon;
grant execute on function public.ops_complete_manual_delivery(uuid,text,jsonb)
to authenticated;
