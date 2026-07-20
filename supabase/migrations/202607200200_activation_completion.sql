-- Complete manual account activations atomically and keep support reports
-- independent from the delivery lifecycle.

create or replace function public.ops_complete_activation(
  p_fulfillment_id uuid,
  p_admin_message text default ''
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  f public.fulfillments%rowtype;
  clean_message text;
  order_fulfillment_status text;
  was_completed boolean;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  clean_message=left(trim(coalesce(p_admin_message,'')),2000);

  select * into f
  from public.fulfillments
  where id=p_fulfillment_id
  for update;

  if not found then
    raise exception 'Activation request not found';
  end if;
  if coalesce(f.mode,'')<>'manual_activation' then
    raise exception 'This is not a manual activation';
  end if;
  if lower(coalesce(f.status,'')) in ('cancelled','failed') then
    raise exception 'This activation cannot be completed';
  end if;

  was_completed=lower(coalesce(f.status,'')) in ('delivered','completed');

  update public.fulfillments
  set
    status='delivered',
    delivered_at=coalesce(delivered_at,now()),
    delivery_summary=coalesce(delivery_summary,'{}'::jsonb)||jsonb_build_object(
      'message','Activation completed successfully.',
      'activation_completed_at',coalesce(delivered_at,now()),
      'activation_completion_note',case
        when clean_message='' then delivery_summary->>'activation_completion_note'
        else clean_message
      end
    ),
    updated_at=now()
  where id=f.id;

  -- Store the final admin note after closing the activation. The message
  -- notification trigger sees the delivered state and therefore does not send
  -- a redundant "new message" email next to the completion email.
  if not was_completed and clean_message<>'' then
    insert into public.activation_messages(
      fulfillment_id,
      sender_id,
      sender_role,
      message
    ) values (
      f.id,
      auth.uid(),
      'admin',
      clean_message
    );
  end if;

  order_fulfillment_status=case
    when exists (
      select 1 from public.fulfillments
      where order_id=f.order_id and lower(coalesce(status,''))='out_of_stock'
    ) then 'needs_stock'
    when exists (
      select 1 from public.fulfillments
      where order_id=f.order_id
        and lower(coalesce(status,'')) not in ('delivered','completed')
    ) then 'partially_delivered'
    else 'delivered'
  end;

  update public.orders
  set
    fulfillment_status=order_fulfillment_status,
    fulfilled_at=case
      when order_fulfillment_status='delivered' then coalesce(fulfilled_at,now())
      else null
    end,
    updated_at=now()
  where id=f.order_id;

  if not was_completed then
    insert into public.integration_outbox(event_type,aggregate_id,payload)
    values(
      'activation_completed',
      f.id::text,
      jsonb_build_object(
        'order_id',f.order_id,
        'fulfillment_id',f.id,
        'service_id',f.service_id,
        'status','delivered',
        'source','operations_center',
        'notify_customer',true,
        'send_email',true
      )
    );

    insert into public.operations_audit_log(
      actor_id,
      action,
      entity_type,
      entity_id,
      order_id,
      service_id,
      before_data,
      after_data
    ) values (
      auth.uid(),
      'complete_activation',
      'fulfillment',
      f.id::text,
      f.order_id,
      f.service_id,
      jsonb_build_object('status',f.status),
      jsonb_build_object(
        'status','delivered',
        'message',clean_message,
        'order_fulfillment_status',order_fulfillment_status
      )
    );
  end if;

  return jsonb_build_object(
    'success',true,
    'fulfillment_id',f.id,
    'order_id',f.order_id,
    'status','delivered',
    'order_fulfillment_status',order_fulfillment_status,
    'already_completed',was_completed
  );
end;
$$;

revoke all on function public.ops_complete_activation(uuid,text) from public;
grant execute on function public.ops_complete_activation(uuid,text) to authenticated;

create or replace function public.ops_resolve_problem(
  p_problem_id uuid,
  p_admin_notes text default ''
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.problem_reports%rowtype;
  f public.fulfillments%rowtype;
  clean_message text;
  restored_status text;
  order_fulfillment_status text;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  clean_message=left(trim(coalesce(p_admin_notes,'')),2000);

  select * into p
  from public.problem_reports
  where id=p_problem_id
  for update;

  if not found then
    raise exception 'Problem not found';
  end if;

  update public.problem_reports
  set
    status='resolved',
    admin_notes=case when clean_message='' then admin_notes else clean_message end,
    resolved_at=now(),
    updated_at=now()
  where id=p.id;

  -- Store the resolution note after closing the report. The message trigger
  -- sees the resolved state and does not send a second "new reply" email;
  -- the resolution notification already carries admin_notes.
  if clean_message<>'' then
    insert into public.problem_messages(problem_id,sender_id,sender_role,message)
    values(p.id,auth.uid(),'admin',clean_message);
  end if;

  select * into f
  from public.fulfillments
  where id=p.fulfillment_id
  for update;

  if f.id is not null then
    restored_status=case
      when lower(coalesce(f.status,''))<>'problem' then f.status
      when lower(coalesce(f.delivery_summary->>'problem_previous_status','')) in (
        'delivered','completed','awaiting_admin','awaiting_customer'
      ) then lower(f.delivery_summary->>'problem_previous_status')
      -- A support report opened after a manual activation must never reopen
      -- the activation conversation when it is resolved.
      when f.mode='manual_activation' then 'delivered'
      else 'delivered'
    end;

    update public.fulfillments
    set
      status=restored_status,
      delivered_at=case
        when restored_status in ('delivered','completed')
          then coalesce(delivered_at,now())
        else delivered_at
      end,
      delivery_summary=coalesce(delivery_summary,'{}'::jsonb)||jsonb_build_object(
        'problem_resolution_note',case
          when clean_message='' then coalesce(p.admin_notes,'')
          else clean_message
        end,
        'problem_status','resolved'
      ),
      updated_at=now()
    where id=f.id;

    update public.fulfillment_allocations
    set
      admin_notes=nullif(trim(replace(coalesce(admin_notes,''),'[PROBLEM OPEN]','')),''),
      sheet_version=coalesce(sheet_version,0)+1
    where fulfillment_id=f.id;

    order_fulfillment_status=case
      when exists (
        select 1 from public.fulfillments
        where order_id=f.order_id and lower(coalesce(status,''))='out_of_stock'
      ) then 'needs_stock'
      when exists (
        select 1 from public.fulfillments
        where order_id=f.order_id
          and lower(coalesce(status,'')) not in ('delivered','completed')
      ) then 'partially_delivered'
      else 'delivered'
    end;

    update public.orders
    set
      fulfillment_status=order_fulfillment_status,
      fulfilled_at=case
        when order_fulfillment_status='delivered' then coalesce(fulfilled_at,now())
        else null
      end,
      updated_at=now()
    where id=f.order_id;
  end if;

  insert into public.operations_audit_log(
    actor_id,
    action,
    entity_type,
    entity_id,
    order_id,
    service_id,
    before_data,
    after_data
  ) values (
    auth.uid(),
    'resolve_problem',
    'problem',
    p.id::text,
    p.order_id,
    p.service_id,
    jsonb_build_object('status',p.status),
    jsonb_build_object('status','resolved','message',clean_message)
  );

  return jsonb_build_object(
    'success',true,
    'problem_id',p.id,
    'order_id',p.order_id,
    'fulfillment_status',case when f.id is null then null else restored_status end
  );
end;
$$;

revoke all on function public.ops_resolve_problem(uuid,text) from public;
grant execute on function public.ops_resolve_problem(uuid,text) to authenticated;
