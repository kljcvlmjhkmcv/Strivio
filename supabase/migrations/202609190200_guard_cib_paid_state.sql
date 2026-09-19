-- A CIB order can enter a paid state only after a verified paid attempt exists.
-- This protects against accidental admin status changes and future code regressions.
create or replace function public.guard_cib_paid_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_method = 'cib'
     and (new.status in ('paid','completed') or coalesce(new.payment_completed,false))
     and not exists (
       select 1 from public.payment_attempts pa
       where pa.order_id = new.id
         and pa.status = 'paid'
         and lower(coalesce(pa.provider_payment_status,'')) = 'paid'
         and pa.provider_amount is not null
         and abs(round(pa.provider_amount,2) - round(pa.expected_amount,2)) <= 0.01
     ) then
    raise exception 'CIB payment cannot be marked paid without a verified matching provider payment';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_cib_paid_state_trigger on public.orders;
create trigger guard_cib_paid_state_trigger
before update of status, payment_completed on public.orders
for each row execute function public.guard_cib_paid_state();

revoke all on function public.guard_cib_paid_state() from public, anon, authenticated;
grant execute on function public.guard_cib_paid_state() to service_role;
