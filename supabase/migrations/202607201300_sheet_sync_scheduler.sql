-- Keep the presentation-only Google Sheet projection moving even when a
-- request-scoped background invocation reaches its execution limit.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.configure_sheet_sync(
  p_sync_secret text,
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
  if char_length(coalesce(p_sync_secret,''))<32 then
    raise exception 'Sync secret must contain at least 32 characters';
  end if;
  if coalesce(p_schedule,'')='' then raise exception 'Schedule is required'; end if;

  select vault.create_secret(
    p_sync_secret,
    'strivio_sheet_sync_'||replace(gen_random_uuid()::text,'-',''),
    'Strivio Google Sheet projection worker secret'
  ) into v_secret_id;

  for v_existing in
    select jobid from cron.job where jobname='strivio-sheet-sync'
  loop
    perform cron.unschedule(v_existing);
  end loop;

  v_command=format($command$
    select net.http_post(
      url := 'https://rrfguexpsfizyijekkmi.supabase.co/functions/v1/sync-google-sheet',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-sync-secret',(
          select decrypted_secret from vault.decrypted_secrets where id=%L::uuid
        )
      ),
      body := '{"limit":8,"source":"scheduled_drain"}'::jsonb,
      timeout_milliseconds := 120000
    );
  $command$,v_secret_id::text);

  select cron.schedule(
    'strivio-sheet-sync',
    p_schedule,
    v_command
  ) into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.configure_sheet_sync(text,text) from public,anon,authenticated;
grant execute on function public.configure_sheet_sync(text,text) to service_role;
