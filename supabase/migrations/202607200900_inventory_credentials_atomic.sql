-- Atomically rotate an inventory account's encrypted credentials and every
-- still-active customer's encrypted delivery snapshot. The Edge function does
-- the encryption first; this RPC only commits a fully validated change-set.

alter table public.inventory_accounts
  add column if not exists credentials_version integer not null default 0,
  add column if not exists credentials_updated_at timestamptz;

alter table public.fulfillments
  add column if not exists sheet_version integer not null default 0;

create or replace function public.ops_update_inventory_account_credentials_atomic(
  p_account_id uuid,
  p_expected_credentials text,
  p_expected_credentials_version integer,
  p_new_credentials text,
  p_expected_allocations jsonb,
  p_fulfillment_updates jsonb,
  p_actor_id uuid,
  p_before_data jsonb,
  p_after_data jsonb,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.inventory_accounts%rowtype;
  v_actual_allocation_count integer := 0;
  v_expected_allocation_count integer := 0;
  v_distinct_expected_allocation_count integer := 0;
  v_current_fulfillment_count integer := 0;
  v_update_count integer := 0;
  v_distinct_update_count integer := 0;
  v_rows integer := 0;
  v_update jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_actor_id is null or not exists (
    select 1 from public.admin_users where user_id = p_actor_id
  ) then
    raise exception 'Admin only' using errcode = '42501';
  end if;

  if coalesce(p_new_credentials, '') = '' then
    raise exception 'Encrypted credentials are required';
  end if;
  if jsonb_typeof(coalesce(p_expected_allocations, 'null'::jsonb)) <> 'array' then
    raise exception 'Expected allocations must be a JSON array';
  end if;
  if jsonb_typeof(coalesce(p_fulfillment_updates, 'null'::jsonb)) <> 'array' then
    raise exception 'Fulfillment updates must be a JSON array';
  end if;

  select *
    into v_account
    from public.inventory_accounts
   where id = p_account_id
   for update;
  if not found then
    raise exception 'Account not found';
  end if;
  if v_account.encrypted_credentials is distinct from p_expected_credentials
     or coalesce(v_account.credentials_version, 0) <> coalesce(p_expected_credentials_version, 0) then
    raise exception 'Account credentials changed while this update was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  -- Serialize against moves, renewals and releases, then compare the complete
  -- active allocation set to the snapshot read by the Edge function.
  perform a.id
    from public.fulfillment_allocations a
   where a.account_id = p_account_id
     and a.status = 'active'
   order by a.id
   for update;

  select count(*)
    into v_actual_allocation_count
    from public.fulfillment_allocations a
   where a.account_id = p_account_id
     and a.status = 'active';
  select count(*), count(distinct item->>'id')
    into v_expected_allocation_count, v_distinct_expected_allocation_count
    from jsonb_array_elements(p_expected_allocations) item;

  if v_expected_allocation_count <> v_distinct_expected_allocation_count
     or v_expected_allocation_count <> v_actual_allocation_count
     or exists (
       select 1
         from public.fulfillment_allocations a
        where a.account_id = p_account_id
          and a.status = 'active'
          and not exists (
            select 1
              from jsonb_array_elements(p_expected_allocations) expected
             where expected->>'id' = a.id::text
               and expected->>'fulfillment_id' = a.fulfillment_id::text
               and coalesce(expected->>'slot_id', '') = coalesce(a.slot_id::text, '')
               and coalesce((expected->>'sheet_version')::integer, 0) = coalesce(a.sheet_version, 0)
               and (
                 (nullif(expected->>'ends_at', '') is null and a.ends_at is null)
                 or a.ends_at = (expected->>'ends_at')::timestamptz
               )
          )
     ) then
    raise exception 'Active subscriptions changed while this update was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  -- Only non-expired active allocations receive new customer credentials.
  select count(distinct a.fulfillment_id)
    into v_current_fulfillment_count
    from public.fulfillment_allocations a
   where a.account_id = p_account_id
     and a.status = 'active'
     and (a.ends_at is null or a.ends_at > transaction_timestamp());
  select count(*), count(distinct item->>'id')
    into v_update_count, v_distinct_update_count
    from jsonb_array_elements(p_fulfillment_updates) item;

  if v_update_count <> v_distinct_update_count
     or v_update_count <> v_current_fulfillment_count
     or exists (
       select 1
         from public.fulfillment_allocations a
        where a.account_id = p_account_id
          and a.status = 'active'
          and (a.ends_at is null or a.ends_at > transaction_timestamp())
          and not exists (
            select 1
              from jsonb_array_elements(p_fulfillment_updates) change_set
             where change_set->>'id' = a.fulfillment_id::text
          )
     )
     or exists (
       select 1
         from jsonb_array_elements(p_fulfillment_updates) change_set
        where coalesce(change_set->>'id', '') = ''
           or coalesce(change_set->>'encrypted_delivery', '') = ''
           or not exists (
             select 1
               from public.fulfillment_allocations a
              where a.account_id = p_account_id
                and a.status = 'active'
                and (a.ends_at is null or a.ends_at > transaction_timestamp())
                and a.fulfillment_id::text = change_set->>'id'
           )
     ) then
    raise exception 'Customer deliveries changed while this update was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  perform f.id
    from public.fulfillments f
   where exists (
     select 1
       from jsonb_array_elements(p_fulfillment_updates) change_set
      where change_set->>'id' = f.id::text
   )
   order by f.id
   for update;

  if exists (
    select 1
      from public.fulfillments f
      join lateral jsonb_array_elements(p_fulfillment_updates) change_set
        on change_set->>'id' = f.id::text
     where coalesce(f.encrypted_delivery, '') is distinct from
           coalesce(change_set->>'expected_encrypted_delivery', '')
  ) then
    raise exception 'A customer delivery changed while this update was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  update public.inventory_accounts
     set encrypted_credentials = p_new_credentials,
         credentials_version = coalesce(credentials_version, 0) + 1,
         credentials_updated_at = v_now,
         updated_at = v_now
   where id = p_account_id
     and encrypted_credentials is not distinct from p_expected_credentials
     and coalesce(credentials_version, 0) = coalesce(p_expected_credentials_version, 0);
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Account changed concurrently; refresh and try again'
      using errcode = '40001';
  end if;

  for v_update in
    select item from jsonb_array_elements(p_fulfillment_updates) item
  loop
    update public.fulfillments
       set encrypted_delivery = v_update->>'encrypted_delivery',
           sheet_version = coalesce(sheet_version, 0) + 1,
           updated_at = v_now
     where id::text = v_update->>'id'
       and coalesce(encrypted_delivery, '') is not distinct from
           coalesce(v_update->>'expected_encrypted_delivery', '');
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'A customer delivery changed concurrently; no credentials were updated'
        using errcode = '40001';
    end if;
  end loop;

  insert into public.operations_audit_log(
    actor_id,
    action,
    entity_type,
    entity_id,
    service_id,
    before_data,
    after_data,
    metadata
  ) values (
    p_actor_id,
    'update_account_credentials',
    'inventory_account',
    p_account_id::text,
    v_account.service_id,
    coalesce(p_before_data, '{}'::jsonb),
    coalesce(p_after_data, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'credentials_version', coalesce(v_account.credentials_version, 0) + 1,
      'atomic_commit', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'account_id', p_account_id,
    'credentials_version', coalesce(v_account.credentials_version, 0) + 1,
    'active_allocations', v_actual_allocation_count,
    'updated_fulfillments', v_update_count
  );
end;
$$;

revoke all on function public.ops_update_inventory_account_credentials_atomic(
  uuid, text, integer, text, jsonb, jsonb, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.ops_update_inventory_account_credentials_atomic(
  uuid, text, integer, text, jsonb, jsonb, uuid, jsonb, jsonb, jsonb
) to service_role;
