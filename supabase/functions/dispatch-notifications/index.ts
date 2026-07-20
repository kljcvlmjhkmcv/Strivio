import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type DeliveryEntry,
  renderStrivioEmail,
} from "../_shared/strivio-email.ts";

const ALLOWED_ORIGINS = new Set([
  "https://www.striviodz.store",
  "https://striviodz.store",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function responseHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://www.striviodz.store",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-notification-secret, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(req) });
}

function safeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

function authorized(req: Request, serviceKey: string, workerSecret: string) {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const worker = (req.headers.get("x-notification-secret") || "").trim();
  return (!!serviceKey && !!bearer && safeEqual(bearer, serviceKey)) ||
    (!!workerSecret && !!worker && safeEqual(worker, workerSecret));
}

function unb64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function decrypt(value?: string | null) {
  if (!value) return null;
  const raw = Deno.env.get("FULFILLMENT_ENCRYPTION_KEY") || "";
  if (raw.length < 32) throw new Error("Delivery encryption is not configured");
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Unsupported encrypted delivery format");
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(raw));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(parts[1]) }, key, unb64(parts[2]));
  return JSON.parse(decoder.decode(plain));
}

function label(value: any, locale: string) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value?.[locale] || value?.ar || value?.fr || value?.en || "");
}

function safeUrl(path: unknown, siteUrl: string) {
  const value = String(path || "");
  const relative = /^\/(?!\/)/.test(value) ? value : "/my-account";
  return new URL(relative, siteUrl).toString();
}

function entriesFromDelivery(value: any): DeliveryEntry[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.entries)) {
    return value.entries.map((entry: any) => ({
      allocation_id: String(entry?.allocation_id || ""),
      account_id: String(entry?.account_id || ""),
      slot_id: String(entry?.slot_id || ""),
      email: String(entry?.email || ""),
      password: String(entry?.password || ""),
      profile: String(entry?.profile || entry?.label || ""),
      pin: String(entry?.pin || ""),
      code: String(entry?.code || ""),
      ends_at: entry?.ends_at ? String(entry.ends_at) : undefined,
    }));
  }
  if (value.email || value.password || value.code) {
    return [{
      email: String(value.email || ""),
      password: String(value.password || ""),
      profile: String(value.profile || value.label || ""),
      pin: String(value.pin || ""),
      code: String(value.code || ""),
      ends_at: value.ends_at ? String(value.ends_at) : undefined,
    }];
  }
  return [];
}

async function buildContext(db: any, delivery: any, event: any) {
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  const [inboxResult, orderResult, problemResult] = await Promise.all([
    delivery.user_notification_id
      ? db.from("user_notifications").select("title_i18n,body_i18n,action_url").eq("id", delivery.user_notification_id).maybeSingle()
      : Promise.resolve({ data: null }),
    event.order_id
      ? db.from("orders").select("id,total_payable,status,fulfillment_status,customer_info,items").eq("id", event.order_id).maybeSingle()
      : Promise.resolve({ data: null }),
    event.problem_id
      ? db.from("problem_reports").select("id,status,message,admin_notes,resolved_at").eq("id", event.problem_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (inboxResult.error) throw inboxResult.error;
  if (orderResult.error) throw orderResult.error;
  if (problemResult.error) throw problemResult.error;
  const inbox = inboxResult.data;
  const order = orderResult.data;
  const problem = problemResult.data;

  let fulfillmentQuery = event.order_id
    ? db.from("fulfillments").select("id,order_id,order_item_index,service_id,mode,status,encrypted_delivery,delivery_summary,delivered_at").eq("order_id", event.order_id).order("order_item_index")
    : null;
  if (fulfillmentQuery && event.fulfillment_id) fulfillmentQuery = fulfillmentQuery.eq("id", event.fulfillment_id);
  const fulfillmentResult = fulfillmentQuery ? await fulfillmentQuery : { data: [], error: null };
  if (fulfillmentResult.error) throw fulfillmentResult.error;
  const fulfillments = fulfillmentResult.data;
  const rows = fulfillments || [];
  const serviceIds = [...new Set([event.service_id, ...rows.map((row: any) => row.service_id)].filter(Boolean))];
  const serviceResult = serviceIds.length
    ? await db.from("services").select("id,n").in("id", serviceIds)
    : { data: [], error: null };
  if (serviceResult.error) throw serviceResult.error;
  const services = serviceResult.data;
  const serviceMap = new Map((services || []).map((service: any) => [service.id, service]));

  const entries: DeliveryEntry[] = [];
  const mayIncludeCredentials = ["order.delivered", "fulfillment.delivered", "account.changed", "credentials.changed"]
    .includes(String(event.event_type || "").toLowerCase());
  for (const fulfillment of mayIncludeCredentials ? rows : []) {
    const decrypted = await decrypt(fulfillment.encrypted_delivery);
    let nextEntries = entriesFromDelivery(decrypted);
    if (String(event.event_type || "").toLowerCase() === "account.changed" && data.account_id) {
      const allocationResult = await db.from("fulfillment_allocations")
        .select("id,account_id,slot_id,inventory_slots(label)")
        .eq("fulfillment_id", fulfillment.id)
        .eq("account_id", String(data.account_id))
        .eq("status", "active")
        .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`);
      if (allocationResult.error) throw allocationResult.error;
      const allocationIds = new Set((allocationResult.data || []).map((row: any) => String(row.id || "")).filter(Boolean));
      const slotIds = new Set((allocationResult.data || []).map((row: any) => String(row.slot_id || "")).filter(Boolean));
      const labels = new Set((allocationResult.data || []).map((row: any) =>
        String(row.inventory_slots?.label || "").trim().toLowerCase()
      ).filter(Boolean));
      const labelCounts = new Map<string, number>();
      for (const entry of nextEntries) {
        const entryLabel = String(entry.profile || entry.label || "").trim().toLowerCase();
        if (entryLabel) labelCounts.set(entryLabel, (labelCounts.get(entryLabel) || 0) + 1);
      }
      nextEntries = nextEntries.filter((entry) => {
        if (entry.allocation_id && allocationIds.has(String(entry.allocation_id))) return true;
        if (entry.slot_id && slotIds.has(String(entry.slot_id))) return true;
        if (entry.account_id && String(entry.account_id) === String(data.account_id)) return true;
        // Legacy deliveries did not store stable identifiers. Only accept a
        // label fallback when it is unique inside this fulfillment.
        const entryLabel = String(entry.profile || entry.label || "").trim().toLowerCase();
        return !entry.allocation_id && !entry.slot_id && !entry.account_id &&
          labels.has(entryLabel) && labelCounts.get(entryLabel) === 1;
      });
    }
    entries.push(...nextEntries);
  }

  // Never fall back to raw inventory credentials when no active allocation was
  // found. The fulfillment/allocation join above is the authorization boundary
  // that prevents an expired or moved customer from receiving current secrets.

  const locale = delivery.locale === "fr" || delivery.locale === "en" ? delivery.locale : "ar";
  const firstService: any = serviceMap.get(event.service_id) || serviceMap.get(rows[0]?.service_id) || null;
  const itemNames = Array.isArray(order?.items)
    ? order.items.map((item: any) => label(item?.nameData, locale) || item?.name || item?.title || item?.id).filter(Boolean)
    : [];
  const serviceName = label(firstService?.n, locale) || String(data.service_name || itemNames[0] || event.service_id || "Strivio");
  const scopedRow = event.fulfillment_id
    ? rows.find((row: any) => row.id === event.fulfillment_id) || rows[0]
    : null;
  const scopedItem = scopedRow && Array.isArray(order?.items)
    ? order.items[Number(scopedRow.order_item_index || 0)]
    : null;
  const identityItemNames = scopedItem
    ? [label(scopedItem?.nameData, locale) || scopedItem?.name || scopedItem?.title || scopedItem?.id]
    : itemNames;
  const identity = [event.service_id, serviceName, ...identityItemNames].join(" ").toLowerCase();
  const summaryEnd = rows.map((row: any) => row.delivery_summary?.ends_at).filter(Boolean)[0];
  const entryEnds = entries.map((entry) => entry.ends_at).filter(Boolean).sort().at(-1);
  const customer = order?.customer_info || {};
  const customerName = [customer.first_name || customer.firstname, customer.last_name || customer.lastname].filter(Boolean).join(" ");
  const actionPath = inbox?.action_url || data.action_url || (event.order_id ? `/my-account?order=${event.order_id}` : "/my-account");

  return {
    eventType: event.event_type,
    templateKey: delivery.template_key,
    locale,
    customerName,
    customerEmail: String(customer.email || delivery.recipient || ""),
    orderId: event.order_id || undefined,
    serviceId: event.service_id || rows[0]?.service_id || undefined,
    serviceName,
    amountDzd: order?.total_payable === null || order?.total_payable === undefined ? null : Number(order.total_payable),
    actionUrl: safeUrl(actionPath, Deno.env.get("SITE_URL") || "https://www.striviodz.store"),
    message: String(data.message || problem?.message || ""),
    adminNote: String(data.admin_note || data.admin_notes || problem?.admin_notes || ""),
    endsAt: String(data.ends_at || summaryEnd || entryEnds || "") || null,
    months: Number(data.months || 0) || null,
    entries,
    isNetflix: /netflix|نتفلكس|نتفليكس/i.test(identity),
    titleI18n: inbox?.title_i18n || null,
    bodyI18n: inbox?.body_i18n || null,
  };
}

function retryDelay(attempt: number, headerSeconds?: number | null) {
  if (headerSeconds && Number.isFinite(headerSeconds)) return Math.max(10, Math.min(headerSeconds, 86400));
  return [30, 120, 600, 1800, 7200, 21600][Math.max(0, Math.min(attempt - 1, 5))] || 21600;
}

async function markComplete(db: any, delivery: any, status: string, providerId?: string, metadata: any = {}) {
  const { data, error } = await db.rpc("complete_notification_delivery", {
    p_delivery_id: delivery.id,
    p_status: status,
    p_provider_message_id: providerId || null,
    p_provider_metadata: metadata,
    p_worker_id: delivery.locked_by || null,
  });
  if (error) throw error;
  if (data !== true && !providerId) throw new Error("Notification delivery lease was lost before completion");
  if (providerId) {
    const current = await db.from("notification_deliveries")
      .select("status,provider_message_id")
      .eq("id", delivery.id)
      .maybeSingle();
    if (current.error) throw current.error;
    if (String(current.data?.provider_message_id || "") === providerId &&
        ["sent", "delivered", "suppressed", "dead", "cancelled"].includes(String(current.data?.status || ""))) {
      return String(current.data.status);
    }
  }
  if (data !== true) throw new Error("Notification delivery lease was lost before completion");
  return status;
}

async function markFailed(db: any, delivery: any, errorMessage: string, permanent: boolean, retryAfter?: number | null) {
  const { data, error } = await db.rpc("fail_notification_delivery", {
    p_delivery_id: delivery.id,
    p_error: String(errorMessage || "Delivery failed").slice(0, 800),
    p_retry_after_seconds: retryDelay(Number(delivery.attempt_count || 1), retryAfter),
    p_permanent: permanent,
    p_worker_id: delivery.locked_by || null,
    p_provider_message_id: null,
  });
  if (error) throw error;
  if (data) return String(data);
  const current = await db.from("notification_deliveries")
    .select("status")
    .eq("id", delivery.id)
    .maybeSingle();
  if (current.error) throw current.error;
  if (["sent", "delivered", "suppressed", "dead", "cancelled"].includes(String(current.data?.status || ""))) {
    return String(current.data.status);
  }
  throw new Error("Notification delivery lease was lost before failure handling");
}

async function updateOrderEmailState(db: any, event: any, status: string, errorMessage: string | null = null) {
  if (!event?.order_id) return;
  const eventType = String(event.event_type || "").toLowerCase();
  if (!eventType.startsWith("order.") && eventType !== "fulfillment.delivered") return;
  let query = db.from("fulfillments").update({
    email_status: status,
    email_error: errorMessage ? String(errorMessage).slice(0, 500) : null,
  }).eq("order_id", event.order_id);
  if (event.fulfillment_id) query = query.eq("id", event.fulfillment_id);
  const { error } = await query;
  if (error) throw error;
}

async function sendResend(db: any, delivery: any, event: any) {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "";
  const fromName = Deno.env.get("RESEND_FROM_NAME") || "Strivio";
  if (!apiKey || !fromEmail) throw new Error("Resend sender is not configured");

  const suppressionResult = await db.from("email_suppressions").select("email").eq("email", String(delivery.recipient).toLowerCase()).maybeSingle();
  if (suppressionResult.error) throw suppressionResult.error;
  const suppression = suppressionResult.data;
  if (suppression) {
    const completedStatus = await markComplete(db, delivery, "suppressed", undefined, { reason: "suppression_list" });
    await updateOrderEmailState(db, event, completedStatus, "Email address is suppressed");
    return { status: completedStatus };
  }

  const rendered = renderStrivioEmail(await buildContext(db, delivery, event));
  const eventTag = String(event.event_type || "notification").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  const body: Record<string, unknown> = {
    from: `${fromName} <${fromEmail}>`,
    to: [delivery.recipient],
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: [
      { name: "event", value: eventTag },
      { name: "delivery_id", value: String(delivery.id) },
    ],
  };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `strivio-${delivery.id}-${Number(delivery.requeue_generation || 0)}`,
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  let responseData: any = null;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = null;
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after") || 0) || null;
    const errorName = String(responseData?.name || responseData?.error?.name || "");
    const retryable409 = response.status === 409 && errorName === "concurrent_idempotent_requests";
    const retryable = response.status === 408 || retryable409 || response.status === 429 || response.status >= 500;
    const providerError = String(responseData?.message || responseData?.error || `Resend HTTP ${response.status}`).slice(0, 500);
    const failedStatus = await markFailed(db, delivery, providerError, !retryable, retryAfter);
    await updateOrderEmailState(db, event, failedStatus, providerError);
    return { status: failedStatus, code: response.status };
  }
  const providerId = String(responseData?.id || "");
  if (!providerId) {
    const failedStatus = await markFailed(db, delivery, "Resend returned no message id", false);
    await updateOrderEmailState(db, event, failedStatus, "Resend returned no message id");
    return { status: failedStatus };
  }
  const completedStatus = await markComplete(db, delivery, "sent", providerId, { accepted_at: new Date().toISOString() });
  await updateOrderEmailState(db, event, completedStatus);
  return { status: completedStatus };
}

function telegramText(event: any, order: any) {
  const data = event?.data || {};
  const customer = order?.customer_info || {};
  const customerName = [customer.first_name || customer.firstname, customer.last_name || customer.lastname].filter(Boolean).join(" ");
  const lines = [
    "🔔 Strivio Operations",
    `الحدث: ${String(event?.event_type || "notification")}`,
    event?.order_id ? `الطلب: #${String(event.order_id).slice(0, 8)}\nOrder ID: ${event.order_id}` : "",
    event?.service_id ? `الخدمة: ${event.service_id}` : "",
    customerName ? `العميل: ${customerName}` : "",
    customer?.email ? `البريد: ${customer.email}` : "",
    customer?.phone ? `الهاتف: ${customer.phone}` : "",
    data.message ? `التفاصيل: ${String(data.message).slice(0, 1500)}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

async function sendTelegram(db: any, delivery: any, event: any) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || Deno.env.get("PROBLEMS_TELEGRAM_BOT_TOKEN") || "";
  const chatId = delivery.recipient === "admin"
    ? (Deno.env.get("TELEGRAM_CHAT_ID") || Deno.env.get("PROBLEMS_TELEGRAM_CHAT_ID") || "")
    : String(delivery.recipient || "");
  if (!token || !chatId) throw new Error("Telegram notifications are not configured");
  const { data: order } = event.order_id
    ? await db.from("orders").select("id,customer_info").eq("id", event.order_id).maybeSingle()
    : { data: null };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: telegramText(event, order), disable_web_page_preview: true }),
  });
  const responseText = await response.text();
  let responseData: any = null;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = null;
  }
  if (!response.ok || responseData?.ok === false) {
    const retryable = response.status === 429 || response.status >= 500;
    const retryAfter = Number(responseData?.parameters?.retry_after || 0) || null;
    await markFailed(db, delivery, String(responseData?.description || `Telegram HTTP ${response.status}`).slice(0, 500), !retryable, retryAfter);
    return { status: retryable ? "failed" : "dead", code: response.status };
  }
  const providerId = String(responseData?.result?.message_id || "");
  await markComplete(db, delivery, "sent", providerId, { chat: "admin" });
  return { status: "sent" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(req) });
  if (req.method !== "POST") return json(req, { success: false, error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const workerSecret = Deno.env.get("NOTIFICATION_WORKER_SECRET") || "";
  if (!supabaseUrl || !serviceKey) return json(req, { success: false, error: "Server configuration is incomplete" }, 503);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const requestBody = await req.json().catch(() => ({}));
  const requestedChannels = Array.isArray(requestBody?.channels)
    ? requestBody.channels.filter((channel: unknown) => channel === "email" || channel === "telegram")
    : null;
  const serverAuthorized = authorized(req, serviceKey, workerSecret);
  let isAdmin = false;
  let isVerifiedCustomerWakeup = false;
  if (!serverAuthorized) {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (bearer) {
      const { data: { user }, error: userError } = await db.auth.getUser(bearer);
      if (!userError && user?.email_confirmed_at) {
        const { data: admin } = await db.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
        isAdmin = !!admin;
        // A verified customer may only wake the email queue with a small batch.
        // They cannot create jobs, choose recipients, inspect results, or send
        // Telegram messages; this makes report acknowledgements immediate.
        isVerifiedCustomerWakeup = !!requestedChannels?.length &&
          requestedChannels.every((channel: string) => channel === "email");
      }
    }
  }
  if (!serverAuthorized && !isAdmin && !isVerifiedCustomerWakeup) {
    return json(req, { success: false, error: "Unauthorized" }, 401);
  }

  try {
    const maxLimit = serverAuthorized || isAdmin ? 25 : 5;
    const limit = Math.max(1, Math.min(Number(requestBody?.limit || 10), maxLimit));
    const channels = isVerifiedCustomerWakeup && !isAdmin && !serverAuthorized
      ? ["email"]
      : requestedChannels;
    const workerId = `edge-${crypto.randomUUID()}`;
    const { data: deliveries, error: claimError } = await db.rpc("claim_notification_deliveries", {
      p_limit: limit,
      p_worker_id: workerId,
      p_channels: channels?.length ? channels : null,
    });
    if (claimError) throw claimError;

    const results: Array<Record<string, unknown>> = [];
    for (const delivery of deliveries || []) {
      let event: any = null;
      try {
        const eventResult = await db.from("notification_events").select("*").eq("id", delivery.event_id).maybeSingle();
        event = eventResult.data;
        const eventError = eventResult.error;
        if (eventError || !event) {
          await markFailed(db, delivery, "Notification event not found", true);
          results.push({ id: delivery.id, status: "dead" });
          continue;
        }
        const result = delivery.channel === "email"
          ? await sendResend(db, delivery, event)
          : delivery.channel === "telegram"
            ? await sendTelegram(db, delivery, event)
            : { status: "dead" };
        if (result.status === "dead" && !["email", "telegram"].includes(delivery.channel)) {
          await markFailed(db, delivery, "Unsupported notification channel", true);
        }
        results.push({ id: delivery.id, ...result });
      } catch (error: any) {
        const failureMessage = String(error?.message || "Notification delivery failed").slice(0, 500);
        let failureStatus = "failed";
        try {
          failureStatus = await markFailed(db, delivery, failureMessage, false);
        } catch (markError: any) {
          results.push({
            id: delivery.id,
            status: "lease_lost",
            error: String(markError?.message || "Unable to release notification lease").slice(0, 300),
          });
          continue;
        }
        if (delivery.channel === "email") {
          try {
            await updateOrderEmailState(db, event, failureStatus, failureMessage);
          } catch (stateError: any) {
            results.push({
              id: delivery.id,
              status: failureStatus,
              warning: String(stateError?.message || "Unable to update order email state").slice(0, 300),
            });
            continue;
          }
        }
        results.push({ id: delivery.id, status: failureStatus });
      }
    }

    const counts = results.reduce((summary: Record<string, number>, result: any) => {
      const key = String(result.status || "unknown");
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, {});
    return json(req, { success: true, claimed: (deliveries || []).length, counts, results });
  } catch (error: any) {
    return json(req, { success: false, error: String(error?.message || "Notification worker failed").slice(0, 500) }, 500);
  }
});
