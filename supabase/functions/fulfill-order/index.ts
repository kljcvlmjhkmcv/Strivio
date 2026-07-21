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

async function renewFulfillmentClaim(db: any, orderId: string, workerId: string) {
  const { data, error } = await db.rpc("renew_order_fulfillment_claim", {
    p_order_id: orderId,
    p_worker_id: workerId,
    p_lease_seconds: 300,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Fulfillment claim was lost; retry the order safely");
}

async function releaseFulfillmentInventory(
  db: any,
  fulfillmentId: string,
  workerId: string,
  note = "reallocated",
  reservedSlotIds: string[] = [],
  reservedLicenseIds: string[] = [],
) {
  const { data, error } = await db.rpc("release_fulfillment_inventory_atomic", {
    p_fulfillment_id: fulfillmentId,
    p_worker_id: workerId,
    p_note: note,
    p_reserved_slot_ids: [...new Set(reservedSlotIds.filter(Boolean))],
    p_reserved_license_ids: [...new Set(reservedLicenseIds.filter(Boolean))],
  });
  if (error) throw error;
  if (!data?.success) throw new Error("Inventory release was not committed");
  return data;
}

async function rollbackInventoryAllocation(
  db: any,
  fulfillmentId: string,
  workerId: string,
  reservedSlotIds: string[] = [],
  reservedLicenseIds: string[] = [],
) {
  await releaseFulfillmentInventory(
    db,
    fulfillmentId,
    workerId,
    "automatic allocation rolled back",
    reservedSlotIds,
    reservedLicenseIds,
  );
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

async function allocateSlots(
  db: any,
  serviceId: string,
  fulfillmentId: string,
  qty: number,
  endsAt: string,
  includePin: boolean,
  workerId: string,
  renewLease: () => Promise<void>,
  credentialRetry = 0,
) {
  // Never run stale-slot cleanup inside the allocation hot path. A different
  // worker may have reserved a slot and not inserted its allocation yet.
  await renewLease();
  const { data: accounts, error: accountsError } = await db
    .from("inventory_accounts")
    .select("id,label,encrypted_credentials,credentials_version,created_at")
    .eq("service_id", serviceId)
    .eq("pool_kind", "standard")
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
  const { data: activeAllocations, error: activeAllocationsError } = slotIds.length
    ? await db.from("fulfillment_allocations").select("slot_id").in("slot_id", slotIds).eq("status", "active")
    : { data: [], error: null };
  if (activeAllocationsError) throw activeAllocationsError;
  const activeSlotIds = new Set((activeAllocations || []).map((a: any) => a.slot_id));
  const freeSlots = (slots || []).filter((s: any) => !activeSlotIds.has(s.id));
  const selected = chooseStrictSlots(orderedAccounts, freeSlots, qty);

  const entries: any[] = [];
  const reservedSlotIds: string[] = [];
  try {
    for (const slot of selected) {
      await renewLease();
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
      reservedSlotIds.push(slot.id);
      const { data: allocation, error: allocationError } = await db.from("fulfillment_allocations")
        .insert({ fulfillment_id: fulfillmentId, account_id: slot.account_id, slot_id: slot.id, ends_at: endsAt })
        .select("id")
        .single();
      if (allocationError || !allocation) throw allocationError || new Error("Could not record subscription allocation");
      const credentials = await decrypt(account?.encrypted_credentials);
      const secret = await decrypt(slot.encrypted_secret);
      entries.push({
        email: credentials.email,
        password: credentials.password,
        profile: slot.label,
        pin: includePin ? secret.pin || secret.code || "" : "",
        ends_at: endsAt,
        account_id: slot.account_id,
        slot_id: slot.id,
        allocation_id: allocation.id,
      });
    }

    // A credential rotation can race with fulfillment after the first account
    // read. Recheck the exact value and version before publishing delivery;
    // any mismatch rolls all reservations back for a clean retry.
    await renewLease();
    const selectedAccountIds = [...new Set(
      selected.map((slot: any) => String(slot.account_id)).filter(Boolean),
    )];
    if (selectedAccountIds.length) {
      const { data: latestAccounts, error: latestAccountsError } = await db
        .from("inventory_accounts")
        .select("id,encrypted_credentials,credentials_version")
        .in("id", selectedAccountIds);
      if (latestAccountsError) throw latestAccountsError;
      const latestById = new Map(
        (latestAccounts || []).map((latest: any) => [String(latest.id), latest]),
      );
      for (const accountId of selectedAccountIds) {
        const original = orderedAccounts.find((value: any) => String(value.id) === accountId);
        const latest: any = latestById.get(accountId);
        if (
          !original ||
          !latest ||
          String(original.encrypted_credentials || "") !== String(latest.encrypted_credentials || "") ||
          Number(original.credentials_version || 0) !== Number(latest.credentials_version || 0)
        ) {
          throw new Error("INVENTORY_CREDENTIALS_CHANGED");
        }
      }
    }
  } catch (error: any) {
    const failure: any = error && typeof error === "object" ? error : new Error(String(error));
    try {
      await rollbackInventoryAllocation(db, fulfillmentId, workerId, reservedSlotIds);
    } catch (cleanupError: any) {
      failure.allocationCleanupError = String(cleanupError?.message || cleanupError);
    }
    failure.reservedSlotIds = reservedSlotIds;
    if (
      String(failure.message || "").includes("INVENTORY_CREDENTIALS_CHANGED") &&
      !failure.allocationCleanupError &&
      credentialRetry < 1
    ) {
      return await allocateSlots(
        db,
        serviceId,
        fulfillmentId,
        qty,
        endsAt,
        includePin,
        workerId,
        renewLease,
        credentialRetry + 1,
      );
    }
    throw failure;
  }
  return entries;
}

async function allocateSharedPromotionSlots(
  db: any,
  serviceId: string,
  fulfillmentId: string,
  benefitId: string,
  qty: number,
  endsAt: string,
  workerId: string,
  renewLease: () => Promise<void>,
  credentialRetry = 0,
) {
  await renewLease();
  const { data: rows, error } = await db.rpc("allocate_shared_promotion_slots_atomic", {
    p_fulfillment_id: fulfillmentId,
    p_benefit_id: benefitId,
    p_service_id: serviceId,
    p_quantity: qty,
    p_ends_at: endsAt,
    p_worker_id: workerId,
  });
  if (error) throw error;
  if ((rows || []).length !== qty) throw new Error("OUT_OF_STOCK");

  // Credential rotation may start immediately after the allocation transaction
  // commits. Recheck the exact encrypted value/version before publishing it to
  // the customer; an idempotent retry returns the same shared allocation with
  // the newest credentials.
  const accountIds = [...new Set((rows || []).map((row: any) => String(row.account_id || "")).filter(Boolean))];
  if (accountIds.length) {
    const { data: latestAccounts, error: latestError } = await db
      .from("inventory_accounts")
      .select("id,encrypted_credentials,credentials_version")
      .in("id", accountIds);
    if (latestError) throw latestError;
    const latestById = new Map((latestAccounts || []).map((row: any) => [String(row.id), row]));
    const changed = (rows || []).some((row: any) => {
      const latest: any = latestById.get(String(row.account_id));
      return !latest ||
        String(latest.encrypted_credentials || "") !== String(row.encrypted_credentials || "") ||
        Number(latest.credentials_version || 0) !== Number(row.credentials_version || 0);
    });
    if (changed) {
      if (credentialRetry >= 1) throw new Error("INVENTORY_CREDENTIALS_CHANGED");
      return allocateSharedPromotionSlots(
        db,
        serviceId,
        fulfillmentId,
        benefitId,
        qty,
        endsAt,
        workerId,
        renewLease,
        credentialRetry + 1,
      );
    }
  }

  const entries = [];
  for (const row of rows || []) {
    const credentials = await decrypt(row.encrypted_credentials);
    const secret = await decrypt(row.encrypted_secret);
    entries.push({
      email: credentials.email,
      password: credentials.password,
      profile: row.slot_label || "Prime profile",
      pin: secret?.pin || secret?.code || "",
      ends_at: row.ends_at || endsAt,
      account_id: row.account_id,
      slot_id: row.slot_id,
      allocation_id: row.allocation_id,
      shared_allocation_id: row.allocation_id,
      allocation_kind: "shared_promotion",
      included_free: true,
    });
  }
  return entries;
}

async function allocateLicenses(
  db: any,
  serviceId: string,
  fulfillmentId: string,
  qty: number,
  endsAt: string,
  workerId: string,
) {
  const { data: rows, error } = await db.rpc("allocate_fulfillment_licenses_atomic", {
    p_fulfillment_id: fulfillmentId,
    p_service_id: serviceId,
    p_quantity: qty,
    p_ends_at: endsAt,
    p_worker_id: workerId,
  });
  if (error) throw error;
  const entries = [];
  for (const row of rows || []) {
    const secret = await decrypt(row.encrypted_secret);
    entries.push({
      code: secret.code || secret.key || secret.license,
      allocation_id: row.allocation_id,
      license_id: row.license_id,
      ends_at: endsAt,
    });
  }
  return entries;
}

type CustomerNotification = {
  eventType: string;
  templateKey: string;
  orderId: string;
  serviceId?: string | null;
  fulfillmentId?: string | null;
  actionUrl: string;
  title: Record<string, string>;
  body: Record<string, string>;
  data: Record<string, unknown>;
  dedupeKey: string;
};

async function enqueueCustomerNotification(db: any, input: CustomerNotification) {
  const { data: eventId, error } = await db.rpc("enqueue_customer_notification", {
    p_event_type: input.eventType,
    p_order_id: input.orderId,
    p_template_key: input.templateKey,
    p_title_i18n: input.title,
    p_body_i18n: input.body,
    p_fulfillment_id: input.fulfillmentId || null,
    p_problem_id: null,
    p_service_id: input.serviceId || null,
    p_action_url: input.actionUrl,
    p_data: input.data,
    p_send_email: true,
    p_dedupe_key: input.dedupeKey,
  });
  if (error) throw error;
  if (!eventId) throw new Error("Notification event was not persisted");

  const { data: ownDelivery, error: deliveryError } = await db.from("notification_deliveries")
    .select("status,last_error")
    .eq("event_id", eventId)
    .eq("channel", "email")
    .maybeSingle();
  if (deliveryError) throw deliveryError;
  if (!ownDelivery) {
    // Orders without an email still retain their in-site notification event.
    return { status: "skipped", error: null as string | null, event_id: eventId };
  }
  const ownStatus = String(ownDelivery.status || "pending").toLowerCase();
  return {
    status: ["pending", "processing"].includes(ownStatus) ? "queued" : ownStatus,
    error: ownDelivery.last_error ? String(ownDelivery.last_error).slice(0, 500) : null,
    event_id: eventId,
  };
}

function fulfillmentNotification(
  orderId: string,
  finalStatus: string,
  fulfillment?: { id: string; service_id?: string | null } | null,
): CustomerNotification {
  const actionUrl = `/my-account?order=${encodeURIComponent(orderId)}`;
  if (fulfillment || finalStatus === "delivered") {
    return {
      eventType: fulfillment ? "fulfillment.delivered" : "order.delivered",
      templateKey: "order_delivered",
      orderId,
      serviceId: fulfillment?.service_id || null,
      fulfillmentId: fulfillment?.id || null,
      actionUrl,
      title: { ar: "تم تسليم طلبك", fr: "Votre commande a été livrée", en: "Your order has been delivered" },
      body: {
        ar: "تم تسليم طلبك بنجاح. افتح حسابك للاطلاع على التفاصيل والتعليمات.",
        fr: "Votre commande a été livrée. Ouvrez votre compte pour consulter les détails et les instructions.",
        en: "Your order has been delivered. Open your account to view the details and instructions.",
      },
      data: { fulfillment_status: fulfillment ? "delivered" : finalStatus },
      dedupeKey: fulfillment
        ? `fulfillment-delivered:${fulfillment.id}`
        : `order-fulfillment:${orderId}:order.delivered`,
    };
  }
  if (finalStatus === "needs_stock") {
    return {
      eventType: "order.delayed",
      templateKey: "order_delayed",
      orderId,
      actionUrl,
      title: { ar: "طلبك يحتاج إلى مراجعة", fr: "Votre commande nécessite une vérification", en: "Your order needs attention" },
      body: {
        ar: "يحتاج طلبك إلى مراجعة المخزون أو فريق Strivio. سنحدّث حالته فور تجهيزه.",
        fr: "Votre commande nécessite une vérification du stock ou de l’équipe Strivio. Son statut sera mis à jour dès qu’elle sera prête.",
        en: "Your order needs a stock or Strivio team review. We will update its status as soon as it is ready.",
      },
      data: { fulfillment_status: finalStatus },
      dedupeKey: `order-fulfillment:${orderId}:order.delayed`,
    };
  }
  return {
    eventType: "order.processing",
    templateKey: "order_processing",
    orderId,
    actionUrl,
    title: { ar: "طلبك قيد التجهيز", fr: "Votre commande est en cours de préparation", en: "Your order is being prepared" },
    body: {
      ar: "تم تأكيد الدفع، وبعض خدمات الطلب تحتاج إلى بيانات الحساب أو إجراء من فريق Strivio.",
      fr: "Le paiement est confirmé. Certains services nécessitent les informations du compte ou une intervention de l’équipe Strivio.",
      en: "Payment is confirmed. Some services need account details or action from the Strivio team.",
    },
    data: { fulfillment_status: finalStatus },
    dedupeKey: `order-fulfillment:${orderId}:order.processing`,
  };
}

async function persistFulfillmentSideEffects(db: any, order: any, shouldNotify: boolean, finalStatus: string) {
  // Persist the Sheet projection before returning success. The HTTP call that
  // wakes the Sheet worker is optional; the serialized outbox is authoritative.
  const outboxResult = await db.from("integration_outbox").insert({
    event_type: "order_fulfilled",
    aggregate_id: order.id,
    payload: {
      order_id: order.id,
      fulfillment_status: finalStatus,
      email_status: "pending",
      source: "fulfill_order",
    },
  });
  if (outboxResult.error) throw outboxResult.error;

  const { data: fulfillmentRows, error: fulfillmentRowsError } = await db
    .from("fulfillments")
    .select("id,service_id,status,email_status")
    .eq("order_id", order.id)
    .order("order_item_index");
  if (fulfillmentRowsError) throw fulfillmentRowsError;

  const rows = fulfillmentRows || [];
  const emailIsFinal = (value: unknown) =>
    ["sent", "delivered", "suppressed", "dead", "cancelled", "skipped"]
      .includes(String(value || "").toLowerCase());
  const deliveredRows = rows.filter((row: any) =>
    ["delivered", "completed"].includes(String(row.status || "").toLowerCase()) &&
    !emailIsFinal(row.email_status)
  );
  const pendingRows = rows.filter((row: any) =>
    !["delivered", "completed"].includes(String(row.status || "").toLowerCase()) &&
    !emailIsFinal(row.email_status)
  );
  const outcomes: Array<{ status: string; error: string | null }> = [];

  // A fully delivered bundle is one customer experience. Queue one order-level
  // event so the email renderer receives both Netflix and the free Prime
  // delivery entries instead of sending one email per fulfillment.
  if (finalStatus === "delivered" && deliveredRows.length) {
    const outcome = await enqueueCustomerNotification(
      db,
      fulfillmentNotification(order.id, "delivered"),
    );
    outcomes.push(outcome);
    const updateResult = await db.from("fulfillments").update({
      email_status: outcome.status,
      email_error: outcome.error,
    }).in("id", deliveredRows.map((row: any) => row.id));
    if (updateResult.error) throw updateResult.error;
  } else {
    for (const fulfillment of deliveredRows) {
      const outcome = await enqueueCustomerNotification(
        db,
        fulfillmentNotification(order.id, "delivered", fulfillment),
      );
      outcomes.push(outcome);
      const updateResult = await db.from("fulfillments").update({
        email_status: outcome.status,
        email_error: outcome.error,
      }).eq("id", fulfillment.id);
      if (updateResult.error) throw updateResult.error;
    }
  }

  if (finalStatus !== "delivered" && pendingRows.length && shouldNotify) {
    const outcome = await enqueueCustomerNotification(
      db,
      fulfillmentNotification(order.id, finalStatus),
    );
    outcomes.push(outcome);
    const updateResult = await db.from("fulfillments").update({
      email_status: outcome.status,
      email_error: outcome.error,
    }).in("id", pendingRows.map((row: any) => row.id));
    if (updateResult.error) throw updateResult.error;
  }

  // Keep a fallback for unusual paid orders that contain no service row.
  if (!rows.length && shouldNotify) {
    outcomes.push(await enqueueCustomerNotification(db, fulfillmentNotification(order.id, finalStatus)));
  }

  return outcomes.find((item) => item.status === "failed") ||
    outcomes.find((item) => item.status === "queued") ||
    outcomes.find((item) => item.status === "sent") ||
    { status: "already_sent", error: null };
}

async function wakeDeliveryWorkers(url: string, serviceKey: string, syncBody: Record<string, unknown> = {}) {
  const headers = { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const calls = [
    fetch(`${url}/functions/v1/dispatch-notifications`, {
      method: "POST",
      headers,
      body: JSON.stringify({ limit: 10, channels: ["email"] }),
    }),
    fetch(`${url}/functions/v1/sync-google-sheet`, {
      method: "POST",
      headers,
      body: JSON.stringify(syncBody),
    }),
  ];
  await Promise.allSettled(calls.map(async (request) => {
    const response = await request;
    await response.text().catch(() => "");
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(JSON.stringify({ ok: true }), { headers: cors });
  let db: any = null;
  let claimedOrderId: string | null = null;
  const workerId = `fulfill-order:${crypto.randomUUID()}`;
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if ((req.headers.get("authorization") || "") !== `Bearer ${serviceKey}`) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401, headers: cors });
    }

    const { order_id } = await req.json();
    db = createClient(url, serviceKey);
    const { data: order, error: orderError } = await db.from("orders").select("*").eq("id", order_id).single();
    if (orderError || !order) throw orderError || new Error("Order not found");
    if (!["paid", "completed"].includes(order.status)) return new Response(JSON.stringify({ success: false, error: "Order is not paid" }), { status: 409, headers: cors });

    const { data: claimed, error: claimError } = await db.rpc("claim_order_fulfillment", {
      p_order_id: order.id,
      p_worker_id: workerId,
      p_lease_seconds: 300,
    });
    if (claimError) throw claimError;
    if (!claimed) {
      return new Response(JSON.stringify({
        success: true,
        status: "processing",
        claimed: false,
        retryable: true,
      }), { status: 202, headers: { ...cors, "Retry-After": "2" } });
    }
    claimedOrderId = order.id;
    const renewLease = () => renewFulfillmentClaim(db, order.id, workerId);

    const { data: renewalRequest, error: renewalRequestError } = await db.from("renewal_requests").select("id,status,metadata,months,service_id").eq("order_id", order.id).maybeSingle();
    if (renewalRequestError) throw renewalRequestError;
    if (renewalRequest) {
      await renewLease();
      const { data: renewalResult, error: renewalError } = await db.rpc("apply_paid_renewal_order", { p_order_id: order.id });
      if (renewalError) throw renewalError;
      const sourceOrderId = renewalRequest.metadata?.source_order_id || order.id;
      const effectiveEnd = renewalResult?.new_ends_at || renewalResult?.updates?.[0]?.ends_at || null;
      const renewalActionKind = String(order.customer_info?.renewal_action_kind || "").toLowerCase() === "extension"
        ? "extension"
        : "renewal";
      const renewalNotification = await enqueueCustomerNotification(db, {
        eventType: renewalActionKind === "extension" ? "subscription.extended" : "subscription.renewed",
        templateKey: renewalActionKind === "extension" ? "subscription_extended" : "subscription_renewed",
        orderId: order.id,
        serviceId: renewalRequest.service_id,
        actionUrl: `/my-account?order=${encodeURIComponent(sourceOrderId)}`,
        title: renewalActionKind === "extension"
          ? { ar: "تم تمديد اشتراكك", fr: "Votre abonnement a été prolongé", en: "Your subscription has been extended" }
          : { ar: "تم تجديد اشتراكك", fr: "Votre abonnement a été renouvelé", en: "Your subscription has been renewed" },
        body: {
          ar: "تم تأكيد الدفع وتمديد نفس الاشتراك بنجاح. يمكنك الاطلاع على تاريخ الانتهاء المحدّث من حسابك.",
          fr: "Le paiement est confirmé et le même abonnement a été prolongé. Consultez la nouvelle date d’expiration dans votre compte.",
          en: "Payment is confirmed and the same subscription has been extended. View the updated expiry date in your account.",
        },
        data: {
          months: renewalRequest.months || renewalResult?.months || null,
          ends_at: effectiveEnd,
          source_order_id: sourceOrderId,
          action_kind: renewalActionKind,
        },
        dedupeKey: `subscription-renewed:${order.id}`,
      });
      waitUntil(wakeDeliveryWorkers(url, serviceKey, {
        full_refresh: true,
        refresh_scope: "inventory",
        include_inventory: true,
      }));
      return new Response(JSON.stringify({
        success: true,
        status: "delivered",
        renewal: true,
        renewal_result: renewalResult,
        email_status: renewalNotification.status,
      }), { headers: cors });
    }

    const { data: processingOrder, error: processingOrderError } = await db.from("orders")
      .update({ fulfillment_status: "processing", fulfillment_started_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("fulfillment_worker_id", workerId)
      .select("id")
      .maybeSingle();
    if (processingOrderError || !processingOrder) {
      throw processingOrderError || new Error("Fulfillment claim was lost before processing");
    }
    let hasStockFailure = false;
    let hasPending = false;
    let shouldNotify = false;

    for (let i = 0; i < (order.items || []).length; i++) {
      await renewLease();
      const item = order.items[i] || {};
      const serviceId = item.id || item.service_id;
      const { data: svc, error: serviceError } = await db.from("services").select("id,n,fulfillment_mode,fulfillment_config").eq("id", serviceId).single();
      if (serviceError || !svc) {
        throw serviceError || new Error(`Service not found for order item ${i}`);
      }

      const isPromotionGift = item?.is_promotional_gift === true && item?.included_free === true;
      const mode = isPromotionGift && item?.fulfillment_mode_override === "automatic_shared_slot"
        ? "automatic_shared_slot"
        : svc.fulfillment_mode || "manual_delivery";
      const qty = mode === "automatic_slot" || mode === "automatic_account" ? screenCountFor(item) : quantityFor(item);
      let endsAt = endDate(monthsFor(item));
      const productName = firstLabel(svc.n) || item.name || svc.id;
      let benefit: any = null;
      let promotionSourceReady = true;
      if (isPromotionGift) {
        const { data: benefitRow, error: benefitError } = await db.from("order_benefits")
          .select("id,status,quantity,duration_months,allocation_policy,metadata")
          .eq("order_id", order.id)
          .eq("gift_item_index", i)
          .eq("gift_service_id", svc.id)
          .maybeSingle();
        if (benefitError) throw benefitError;
        if (!benefitRow) throw new Error(`Promotion benefit not found for order item ${i}`);
        benefit = benefitRow;
        const sourceItemIndex = Number(item.bundle_source_item_index);
        if (Number.isInteger(sourceItemIndex) && sourceItemIndex >= 0 && sourceItemIndex < i) {
          const { data: sourceFulfillment, error: sourceFulfillmentError } = await db.from("fulfillments")
            .select("status,delivery_summary")
            .eq("order_id", order.id)
            .eq("order_item_index", sourceItemIndex)
            .maybeSingle();
          if (sourceFulfillmentError) throw sourceFulfillmentError;
          promotionSourceReady = ["delivered", "completed"].includes(
            String(sourceFulfillment?.status || "").toLowerCase(),
          );
          const sourceEnd = String(sourceFulfillment?.delivery_summary?.ends_at || "");
          if (sourceEnd && Number.isFinite(new Date(sourceEnd).getTime())) endsAt = sourceEnd;
        } else {
          // A server-created benefit must always point at an earlier paid item.
          // Failing closed prevents an orphaned gift from being delivered.
          promotionSourceReady = false;
        }
      }
      const { data: existing, error: existingError } = await db.from("fulfillments")
        .select("*")
        .eq("order_id", order.id)
        .eq("order_item_index", i)
        .maybeSingle();
      if (existingError) throw existingError;
      const existingStatus = String(existing?.status || "").toLowerCase();
      const isTerminal = existingStatus === "delivered" || existingStatus === "completed";
      const isManual = !["automatic_slot", "automatic_account", "automatic_license", "automatic_shared_slot"].includes(mode);

      // A completed manual activation/delivery is authoritative. Re-running this
      // function must never reopen it as awaiting_customer/awaiting_admin.
      if (existing && isTerminal && isManual) {
        continue;
      }

      if (existing && isTerminal && existing.encrypted_delivery) {
        const current = await decrypt(existing.encrypted_delivery);
        if ((current.entries || []).length >= qty) {
          if (benefit && benefit.status !== "delivered") {
            const { error: benefitRepairError } = await db.from("order_benefits").update({
              status: "delivered",
              fulfillment_id: existing.id,
              updated_at: new Date().toISOString(),
            }).eq("id", benefit.id);
            if (benefitRepairError) throw benefitRepairError;
          }
          if (!["sent", "delivered", "suppressed", "dead", "cancelled", "skipped"].includes(String(existing.email_status || "").toLowerCase())) shouldNotify = true;
          continue;
        }
        await renewLease();
        await releaseFulfillmentInventory(db, existing.id, workerId, "reallocated after quantity change");
        const { error: resetError } = await db.from("fulfillments")
          .update({ status: "processing", encrypted_delivery: null, delivered_at: null })
          .eq("id", existing.id);
        if (resetError) throw resetError;
      } else if (existing?.status === "awaiting_customer" || existing?.status === "awaiting_admin") {
        hasPending = true;
        if (!["sent", "delivered", "suppressed", "dead", "cancelled", "skipped"].includes(String(existing.email_status || "").toLowerCase())) shouldNotify = true;
        continue;
      }

      shouldNotify = true;
      const base = { order_id: order.id, order_item_index: i, user_id: order.user_id, service_id: svc.id, mode, quantity: qty, status: "processing" };
      const { data: fulfillment, error: fulfillmentError } = existing
        ? await db.from("fulfillments").update(base).eq("id", existing.id).select().single()
        : await db.from("fulfillments").insert(base).select().single();
      if (fulfillmentError || !fulfillment) throw fulfillmentError || new Error("Could not create fulfillment");
      if (benefit) {
        const { error: benefitProcessingError } = await db.from("order_benefits").update({
          status: "processing",
          fulfillment_id: fulfillment.id,
          updated_at: new Date().toISOString(),
        }).eq("id", benefit.id);
        if (benefitProcessingError) throw benefitProcessingError;
      }
      await renewLease();
      await releaseFulfillmentInventory(db, fulfillment.id, workerId, "reallocated before fulfillment retry");

      try {
        const delivery: any = { service_id: svc.id, mode, product_name: productName, entries: [], ends_at: endsAt };
        if (isPromotionGift && !promotionSourceReady) {
          throw new Error("OUT_OF_STOCK: paid bundle item is not delivered yet");
        }
        if (mode === "automatic_slot" || mode === "automatic_account") {
          delivery.entries = await allocateSlots(
            db,
            svc.id,
            fulfillment.id,
            qty,
            endsAt,
            mode === "automatic_slot",
            workerId,
            renewLease,
          );
        } else if (mode === "automatic_shared_slot") {
          delivery.included_free = true;
          delivery.promotion = {
            benefit_id: benefit.id,
            source_item_index: Number(item.bundle_source_item_index || 0),
            label_i18n: item.bundle_label_i18n || {},
          };
          delivery.entries = await allocateSharedPromotionSlots(
            db,
            svc.id,
            fulfillment.id,
            benefit.id,
            qty,
            endsAt,
            workerId,
            renewLease,
          );
        } else if (mode === "automatic_license") {
          await renewLease();
          delivery.entries = await allocateLicenses(db, svc.id, fulfillment.id, qty, endsAt, workerId);
        } else {
          const status = mode === "manual_activation" ? "awaiting_customer" : "awaiting_admin";
          delivery.message = deliveryMessage(mode);
          hasPending = true;
          await renewLease();
          const { error: manualUpdateError } = await db.from("fulfillments")
            .update({ status, delivery_summary: { mode, product_name: productName, message: delivery.message, ends_at: endsAt } })
            .eq("id", fulfillment.id);
          if (manualUpdateError) throw manualUpdateError;
          continue;
        }

        if (delivery.entries.length !== qty) throw new Error(`OUT_OF_STOCK: allocated ${delivery.entries.length} of ${qty}`);
        const encryptedDelivery = await encrypt(delivery);
        await renewLease();
        const { error: deliveryUpdateError } = await db.from("fulfillments").update({
          status: "delivered",
          encrypted_delivery: encryptedDelivery,
          delivery_summary: { mode, product_name: productName, count: delivery.entries.length, requested: qty, ends_at: endsAt },
          delivered_at: new Date().toISOString(),
          // The notification queue is persisted synchronously below. Keep this
          // recoverable until that commit succeeds.
          email_status: "pending",
        }).eq("id", fulfillment.id);
        if (deliveryUpdateError) throw deliveryUpdateError;
        if (benefit) {
          const { data: latestBenefit, error: latestBenefitError } = await db.from("order_benefits")
            .select("metadata")
            .eq("id", benefit.id)
            .single();
          if (latestBenefitError) throw latestBenefitError;
          const { error: benefitDeliveryError } = await db.from("order_benefits").update({
            status: "delivered",
            fulfillment_id: fulfillment.id,
            updated_at: new Date().toISOString(),
            metadata: {
              ...(latestBenefit?.metadata || benefit.metadata || {}),
              delivered_at: new Date().toISOString(),
              allocated_count: delivery.entries.length,
            },
          }).eq("id", benefit.id);
          if (benefitDeliveryError) throw benefitDeliveryError;
        }
      } catch (error: any) {
        let cleanupError = String(error?.allocationCleanupError || "");
        if (["automatic_slot", "automatic_account", "automatic_license"].includes(mode)) {
          try {
            await rollbackInventoryAllocation(
              db,
              fulfillment.id,
              workerId,
              Array.isArray(error?.reservedSlotIds) ? error.reservedSlotIds : [],
              Array.isArray(error?.reservedLicenseIds) ? error.reservedLicenseIds : [],
            );
          } catch (rollbackError: any) {
            cleanupError = [cleanupError, String(rollbackError?.message || rollbackError)].filter(Boolean).join("; ");
          }
        }
        const originalMessage = String(error?.message || error);
        const message = cleanupError ? `${originalMessage}; ${cleanupError}` : originalMessage;
        const outOfStock = message.includes("OUT_OF_STOCK");
        const manualSplit = message.includes("NEEDS_MANUAL_SPLIT");
        // A free bonus can wait for stock without downgrading the paid Netflix
        // delivery to needs_stock. The order becomes partially delivered and
        // the benefit remains retryable.
        hasStockFailure ||= outOfStock && !isPromotionGift;
        hasPending = true;
        await renewLease();
        const { error: failureUpdateError } = await db.from("fulfillments").update({
          status: manualSplit ? "awaiting_admin" : outOfStock ? "out_of_stock" : "failed",
          delivery_summary: {
            mode,
            product_name: productName,
            message: manualSplit ? "المخزون المتاح متفرق على أكثر من حسابين. سيتم تجهيز الطلب يدوياً والتواصل معك." : outOfStock ? "المخزون غير كافٍ لهذا الطلب." : "تعذر التسليم الآلي. يحتاج الطلب لمراجعة الإدارة.",
            requested: qty,
          },
          email_error: message.slice(0, 500),
        }).eq("id", fulfillment.id);
        if (failureUpdateError) throw failureUpdateError;
        if (benefit) {
          const { data: latestFailureBenefit, error: latestFailureBenefitError } = await db.from("order_benefits")
            .select("metadata")
            .eq("id", benefit.id)
            .single();
          if (latestFailureBenefitError) throw latestFailureBenefitError;
          const { error: benefitFailureError } = await db.from("order_benefits").update({
            status: outOfStock ? "awaiting_stock" : "failed",
            fulfillment_id: fulfillment.id,
            updated_at: new Date().toISOString(),
            metadata: {
              ...(latestFailureBenefit?.metadata || benefit.metadata || {}),
              last_error: message.slice(0, 500),
              last_attempt_at: new Date().toISOString(),
            },
          }).eq("id", benefit.id);
          if (benefitFailureError) throw benefitFailureError;
        }
      }
    }

    const finalStatus = hasStockFailure ? "needs_stock" : hasPending ? "partially_delivered" : "delivered";
    await renewLease();
    const { data: finalizedOrder, error: finalizedOrderError } = await db.from("orders")
      .update({ fulfillment_status: finalStatus, fulfilled_at: finalStatus === "delivered" ? new Date().toISOString() : null })
      .eq("id", order.id)
      .eq("fulfillment_worker_id", workerId)
      .select("id")
      .maybeSingle();
    if (finalizedOrderError || !finalizedOrder) {
      throw finalizedOrderError || new Error("Fulfillment claim was lost before finalizing the order");
    }
    const notification = await persistFulfillmentSideEffects(db, order, shouldNotify, finalStatus);
    waitUntil(wakeDeliveryWorkers(url, serviceKey));

    return new Response(JSON.stringify({ success: true, status: finalStatus, email_status: notification.status }), { headers: cors });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), { status: 500, headers: cors });
  } finally {
    if (db && claimedOrderId) {
      try {
        const { data: released, error: releaseError } = await db.rpc("release_order_fulfillment_claim", {
          p_order_id: claimedOrderId,
          p_worker_id: workerId,
        });
        if (releaseError || !released) {
          console.error("Could not release order fulfillment claim", releaseError || "claim no longer owned");
        }
      } catch (releaseError) {
        // The database lease expires automatically, so a network error here
        // must not replace the actual fulfillment response.
        console.error("Could not release order fulfillment claim", releaseError);
      }
    }
  }
});
