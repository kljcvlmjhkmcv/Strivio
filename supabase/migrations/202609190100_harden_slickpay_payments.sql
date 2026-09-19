-- Harden the SlickPay/SATIM payment lifecycle.
-- Provider invoice state is kept separately from the commercial order state.

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'slickpay',
  provider_invoice_id text,
  payment_url text,
  expected_amount numeric(14,2) not null check (expected_amount > 0),
  currency text not null default 'DZD',
  status text not null default 'creating' check (status in (
    'creating','pending','paid','failed','cancelled','expired','superseded','review'
  )),
  provider_payment_status text,
  provider_invoice_status text,
  provider_amount numeric(14,2),
  provider_payload jsonb,
  active boolean not null default true,
  verification_count integer not null default 0,
  last_verified_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_attempts_provider_invoice_unique unique (provider, provider_invoice_id)
);

create unique index if not exists payment_attempts_one_active_per_order
  on public.payment_attempts(order_id) where active;
create index if not exists payment_attempts_order_created_idx
  on public.payment_attempts(order_id, created_at desc);

alter table public.payment_attempts enable row level security;
revoke all on public.payment_attempts from public, anon, authenticated;
grant all on public.payment_attempts to service_role;

create or replace function public.payment_claim_attempt(
  p_order_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('success', false, 'code', 'order_not_found'); end if;
  if v_order.user_id is null or v_order.user_id <> p_user_id then
    return jsonb_build_object('success', false, 'code', 'order_forbidden');
  end if;
  if v_order.payment_method <> 'cib' then
    return jsonb_build_object('success', false, 'code', 'invalid_payment_method');
  end if;
  if v_order.status in ('paid','completed') or coalesce(v_order.payment_completed, false) then
    return jsonb_build_object('success', true, 'already_paid', true, 'order_id', v_order.id);
  end if;
  if v_order.status in ('cancelled','failed','expired') then
    return jsonb_build_object('success', false, 'code', 'terminal_order');
  end if;
  if v_order.total_payable is null or v_order.total_payable <= 0 then
    return jsonb_build_object('success', false, 'code', 'invalid_amount');
  end if;

  select * into v_attempt
  from public.payment_attempts
  where order_id = v_order.id and active
  order by created_at desc limit 1 for update;

  if found then
    return jsonb_build_object(
      'success', true,
      'should_create', false,
      'attempt_id', v_attempt.id,
      'attempt_status', v_attempt.status,
      'payment_id', v_attempt.provider_invoice_id,
      'payment_url', v_attempt.payment_url,
      'expected_amount', v_attempt.expected_amount,
      'order', to_jsonb(v_order)
    );
  end if;

  insert into public.payment_attempts(order_id, expected_amount)
  values (v_order.id, round(v_order.total_payable, 2)) returning * into v_attempt;

  return jsonb_build_object(
    'success', true,
    'should_create', true,
    'attempt_id', v_attempt.id,
    'attempt_status', v_attempt.status,
    'expected_amount', v_attempt.expected_amount,
    'order', to_jsonb(v_order)
  );
end;
$$;

create or replace function public.payment_activate_attempt(
  p_attempt_id uuid,
  p_provider_invoice_id text,
  p_payment_url text,
  p_provider_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.payment_attempts%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if nullif(trim(p_provider_invoice_id), '') is null or nullif(trim(p_payment_url), '') is null then
    raise exception 'provider invoice id and payment URL are required';
  end if;

  update public.payment_attempts
  set provider_invoice_id = p_provider_invoice_id,
      payment_url = p_payment_url,
      provider_payload = coalesce(p_provider_payload, '{}'::jsonb),
      status = 'pending', updated_at = now()
  where id = p_attempt_id and active and status = 'creating'
  returning * into v_attempt;
  if not found then
    select * into v_attempt from public.payment_attempts where id = p_attempt_id;
    if not found then return jsonb_build_object('success', false, 'code', 'attempt_not_found'); end if;
    if v_attempt.provider_invoice_id <> p_provider_invoice_id then
      return jsonb_build_object('success', false, 'code', 'attempt_already_bound');
    end if;
  end if;

  update public.orders
  set payment_id = v_attempt.provider_invoice_id,
      payment_url = v_attempt.payment_url,
      status = case when status in ('paid','completed') then status else 'pending_payment' end,
      invoice_status = 'pending', payment_completed = false,
      last_sync_at = now()::text, updated_at = now()
  where id = v_attempt.order_id;

  return jsonb_build_object('success', true, 'order_id', v_attempt.order_id,
    'payment_id', v_attempt.provider_invoice_id, 'payment_url', v_attempt.payment_url);
end;
$$;

create or replace function public.payment_record_provider_state(
  p_attempt_id uuid,
  p_payment_status text,
  p_invoice_status text,
  p_provider_amount numeric,
  p_payload jsonb,
  p_paid_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_payment_status text := lower(trim(coalesce(p_payment_status, '')));
  v_paid boolean := false;
  v_amount_matches boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  select * into v_attempt from public.payment_attempts where id = p_attempt_id for update;
  if not found then return jsonb_build_object('success', false, 'code', 'attempt_not_found'); end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  if not found then return jsonb_build_object('success', false, 'code', 'order_not_found'); end if;

  v_amount_matches := p_provider_amount is not null
    and abs(round(p_provider_amount, 2) - round(v_attempt.expected_amount, 2)) <= 0.01;
  -- Only SlickPay's explicit payment_status=paid is payment proof.
  v_paid := v_payment_status = 'paid' and v_amount_matches;

  update public.payment_attempts
  set provider_payment_status = nullif(v_payment_status, ''),
      provider_invoice_status = nullif(lower(trim(coalesce(p_invoice_status, ''))), ''),
      provider_amount = p_provider_amount,
      provider_payload = coalesce(p_payload, '{}'::jsonb),
      verification_count = verification_count + 1,
      last_verified_at = now(), updated_at = now(),
      status = case
        when v_paid then 'paid'
        when v_payment_status in ('failed','cancelled','canceled','expired') then
          case when v_payment_status = 'canceled' then 'cancelled' else v_payment_status end
        when v_payment_status = 'paid' and not v_amount_matches then 'review'
        else 'pending'
      end,
      paid_at = case when v_paid then coalesce(p_paid_at, now()) else paid_at end,
      active = case when v_paid or v_payment_status in ('failed','cancelled','canceled','expired') then false else active end
  where id = v_attempt.id;

  if v_paid then
    update public.orders
    set status = case when status = 'completed' then 'completed' else 'paid' end,
        invoice_status = coalesce(nullif(lower(trim(p_invoice_status)), ''), 'paid'),
        invoice_completed = true, payment_completed = true,
        paid_at = coalesce(p_paid_at, now())::text,
        last_sync_at = now()::text, updated_at = now()
    where id = v_order.id;
  elsif v_payment_status in ('failed','cancelled','canceled','expired')
        and v_order.status not in ('paid','completed') then
    update public.orders
    set status = case when v_payment_status = 'canceled' then 'cancelled' else v_payment_status end,
        invoice_status = v_payment_status, payment_completed = false,
        last_sync_at = now()::text, updated_at = now()
    where id = v_order.id;
  else
    update public.orders
    set status = case when status in ('paid','completed') then status else 'pending_payment' end,
        invoice_status = coalesce(nullif(v_payment_status, ''), nullif(lower(trim(p_invoice_status)), ''), 'pending'),
        payment_completed = case when status in ('paid','completed') then payment_completed else false end,
        last_sync_at = now()::text, updated_at = now()
    where id = v_order.id;
  end if;

  return jsonb_build_object(
    'success', true, 'verified_paid', v_paid, 'amount_matches', v_amount_matches,
    'status', case when v_paid then 'paid'
      when v_payment_status in ('failed','cancelled','canceled','expired') then v_payment_status
      when v_payment_status = 'paid' then 'review' else 'pending_payment' end,
    'order_id', v_order.id, 'attempt_id', v_attempt.id
  );
end;
$$;

revoke execute on function public.payment_claim_attempt(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.payment_activate_attempt(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.payment_record_provider_state(uuid, text, text, numeric, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.payment_claim_attempt(uuid, uuid) to service_role;
grant execute on function public.payment_activate_attempt(uuid, text, text, jsonb) to service_role;
grant execute on function public.payment_record_provider_state(uuid, text, text, numeric, jsonb, timestamptz) to service_role;

-- Import existing SlickPay invoice identities without changing their payment state.
insert into public.payment_attempts(
  order_id, provider_invoice_id, payment_url, expected_amount, status,
  provider_payment_status, provider_invoice_status, active, created_at, updated_at
)
select o.id, o.payment_id, o.payment_url, round(o.total_payable,2),
  case when o.status in ('paid','completed') and coalesce(o.payment_completed,false) then 'paid'
       when o.status in ('failed','cancelled','expired') then o.status
       else 'pending' end,
  case when coalesce(o.payment_completed,false) then 'paid' else null end,
  o.invoice_status,
  not (o.status in ('paid','completed','failed','cancelled','expired') and
       (coalesce(o.payment_completed,false) or o.status in ('failed','cancelled','expired'))),
  o.created_at, coalesce(o.updated_at,o.created_at)
from public.orders o
where o.payment_method='cib' and o.payment_id is not null
on conflict (provider, provider_invoice_id) do nothing;
