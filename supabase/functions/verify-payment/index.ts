import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ALLOWED_ORIGINS = new Set([
  "https://striviodz.store", "https://www.striviodz.store",
  "http://localhost:3000", "http://127.0.0.1:3000",
]);
const SLICK_BASE = "https://prodapi.slick-pay.com/api/v2";

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://www.striviodz.store",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-slickpay-signature, x-webhook-signature",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  };
}
function reply(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" } });
}
function first(...values: unknown[]) {
  return values.find((v) => v !== undefined && v !== null && String(v).trim() !== "") ?? null;
}
function normalized(value: unknown) { return value == null ? null : String(value).trim().toLowerCase(); }
function canonicalStatus(value: unknown): string | null {
  const raw = normalized(value);
  if (!raw) return null;
  const plain = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["paid", "paye", "payee", "completed", "success", "successful"].includes(plain)) return "paid";
  if (["cancelled", "canceled", "annule", "annulee", "ignored", "ignore", "rejected", "refused", "refuse"].includes(plain)) return "cancelled";
  if (["failed", "failure", "error", "erreur", "declined", "decline"].includes(plain)) return "failed";
  if (["expired", "expire", "timeout", "session time limit"].includes(plain)) return "expired";
  return raw;
}
function envelope(raw: any) {
  let data = raw?.data;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = null; } }
  return { raw: raw || {}, invoice: data?.invoice || data || raw?.invoice || raw || {} };
}
function paymentStatus(raw: any): string | null {
  const x = envelope(raw);
  // Deliberately exclude generic status/completed fields: they are invoice lifecycle metadata, not payment proof.
  const explicit = first(x.invoice?.payment_status, x.invoice?.payment?.status, x.raw?.payment_status);
  if (explicit != null) return canonicalStatus(explicit);
  // SlickPay uses pay_status=1 as an explicit paid flag. Zero means only
  // "not paid" and must never be treated as failure by itself.
  const payFlag = first(x.invoice?.pay_status, x.raw?.pay_status);
  if (String(payFlag) === "1") return "paid";
  const lifecycle = canonicalStatus(first(x.invoice?.invoice_status, x.raw?.invoice_status, x.invoice?.status));
  return ["cancelled", "failed", "expired"].includes(String(lifecycle)) ? lifecycle : null;
}
function invoiceStatus(raw: any): string | null {
  const x = envelope(raw);
  return canonicalStatus(first(x.invoice?.invoice_status, x.raw?.invoice_status, x.invoice?.status));
}
function paidAt(raw: any): string | null {
  const x = envelope(raw);
  return first(x.invoice?.paid_at, x.invoice?.payment?.paid_at, x.raw?.paid_at) as string | null;
}
function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
function verifiedAmount(raw: any, expected: number): number | null {
  const x = envelope(raw);
  const candidates = [
    x.invoice?.amount_without_commission, x.invoice?.base_amount, x.invoice?.subtotal,
    x.raw?.amount_without_commission, x.raw?.base_amount, x.raw?.subtotal,
    x.invoice?.amount, x.raw?.amount,
  ].map(numeric).filter((v): v is number => v !== null);
  return candidates.find((v) => Math.abs(v - expected) <= 0.01) ?? candidates[0] ?? null;
}
function bearer(req: Request) {
  return req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}
function constantTimeEqual(a: string, b: string) {
  const enc = new TextEncoder(); const aa = enc.encode(a); const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let result = 0; for (let i = 0; i < aa.length; i++) result |= aa[i] ^ bb[i];
  return result === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return reply(req, 405, { success: false, code: "method_not_allowed" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const slickKey = Deno.env.get("SLICKPAY_API_KEY") || "";
  if (!supabaseUrl || !serviceKey || !slickKey) return reply(req, 500, { success: false, code: "server_configuration_error" });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let input: any = {};
  try { input = await req.json(); } catch { /* provider may send an empty trigger */ }
  const url = new URL(req.url);
  const isWebhook = url.searchParams.get("webhook") === "1";
  let userId: string | null = null;
  if (isWebhook) {
    const expectedSecret = Deno.env.get("SLICKPAY_WEBHOOK_SECRET") || "";
    const supplied = String(first(
      req.headers.get("x-slickpay-signature"), req.headers.get("x-webhook-signature"),
      input?.webhook_signature, input?.signature,
    ) || "");
    if (!expectedSecret || !supplied || !constantTimeEqual(expectedSecret, supplied)) {
      return reply(req, 401, { success: false, code: "invalid_webhook_signature" });
    }
  } else {
    const token = bearer(req);
    if (!token) return reply(req, 401, { success: false, code: "authentication_required" });
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return reply(req, 401, { success: false, code: "invalid_session" });
    userId = data.user.id;
  }

  const attemptId = String(first(input?.attempt_id, url.searchParams.get("attempt_id")) || "");
  const orderId = String(first(input?.order_id, input?.webhook_meta_data?.order_id, url.searchParams.get("order_id")) || "");
  const paymentId = String(first(input?.payment_id, input?.invoice_id, input?.id) || "");
  let query = admin.from("payment_attempts").select("*, orders!inner(*)").order("created_at", { ascending: false }).limit(1);
  if (attemptId) query = query.eq("id", attemptId);
  else if (orderId) query = query.eq("order_id", orderId);
  else if (paymentId) query = query.eq("provider_invoice_id", paymentId);
  else return reply(req, 400, { success: false, code: "payment_reference_required" });
  const { data: rows, error: attemptError } = await query;
  const attempt: any = rows?.[0];
  if (attemptError || !attempt) return reply(req, 404, { success: false, code: "payment_attempt_not_found" });
  const order = Array.isArray(attempt.orders) ? attempt.orders[0] : attempt.orders;
  if (!isWebhook && (!order?.user_id || order.user_id !== userId)) {
    return reply(req, 403, { success: false, code: "order_forbidden" });
  }
  if (!attempt.provider_invoice_id) {
    return reply(req, 202, { success: true, verified: false, status: "payment_initializing", order });
  }

  let response: Response;
  let providerJson: any;
  try {
    response = await fetch(`${SLICK_BASE}/users/invoices/${encodeURIComponent(attempt.provider_invoice_id)}`, {
      headers: { "Authorization": `Bearer ${slickKey}`, "Accept": "application/json" },
    });
    providerJson = await response.json().catch(() => ({}));
  } catch (error) {
    console.error("SlickPay verification transport failure", { attempt_id: attempt.id, error: String(error) });
    return reply(req, 503, { success: false, code: "gateway_temporarily_unavailable", retryable: true });
  }
  if (!response.ok) {
    console.error("SlickPay verification rejected", { attempt_id: attempt.id, status: response.status });
    return reply(req, 503, { success: false, code: "gateway_temporarily_unavailable", retryable: true });
  }

  const explicitPaymentStatus = paymentStatus(providerJson);
  const explicitInvoiceStatus = invoiceStatus(providerJson);
  const providerView = envelope(providerJson);
  console.info("SlickPay verification state", {
    attempt_id: attempt.id,
    payment_status: explicitPaymentStatus,
    invoice_status: explicitInvoiceStatus,
    pay_status: first(providerView.invoice?.pay_status, providerView.raw?.pay_status),
    status: first(providerView.invoice?.status, providerView.raw?.status),
    rejection_reason: first(providerView.invoice?.rejection_reason, providerView.invoice?.reject_reason, providerView.raw?.rejection_reason),
  });
  const amount = verifiedAmount(providerJson, Number(attempt.expected_amount));
  const paidTimestamp = paidAt(providerJson);
  const { data: state, error: stateError } = await admin.rpc("payment_record_provider_state", {
    p_attempt_id: attempt.id,
    p_payment_status: explicitPaymentStatus,
    p_invoice_status: explicitInvoiceStatus,
    p_provider_amount: amount,
    p_payload: providerJson,
    p_paid_at: paidTimestamp,
  });
  if (stateError || !state?.success) {
    console.error("Could not persist provider state", { attempt_id: attempt.id, error: stateError?.message });
    return reply(req, 500, { success: false, code: "verification_persistence_failed" });
  }

  const { data: refreshedOrder } = await admin.from("orders").select("*").eq("id", attempt.order_id).single();
  if (state.verified_paid) {
    // Fulfillment is idempotent and uses its own database claim.
    const fulfillment = fetch(`${supabaseUrl}/functions/v1/fulfill-order`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: attempt.order_id }),
    }).catch((error) => console.error("fulfillment dispatch failed", { order_id: attempt.order_id, error: String(error) }));
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(fulfillment);
    else await fulfillment;
  }
  return reply(req, 200, {
    success: true,
    verified: Boolean(state.verified_paid),
    amount_matches: Boolean(state.amount_matches),
    status: state.status,
    order: refreshedOrder || order,
  });
});
