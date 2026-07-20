-- Move an active subscription between inventory profiles as one transaction.
-- Every mutable snapshot used to build the replacement encrypted delivery is
-- validated again after deterministic row locking.

create or replace function public.ops_move_inventory_allocation_atomic(
  p_allocation_id uuid,
  p_target_slot_id uuid,
  p_expected_source_account_id uuid,
  p_expected_source_slot_id uuid,
  p_expected_fulfillment_id uuid,
  p_expected_allocation_sheet_version integer,
  p_expected_allocation_admin_notes text,
  p_expected_source_slot_label text,
  p_expected_target_account_id uuid,
  p_expected_target_account_credentials text,
  p_expected_target_credentials_version integer,
  p_expected_target_slot_label text,
  p_expected_target_slot_secret text,
  p_expected_fulfillment_delivery text,
  p_new_fulfillment_delivery text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation public.fulfillment_allocations%rowtype;
  v_source_account public.inventory_accounts%rowtype;
  v_target_account public.inventory_accounts%rowtype;
  v_source_slot public.inventory_slots%rowtype;
  v_target_slot public.inventory_slots%rowtype;
  v_fulfillment public.fulfillments%rowtype;
  v_note text;
  v_now timestamptz := clock_timestamp();
  v_rows integer := 0;
begin
  if p_actor_id is null or not exists (
    select 1 from public.admin_users where user_id = p_actor_id
  ) then
    raise exception 'Admin only' using errcode = '42501';
  end if;
  if p_allocation_id is null
     or p_target_slot_id is null
     or p_expected_source_account_id is null
     or p_expected_source_slot_id is null
     or p_expected_fulfillment_id is null
     or p_expected_target_account_id is null then
    raise exception 'Move snapshot is incomplete';
  end if;
  if p_expected_source_slot_id = p_target_slot_id then
    raise exception 'Choose a different destination profile';
  end if;
  if coalesce(p_new_fulfillment_delivery, '') = '' then
    raise exception 'Encrypted delivery is required';
  end if;

  -- Fixed global lock order prevents two opposite moves from deadlocking:
  -- accounts -> slots -> allocation -> fulfillment, IDs sorted per group.
  perform account.id
    from public.inventory_accounts account
   where account.id = any(array[
     p_expected_source_account_id,
     p_expected_target_account_id
   ]::uuid[])
   order by account.id
   for update;

  select * into v_source_account
    from public.inventory_accounts
   where id = p_expected_source_account_id;
  select * into v_target_account
    from public.inventory_accounts
   where id = p_expected_target_account_id;
  if v_source_account.id is null or v_target_account.id is null then
    raise exception 'Source or destination account no longer exists';
  end if;

  perform slot.id
    from public.inventory_slots slot
   where slot.id = any(array[
     p_expected_source_slot_id,
     p_target_slot_id
   ]::uuid[])
   order by slot.id
   for update;

  select * into v_source_slot
    from public.inventory_slots
   where id = p_expected_source_slot_id;
  select * into v_target_slot
    from public.inventory_slots
   where id = p_target_slot_id;
  if v_source_slot.id is null or v_target_slot.id is null then
    raise exception 'Source or destination profile no longer exists';
  end if;

  select * into v_allocation
    from public.fulfillment_allocations
   where id = p_allocation_id
   for update;
  if not found then
    raise exception 'Subscription allocation not found';
  end if;

  select * into v_fulfillment
    from public.fulfillments
   where id = p_expected_fulfillment_id
   for update;
  if not found then
    raise exception 'Delivery record not found';
  end if;

  if v_allocation.status <> 'active'
     or v_allocation.account_id is distinct from p_expected_source_account_id
     or v_allocation.slot_id is distinct from p_expected_source_slot_id
     or v_allocation.fulfillment_id is distinct from p_expected_fulfillment_id
     or coalesce(v_allocation.sheet_version, 0) <>
        coalesce(p_expected_allocation_sheet_version, 0)
     or v_allocation.admin_notes is distinct from p_expected_allocation_admin_notes then
    raise exception 'Subscription changed while the move was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  if v_source_slot.account_id is distinct from p_expected_source_account_id
     or v_source_slot.label is distinct from p_expected_source_slot_label
     or v_source_slot.status <> 'assigned' then
    raise exception 'Source profile changed while the move was being prepared; refresh and try again'
      using errcode = '40001';
  end if;

  if v_target_account.status <> 'active' then
    raise exception 'Destination account is not active';
  end if;
  if v_target_account.encrypted_credentials is distinct from
       p_expected_target_account_credentials
     or coalesce(v_target_account.credentials_version, 0) <>
        coalesce(p_expected_target_credentials_version, 0) then
    raise exception 'Destination credentials changed while the move was being prepared; refresh and try again'
      using errcode = '40001';
  end if;
  if v_target_slot.account_id is distinct from p_expected_target_account_id
     or v_target_slot.label is distinct from p_expected_target_slot_label
     or v_target_slot.encrypted_secret is distinct from p_expected_target_slot_secret
     or v_target_slot.status <> 'available' then
    raise exception 'Destination profile changed while the move was being prepared; refresh and try again'
      using errcode = '40001';
  end if;
  if v_source_account.service_id is distinct from v_fulfillment.service_id
     or v_target_account.service_id is distinct from v_fulfillment.service_id then
    raise exception 'Destination profile must belong to the same service';
  end if;
  if v_fulfillment.id is distinct from v_allocation.fulfillment_id
     or v_fulfillment.encrypted_delivery is distinct from
        p_expected_fulfillment_delivery then
    raise exception 'Customer delivery changed while the move was being prepared; refresh and try again'
      using errcode = '40001';
  end if;
  if exists (
    select 1
      from public.fulfillment_allocations active_target
     where active_target.slot_id = p_target_slot_id
       and active_target.status = 'active'
       and active_target.id <> p_allocation_id
  ) then
    raise exception 'Destination profile is already assigned';
  end if;

  update public.inventory_slots
     set status = 'assigned', updated_at = v_now
   where id = p_target_slot_id
     and status = 'available'
     and account_id = p_expected_target_account_id
     and label is not distinct from p_expected_target_slot_label
     and encrypted_secret is not distinct from p_expected_target_slot_secret;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Destination profile changed concurrently; no move was made'
      using errcode = '40001';
  end if;

  v_note := format(
    'Moved from %s to %s by admin',
    coalesce(v_source_slot.label, 'profile'),
    coalesce(v_target_slot.label, 'profile')
  );
  update public.fulfillment_allocations
     set account_id = p_expected_target_account_id,
         slot_id = p_target_slot_id,
         sheet_version = coalesce(sheet_version, 0) + 1,
         admin_notes = concat_ws(
           E'\n',
           nullif(trim(coalesce(admin_notes, '')), ''),
           v_note
         )
   where id = p_allocation_id
     and status = 'active'
     and account_id = p_expected_source_account_id
     and slot_id = p_expected_source_slot_id
     and fulfillment_id = p_expected_fulfillment_id
     and coalesce(sheet_version, 0) =
         coalesce(p_expected_allocation_sheet_version, 0)
     and admin_notes is not distinct from p_expected_allocation_admin_notes;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Subscription changed concurrently; no move was made'
      using errcode = '40001';
  end if;

  -- Release only after the allocation points at the destination. The existing
  -- availability trigger expires allocations still attached to a released slot.
  update public.inventory_slots
     set status = 'available', updated_at = v_now
   where id = p_expected_source_slot_id
     and status = 'assigned'
     and account_id = p_expected_source_account_id
     and label is not distinct from p_expected_source_slot_label;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Source profile changed concurrently; no move was made'
      using errcode = '40001';
  end if;

  update public.fulfillments
     set encrypted_delivery = p_new_fulfillment_delivery,
         sheet_version = coalesce(sheet_version, 0) + 1,
         updated_at = v_now
   where id = p_expected_fulfillment_id
     and encrypted_delivery is not distinct from p_expected_fulfillment_delivery;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Customer delivery changed concurrently; no move was made'
      using errcode = '40001';
  end if;

  insert into public.subscription_events(
    allocation_id,
    event_type,
    source,
    details
  ) values (
    p_allocation_id,
    'profile_moved',
    'operations_center',
    jsonb_build_object(
      'actor_id', p_actor_id,
      'order_id', v_fulfillment.order_id,
      'service_id', v_fulfillment.service_id,
      'source_account_id', p_expected_source_account_id,
      'source_slot_id', p_expected_source_slot_id,
      'source_profile', v_source_slot.label,
      'target_account_id', p_expected_target_account_id,
      'target_slot_id', p_target_slot_id,
      'target_profile', v_target_slot.label
    )
  );

  insert into public.operations_audit_log(
    actor_id,
    action,
    entity_type,
    entity_id,
    order_id,
    service_id,
    before_data,
    after_data,
    metadata
  ) values (
    p_actor_id,
    'move_profile',
    'fulfillment_allocation',
    p_allocation_id::text,
    v_fulfillment.order_id,
    v_fulfillment.service_id,
    jsonb_build_object(
      'slot_id', p_expected_source_slot_id,
      'profile', v_source_slot.label,
      'account_id', p_expected_source_account_id
    ),
    jsonb_build_object(
      'slot_id', p_target_slot_id,
      'profile', v_target_slot.label,
      'account_id', p_expected_target_account_id
    ),
    jsonb_build_object(
      'delivery_updated', true,
      'target_credentials_version',
        coalesce(v_target_account.credentials_version, 0),
      'atomic_commit', true
    )
  );

  insert into public.integration_outbox(
    event_type,
    aggregate_id,
    payload
  ) values (
    'subscription_updated',
    p_allocation_id::text,
    jsonb_build_object(
      'order_id', v_fulfillment.order_id,
      'allocation_id', p_allocation_id,
      'source_profile', v_source_slot.label,
      'target_profile', v_target_slot.label,
      'inventory', true,
      'source', 'operations_center'
    )
  );

  return jsonb_build_object(
    'success', true,
    'allocation_id', p_allocation_id,
    'order_id', v_fulfillment.order_id,
    'source_profile', v_source_slot.label,
    'target_profile', v_target_slot.label,
    'sheet_version', coalesce(v_allocation.sheet_version, 0) + 1
  );
end;
$$;

revoke all on function public.ops_move_inventory_allocation_atomic(
  uuid, uuid, uuid, uuid, uuid, integer, text, text,
  uuid, text, integer, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.ops_move_inventory_allocation_atomic(
  uuid, uuid, uuid, uuid, uuid, integer, text, text,
  uuid, text, integer, text, text, text, text, uuid
) to service_role;
