import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const ALLOWED_ORIGINS = new Set([
  "https://striviodz.store",
  "https://www.striviodz.store",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const SLICK_BASE = "https://prodapi.slick-pay.com/api/v2";

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://www.striviodz.store",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), ...JSON_HEADERS } });
}

function first(...values: unknown[]) {
  return values.find((v) => v !== undefined && v !== null && String(v).trim() !== "") ?? null;
}

function invoiceEnvelope(raw: any) {
  let data = raw?.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  const invoice = data?.invoice || data || raw?.invoice || raw || {};
  return { raw: raw || {}, invoice };
}

function directSatimUrl(raw: any): string | null {
  const { raw: envelope, invoice } = invoiceEnvelope(raw);
  const candidates = [
    envelope?.url, envelope?.payment_url, envelope?.redirect_url,
    invoice?.payment_url, invoice?.redirect_url, invoice?.url,
  ];
  // SlickPay production has returned the hosted URL under different nested
  // envelopes over time. Search every response value, while the strict
  // HTTPS host/path allow-list below remains the security boundary.
  const seen = new Set<any>();
  const stack = [raw];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const value of Object.values(current)) {
      if (typeof value === "string") candidates.push(value);
      else if (value && typeof value === "object") stack.push(value);
    }
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(String(candidate));
      if (url.protocol === "https:"
        && url.hostname.toLowerCase() === "cib.satim.dz"
        && url.pathname === "/payment/epg/merchants/merchantsatim/payment.html"
        && url.searchParams.has("mdOrder")) {
        return url.toString();
      }
      if (!(url.protocol === "https:" && /(^|\.)slick-pay\.com$/i.test(url.hostname))) continue;
      // Production currently returns the hosted invoice URL. It is the only
      // supported entry point because SlickPay collects its own terms consent
      // and creates the one-time SATIM session before redirecting to cib.satim.dz.
      if (/^\/invoice\/payment\/[a-z0-9-]+(?:\/user)?\/?$/i.test(url.pathname)) {
        // SlickPay may return the merchant dashboard variant (`/user`).
        // Customers must always receive the public hosted invoice URL.
        url.pathname = url.pathname.replace(/\/user\/?$/i, "");
        return url.toString();
      }
      // The documented create-invoice response includes `/api/v2`; older saved
      // invoice URLs may omit it. Keep the allow-list strict, but accept both.
      if (/^(?:\/api\/v2)?\/users\/invoices\/satim\/payment\/[^/]+\/?$/i.test(url.pathname)) return url.toString();
      if (/^(?:\/api\/v2)?\/users\/invoices\/payment\/[^/]+\/?$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace("/users/invoices/payment/", "/users/invoices/satim/payment/");
        return url.toString();
      }
    } catch { /* reject malformed or non-SlickPay URLs */ }
  }
  return null;
}

function providerIdFromPaymentUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!(url.protocol === "https:" && /(^|\.)slick-pay\.com$/i.test(url.hostname))) return null;
    const hosted = url.pathname.match(/^\/invoice\/payment\/([^/]+)(?:\/user)?\/?$/i);
    if (hosted?.[1]) return hosted[1];
    const api = url.pathname.match(/^(?:\/api\/v2)?\/users\/invoices\/(?:satim\/)?payment\/([^/]+)\/?$/i);
    return api?.[1] || null;
  } catch {
    return null;
  }
}

function providerDiagnostic(raw: any) {
  const output: Array<[string, string]> = [];
  const seen = new Set<any>();
  const visit = (value: any, path: string, depth: number) => {
    if (value == null || depth > 6 || output.length >= 60) return;
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    const entries = Array.isArray(value)
      ? value.slice(0, 8).map((item, index) => [String(index), item] as const)
      : Object.entries(value);
    for (const [key, child] of entries) {
      const childPath = path ? `${path}.${key}` : key;
      if (/(id|url|link|payment|invoice|success|status|message|reference|number)/i.test(key)
        && ["string", "number", "boolean"].includes(typeof child)) {
        output.push([childPath, String(child).slice(0, 300)]);
      }
      visit(child, childPath, depth + 1);
    }
  };
  visit(raw, "", 0);
  return output;
}

function bearer(req: Request) {
  const value = req.headers.get("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return reply(req, 405, { success: false, code: "method_not_allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const slickKey = Deno.env.get("SLICKPAY_API_KEY") || "";
  if (!supabaseUrl || !serviceKey || !slickKey) {
    return reply(req, 500, { success: false, code: "server_configuration_error" });
  }

  const token = bearer(req);
  if (!token) return reply(req, 401, { success: false, code: "authentication_required" });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return reply(req, 401, { success: false, code: "invalid_session" });

  let input: any;
  try { input = await req.json(); } catch { return reply(req, 400, { success: false, code: "invalid_json" }); }
  const orderId = String(input?.order_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderId)) {
    return reply(req, 400, { success: false, code: "invalid_order_id" });
  }

  const { data: claim, error: claimError } = await admin.rpc("payment_claim_attempt", {
    p_order_id: orderId,
    p_user_id: authData.user.id,
  });
  if (claimError) {
    console.error("payment_claim_attempt failed", { order_id: orderId, error: claimError.message });
    return reply(req, 500, { success: false, code: "payment_initialization_failed" });
  }
  if (!claim?.success) {
    const status = claim?.code === "order_not_found" ? 404 : claim?.code === "order_forbidden" ? 403 : 409;
    return reply(req, status, { success: false, code: claim?.code || "payment_initialization_failed" });
  }
  if (claim.already_paid) return reply(req, 409, { success: false, code: "order_already_paid" });
  if (!claim.should_create) {
    if (claim.payment_id && claim.payment_url && claim.attempt_status === "pending") {
      const reusableUrl = directSatimUrl({ url: claim.payment_url });
      if (!reusableUrl) return reply(req, 409, { success: false, code: "payment_requires_review" });
      return reply(req, 200, {
        success: true, reused: true, order_id: orderId,
        payment_id: claim.payment_id, payment_url: reusableUrl,
      });
    }
    return reply(req, 409, {
      success: false,
      code: claim.attempt_status === "review" ? "payment_requires_review" : "payment_initializing",
      retryable: claim.attempt_status === "creating",
    });
  }

  const order = claim.order || {};
  const amount = Number(claim.expected_amount);
  const attemptId = String(claim.attempt_id);
  if (!Number.isFinite(amount) || amount <= 0) return reply(req, 422, { success: false, code: "invalid_amount" });

  const requestedOrigin = String(input?.origin_url || "");
  const requestOrigin = req.headers.get("origin") || "";
  const origin = ALLOWED_ORIGINS.has(requestedOrigin)
    ? requestedOrigin : ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "https://www.striviodz.store";
  const customer = order.customer_info || {};
  const contact = first(customer.contact, customer.contact_id, Deno.env.get("SLICKPAY_CONTACT_ID"));
  if (!contact) return reply(req, 422, { success: false, code: "billing_contact_missing" });

  const returnUrl = `${origin}/thank-you?order_id=${encodeURIComponent(orderId)}`;
  const redirectBridge = `${origin}/payment-redirect?order_id=${encodeURIComponent(orderId)}`;
  const webhookSecret = Deno.env.get("SLICKPAY_WEBHOOK_SECRET") || "";
  const payload: Record<string, unknown> = {
    amount,
    contact,
    // SATIM may use `url` rather than the more specific callbacks for its
    // cancel/back button. Route every browser return through one bridge which
    // preserves the provider result, then let verify-payment confirm it.
    url: redirectBridge,
    success_url: `${redirectBridge}&result=success`,
    return_url: redirectBridge,
    cancel_url: `${redirectBridge}&result=cancelled`,
    failed_url: `${redirectBridge}&result=failed`,
    back_url: `${redirectBridge}&result=cancelled`,
    webhook_url: `${supabaseUrl}/functions/v1/verify-payment?webhook=1&attempt_id=${encodeURIComponent(attemptId)}`,
    webhook_meta_data: { order_id: orderId, attempt_id: attemptId, store: "strivio" },
    // A single exact-total line prevents item totals or discounts from overriding the invoice amount.
    items: [{ name: `Strivio order ${orderId.slice(0, 8)}`, price: amount, quantity: 1, qty: 1 }],
  };
  if (webhookSecret) payload.webhook_signature = webhookSecret;

  let providerResponse: Response;
  let providerJson: any;
  try {
    // Never retry invoice creation automatically: an ambiguous network failure must not create two invoices.
    providerResponse = await fetch(`${SLICK_BASE}/users/invoices`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${slickKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Idempotency-Key": attemptId,
      },
      body: JSON.stringify(payload),
    });
    providerJson = await providerResponse.json().catch(() => ({}));
  } catch (error) {
    console.error("SlickPay create invoice transport failure", { order_id: orderId, attempt_id: attemptId, error: String(error) });
    return reply(req, 502, { success: false, code: "gateway_connection_failed", retryable: false });
  }
  if (!providerResponse.ok) {
    console.error("SlickPay create invoice rejected", { order_id: orderId, attempt_id: attemptId, status: providerResponse.status });
    return reply(req, 502, { success: false, code: "gateway_rejected_invoice", retryable: false });
  }

  const paymentUrl = directSatimUrl(providerJson);
  const { raw, invoice } = invoiceEnvelope(providerJson);
  const paymentId = first(
    invoice?.id, invoice?.invoice_id, invoice?.payment_id,
    raw?.id, raw?.invoice_id, raw?.payment_id,
    providerIdFromPaymentUrl(paymentUrl),
  );
  if (!paymentId || !paymentUrl) {
    console.error("SlickPay response missing direct SATIM identity", {
      order_id: orderId,
      attempt_id: attemptId,
      diagnostic: providerDiagnostic(providerJson),
    });
    return reply(req, 502, { success: false, code: "gateway_direct_url_missing", retryable: false });
  }

  const { data: activated, error: activationError } = await admin.rpc("payment_activate_attempt", {
    p_attempt_id: attemptId,
    p_provider_invoice_id: String(paymentId),
    p_payment_url: paymentUrl,
    p_provider_payload: providerJson,
  });
  if (activationError || !activated?.success) {
    console.error("Could not persist created invoice", { order_id: orderId, attempt_id: attemptId, invoice_id: String(paymentId) });
    return reply(req, 500, { success: false, code: "invoice_persistence_failed", retryable: false });
  }

  return reply(req, 200, {
    success: true, order_id: orderId, payment_id: String(paymentId), payment_url: paymentUrl,
  });
});
