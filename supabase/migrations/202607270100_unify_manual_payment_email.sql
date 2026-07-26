-- Keep payment.confirmed in the in-site notification center, but do not queue a
-- separate email. fulfill-order is the single email authority: it sends either
-- the unified paid + processing message or the final delivered message.

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
      paid_at=coalesce(paid_at,now()::text),
      transfer_status='confirmed',
      updated_at=now()
    where id=v_order.id;

    insert into public.order_status_logs(order_id,old_status,new_status,source)
    values(v_order.id,v_order.status,'paid','operations_manual_payment');

    v_changed=true;
  else
    update public.orders
    set
      payment_completed=true,
      invoice_completed=true,
      invoice_status='paid',
      paid_at=coalesce(paid_at,now()::text),
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
        'paid_at',coalesce(v_order.paid_at,now()::text)
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
      false,
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
