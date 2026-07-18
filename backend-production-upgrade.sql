-- Strivio operations, conversations, projection triggers, and renewals.
-- Database is the source of truth; Google Sheets consumes the latest projection.

alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists fulfillment_status text;
alter table public.orders add column if not exists fulfilled_at timestamptz;
alter table public.fulfillment_allocations add column if not exists sheet_version integer not null default 0;

create table if not exists public.problem_messages (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problem_reports(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_role text not null check (sender_role in ('customer','admin','system')),
  message text not null check (char_length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists problem_messages_thread_idx
  on public.problem_messages(problem_id, created_at, id);

alter table public.problem_messages enable row level security;
drop policy if exists problem_messages_read on public.problem_messages;
create policy problem_messages_read on public.problem_messages for select using (
  public.is_admin() or exists (
    select 1
    from public.problem_reports p
    join public.orders o on o.id=p.order_id
    where p.id=problem_messages.problem_id
      and (
        o.user_id=auth.uid()
        or lower(coalesce(o.customer_info->>'email',''))=lower(coalesce(auth.jwt()->>'email',''))
      )
  )
);

create or replace function public.customer_reply_problem(p_problem_id uuid, p_message text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.problem_reports%rowtype; o public.orders%rowtype; clean_message text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  clean_message=left(trim(coalesce(p_message,'')),2000);
  if char_length(clean_message)<1 then raise exception 'Message is required'; end if;
  select * into p from public.problem_reports where id=p_problem_id for update;
  if not found then raise exception 'Problem not found'; end if;
  if lower(coalesce(p.status,'')) in ('resolved','closed','cancelled') then raise exception 'Problem is closed'; end if;
  select * into o from public.orders where id=p.order_id;
  if not found or not (
    o.user_id=auth.uid()
    or lower(coalesce(o.customer_info->>'email',''))=lower(coalesce(auth.jwt()->>'email',''))
  ) then raise exception 'Forbidden'; end if;
  insert into public.problem_messages(problem_id,sender_id,sender_role,message)
  values(p.id,auth.uid(),'customer',clean_message);
  update public.problem_reports set status='open',updated_at=now() where id=p.id;
  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values('problem_updated',p.id::text,jsonb_build_object('order_id',p.order_id,'problem_report_id',p.id,'status','open','source','customer_reply'));
  return jsonb_build_object('success',true,'problem_id',p.id);
end;
$$;

create or replace function public.ops_reply_problem(p_problem_id uuid, p_message text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.problem_reports%rowtype; clean_message text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  clean_message=left(trim(coalesce(p_message,'')),2000);
  if char_length(clean_message)<1 then raise exception 'Message is required'; end if;
  select * into p from public.problem_reports where id=p_problem_id for update;
  if not found then raise exception 'Problem not found'; end if;
  if lower(coalesce(p.status,'')) in ('resolved','closed','cancelled') then raise exception 'Problem is closed'; end if;
  insert into public.problem_messages(problem_id,sender_id,sender_role,message)
  values(p.id,auth.uid(),'admin',clean_message);
  update public.problem_reports
    set status='reviewing',admin_notes=clean_message,updated_at=now()
    where id=p.id;
  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values('problem_updated',p.id::text,jsonb_build_object('order_id',p.order_id,'problem_report_id',p.id,'status','reviewing','source','admin_reply'));
  insert into public.operations_audit_log(actor_id,action,entity_type,entity_id,order_id,service_id,before_data,after_data)
  values(auth.uid(),'reply_problem','problem',p.id::text,p.order_id,p.service_id,jsonb_build_object('status',p.status),jsonb_build_object('status','reviewing','message',clean_message));
  return jsonb_build_object('success',true,'problem_id',p.id,'order_id',p.order_id);
end;
$$;

create or replace function public.ops_resolve_problem(p_problem_id uuid, p_admin_notes text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.problem_reports%rowtype; f public.fulfillments%rowtype; clean_message text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  clean_message=left(trim(coalesce(p_admin_notes,'')),2000);
  select * into p from public.problem_reports where id=p_problem_id for update;
  if not found then raise exception 'Problem not found'; end if;
  if clean_message<>'' then
    insert into public.problem_messages(problem_id,sender_id,sender_role,message)
    values(p.id,auth.uid(),'admin',clean_message);
  end if;
  select * into f from public.fulfillments where id=p.fulfillment_id for update;
  update public.problem_reports set
    status='resolved',
    admin_notes=case when clean_message='' then admin_notes else clean_message end,
    resolved_at=now(),updated_at=now()
  where id=p.id;
  if f.id is not null then
    update public.fulfillments set
      status=case when f.status='problem' then case when f.mode='manual_activation' then 'awaiting_admin' else 'delivered' end else f.status end,
      delivery_summary=coalesce(delivery_summary,'{}'::jsonb)||jsonb_build_object(
        'problem_resolution_note',case when clean_message='' then coalesce(p.admin_notes,'') else clean_message end,
        'problem_status','resolved'
      ),updated_at=now()
    where id=f.id;
    update public.fulfillment_allocations set
      admin_notes=nullif(trim(replace(coalesce(admin_notes,''),'[PROBLEM OPEN]','')),''),
      sheet_version=coalesce(sheet_version,0)+1
    where fulfillment_id=f.id;
  end if;
  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values('problem_updated',p.id::text,jsonb_build_object('order_id',p.order_id,'problem_report_id',p.id,'status','resolved','source','operations_center'));
  insert into public.operations_audit_log(actor_id,action,entity_type,entity_id,order_id,service_id,before_data,after_data)
  values(auth.uid(),'resolve_problem','problem',p.id::text,p.order_id,p.service_id,jsonb_build_object('status',p.status),jsonb_build_object('status','resolved','message',clean_message));
  return jsonb_build_object('success',true,'problem_id',p.id,'order_id',p.order_id);
end;
$$;

revoke all on function public.customer_reply_problem(uuid,text) from public;
revoke all on function public.ops_reply_problem(uuid,text) from public;
revoke all on function public.ops_resolve_problem(uuid,text) from public;
grant execute on function public.customer_reply_problem(uuid,text) to authenticated;
grant execute on function public.ops_reply_problem(uuid,text) to authenticated;
grant execute on function public.ops_resolve_problem(uuid,text) to authenticated;

create table if not exists public.renewal_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  service_id text not null references public.services(id) on delete restrict,
  target_kind text not null check (target_kind in ('allocation','fulfillment')),
  target_ids uuid[] not null,
  duration_idx integer not null check (duration_idx between 0 and 20),
  months integer not null check (months between 1 and 36),
  status text not null default 'pending_payment' check (status in ('pending_payment','paid','applied','cancelled','failed')),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists renewal_requests_user_idx on public.renewal_requests(user_id,created_at desc);
alter table public.renewal_requests enable row level security;
drop policy if exists renewal_requests_owner_read on public.renewal_requests;
create policy renewal_requests_owner_read on public.renewal_requests for select using (user_id=auth.uid() or public.is_admin());

create or replace function public.create_renewal_order(
  p_target_ids uuid[],
  p_target_kind text,
  p_duration_idx integer,
  p_payment_method text default 'cib',
  p_customer_info jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  target_count integer; v_user uuid; v_service_id text; v_source_item jsonb; v_source_order uuid;
  v_service public.services%rowtype; v_duration jsonb; v_label text; v_digits text; v_months integer;
  v_type_idx integer; v_item jsonb; v_result jsonb; v_order_id uuid; v_mode text;
begin
  v_user=auth.uid();
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_target_kind not in ('allocation','fulfillment') then raise exception 'Invalid renewal target'; end if;
  if p_target_ids is null or cardinality(p_target_ids)<1 or cardinality(p_target_ids)>20 then raise exception 'Select between 1 and 20 subscriptions'; end if;
  if p_duration_idx<0 or p_duration_idx>20 then raise exception 'Invalid duration'; end if;
  if p_payment_method<>'cib' then raise exception 'Renewals currently require online payment'; end if;

  if p_target_kind='allocation' then
    select count(*),min(f.service_id),min(o.id::text)::uuid
      into target_count,v_service_id,v_source_order
    from public.fulfillment_allocations a
    join public.fulfillments f on f.id=a.fulfillment_id
    join public.orders o on o.id=f.order_id
    where a.id=any(p_target_ids) and a.status='active'
      and (a.ends_at is null or a.ends_at<=now()+interval '7 days')
      and (o.user_id=v_user or lower(coalesce(o.customer_info->>'email',''))=lower(coalesce(auth.jwt()->>'email','')));
    select o.items->f.order_item_index into v_source_item
    from public.fulfillment_allocations a join public.fulfillments f on f.id=a.fulfillment_id join public.orders o on o.id=f.order_id
    where a.id=any(p_target_ids) limit 1;
  else
    select count(*),min(f.service_id),min(o.id::text)::uuid
      into target_count,v_service_id,v_source_order
    from public.fulfillments f join public.orders o on o.id=f.order_id
    where f.id=any(p_target_ids) and f.status in ('delivered','completed','awaiting_admin')
      and (
        nullif(f.delivery_summary->>'ends_at','') is null
        or (f.delivery_summary->>'ends_at')::timestamptz<=now()+interval '7 days'
      )
      and (o.user_id=v_user or lower(coalesce(o.customer_info->>'email',''))=lower(coalesce(auth.jwt()->>'email','')));
    select o.items->f.order_item_index into v_source_item
    from public.fulfillments f join public.orders o on o.id=f.order_id where f.id=any(p_target_ids) limit 1;
  end if;
  if target_count<>cardinality(p_target_ids) or v_service_id is null then raise exception 'One or more subscriptions cannot be renewed yet'; end if;
  if exists (
    select 1 from (
      select distinct f.service_id from public.fulfillment_allocations a join public.fulfillments f on f.id=a.fulfillment_id where p_target_kind='allocation' and a.id=any(p_target_ids)
      union all
      select distinct f.service_id from public.fulfillments f where p_target_kind='fulfillment' and f.id=any(p_target_ids)
    ) q where q.service_id<>v_service_id
  ) then raise exception 'Renew one service at a time'; end if;

  select * into v_service from public.services where id=v_service_id;
  if not found then raise exception 'Service not found'; end if;
  v_duration=jsonb_build_object(
    'ar',coalesce(v_service.f->'ar'->p_duration_idx,'null'::jsonb),
    'fr',coalesce(v_service.f->'fr'->p_duration_idx,'null'::jsonb),
    'en',coalesce(v_service.f->'en'->p_duration_idx,'null'::jsonb)
  );
  v_label=coalesce(v_service.f->'en'->>p_duration_idx,v_service.f->'fr'->>p_duration_idx,v_service.f->'ar'->>p_duration_idx,'');
  v_digits=regexp_replace(v_label,'[^0-9]','','g');
  v_months=case when v_digits<>'' then greatest(1,least(36,v_digits::integer)) else (array[1,2,3,6,12])[least(p_duration_idx+1,5)] end;
  v_mode=coalesce(v_service.fulfillment_mode,'manual_delivery');
  v_type_idx=case when v_mode in ('automatic_slot','automatic_account') then target_count-1 else coalesce((v_source_item->>'typeIdx')::integer,0) end;
  v_item=coalesce(v_source_item,'{}'::jsonb)||jsonb_build_object(
    'id',v_service_id,'durIdx',p_duration_idx,'durLabelData',v_duration,
    'durLabel',coalesce(v_duration->>'ar',v_duration->>'fr',v_duration->>'en',''),
    'typeIdx',v_type_idx,'qty',1,'renewal',true
  );
  v_result=public.create_order_secure(jsonb_build_array(v_item),p_payment_method,null,
    coalesce(p_customer_info,'{}'::jsonb)||jsonb_build_object('order_kind','renewal','renewal_source_order_id',v_source_order));
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_order_id=(v_result->>'order_id')::uuid;
  update public.orders set user_id=v_user,updated_at=now() where id=v_order_id;
  insert into public.renewal_requests(order_id,user_id,service_id,target_kind,target_ids,duration_idx,months,metadata)
  values(v_order_id,v_user,v_service_id,p_target_kind,p_target_ids,p_duration_idx,v_months,jsonb_build_object('source_order_id',v_source_order));
  return v_result||jsonb_build_object('renewal',true,'months',v_months,'target_count',target_count);
end;
$$;

create or replace function public.apply_paid_renewal_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare req public.renewal_requests%rowtype; ord public.orders%rowtype; target uuid; new_end timestamptz; base_end timestamptz; f_id uuid; updates jsonb='[]'::jsonb;
begin
  if auth.role()<>'service_role' and not public.is_admin() then raise exception 'Server only'; end if;
  select * into ord from public.orders where id=p_order_id for update;
  if not found or ord.status not in ('paid','completed') then raise exception 'Renewal order is not paid'; end if;
  select * into req from public.renewal_requests where order_id=p_order_id for update;
  if not found then raise exception 'Renewal request not found'; end if;
  if req.status='applied' then return jsonb_build_object('success',true,'already_applied',true,'order_id',p_order_id); end if;
  foreach target in array req.target_ids loop
    if req.target_kind='allocation' then
      select ends_at,fulfillment_id into base_end,f_id from public.fulfillment_allocations where id=target and status='active' for update;
      if not found then raise exception 'Renewal allocation is no longer active'; end if;
      new_end=greatest(coalesce(base_end,now()),now())+make_interval(months=>req.months);
      update public.fulfillment_allocations set ends_at=new_end,sheet_version=coalesce(sheet_version,0)+1,admin_notes=concat_ws(E'\n',nullif(admin_notes,''),'Renewed by order #'||p_order_id::text) where id=target;
      update public.fulfillments set delivery_summary=coalesce(delivery_summary,'{}'::jsonb)||jsonb_build_object('ends_at',(
        select max(ends_at) from public.fulfillment_allocations where fulfillment_id=f_id and status='active'
      )),updated_at=now() where id=f_id;
    else
      select nullif(delivery_summary->>'ends_at','')::timestamptz into base_end from public.fulfillments where id=target for update;
      if not found then raise exception 'Renewal fulfillment no longer exists'; end if;
      new_end=greatest(coalesce(base_end,now()),now())+make_interval(months=>req.months);
      update public.fulfillments set delivery_summary=coalesce(delivery_summary,'{}'::jsonb)||jsonb_build_object('ends_at',new_end,'renewed_by_order_id',p_order_id),updated_at=now() where id=target;
      f_id=target;
    end if;
    updates=updates||jsonb_build_object('target_id',target,'fulfillment_id',f_id,'ends_at',new_end);
    insert into public.operations_audit_log(actor_id,action,entity_type,entity_id,order_id,service_id,before_data,after_data)
    values(req.user_id,'renew_subscription',req.target_kind,target::text,p_order_id,req.service_id,jsonb_build_object('ends_at',base_end),jsonb_build_object('ends_at',new_end,'months',req.months));
  end loop;
  update public.renewal_requests set status='applied',applied_at=now() where id=req.id;
  update public.orders set fulfillment_status='delivered',fulfilled_at=now(),updated_at=now() where id=p_order_id;
  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values('subscription_renewed',p_order_id::text,jsonb_build_object('order_id',p_order_id,'service_id',req.service_id,'target_kind',req.target_kind,'target_ids',req.target_ids,'months',req.months,'inventory',true));
  return jsonb_build_object('success',true,'order_id',p_order_id,'months',req.months,'updates',updates);
end;
$$;

revoke all on function public.create_renewal_order(uuid[],text,integer,text,jsonb) from public;
revoke all on function public.apply_paid_renewal_order(uuid) from public;
grant execute on function public.create_renewal_order(uuid[],text,integer,text,jsonb) to authenticated;
grant execute on function public.apply_paid_renewal_order(uuid) to service_role,authenticated;

create or replace function public.ops_ack_sheet_snapshot(p_scope text, p_order_id uuid default null)
returns integer language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  if auth.role()<>'service_role' and not public.is_admin() then raise exception 'Server only'; end if;
  update public.integration_outbox set status='sent',processed_at=now(),last_error=null
  where status in ('pending','failed') and (
    (
      lower(coalesce(p_scope,'')) in ('inventory','netflix','netflix_inventory')
      and event_type in ('inventory_changed','admin_sheet_refresh')
      and lower(coalesce(payload->>'inventory','false'))='true'
    )
    or (p_order_id is not null and payload->>'order_id'=p_order_id::text)
  );
  get diagnostics affected=row_count;
  return affected;
end;
$$;
revoke all on function public.ops_ack_sheet_snapshot(text,uuid) from public;
grant execute on function public.ops_ack_sheet_snapshot(text,uuid) to service_role;

create or replace function public.ops_enqueue_sheet_projection()
returns trigger language plpgsql security definer set search_path=public as $$
declare row_id text; service_value text; order_value uuid; event_value text;
begin
  if tg_op='DELETE' then row_id=old.id::text; else row_id=new.id::text; end if;
  if tg_table_name='problem_reports' then
    event_value='problem_updated';
    if tg_op='DELETE' then order_value=old.order_id; service_value=old.service_id;
    else order_value=new.order_id; service_value=new.service_id; end if;
  else
    event_value='inventory_changed';
    if tg_table_name='inventory_accounts' then
      if tg_op='DELETE' then service_value=old.service_id; else service_value=new.service_id; end if;
    end if;
  end if;
  insert into public.integration_outbox(event_type,aggregate_id,payload)
  values(event_value,row_id,jsonb_build_object('table',tg_table_name,'operation',tg_op,'order_id',order_value,'service_id',service_value,'inventory',event_value='inventory_changed','source','database_trigger'));
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists project_inventory_accounts_to_sheet on public.inventory_accounts;
create trigger project_inventory_accounts_to_sheet after insert or update or delete on public.inventory_accounts for each row execute function public.ops_enqueue_sheet_projection();
drop trigger if exists project_inventory_slots_to_sheet on public.inventory_slots;
create trigger project_inventory_slots_to_sheet after insert or update or delete on public.inventory_slots for each row execute function public.ops_enqueue_sheet_projection();
drop trigger if exists project_allocations_to_sheet on public.fulfillment_allocations;
create trigger project_allocations_to_sheet after insert or update or delete on public.fulfillment_allocations for each row execute function public.ops_enqueue_sheet_projection();
drop trigger if exists project_problems_to_sheet on public.problem_reports;
create trigger project_problems_to_sheet after insert or update or delete on public.problem_reports for each row execute function public.ops_enqueue_sheet_projection();
