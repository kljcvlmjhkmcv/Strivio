-- Queue one customer notification when a delivered subscription enters its
-- final seven days. A changed/renewed expiry creates a new dedupe key, while a
-- daily scheduler can run safely without sending duplicates.

create or replace function public.notification_parse_timestamp(p_value text)
returns timestamptz
language plpgsql
stable
set search_path=public
as $$
begin
  return nullif(trim(coalesce(p_value,'')),'')::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.queue_expiring_subscription_notifications()
returns integer
language plpgsql
security definer
set search_path=public,cron
as $$
declare
  item record;
  queued_count integer := 0;
  days_remaining integer;
begin
  if coalesce(auth.role(),'')<>'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception 'Server only';
  end if;

  for item in
    with allocation_expiry as (
      select
        f.id as fulfillment_id,
        f.order_id,
        f.service_id,
        min(a.ends_at) as ends_at
      from public.fulfillments f
      join public.orders o on o.id=f.order_id
      join public.fulfillment_allocations a on a.fulfillment_id=f.id
      where lower(coalesce(f.status,'')) in ('delivered','completed')
        and lower(coalesce(o.status,'')) in ('paid','completed')
        and lower(coalesce(a.status,''))='active'
        and a.ends_at>=now()
        and a.ends_at<now()+interval '7 days'
      group by f.id,f.order_id,f.service_id
    ), summary_expiry as (
      select
        f.id as fulfillment_id,
        f.order_id,
        f.service_id,
        public.notification_parse_timestamp(f.delivery_summary->>'ends_at') as ends_at
      from public.fulfillments f
      join public.orders o on o.id=f.order_id
      where lower(coalesce(f.status,'')) in ('delivered','completed')
        and lower(coalesce(o.status,'')) in ('paid','completed')
        and public.notification_parse_timestamp(f.delivery_summary->>'ends_at')>=now()
        and public.notification_parse_timestamp(f.delivery_summary->>'ends_at')<now()+interval '7 days'
        and not exists (
          select 1 from public.fulfillment_allocations a
          where a.fulfillment_id=f.id
            and lower(coalesce(a.status,''))='active'
            and a.ends_at is not null
        )
    )
    select * from allocation_expiry
    union all
    select * from summary_expiry
  loop
    days_remaining := greatest(
      0,
      ceil(extract(epoch from (item.ends_at-now()))/86400.0)::integer
    );

    perform public.enqueue_customer_notification(
      'subscription.expiring',
      item.order_id,
      'subscription_expiring',
      jsonb_build_object(
        'ar','اشتراكك يقترب من الانتهاء',
        'fr','Votre abonnement expire bientôt',
        'en','Your subscription expires soon'
      ),
      jsonb_build_object(
        'ar','بقي '||days_remaining::text||' يوم على انتهاء اشتراكك. يمكنك تجديده الآن للمحافظة على نفس الخدمة.',
        'fr','Il reste '||days_remaining::text||' jour(s) avant l’expiration. Vous pouvez prolonger maintenant pour conserver le même service.',
        'en',days_remaining::text||' day(s) remain before expiry. You can extend now to keep the same service.'
      ),
      item.fulfillment_id,
      null,
      item.service_id,
      '/my-account?order='||item.order_id::text,
      jsonb_build_object(
        'ends_at',item.ends_at,
        'days_remaining',days_remaining
      ),
      true,
      'subscription.expiring:'||item.fulfillment_id::text||':'||to_char(item.ends_at at time zone 'Africa/Algiers','YYYY-MM-DD')
    );
    queued_count := queued_count + 1;
  end loop;

  return queued_count;
end;
$$;

revoke all on function public.queue_expiring_subscription_notifications() from public,anon,authenticated;
grant execute on function public.queue_expiring_subscription_notifications() to service_role;
revoke all on function public.notification_parse_timestamp(text) from public,anon,authenticated;

do $scheduler$
declare existing_job bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    for existing_job in
      select jobid from cron.job where jobname='strivio-subscription-reminders'
    loop
      perform cron.unschedule(existing_job);
    end loop;
    perform cron.schedule(
      'strivio-subscription-reminders',
      '15 8 * * *',
      'select public.queue_expiring_subscription_notifications();'
    );
  end if;
end;
$scheduler$;
