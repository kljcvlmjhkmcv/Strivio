-- Manual-delivery instructions can contain recovery keys, 2FA secrets, or URLs.
-- Keep them only inside encrypted_delivery and remove the historical plaintext
-- copy from delivery_summary.
update public.fulfillments
set delivery_summary = delivery_summary - 'admin_note'
where delivery_summary ? 'admin_note';
