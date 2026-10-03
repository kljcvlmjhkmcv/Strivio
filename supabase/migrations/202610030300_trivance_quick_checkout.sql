-- Keep the legacy columns for existing orders; new requests collect location and phone only.
create or replace function public.trivance_place_order(p_order jsonb, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_settings trivance_private.settings%rowtype;
  v_id uuid;
  v_request_id uuid;
  v_name text := btrim(coalesce(p_order->>'name', ''));
  v_phone text := regexp_replace(coalesce(p_order->>'phone', ''), '[ .()\-]', '', 'g');
  v_delivery text := coalesce(p_order->>'delivery_method', '');
  v_wilaya integer;
  v_commune integer;
  v_quantity integer;
  v_fee integer;
begin
  if p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request'; end if;

  insert into trivance_private.rate_limits (fingerprint, window_started_at, attempt_count)
  values (p_fingerprint, now(), 1)
  on conflict (fingerprint) do update set
    window_started_at = case when trivance_private.rate_limits.window_started_at < now() - interval '10 minutes' then now() else trivance_private.rate_limits.window_started_at end,
    attempt_count = case when trivance_private.rate_limits.window_started_at < now() - interval '10 minutes' then 1 else trivance_private.rate_limits.attempt_count + 1 end
  returning attempt_count into v_count;
  if v_count > 5 then return jsonb_build_object('ok', false, 'rate_limited', true); end if;

  if coalesce(p_order->>'website', '') <> '' then raise exception 'Invalid request'; end if;
  if length(v_name) < 2 or length(v_name) > 80 or v_name ~ '[[:cntrl:]]' then raise exception 'Invalid name'; end if;
  if v_phone ~ '^\+213[567][0-9]{8}$' then v_phone := '0' || substring(v_phone from 5); end if;
  if v_phone !~ '^0[567][0-9]{8}$' then raise exception 'Invalid phone'; end if;
  if v_delivery not in ('home', 'office') then raise exception 'Invalid delivery'; end if;

  begin
    v_request_id := (p_order->>'request_id')::uuid;
    v_wilaya := (p_order->>'wilaya_code')::integer;
    v_commune := (p_order->>'commune_id')::integer;
    v_quantity := (p_order->>'quantity')::integer;
  exception when others then raise exception 'Invalid selection';
  end;
  if v_quantity not between 1 and 3 then raise exception 'Invalid quantity'; end if;
  if not exists (select 1 from trivance_private.communes where id = v_commune and wilaya_code = v_wilaya) then raise exception 'Invalid location'; end if;

  select * into v_settings from trivance_private.settings where id = true;
  if not found or not v_settings.accepting_orders then raise exception 'Orders unavailable'; end if;
  v_fee := case when v_delivery = 'home' then v_settings.home_fee_dzd else v_settings.office_fee_dzd end;

  insert into trivance_private.orders (
    request_id, customer_name, phone, wilaya_code, commune_id, delivery_method,
    address, note, quantity, unit_price_dzd, delivery_fee_dzd, total_dzd, attribution
  ) values (
    v_request_id, v_name, v_phone, v_wilaya, v_commune, v_delivery,
    '', '', v_quantity, v_settings.price_dzd, v_fee,
    v_settings.price_dzd * v_quantity + v_fee,
    jsonb_build_object(
      'utm_source', left(coalesce(p_order->'attribution'->>'utm_source', ''), 100),
      'utm_medium', left(coalesce(p_order->'attribution'->>'utm_medium', ''), 100),
      'utm_campaign', left(coalesce(p_order->'attribution'->>'utm_campaign', ''), 100),
      'utm_content', left(coalesce(p_order->'attribution'->>'utm_content', ''), 100),
      'utm_term', left(coalesce(p_order->'attribution'->>'utm_term', ''), 100)
    )
  ) on conflict (request_id) do nothing returning id into v_id;
  if v_id is null then select id into v_id from trivance_private.orders where request_id = v_request_id; end if;
  return jsonb_build_object('ok', true, 'reference', upper(left(replace(v_id::text, '-', ''), 8)));
end;
$$;
revoke all on function public.trivance_place_order(jsonb, text) from public, anon, authenticated;
grant execute on function public.trivance_place_order(jsonb, text) to service_role;
