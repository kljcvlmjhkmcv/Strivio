import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const allowedOrigins = new Set([
  'https://seventytworealestate.com',
  'https://www.seventytworealestate.com',
  'https://striviodz.store',
  'https://www.striviodz.store'
]);
const pixxiEndpoint = 'https://dataapi.pixxicrm.ae/pixxiapi/webhook/v1/form';

function response(origin: string, status: number, body?: Record<string, unknown>) {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin'
    }
  });
}

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

serve(async request => {
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigins.has(origin)) return new Response(null, { status: 403 });
  if (request.method === 'OPTIONS') return response(origin, 204);
  if (request.method !== 'POST') return response(origin, 405, { message: 'Method not allowed' });
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return response(origin, 415, { message: 'Invalid request' });
  }

  let raw = '';
  try {
    raw = await request.text();
    if (raw.length > 4096) throw new Error('Payload too large');
    const body = JSON.parse(raw) as Record<string, unknown>;
    const first = text(body.first, 80);
    const last = text(body.last, 80);
    const phone = text(body.phone, 32);
    const note = text(body.note, 1000);
    const phoneDigits = phone.replace(/\D/g, '');
    if (!first || !last || phoneDigits.length < 7) {
      return response(origin, 400, { message: 'Please enter your name and a valid phone number.' });
    }

    const token = Deno.env.get('PIXXI_PLAZA_API_TOKEN');
    const formId = Deno.env.get('PIXXI_PLAZA_FORM_ID');
    if (!token || !formId) return response(origin, 503, { message: 'Enquiry service is unavailable.' });

    const upstream = await fetch(pixxiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PIXXI-TOKEN': token },
      body: JSON.stringify({
        formId,
        formName: 'The Plaza at The Yards | Website',
        name: `${first} ${last}`,
        // Pixxi requires an email field. This non-deliverable value records that the visitor chose phone contact.
        email: `phone-${phoneDigits}@not-provided.invalid`,
        phone,
        extraData: {
          Project: 'The Plaza at The Yards',
          Source: 'Website landing page',
          'First name': first,
          'Last name': last,
          Note: note || 'No additional note provided',
          'Preferred contact': 'Phone'
        }
      })
    });
    const upstreamBody = await upstream.json().catch(() => null) as Record<string, unknown> | null;
    if (!upstream.ok || upstreamBody?.success === false || upstreamBody?.status === false) {
      return response(origin, 502, { message: 'Unable to send your enquiry. Please try again.' });
    }
    return response(origin, 200, { ok: true });
  } catch {
    return response(origin, 400, { message: 'Invalid request' });
  }
});
