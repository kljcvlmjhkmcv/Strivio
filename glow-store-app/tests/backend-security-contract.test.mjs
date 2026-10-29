import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/202610290001_glow_store_backend.sql', import.meta.url), 'utf8');

test('public visitors can submit an order without selecting their own price', () => {
  assert.match(migration, /create\s+or\s+replace\s+function\s+public\.submit_glow_order/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.submit_glow_order[\s\S]*?to\s+anon/i);
  assert.match(migration, /insert\s+into\s+public\.glow_orders/i);
  assert.match(migration, /price_dzd/i);
});

test('order and admin records have row security and direct public writes are revoked', () => {
  assert.match(migration, /alter\s+table\s+public\.glow_orders\s+enable\s+row\s+level\s+security/i);
  assert.match(migration, /revoke\s+all\s+on\s+public\.glow_admins\s*,\s*public\.glow_store_settings\s*,\s*public\.glow_orders\s*,\s*public\.glow_admin_audit\s+from\s+anon\s*,\s*authenticated/i);
  assert.match(migration, /create\s+policy[\s\S]*?glow_orders[\s\S]*?aal2/i);
});

test('administrative mutations require an authenticated admin at MFA assurance level 2', () => {
  assert.match(migration, /function\s+public\.is_glow_admin/i);
  assert.match(migration, /auth\.jwt\(\)->>?'aal'[\s\S]*?aal2/i);
  assert.match(migration, /create\s+or\s+replace\s+function\s+public\.set_glow_order_status/i);
});

test('order submission validates phone, shade and wilaya commune relationship on the server', () => {
  assert.match(migration, /phone[\s\S]*?regexp/i);
  assert.match(migration, /glow_product_shades/i);
  assert.match(migration, /wilaya_code/i);
  assert.match(migration, /cooldown|interval\s+'1 minute'/i);
});

test('the browser configuration never contains server credentials or an embedded admin account', async () => {
  const client = await readFile(new URL('../src/supabase.js', import.meta.url), 'utf8');
  assert.match(client, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(client, /service_role|secret_key|SUPABASE_DB_PASSWORD|password\s*[:=]/i);
  const auth = await readFile(new URL('../src/admin/AdminApp.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(auth, /signUp\s*\(/);
  assert.match(auth, /signInWithPassword/);
  assert.match(auth, /mfa\.challengeAndVerify/);
});

test('checkout uses the database RPC and delivery/product settings come from Supabase', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /rpc\('submit_glow_order'/);
  assert.match(app, /from\('glow_store_settings'\)/);
  assert.doesNotMatch(app, /order preview only|لا يتم إرسال الطلب أو حفظه حالياً/);
});
