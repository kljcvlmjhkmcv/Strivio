-- Structured Meta sales flow, safe short-term conversation memory, follow-up
-- scheduling and configurable abuse/cost limits.

alter table public.chatbot_settings
  add column if not exists structured_messages_enabled boolean not null default true,
  add column if not exists website_buttons_enabled boolean not null default true,
  add column if not exists manual_checkout_enabled boolean not null default true,
  add column if not exists follow_up_enabled boolean not null default true,
  add column if not exists follow_up_delay_minutes integer not null default 120,
  add column if not exists max_followups_per_conversation integer not null default 1,
  add column if not exists burst_limit_per_minute integer not null default 6,
  add column if not exists max_ai_replies_per_hour integer not null default 16,
  add column if not exists daily_ai_limit integer not null default 300,
  add column if not exists website_url text not null default 'https://www.striviodz.store';

alter table public.chatbot_settings
  drop constraint if exists chatbot_settings_follow_up_delay_check,
  add constraint chatbot_settings_follow_up_delay_check
    check (follow_up_delay_minutes between 30 and 1200),
  drop constraint if exists chatbot_settings_max_followups_check,
  add constraint chatbot_settings_max_followups_check
    check (max_followups_per_conversation between 0 and 2),
  drop constraint if exists chatbot_settings_burst_limit_check,
  add constraint chatbot_settings_burst_limit_check
    check (burst_limit_per_minute between 3 and 20),
  drop constraint if exists chatbot_settings_ai_hour_check,
  add constraint chatbot_settings_ai_hour_check
    check (max_ai_replies_per_hour between 4 and 60),
  drop constraint if exists chatbot_settings_ai_daily_check,
  add constraint chatbot_settings_ai_daily_check
    check (daily_ai_limit between 20 and 3000),
  drop constraint if exists chatbot_settings_website_url_check,
  add constraint chatbot_settings_website_url_check
    check (website_url ~ '^https://[A-Za-z0-9.-]+(?:/.*)?$');

alter table public.chatbot_conversations
  add column if not exists memory jsonb not null default '{}'::jsonb,
  add column if not exists follow_up_due_at timestamptz,
  add column if not exists follow_up_sent_at timestamptz,
  add column if not exists follow_up_count integer not null default 0;

alter table public.chatbot_conversations
  drop constraint if exists chatbot_conversations_follow_up_count_check,
  add constraint chatbot_conversations_follow_up_count_check
    check (follow_up_count between 0 and 10);

create index if not exists chatbot_conversations_follow_up_due_idx
  on public.chatbot_conversations(follow_up_due_at)
  where follow_up_due_at is not null and mode = 'bot';

create index if not exists chatbot_messages_gemini_usage_idx
  on public.chatbot_messages(created_at, conversation_id)
  where reply_source = 'gemini';

alter table public.chatbot_messages
  drop constraint if exists chatbot_messages_reply_source_check;
alter table public.chatbot_messages
  add constraint chatbot_messages_reply_source_check
    check (reply_source is null or reply_source in ('rules', 'gemini', 'admin', 'system', 'scheduler'));

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.configure_chatbot_followups(
  p_worker_secret text,
  p_schedule text default '*/5 * * * *'
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
    'strivio_meta_chatbot_worker_'||replace(gen_random_uuid()::text,'-',''),
    'Strivio Meta chatbot follow-up worker secret'
  ) into v_secret_id;

  for v_existing in
    select jobid from cron.job where jobname='strivio-meta-chatbot-followups'
  loop
    perform cron.unschedule(v_existing);
  end loop;

  v_command=format($command$
    select net.http_post(
      url := 'https://rrfguexpsfizyijekkmi.supabase.co/functions/v1/meta-chatbot',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-chatbot-worker-secret',(
          select decrypted_secret from vault.decrypted_secrets where id=%L::uuid
        )
      ),
      body := '{"mode":"process_followups","limit":20}'::jsonb
    );
  $command$,v_secret_id::text);

  select cron.schedule(
    'strivio-meta-chatbot-followups',
    p_schedule,
    v_command
  ) into v_job_id;
  return v_job_id;
end;
$$;

revoke all on function public.configure_chatbot_followups(text,text) from public,anon,authenticated;
grant execute on function public.configure_chatbot_followups(text,text) to service_role;
