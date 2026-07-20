import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = {
  "Access-Control-Allow-Origin": "https://www.striviodz.store",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function waitUntil(promise: Promise<unknown>) {
  const edge = (globalThis as any).EdgeRuntime;
  if (edge?.waitUntil) edge.waitUntil(promise);
  else promise.catch(() => null);
}

function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function unb64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function firstLabel(value: any) {
  return value?.ar || value?.fr || value?.en || value || "";
}

function quantityFor(item: any) {
  const qty = Number(item?.qty ?? item?.quantity ?? 1);
  if (!Number.isFinite(qty)) return 1;
  return Math.max(1, Math.min(20, Math.trunc(qty)));
}

function screenCountFor(item: any) {
  const variants = item?.typeLabelData;
  const variantLabel = Array.isArray(variants?.ar) ? variants.ar[Number(item?.typeIdx || 0)] : "";
  const label = String(item?.typeLabel || variantLabel || "").toLowerCase();
  const looksLikeScreens = /screen|écran|ecran|شاشة|شاشت/.test(label);
  if (!looksLikeScreens) return quantityFor(item);
  const explicit = label.match(/(\d+)/);
  const screens = explicit ? Number(explicit[1]) : Number(item?.typeIdx ?? 0) + 1;
  const itemQty = quantityFor(item);
  if (!Number.isFinite(screens) || screens < 1) return itemQty;
  return Math.max(1, Math.min(20, Math.trunc(screens) * itemQty));
}

function monthsFor(item: any) {
  const raw = String(firstLabel(item?.durLabelData) || item?.durLabel || "").toLowerCase();
  const match = raw.match(/(\d+)/);
  if (match) return Math.max(1, Number(match[1]));
  return [1, 2, 3, 6, 12][Number(item?.durIdx || 0)] || 1;
}

function endDate(months: number) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

function profileNo(label: string) {
  const match = String(label || "").match(/\d+/);
  return match ? Number(match[0]) : 9999;
}

function deliveryMessage(mode: string) {
  if (mode === "manual_activation") return "تم الدفع. اضغط زر إدخال معلومات الحساب حتى نبدأ التفعيل.";
  if (mode === "email_invite") return "تم الدفع. ستصلك الدعوة قريبًا على البريد الإلكتروني المسجل في الطلب.";
  return "تم الدفع. طلبك قيد التجهيز من فريق Strivio.";
}
async function keyFromEnv() {
  const raw = Deno.env.get("FULFILLMENT_ENCRYPTION_KEY") || "";
  if (raw.length < 32) throw new Error("FULFILLMENT_ENCRYPTION_KEY must contain at least 32 characters");
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFromEnv(), enc.encode(JSON.stringify(value)));
  return `v1.${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}

async function decrypt(value?: string | null): Promise<any> {
  if (!value) return {};
  const [, iv, cipher] = value.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await keyFromEnv(), unb64(cipher));
  return JSON.parse(dec.decode(plain));
}

function emailHtml(order: any, deliveries: any[]) {
  const customer = order.customer_info || {};
  const amount = Number(order.total_payable || 0).toLocaleString("en-US");
  const customerName = [customer.first_name || customer.firstname, customer.last_name || customer.lastname].filter(Boolean).join(" ") || "عميل Strivio";
  const blocks = deliveries.map((delivery: any) => {
    const entries = Array.isArray(delivery.entries) ? delivery.entries : [];
    const productIdentity = [delivery.service_id, delivery.product_name].filter(Boolean).join(" ").toLowerCase();
    const isNetflix = /netflix|نتفلكس|نتفليكس/i.test(productIdentity);
    const ends = delivery.ends_at ? `<div style="margin-top:10px;color:#9ca3af;font-size:13px">ينتهي الاشتراك: ${esc(new Date(delivery.ends_at).toLocaleDateString("fr-DZ"))}</div>` : "";
    const rules = isNetflix ? `<div dir="rtl" lang="ar" style="margin-top:12px;padding:14px;border-radius:14px;background:#1b1605;border:1px solid #5f4b12;color:#fff3b0;line-height:1.8;text-align:right"><b>شروط الاستخدام:</b><ul style="margin:8px 0 0;padding-right:20px"><li>معلومات الحساب مخصصة لصاحب الطلب فقط ولا يجوز نشرها أو مشاركتها.</li><li>البروفايل أو الشاشة مخصصان لشخص واحد فقط، ويمنع أن يتشارك أكثر من شخص في نفس البروفايل أو الشاشة.</li><li>يمنع تشغيل أو مشاهدة المحتوى من جهازين في الوقت نفسه حتى لو كانا لنفس الشخص.</li><li>يمنع تغيير كلمة سر الحساب أو إعداداته العامة.</li><li>يسمح فقط بتعديل اسم البروفايل ورمز PIN الخاص بك.</li><li>أي مخالفة قد تؤدي إلى إيقاف الاشتراك دون استرداد الأموال.</li></ul></div>` : "";
    const body = entries.length ? entries.map((entry: any, index: number) => {
      if (entry.code) return `<div style="margin-top:12px;padding:14px;border-radius:14px;background:#070707;border:1px solid #263326"><div style="color:#39ff14;font-weight:900;margin-bottom:8px">الكود ${index + 1}</div><div style="font-family:Consolas,monospace;color:#fff;word-break:break-all">${esc(entry.code)}</div></div>`;
      const profileEnd = entry.ends_at ? `<div style="margin-top:6px;color:#9ca3af;font-size:13px">ينتهي هذا البروفايل: ${esc(new Date(entry.ends_at).toLocaleDateString("fr-DZ"))}</div>` : "";
      return `<div style="margin-top:12px;padding:14px;border-radius:14px;background:#070707;border:1px solid #263326;line-height:1.9"><div style="color:#39ff14;font-weight:900;margin-bottom:8px">${esc(entry.profile || `Profile ${index + 1}`)}</div><div><b>إيميل الحساب:</b> ${esc(entry.email)}</div><div><b>كلمة السر:</b> <span style="font-family:Consolas,monospace">${esc(entry.password)}</span></div><div><b>اسم الشاشة:</b> ${esc(entry.profile)}</div><div><b>PIN:</b> ${esc(entry.pin || "بدون")}</div>${profileEnd}</div>`;
    }).join("") : `<div style="margin-top:12px;color:#d1d5db;line-height:1.8">${esc(delivery.message || deliveryMessage(delivery.mode))}</div>`;
    return `<section style="margin:18px 0;padding:18px;border:1px solid #263326;border-radius:18px;background:#111"><h3 style="margin:0;color:#39ff14;font-size:20px">${esc(delivery.product_name || "Strivio")}</h3>${ends}${rules}${body}</section>`;
  }).join("");
  const accountUrl = `https://www.striviodz.store/my-account?order=${encodeURIComponent(order.id)}&download=1`;
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#050505;color:#f4f4f4;font-family:Arial,Tahoma,sans-serif"><div style="max-width:720px;margin:0 auto;padding:28px"><div style="border:1px solid #263326;border-radius:24px;background:#0b0b0b;overflow:hidden"><div style="padding:26px 24px;background:linear-gradient(135deg,#0b0b0b,#102010)"><div style="color:#39ff14;font-weight:900;font-size:30px;letter-spacing:.5px">Strivio</div><h1 style="margin:18px 0 8px;color:#fff;font-size:24px">تم تسليم طلبك يا ${esc(customerName)}</h1><p style="margin:0;color:#bdbdbd">معلومات الحساب والشاشات بالأسفل.</p></div><div style="padding:24px"><div style="display:grid;gap:8px;color:#d8d8d8;line-height:1.8"><div><b>رقم الطلب:</b> <span style="font-family:Consolas,monospace">${esc(order.id)}</span></div><div><b>الإيميل:</b> ${esc(customer.email || "")}</div><div><b>رقم الهاتف:</b> ${esc(customer.phone || "")}</div><div><b>الإجمالي:</b> ${amount} DZD</div></div>${blocks}<a href="${accountUrl}" style="display:inline-block;margin-top:8px;background:#39ff14;color:#050505;text-decoration:none;padding:14px 20px;border-radius:14px;font-weight:900">فتح الطلب وتحميل المستند</a><p style="margin-top:24px;color:#909090;font-size:12px;line-height:1.7">المعلومات خاصة بصاحب الطلب فقط. لا تشارك كلمة السر أو رمز PIN مع أي شخص.</p></div></div></div></body></html>`;
}
async function sendEmail(order: any, deliveries: any[]) {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const sender = Deno.env.get("BREVO_SENDER_EMAIL");
  const to = order.customer_info?.email;
  if (!apiKey || !sender || !to) return { status: "pending_configuration", error: !to ? "Customer email missing" : "Brevo is not configured" };
  const name = [order.customer_info?.first_name, order.customer_info?.last_name].filter(Boolean).join(" ");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { email: sender, name: "Strivio" },
      to: [{ email: to, name }],
      subject: `تم تسليم طلبك من Strivio #${String(order.id).slice(0, 8)}`,
      htmlContent: emailHtml(order, deliveries),
    }),
  });
  if (!res.ok) return { status: "failed", error: (await res.text()).slice(0, 500) };
  return { status: "sent", error: null };
}

async function sendRenewalEmail(order: any, result: any) {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const sender = Deno.env.get("BREVO_SENDER_EMAIL");
  const to = order.customer_info?.email;
  if (!apiKey || !sender || !to) return;
  const effectiveEnd = result?.new_ends_at || result?.updates?.[0]?.ends_at;
  const end = effectiveEnd ? new Date(effectiveEnd).toLocaleDateString("fr-DZ") : "—";
  const accountUrl = `https://www.striviodz.store/my-account?order=${encodeURIComponent(order.id)}`;
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { email: sender, name: "Strivio" },
      to: [{ email: to }],
      subject: `تم تمديد اشتراكك في Strivio #${String(order.id).slice(0, 8)}`,
      htmlContent: `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#050505;color:#fff;font-family:Arial,Tahoma,sans-serif"><div style="max-width:680px;margin:auto;padding:28px"><div style="background:#0b0b0b;border:1px solid #263326;border-radius:24px;padding:26px"><div style="color:#39ff14;font-size:30px;font-weight:900">Strivio</div><h1 style="font-size:24px">تم تمديد اشتراكك بنجاح</h1><p style="color:#cfcfcf;line-height:1.8">تم تأكيد دفع طلب التجديد وتحديث نفس الاشتراك الذي اخترته. تاريخ الانتهاء الجديد: <b style="color:#39ff14">${esc(end)}</b>.</p><a href="${accountUrl}" style="display:inline-block;margin-top:12px;background:#39ff14;color:#050505;text-decoration:none;padding:14px 20px;border-radius:14px;font-weight:900">عرض الاشتراك المحدّث</a></div></div></body></html>`,
    }),
  }).catch(() => null);
}

async function releaseStaleSlots(db: any, serviceId: string) {
  const { data: slots } = await db
    .from("inventory_slots")
    .select("id,inventory_accounts!inner(service_id)")
    .eq("status", "assigned")
    .eq("inventory_accounts.service_id", serviceId)
    .limit(500);
  const ids = (slots || []).map((slot: any) => slot.id).filter(Boolean);
  if (!ids.length) return;
  const { data: active } = await db.from("fulfillment_allocations").select("slot_id").in("slot_id", ids).eq("status", "active");
  const activeIds = new Set((active || []).map((row: any) => row.slot_id));
  const stale = ids.filter((id: string) => !activeIds.has(id));
  if (stale.length) await db.from("inventory_slots").update({ status: "available", updated_at: new Date().toISOString() }).in("id", stale);
}

async function releaseFulfillmentAllocations(db: any, fulfillmentId: string) {
  const { data: allocations } = await db
    .from("fulfillment_allocations")
    .select("id,slot_id")
    .eq("fulfillment_id", fulfillmentId)
    .eq("status", "active");
  const allocationIds = (allocations || []).map((row: any) => row.id).filter(Boolean);
  const slotIds = (allocations || []).map((row: any) => row.slot_id).filter(Boolean);
  if (allocationIds.length) await db.from("fulfillment_allocations").update({ status: "expired", admin_notes: "reallocated" }).in("id", allocationIds);
  if (slotIds.length) await db.from("inventory_slots").update({ status: "available", updated_at: new Date().toISOString() }).in("id", slotIds);
}

function sortSlotsTopToBottom(a: any, b: any) {
  return profileNo(a.label) - profileNo(b.label) || String(a.label || "").localeCompare(String(b.label || "")) || String(a.created_at || "").localeCompare(String(b.created_at || ""));
}

function chooseStrictSlots(accounts: any[], freeSlots: any[], qty: number) {
  const byAccount = new Map<string, any[]>();
  for (const slot of freeSlots) {
    if (!byAccount.has(slot.account_id)) byAccount.set(slot.account_id, []);
    byAccount.get(slot.account_id)!.push(slot);
  }
  for (const group of byAccount.values()) group.sort(sortSlotsTopToBottom);

  for (const account of accounts) {
    const group = byAccount.get(account.id) || [];
    if (group.length >= qty) return group.slice(0, qty);
  }

  for (let i = 0; i < accounts.length; i++) {
    const first = byAccount.get(accounts[i].id) || [];
    if (!first.length) continue;
    for (let j = i + 1; j < accounts.length; j++) {
      const second = byAccount.get(accounts[j].id) || [];
      if (first.length + second.length >= qty) return [...first, ...second].slice(0, qty);
    }
  }

  const totalFree = freeSlots.length;
  if (totalFree >= qty) throw new Error("NEEDS_MANUAL_SPLIT");
  throw new Error("OUT_OF_STOCK");
}

async function allocateSlots(db: any, serviceId: string, fulfillmentId: string, qty: number, endsAt: string, includePin: boolean) {
  await releaseStaleSlots(db, serviceId);
  const { data: accounts, error: accountsError } = await db
    .from("inventory_accounts")
    .select("id,label,encrypted_credentials,created_at")
    .eq("service_id", serviceId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (accountsError) throw accountsError;
  const orderedAccounts = accounts || [];
  const accountIds = orderedAccounts.map((a: any) => a.id);
  if (!accountIds.length) throw new Error("OUT_OF_STOCK");

  const { data: slots, error: slotsError } = await db
    .from("inventory_slots")
    .select("id,account_id,label,encrypted_secret,status,created_at")
    .in("account_id", accountIds)
    .eq("status", "available");
  if (slotsError) throw slotsError;

  const slotIds = (slots || []).map((s: any) => s.id);
  const { data: activeAllocations } = slotIds.length
    ? await db.from("fulfillment_allocations").select("slot_id").in("slot_id", slotIds).eq("status", "active")
    : { data: [] };
  const activeSlotIds = new Set((activeAllocations || []).map((a: any) => a.slot_id));
  const freeSlots = (slots || []).filter((s: any) => !activeSlotIds.has(s.id));
  const selected = chooseStrictSlots(orderedAccounts, freeSlots, qty);

  const entries: any[] = [];
  for (const slot of selected) {
    const account = orderedAccounts.find((a: any) => a.id === slot.account_id);
    const { data: updatedSlot, error: slotError } = await db
      .from("inventory_slots")
      .update({ status: "assigned", updated_at: new Date().toISOString() })
      .eq("id", slot.id)
      .eq("status", "available")
      .select("id")
      .maybeSingle();
    if (slotError) throw slotError;
    if (!updatedSlot) throw new Error("OUT_OF_STOCK");
    const { error: allocationError } = await db.from("fulfillment_allocations").insert({ fulfillment_id: fulfillmentId, account_id: slot.account_id, slot_id: slot.id, ends_at: endsAt });
    if (allocationError) throw allocationError;
    const credentials = await decrypt(account?.encrypted_credentials);
    const secret = await decrypt(slot.encrypted_secret);
    entries.push({ email: credentials.email, password: credentials.password, profile: slot.label, pin: includePin ? secret.pin || secret.code || "" : "", ends_at: endsAt });
  }
  return entries;
}

async function allocateLicenses(db: any, serviceId: string, fulfillmentId: string, qty: number, endsAt: string) {
  const { data: rows, error } = await db.rpc("allocate_inventory_licenses", { p_fulfillment_id: fulfillmentId, p_service_id: serviceId, p_quantity: qty, p_ends_at: endsAt });
  if (error) throw error;
  const entries = [];
  for (const row of rows || []) {
    const secret = await decrypt(row.encrypted_secret);
    entries.push({ code: secret.code || secret.key || secret.license });
  }
  return entries;
}

async function runBackground(db: any, url: string, serviceKey: string, order: any, deliveries: any[], shouldEmail: boolean, finalStatus: string) {
  let email = { status: shouldEmail ? "queued" : "already_sent", error: null as string | null };
  if (shouldEmail) {
    email = await sendEmail(order, deliveries);
    await db.from("fulfillments").update({ email_status: email.status, email_error: email.error }).eq("order_id", order.id).neq("email_status", "sent");
  }
  await db.from("integration_outbox").insert({ event_type: "order_fulfilled", aggregate_id: order.id, payload: { order_id: order.id, fulfillment_status: finalStatus, email_status: email.status } });
  await fetch(`${url}/functions/v1/sync-google-sheet`, { method: "POST", headers: { Authorization: `Bearer ${serviceKey}` } }).catch(() => null);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(JSON.stringify({ ok: true }), { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if ((req.headers.get("authorization") || "") !== `Bearer ${serviceKey}`) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401, headers: cors });
    }

    const { order_id } = await req.json();
    const db = createClient(url, serviceKey);
    const { data: order, error: orderError } = await db.from("orders").select("*").eq("id", order_id).single();
    if (orderError || !order) throw orderError || new Error("Order not found");
    if (!["paid", "completed"].includes(order.status)) return new Response(JSON.stringify({ success: false, error: "Order is not paid" }), { status: 409, headers: cors });

    const { data: renewalRequest } = await db.from("renewal_requests").select("id,status").eq("order_id", order.id).maybeSingle();
    if (renewalRequest) {
      const { data: renewalResult, error: renewalError } = await db.rpc("apply_paid_renewal_order", { p_order_id: order.id });
      if (renewalError) throw renewalError;
      waitUntil(Promise.all([
        sendRenewalEmail(order, renewalResult),
        fetch(`${url}/functions/v1/sync-google-sheet`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ full_refresh: true, refresh_scope: "inventory", include_inventory: true }),
        }).catch(() => null),
      ]));
      return new Response(JSON.stringify({ success: true, status: "delivered", renewal: true, renewal_result: renewalResult }), { headers: cors });
    }

    await db.from("orders").update({ fulfillment_status: "processing", fulfillment_started_at: new Date().toISOString() }).eq("id", order.id);
    const deliveries: any[] = [];
    let hasStockFailure = false;
    let hasPending = false;
    let shouldEmail = false;

    for (let i = 0; i < (order.items || []).length; i++) {
      const item = order.items[i] || {};
      const serviceId = item.id || item.service_id;
      const { data: svc } = await db.from("services").select("id,n,fulfillment_mode,fulfillment_config").eq("id", serviceId).single();
      if (!svc) continue;

      const mode = svc.fulfillment_mode || "manual_delivery";
      const qty = mode === "automatic_slot" || mode === "automatic_account" ? screenCountFor(item) : quantityFor(item);
      const endsAt = endDate(monthsFor(item));
      const productName = firstLabel(svc.n) || item.name || svc.id;
      const { data: existing } = await db.from("fulfillments").select("*").eq("order_id", order.id).eq("order_item_index", i).maybeSingle();

      if (existing?.status === "delivered" && existing.encrypted_delivery) {
        const current = await decrypt(existing.encrypted_delivery);
        if ((current.entries || []).length >= qty) {
          deliveries.push({ ...current, service_id: svc.id });
          if (existing.email_status !== "sent") shouldEmail = true;
          continue;
        }
        await releaseFulfillmentAllocations(db, existing.id);
        await db.from("fulfillments").update({ status: "processing", encrypted_delivery: null, delivered_at: null }).eq("id", existing.id);
      } else if (existing?.status === "awaiting_customer" || existing?.status === "awaiting_admin") {
        hasPending = true;
        if (existing.email_status !== "sent") shouldEmail = true;
        deliveries.push({ service_id: svc.id, mode, product_name: productName, entries: [], message: existing.delivery_summary?.message || deliveryMessage(mode), ends_at: endsAt });
        continue;
      }

      shouldEmail = true;
      const base = { order_id: order.id, order_item_index: i, user_id: order.user_id, service_id: svc.id, mode, quantity: qty, status: "processing" };
      const { data: fulfillment, error: fulfillmentError } = existing
        ? await db.from("fulfillments").update(base).eq("id", existing.id).select().single()
        : await db.from("fulfillments").insert(base).select().single();
      if (fulfillmentError || !fulfillment) throw fulfillmentError || new Error("Could not create fulfillment");
      await releaseFulfillmentAllocations(db, fulfillment.id);

      try {
        const delivery: any = { service_id: svc.id, mode, product_name: productName, entries: [], ends_at: endsAt };
        if (mode === "automatic_slot" || mode === "automatic_account") {
          delivery.entries = await allocateSlots(db, svc.id, fulfillment.id, qty, endsAt, mode === "automatic_slot");
        } else if (mode === "automatic_license") {
          delivery.entries = await allocateLicenses(db, svc.id, fulfillment.id, qty, endsAt);
        } else {
          const status = mode === "manual_activation" ? "awaiting_customer" : "awaiting_admin";
          delivery.message = deliveryMessage(mode);
          hasPending = true;
          await db.from("fulfillments").update({ status, delivery_summary: { mode, product_name: productName, message: delivery.message, ends_at: endsAt } }).eq("id", fulfillment.id);
          deliveries.push(delivery);
          continue;
        }

        if (delivery.entries.length !== qty) throw new Error(`OUT_OF_STOCK: allocated ${delivery.entries.length} of ${qty}`);
        await db.from("fulfillments").update({
          status: "delivered",
          encrypted_delivery: await encrypt(delivery),
          delivery_summary: { mode, product_name: productName, count: delivery.entries.length, requested: qty, ends_at: endsAt },
          delivered_at: new Date().toISOString(),
          email_status: "queued",
        }).eq("id", fulfillment.id);
        deliveries.push(delivery);
      } catch (error: any) {
        const message = String(error?.message || error);
        const outOfStock = message.includes("OUT_OF_STOCK");
        const manualSplit = message.includes("NEEDS_MANUAL_SPLIT");
        hasStockFailure ||= outOfStock;
        hasPending = true;
        await db.from("fulfillments").update({
          status: manualSplit ? "awaiting_admin" : outOfStock ? "out_of_stock" : "failed",
          delivery_summary: {
            mode,
            product_name: productName,
            message: manualSplit ? "المخزون المتاح متفرق على أكثر من حسابين. سيتم تجهيز الطلب يدوياً والتواصل معك." : outOfStock ? "المخزون غير كافٍ لهذا الطلب." : "تعذر التسليم الآلي. يحتاج الطلب لمراجعة الإدارة.",
            requested: qty,
          },
          email_error: message.slice(0, 500),
        }).eq("id", fulfillment.id);
      }
    }

    const finalStatus = hasStockFailure ? "needs_stock" : hasPending ? "partially_delivered" : "delivered";
    await db.from("orders").update({ fulfillment_status: finalStatus, fulfilled_at: finalStatus === "delivered" ? new Date().toISOString() : null }).eq("id", order.id);
    waitUntil(runBackground(db, url, serviceKey, order, deliveries, shouldEmail, finalStatus));

    return new Response(JSON.stringify({ success: true, status: finalStatus, email_status: shouldEmail ? "queued" : "already_sent" }), { headers: cors });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), { status: 500, headers: cors });
  }
});
