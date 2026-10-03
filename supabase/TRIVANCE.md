# Trivance order operations

The Trivance landing page is isolated under `/trivance/`. Orders are stored in the
`trivance_private` schema. Only the `trivance-order` Edge Function can invoke the
public RPCs with the server-side service role. Do not add a service role key to
the landing page or expose this schema through the Data API.

The SQL Editor can show orders awaiting phone confirmation:

```sql
select o.created_at, o.id, o.customer_name, o.phone, w.name_ar as wilaya,
       c.name_ar as commune, o.delivery_method, o.address, o.quantity,
       o.total_dzd, o.status, o.note
from trivance_private.orders o
join trivance_private.wilayas w on w.code = o.wilaya_code
join trivance_private.communes c on c.id = o.commune_id
where o.status = 'pending_phone_confirmation'
order by o.created_at desc;
```

After confirming a customer by phone, change that order's status to `confirmed`.
The payment method is cash on delivery. The single internal test order is marked
`cancelled` and has `utm_source = internal_test`.

Edit prices without changing frontend code. All amounts are in Algerian dinars:

```sql
update trivance_private.settings
set price_dzd = 2900, home_fee_dzd = 600, office_fee_dzd = 400,
    updated_at = now()
where id = true;
```

To temporarily stop new orders, set `accepting_orders = false` in the same row.
The frontend reads these values from the Edge Function; the database recalculates
every total when an order is submitted.
