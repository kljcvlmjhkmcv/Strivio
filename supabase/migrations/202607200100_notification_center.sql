-- Strivio unified notification center and durable delivery queue.
--
-- Security principles:
--   * notification event payloads contain references and display metadata only;
--     passwords, provider tokens, and decrypted deliveries must never be stored here.
--   * browser clients can only read their own inbox rows and mark them as read
--     through narrowly scoped RPCs.
--   * queue creation and delivery state changes are server-only.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (char_length(event_type) between 3 and 100),
  aggregate_type text,
  aggregate_id text,
  order_id uuid references public.orders(id) on delete cascade,
  fulfillment_id uuid references public.fulfillments(id) on delete cascade,
  problem_id uuid references public.problem_reports(id) on delete cascade,
  service_id text references public.services(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  locale text not null default 'ar' check (locale in ('ar','fr','en')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  dedupe_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_events_dedupe_idx
  on public.notification_events(dedupe_key)
  where dedupe_key is not null;
create index if not exists notification_events_order_idx
  on public.notification_events(order_id, created_at desc);
create index if not exists notification_events_type_idx
  on public.notification_events(event_type, created_at desc);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  recipient_email text,
  category text not null default 'system' check (char_length(category) between 2 and 40),
  severity text not null default 'info' check (severity in ('info','success','warning','error')),
  title_i18n jsonb not null default '{}'::jsonb check (jsonb_typeof(title_i18n) = 'object'),
  body_i18n jsonb not null default '{}'::jsonb check (jsonb_typeof(body_i18n) = 'object'),
  action_url text,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (action_url is null or (left(action_url,1)='/' and left(action_url,2)<>'//'))
);

create unique index if not exists user_notifications_event_user_idx
  on public.user_notifications(event_id,user_id)
  where user_id is not null;
create unique index if not exists user_notifications_event_email_idx
  on public.user_notifications(event_id,lower(recipient_email))
  where recipient_email is not null and recipient_email<>'';
create index if not exists user_notifications_inbox_idx
  on public.user_notifications(user_id, created_at desc)
  where archived_at is null;
create index if not exists user_notifications_unread_idx
  on public.user_notifications(user_id, created_at desc)
  where read_at is null and archived_at is null;
create index if not exists user_notifications_email_inbox_idx
  on public.user_notifications(lower(recipient_email),created_at desc)
  where recipient_email is not null and archived_at is null;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  user_notification_id uuid references public.user_notifications(id) on delete set null,
  channel text not null check (channel in ('email','telegram')),
  provider text not null check (provider in ('resend','telegram')),
  recipient text not null check (char_length(recipient) between 1 and 320),
  template_key text not null check (char_length(template_key) between 2 and 100),
  locale text not null default 'ar' check (locale in ('ar','fr','en')),
  status text not null default 'pending'
    check (status in ('pending','processing','sent','delivered','failed','dead','suppressed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  requeue_generation integer not null default 0 check (requeue_generation >= 0),
  max_attempts integer not null default 6 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_until timestamptz,
  locked_by text,
  provider_message_id text,
  last_error text,
  provider_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_metadata) = 'object'),
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, channel, recipient, template_key)
);

create index if not exists notification_deliveries_queue_idx
  on public.notification_deliveries(status, next_attempt_at, created_at)
  where status in ('pending','failed','processing');
create index if not exists notification_deliveries_provider_id_idx
  on public.notification_deliveries(provider, provider_message_id)
  where provider_message_id is not null;

alter table public.notification_deliveries
  add column if not exists requeue_generation integer not null default 0;

-- Resend bounce/complaint protection. This table contains email destinations,
-- never message content or credentials.
create table if not exists public.email_suppressions (
  email text primary key,
  reason text not null,
  provider text not null default 'resend',
  provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Minimal provider-event ledger for idempotent webhook handling. Raw webhook
-- bodies are intentionally not stored.
create table if not exists public.notification_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider, provider_event_id)
);

alter table public.notification_events enable row level security;
alter table public.user_notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.notification_webhook_events enable row level security;

drop policy if exists notification_events_admin_read on public.notification_events;
create policy notification_events_admin_read
  on public.notification_events for select
  using (public.is_admin());

drop policy if exists user_notifications_owner_read on public.user_notifications;
create policy user_notifications_owner_read
  on public.user_notifications for select
  using (
    user_id = auth.uid()
    or (
      user_id is null
      and recipient_email is not null
      and coalesce(auth.jwt()->>'email','')<>''
      and lower(recipient_email)=lower(coalesce(auth.jwt()->>'email',''))
    )
  );
drop policy if exists user_notifications_admin_read on public.user_notifications;
create policy user_notifications_admin_read
  on public.user_notifications for select
  using (public.is_admin());

drop policy if exists notification_deliveries_admin_read on public.notification_deliveries;
create policy notification_deliveries_admin_read
  on public.notification_deliveries for select
  using (public.is_admin());

drop policy if exists email_suppressions_admin_read on public.email_suppressions;
create policy email_suppressions_admin_read
  on public.email_suppressions for select
  using (public.is_admin());

drop policy if exists notification_webhook_events_admin_read on public.notification_webhook_events;
create policy notification_webhook_events_admin_read
  on public.notification_webhook_events for select
  using (public.is_admin());

revoke all on public.notification_events from anon, authenticated;
revoke all on public.notification_deliveries from anon, authenticated;
revoke all on public.email_suppressions from anon, authenticated;
revoke all on public.notification_webhook_events from anon, authenticated;
revoke all on public.user_notifications from anon, authenticated;
grant select on public.notification_events to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select on public.email_suppressions to authenticated;
grant select on public.notification_webhook_events to authenticated;
grant select on public.user_notifications to authenticated;

create or replace function public.notification_clean_locale(p_locale text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_locale,'')) when 'fr' then 'fr' when 'en' then 'en' else 'ar' end
$$;

create or replace function public.notification_safe_data(p_data jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_type text;
  v_key text;
  v_value jsonb;
  v_result jsonb;
begin
  if p_data is null then return '{}'::jsonb; end if;
  v_type=jsonb_typeof(p_data);
  if v_type='object' then
    v_result='{}'::jsonb;
    for v_key,v_value in select key,value from jsonb_each(p_data) loop
      if lower(v_key) in ('password','account_password','token','secret','api_key','authorization','pin','code','credentials','encrypted_delivery','encrypted_credentials','customer_input','delivery_entries')
        or lower(v_key) ~ '(password|token|secret|api[_-]?key|authorization|encrypted)'
      then
        continue;
      end if;
      v_result=v_result||jsonb_build_object(v_key,public.notification_safe_data(v_value));
    end loop;
    return v_result;
  elsif v_type='array' then
    select coalesce(jsonb_agg(public.notification_safe_data(value)),'[]'::jsonb)
      into v_result from jsonb_array_elements(p_data);
    return v_result;
  end if;
  return p_data;
end;
$$;

create or replace function public.notification_touch_updated_at()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists notification_deliveries_touch_updated_at on public.notification_deliveries;
create trigger notification_deliveries_touch_updated_at
before update on public.notification_deliveries
for each row execute function public.notification_touch_updated_at();

drop trigger if exists email_suppressions_touch_updated_at on public.email_suppressions;
create trigger email_suppressions_touch_updated_at
before update on public.email_suppressions
for each row execute function public.notification_touch_updated_at();

-- Internal helper used by business RPCs and Edge Functions. It resolves the
-- canonical owner, destination, and language from the order. Do not expose it
-- to browser roles.
create or replace function public.enqueue_customer_notification(
  p_event_type text,
  p_order_id uuid,
  p_template_key text default null,
  p_title_i18n jsonb default '{}'::jsonb,
  p_body_i18n jsonb default '{}'::jsonb,
  p_fulfillment_id uuid default null,
  p_problem_id uuid default null,
  p_service_id text default null,
  p_action_url text default null,
  p_data jsonb default '{}'::jsonb,
  p_send_email boolean default true,
  p_dedupe_key text default null
) returns uuid
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_event_id uuid;
  v_notification_id uuid;
  v_user_id uuid;
  v_email text;
  v_order_email text;
  v_locale text;
  v_action_url text;
  v_category text;
  v_severity text;
  v_template_key text;
  v_safe_data jsonb;
  v_delivery_status text;
begin
  if p_order_id is null then raise exception 'Order is required'; end if;
  if char_length(trim(coalesce(p_event_type,''))) < 3 then raise exception 'Event type is required'; end if;

  select o.user_id,
         lower(trim(coalesce(o.customer_info->>'email',''))),
         public.notification_clean_locale(o.customer_info->>'lang')
    into v_user_id,v_order_email,v_locale
  from public.orders o
  where o.id=p_order_id;
  if not found then raise exception 'Order not found'; end if;

  v_email=v_order_email;
  -- Once an order is attached to an account, the verified auth email is the
  -- canonical destination. The checkout email is only a legacy fallback.
  if v_user_id is not null then
    select lower(trim(coalesce(u.email,''))) into v_email
    from auth.users u where u.id=v_user_id;
    if coalesce(v_email,'')='' then v_email=v_order_email; end if;
  end if;

  -- Historical orders may predate user_id attachment. Link only an exact,
  -- normalized auth email; never expose auth.users to the browser.
  if v_user_id is null and v_order_email<>'' then
    select u.id into v_user_id
    from auth.users u
    where lower(trim(coalesce(u.email,'')))=v_order_email
    order by u.created_at
    limit 1;
  end if;

  v_action_url=case
    when p_action_url is not null and left(p_action_url,1)='/' and left(p_action_url,2)<>'//' then p_action_url
    else '/my-account?order='||p_order_id::text
  end;
  v_category=case
    when p_event_type like 'payment.%' then 'payment'
    when p_event_type like 'problem.%' then 'support'
    when p_event_type like 'activation.%' then 'activation'
    when p_event_type like 'subscription.%' or p_event_type like 'renewal.%' then 'subscription'
    when p_event_type like 'account.%' then 'security'
    else 'order'
  end;
  v_severity=case
    when p_event_type like '%.failed' or p_event_type like '%.cancelled' then 'error'
    when p_event_type like '%.required' or p_event_type like '%.expiring' or p_event_type like '%.delayed' then 'warning'
    when p_event_type like '%.completed' or p_event_type like '%.delivered' or p_event_type like '%.confirmed' or p_event_type like '%.resolved' or p_event_type like '%.renewed' then 'success'
    else 'info'
  end;
  v_template_key=coalesce(nullif(trim(p_template_key),''),p_event_type);
  v_safe_data=public.notification_safe_data(p_data);

  insert into public.notification_events(
    event_type,aggregate_type,aggregate_id,order_id,fulfillment_id,problem_id,
    service_id,actor_id,locale,data,dedupe_key
  ) values (
    p_event_type,'order',p_order_id::text,p_order_id,p_fulfillment_id,p_problem_id,
    p_service_id,auth.uid(),v_locale,v_safe_data,nullif(trim(coalesce(p_dedupe_key,'')),'')
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_event_id;

  if v_event_id is null and nullif(trim(coalesce(p_dedupe_key,'')),'') is not null then
    select id into v_event_id from public.notification_events where dedupe_key=trim(p_dedupe_key);
  end if;
  if v_event_id is null then raise exception 'Could not create notification event'; end if;

  if v_user_id is not null or v_email<>'' then
    insert into public.user_notifications(
      event_id,user_id,recipient_email,category,severity,title_i18n,body_i18n,action_url
    ) values (
      v_event_id,v_user_id,nullif(v_email,''),v_category,v_severity,
      case when jsonb_typeof(p_title_i18n)='object' then p_title_i18n else '{}'::jsonb end,
      case when jsonb_typeof(p_body_i18n)='object' then p_body_i18n else '{}'::jsonb end,
      v_action_url
    ) on conflict do nothing
    returning id into v_notification_id;
    if v_notification_id is null then
      select n.id into v_notification_id
      from public.user_notifications n
      where n.event_id=v_event_id
        and (
          (v_user_id is not null and n.user_id=v_user_id)
          or (n.user_id is null and v_email<>'' and lower(coalesce(n.recipient_email,''))=v_email)
        )
      order by n.created_at
      limit 1;
    end if;
  end if;

  if p_send_email and v_email<>'' then
    v_delivery_status=case when exists(
      select 1 from public.email_suppressions s where lower(s.email)=v_email
    ) then 'suppressed' else 'pending' end;
    insert into public.notification_deliveries(
      event_id,user_notification_id,channel,provider,recipient,template_key,locale,status
    ) values (
      v_event_id,v_notification_id,'email','resend',v_email,v_template_key,v_locale,v_delivery_status
    ) on conflict(event_id,channel,recipient,template_key) do nothing;
  end if;

  return v_event_id;
end;
$$;

create or replace function public.enqueue_admin_notification(
  p_event_type text,
  p_template_key text default null,
  p_title_i18n jsonb default '{}'::jsonb,
  p_body_i18n jsonb default '{}'::jsonb,
  p_order_id uuid default null,
  p_fulfillment_id uuid default null,
  p_problem_id uuid default null,
  p_service_id text default null,
  p_action_url text default '/operations',
  p_data jsonb default '{}'::jsonb,
  p_send_telegram boolean default true,
  p_dedupe_key text default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_event_id uuid;
  v_template_key text;
  v_action_url text;
begin
  if char_length(trim(coalesce(p_event_type,''))) < 3 then raise exception 'Event type is required'; end if;
  v_template_key=coalesce(nullif(trim(p_template_key),''),p_event_type);
  v_action_url=case
    when p_action_url is not null and left(p_action_url,1)='/' and left(p_action_url,2)<>'//' then p_action_url
    else '/operations'
  end;

  insert into public.notification_events(
    event_type,aggregate_type,aggregate_id,order_id,fulfillment_id,problem_id,
    service_id,actor_id,locale,data,dedupe_key
  ) values (
    p_event_type,
    case when p_problem_id is not null then 'problem' when p_fulfillment_id is not null then 'fulfillment' when p_order_id is not null then 'order' else 'system' end,
    coalesce(p_problem_id::text,p_fulfillment_id::text,p_order_id::text,p_event_type),
    p_order_id,p_fulfillment_id,p_problem_id,p_service_id,auth.uid(),'ar',
    public.notification_safe_data(p_data),nullif(trim(coalesce(p_dedupe_key,'')),'')
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_event_id;

  if v_event_id is null and nullif(trim(coalesce(p_dedupe_key,'')),'') is not null then
    select id into v_event_id from public.notification_events where dedupe_key=trim(p_dedupe_key);
  end if;
  if v_event_id is null then raise exception 'Could not create notification event'; end if;

  insert into public.user_notifications(
    event_id,user_id,recipient_email,category,severity,title_i18n,body_i18n,action_url
  )
  select v_event_id,a.user_id,lower(nullif(trim(u.email),'')),
    case when p_event_type like 'problem.%' then 'support' when p_event_type like 'activation.%' then 'activation' else 'operations' end,
    case when p_event_type like '%.failed' or p_event_type like '%.reported' then 'error' when p_event_type like '%.required' then 'warning' else 'info' end,
    case when jsonb_typeof(p_title_i18n)='object' then p_title_i18n else '{}'::jsonb end,
    case when jsonb_typeof(p_body_i18n)='object' then p_body_i18n else '{}'::jsonb end,
    v_action_url
  from public.admin_users a
  left join auth.users u on u.id=a.user_id
  on conflict do nothing;

  if p_send_telegram then
    insert into public.notification_deliveries(
      event_id,channel,provider,recipient,template_key,locale,status
    ) values (
      v_event_id,'telegram','telegram','admin',v_template_key,'ar','pending'
    ) on conflict(event_id,channel,recipient,template_key) do nothing;
  end if;
  return v_event_id;
end;
$$;

create or replace function public.get_my_notifications(
  p_limit integer default 30,
  p_before timestamptz default null
) returns table(
  id uuid,
  event_id uuid,
  event_type text,
  category text,
  severity text,
  title_i18n jsonb,
  body_i18n jsonb,
  action_url text,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path=public
as $$
  select n.id,n.event_id,e.event_type,n.category,n.severity,n.title_i18n,n.body_i18n,
         n.action_url,n.read_at,n.created_at
  from public.user_notifications n
  join public.notification_events e on e.id=n.event_id
  where auth.uid() is not null
    and (
      n.user_id=auth.uid()
      or (
        n.user_id is null
        and n.recipient_email is not null
        and coalesce(auth.jwt()->>'email','')<>''
        and lower(n.recipient_email)=lower(auth.jwt()->>'email')
      )
    )
    and n.archived_at is null
    and (p_before is null or n.created_at<p_before)
  order by n.created_at desc,n.id desc
  limit greatest(1,least(coalesce(p_limit,30),100))
$$;

create or replace function public.get_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path=public
as $$
  select count(*)::integer
  from public.user_notifications
  where auth.uid() is not null
    and (
      user_id=auth.uid()
      or (
        user_id is null
        and recipient_email is not null
        and coalesce(auth.jwt()->>'email','')<>''
        and lower(recipient_email)=lower(auth.jwt()->>'email')
      )
    )
    and read_at is null and archived_at is null
$$;

create or replace function public.claim_my_email_notifications()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_updated integer; v_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_email=lower(trim(coalesce(auth.jwt()->>'email','')));
  if v_email='' then return 0; end if;
  update public.user_notifications
  set user_id=auth.uid()
  where user_id is null and lower(coalesce(recipient_email,''))=v_email;
  get diagnostics v_updated=row_count;
  return v_updated;
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v_updated integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.user_notifications
  set read_at=coalesce(read_at,now())
  where id=p_notification_id and archived_at is null
    and (
      user_id=auth.uid()
      or (
        user_id is null
        and recipient_email is not null
        and coalesce(auth.jwt()->>'email','')<>''
        and lower(recipient_email)=lower(auth.jwt()->>'email')
      )
    );
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_updated integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.user_notifications set read_at=now()
  where read_at is null and archived_at is null
    and (
      user_id=auth.uid()
      or (
        user_id is null
        and recipient_email is not null
        and coalesce(auth.jwt()->>'email','')<>''
        and lower(recipient_email)=lower(auth.jwt()->>'email')
      )
    );
  get diagnostics v_updated=row_count;
  return v_updated;
end;
$$;

create or replace function public.claim_notification_deliveries(
  p_limit integer default 10,
  p_worker_id text default 'notification-worker',
  p_channels text[] default null
) returns setof public.notification_deliveries
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.role()<>'service_role' then raise exception 'Server only'; end if;

  update public.notification_deliveries
  set status=case when attempt_count>=max_attempts then 'dead' else 'failed' end,
      locked_at=null,locked_until=null,locked_by=null,
      next_attempt_at=now(),last_error=coalesce(last_error,'Worker lease expired')
  where status='processing' and (locked_until is null or locked_until<now());

  return query
  with candidates as (
    select d.id
    from public.notification_deliveries d
    where d.status in ('pending','failed')
      and d.next_attempt_at<=now()
      and d.attempt_count<d.max_attempts
      and (p_channels is null or d.channel=any(p_channels))
    order by d.next_attempt_at,d.created_at,d.id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
  )
  update public.notification_deliveries d
  set status='processing',attempt_count=d.attempt_count+1,locked_at=now(),
      locked_until=now()+interval '3 minutes',locked_by=left(coalesce(p_worker_id,'notification-worker'),120)
  from candidates c
  where d.id=c.id
  returning d.*;
end;
$$;

drop function if exists public.complete_notification_delivery(uuid,text,text,jsonb);
drop function if exists public.complete_notification_delivery(uuid,text,text,jsonb,text);
drop function if exists public.complete_notification_delivery(uuid,text,text,jsonb,text,text);

create or replace function public.complete_notification_delivery(
  p_delivery_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_provider_metadata jsonb default '{}'::jsonb,
  p_worker_id text default null
) returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v_updated integer;
begin
  if auth.role()<>'service_role' then raise exception 'Server only'; end if;
  if p_status not in ('sent','delivered','suppressed','cancelled') then raise exception 'Invalid completion status'; end if;
  update public.notification_deliveries
  set status=case
        when status in ('suppressed','cancelled') then status
        when status='delivered' and p_status='sent' then status
        else p_status
      end,
      provider_message_id=coalesce(nullif(p_provider_message_id,''),provider_message_id),
      provider_metadata=coalesce(provider_metadata,'{}'::jsonb)||coalesce(p_provider_metadata,'{}'::jsonb),
      sent_at=case when p_status in ('sent','delivered') then coalesce(sent_at,now()) else sent_at end,
      delivered_at=case when p_status='delivered' then coalesce(delivered_at,now()) else delivered_at end,
      locked_at=null,locked_until=null,locked_by=null,last_error=null
  where id=p_delivery_id
    and (
      (
        nullif(trim(coalesce(p_worker_id,'')),'') is not null
        and status='processing'
        and locked_by=p_worker_id
      )
      or (
        nullif(trim(coalesce(p_provider_message_id,'')),'') is not null
        and provider_message_id=p_provider_message_id
        and status in ('processing','sent','delivered','suppressed')
      )
    );
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;

drop function if exists public.fail_notification_delivery(uuid,text,integer,boolean);
drop function if exists public.fail_notification_delivery(uuid,text,integer,boolean,text);
drop function if exists public.fail_notification_delivery(uuid,text,integer,boolean,text,text);

create or replace function public.fail_notification_delivery(
  p_delivery_id uuid,
  p_error text,
  p_retry_after_seconds integer default 60,
  p_permanent boolean default false,
  p_worker_id text default null,
  p_provider_message_id text default null
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare v_status text;
begin
  if auth.role()<>'service_role' then raise exception 'Server only'; end if;
  update public.notification_deliveries
  set status=case
        when status in ('delivered','suppressed','cancelled') then status
        when p_permanent or attempt_count>=max_attempts then 'dead'
        else 'failed'
      end,
      next_attempt_at=now()+make_interval(secs=>greatest(10,least(coalesce(p_retry_after_seconds,60),86400))),
      last_error=case
        when status in ('delivered','suppressed','cancelled') then last_error
        else left(coalesce(p_error,'Delivery failed'),1000)
      end,
      locked_at=null,locked_until=null,locked_by=null
  where id=p_delivery_id
    and (
      (
        nullif(trim(coalesce(p_worker_id,'')),'') is not null
        and status='processing'
        and locked_by=p_worker_id
      )
      or (
        nullif(trim(coalesce(p_worker_id,'')),'') is null
        and nullif(trim(coalesce(p_provider_message_id,'')),'') is not null
        and provider_message_id=p_provider_message_id
        and status in ('processing','sent','delivered','suppressed','dead')
      )
    )
  returning status into v_status;
  return v_status;
end;
$$;

create or replace function public.requeue_notification_delivery(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare v_updated integer;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update public.notification_deliveries
  set status='pending',attempt_count=0,requeue_generation=coalesce(requeue_generation,0)+1,
      next_attempt_at=now(),locked_at=null,
      locked_until=null,locked_by=null,last_error=null
  where id=p_delivery_id and status in ('failed','dead');
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;

revoke all on function public.notification_clean_locale(text) from public;
revoke all on function public.notification_safe_data(jsonb) from public;
revoke all on function public.enqueue_customer_notification(text,uuid,text,jsonb,jsonb,uuid,uuid,text,text,jsonb,boolean,text) from public,anon,authenticated;
revoke all on function public.enqueue_admin_notification(text,text,jsonb,jsonb,uuid,uuid,uuid,text,text,jsonb,boolean,text) from public,anon,authenticated;
revoke all on function public.get_my_notifications(integer,timestamptz) from public,anon;
revoke all on function public.get_unread_notification_count() from public,anon;
revoke all on function public.claim_my_email_notifications() from public,anon;
revoke all on function public.mark_notification_read(uuid) from public,anon;
revoke all on function public.mark_all_notifications_read() from public,anon;
revoke all on function public.claim_notification_deliveries(integer,text,text[]) from public,anon,authenticated;
revoke all on function public.complete_notification_delivery(uuid,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.fail_notification_delivery(uuid,text,integer,boolean,text,text) from public,anon,authenticated;
revoke all on function public.requeue_notification_delivery(uuid) from public,anon;

grant execute on function public.enqueue_customer_notification(text,uuid,text,jsonb,jsonb,uuid,uuid,text,text,jsonb,boolean,text) to service_role;
grant execute on function public.enqueue_admin_notification(text,text,jsonb,jsonb,uuid,uuid,uuid,text,text,jsonb,boolean,text) to service_role;
grant execute on function public.get_my_notifications(integer,timestamptz) to authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;
grant execute on function public.claim_my_email_notifications() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.claim_notification_deliveries(integer,text,text[]) to service_role;
grant execute on function public.complete_notification_delivery(uuid,text,text,jsonb,text) to service_role;
grant execute on function public.fail_notification_delivery(uuid,text,integer,boolean,text,text) to service_role;
grant execute on function public.requeue_notification_delivery(uuid) to authenticated;

-- Realtime observes only customer-safe inbox rows; events and delivery jobs stay private.
do $$
begin
  alter publication supabase_realtime add table public.user_notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- The legacy queue sent emails before inserting rows, so historical `pending`
-- records cannot safely be retried. Cancel them during cut-over to prevent duplicates.
do $$
begin
  if to_regclass('public.customer_notification_queue') is not null then
    update public.customer_notification_queue
    set status='cancelled',updated_at=now(),last_error=coalesce(last_error,'Cancelled during Resend notification-center cut-over')
    where status in ('pending','processing','failed');
  end if;
end $$;
