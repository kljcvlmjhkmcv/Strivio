import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const origins = new Set([
  'https://www.striviodz.store',
  'https://striviodz.store',
  'http://127.0.0.1:8788',
  'http://localhost:8788'
]);
const encoder = new TextEncoder();

function headers(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin'
  };
}

function json(origin: string, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (!origins.has(origin)) return new Response(null, { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
  if (!['GET', 'POST'].includes(request.method)) return json(origin, 405, { message: 'Method not allowed' });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json(origin, 503, { message: 'Store unavailable' });
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (request.method === 'GET') {
    const { data, error } = await db.rpc('trivance_public_config');
    if (error || !data) return json(origin, 503, { message: 'Store unavailable' });
    return json(origin, 200, data);
  }

  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json(origin, 415, { message: 'Invalid request' });
  if (Number(request.headers.get('content-length') || 0) > 4096) return json(origin, 413, { message: 'Invalid request' });
  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json(origin, 413, { message: 'Invalid request' });
    payload = JSON.parse(raw);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('Invalid payload');
  } catch {
    return json(origin, 400, { message: 'Invalid request' });
  }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
  const hmacKey = await crypto.subtle.importKey('raw', encoder.encode(serviceKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(`trivance:${ip}`));
  const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const { data, error } = await db.rpc('trivance_place_order', { p_order: payload, p_fingerprint: fingerprint });
  if (error) return json(origin, 400, { message: 'تعذر إرسال الطلب. راجع البيانات وحاول مجددًا.' });
  if (data?.rate_limited) return json(origin, 429, { message: 'محاولات كثيرة. حاول بعد قليل.' });
  return json(origin, 200, data);
});
