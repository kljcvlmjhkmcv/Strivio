-- Optional one-time scheduler configuration. The worker secret is supplied at
-- runtime and stored only in Supabase Vault, never in source control.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.configure_notification_dispatch(
  p_worker_secret text,
  p_schedule text default '* * * * *'
) returns bigint
language plpgsql
security definer
set search_path=public,extensions,vault,cron,net
as $$
declare
  v_secret_id uuid;
  v_job_id bigint;
  v_existing bigint;
  v_command text;
begin
  if auth.role()<>'service_role' and current_user not in ('postgres','supabase_admin') then
    raise exception 'Server only';
  end if;
  if char_length(coalesce(p_worker_secret,''))<32 then
    raise exception 'Worker secret must contain at least 32 characters';
  end if;
  if coalesce(p_schedule,'')='' then raise exception 'Schedule is required'; end if;

  select vault.create_secret(
    p_worker_secret,
    'strivio_notification_worker_'||replace(gen_random_uuid()::text,'-',''),
    'Strivio notification dispatcher secret'
  ) into v_secret_id;

  for v_existing in
    select jobid from cron.job where jobname='strivio-notification-dispatch'
  loop
    perform cron.unschedule(v_existing);
  end loop;

  v_command=format($command$
    select net.http_post(
      url := 'https://rrfguexpsfizyijekkmi.supabase.co/functions/v1/dispatch-notifications',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-notification-secret',(
          select decrypted_secret from vault.decrypted_secrets where id=%L::uuid
        )
      ),
      body := '{"limit":25,"channels":["email","telegram"]}'::jsonb
    );
  $command$,v_secret_id::text);

  select cron.schedule(
    'strivio-notification-dispatch',
    p_schedule,
    v_command
  ) into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.configure_notification_dispatch(text,text) from public,anon,authenticated;
grant execute on function public.configure_notification_dispatch(text,text) to service_role;
