-- Customer support RPCs are versioned here so fresh environments keep the
-- same secure single-open-report workflow as production.

create or replace function public.report_order_problem(
  p_order_id uuid,
  p_fulfillment_id uuid,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_order public.orders%rowtype;
  v_f public.fulfillments%rowtype;
  v_item jsonb;
  v_report_id uuid;
  v_existing_id uuid;
  v_msg text;
  v_item_index int := 0;
  v_f_service_id text := null;
  v_email text := lower(trim(coalesce(auth.jwt()->>'email','')));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  v_msg := trim(coalesce(p_message,''));
  if length(v_msg)<3 or length(v_msg)>2000 then
    raise exception 'Invalid problem message';
  end if;

  select * into v_order from public.orders where id=p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if not public.is_admin() and not (
    v_order.user_id=auth.uid()
    or (
      v_order.user_id is null
      and v_email<>''
      and lower(trim(coalesce(v_order.customer_info->>'email','')))=v_email
    )
  ) then
    raise exception 'Not allowed';
  end if;

  -- Serialize report creation per order so two rapid clicks cannot create
  -- two simultaneous open tickets.
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,0));

  select id into v_existing_id
  from public.problem_reports
  where order_id=p_order_id
    and lower(coalesce(status,'')) not in ('resolved','closed','cancelled')
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('success',true,'problem_report_id',v_existing_id,'existing',true);
  end if;

  if p_fulfillment_id is not null then
    select * into v_f
    from public.fulfillments
    where id=p_fulfillment_id and order_id=p_order_id;
  else
    select * into v_f
    from public.fulfillments
    where order_id=p_order_id
      and lower(coalesce(status,'')) in ('delivered','completed')
    order by order_item_index,created_at
    limit 1;
    if found then p_fulfillment_id:=v_f.id; end if;
  end if;

  if not found then raise exception 'Delivered item not found'; end if;
  if lower(coalesce(v_f.status,'')) not in ('delivered','completed') then
    raise exception 'This item is not delivered yet';
  end if;

  v_item_index:=coalesce(v_f.order_item_index,0);
  v_f_service_id:=v_f.service_id;
  v_item:=coalesce(v_order.items->v_item_index,'{}'::jsonb);

  insert into public.problem_reports(
    order_id,fulfillment_id,service_id,product_name,
    customer_email,customer_phone,customer_name,message
  ) values (
    p_order_id,p_fulfillment_id,
    nullif(coalesce(v_f_service_id,v_item->>'service_id',v_item->>'id'),''),
    nullif(coalesce(
      v_item#>>'{nameData,ar}',v_item#>>'{nameData,fr}',v_item#>>'{nameData,en}',
      v_item->>'name',v_item->>'title',coalesce(v_f_service_id,'')
    ),''),
    lower(trim(coalesce(v_order.customer_info->>'email',''))),
    coalesce(v_order.customer_info->>'phone',''),
    trim(concat_ws(' ',v_order.customer_info->>'first_name',v_order.customer_info->>'last_name')),
    v_msg
  ) returning id into v_report_id;

  update public.fulfillments
  set delivery_summary=coalesce(delivery_summary,'{}'::jsonb)||jsonb_build_object(
      'problem_status','open','problem_report_id',v_report_id,'problem_message',v_msg
    ),
    updated_at=now()
  where id=p_fulfillment_id;

  update public.fulfillment_allocations
  set admin_notes=trim(coalesce(admin_notes,'')||E'\n[PROBLEM OPEN] '||v_msg),
    sheet_version=sheet_version+1
  where fulfillment_id=p_fulfillment_id and status='active';

  return jsonb_build_object('success',true,'problem_report_id',v_report_id);
end;
$function$;

create or replace function public.customer_reply_problem(p_problem_id uuid,p_message text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  p public.problem_reports%rowtype;
  o public.orders%rowtype;
  clean_message text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  clean_message=left(trim(coalesce(p_message,'')),2000);
  if char_length(clean_message)<1 then raise exception 'Message is required'; end if;
  select * into p from public.problem_reports where id=p_problem_id for update;
  if not found then raise exception 'Problem not found'; end if;
  if lower(coalesce(p.status,'')) in ('resolved','closed','cancelled') then
    raise exception 'Problem is closed';
  end if;
  select * into o from public.orders where id=p.order_id;
  if not found or not (
    o.user_id=auth.uid()
    or (
      o.user_id is null
      and lower(trim(coalesce(auth.jwt()->>'email','')))<>''
      and lower(trim(coalesce(o.customer_info->>'email','')))
          =lower(trim(coalesce(auth.jwt()->>'email','')))
    )
  ) then raise exception 'Forbidden'; end if;
  insert into public.problem_messages(problem_id,sender_id,sender_role,message)
  values(p.id,auth.uid(),'customer',clean_message);
  update public.problem_reports set status='open',updated_at=now() where id=p.id;
  return jsonb_build_object('success',true,'problem_id',p.id);
end;
$function$;

create or replace function public.ops_reply_problem(p_problem_id uuid,p_message text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  p public.problem_reports%rowtype;
  clean_message text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  clean_message=left(trim(coalesce(p_message,'')),2000);
  if char_length(clean_message)<1 then raise exception 'Message is required'; end if;
  select * into p from public.problem_reports where id=p_problem_id for update;
  if not found then raise exception 'Problem not found'; end if;
  if lower(coalesce(p.status,'')) in ('resolved','closed','cancelled') then
    raise exception 'Problem is closed';
  end if;
  insert into public.problem_messages(problem_id,sender_id,sender_role,message)
  values(p.id,auth.uid(),'admin',clean_message);
  update public.problem_reports
  set status='reviewing',admin_notes=clean_message,updated_at=now()
  where id=p.id;
  insert into public.operations_audit_log(
    actor_id,action,entity_type,entity_id,order_id,service_id,before_data,after_data
  ) values (
    auth.uid(),'reply_problem','problem',p.id::text,p.order_id,p.service_id,
    jsonb_build_object('status',p.status),
    jsonb_build_object('status','reviewing','message',clean_message)
  );
  return jsonb_build_object('success',true,'problem_id',p.id,'order_id',p.order_id);
end;
$function$;

grant execute on function public.report_order_problem(uuid,uuid,text) to authenticated;
grant execute on function public.customer_reply_problem(uuid,text) to authenticated;
revoke all on function public.ops_reply_problem(uuid,text) from public,anon;
grant execute on function public.ops_reply_problem(uuid,text) to authenticated;

-- The projection trigger is the single source of Sheet jobs for reports.
-- RPCs update problem_reports; this trigger emits exactly one projection job.
drop trigger if exists project_problems_to_sheet on public.problem_reports;
create trigger project_problems_to_sheet
after insert or update or delete on public.problem_reports
for each row execute function public.ops_enqueue_sheet_projection();

drop policy if exists problem_messages_read on public.problem_messages;
create policy problem_messages_read on public.problem_messages for select using (
  public.is_admin()
  or exists (
    select 1
    from public.problem_reports p
    join public.orders o on o.id=p.order_id
    where p.id=problem_messages.problem_id
      and (
        o.user_id=auth.uid()
        or (
          o.user_id is null
          and lower(trim(coalesce(auth.jwt()->>'email','')))<>''
          and lower(trim(coalesce(o.customer_info->>'email','')))
              =lower(trim(coalesce(auth.jwt()->>'email','')))
        )
      )
  )
);

-- Customer portal uses Realtime for instant activation/problem state changes;
-- polling remains as a fallback when a connection is unavailable.
do $realtime$
declare
  table_name text;
begin
  foreach table_name in array array[
    'fulfillments','activation_messages','problem_reports','problem_messages'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime'
        and schemaname='public'
        and tablename=table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end;
$realtime$;
