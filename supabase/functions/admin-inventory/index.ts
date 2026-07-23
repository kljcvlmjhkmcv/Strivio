import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
const dec = new TextDecoder();
function unb64(v: string) {
  return Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
}
const cors = {
  "Access-Control-Allow-Origin": "https://www.striviodz.store",
  Vary: "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const enc = new TextEncoder();
function b64(b: Uint8Array) {
  return btoa(String.fromCharCode(...b));
}
async function encrypt(v: unknown) {
  const raw = Deno.env.get("FULFILLMENT_ENCRYPTION_KEY") || "";
  if (raw.length < 32) throw new Error("FULFILLMENT_ENCRYPTION_KEY is missing");
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(v)),
  );
  return `v1.${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}
async function syncInventory(
  db: any,
  url: string,
  service: string,
  id: string,
  serviceId?: string,
) {
  const { error } = await db
    .from("integration_outbox")
    .insert({
      event_type: "inventory_changed",
      aggregate_id: String(id),
      payload: { inventory: true, service_id: serviceId || null },
    });
  if (error) return { ok: false, error: error.message || String(error) };
  const request = fetch(`${url}/functions/v1/sync-google-sheet`, {
    method: "POST",
    headers: { Authorization: `Bearer ${service}` },
  }).catch(() => null);
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(request);
  return { ok: true };
}
async function syncInventoryNow(
  _db: any,
  url: string,
  service: string,
  _id: string,
  scope = "all_light",
) {
  const includeInventory = ["inventory", "all", "all_light"].includes(scope);
  // sync-google-sheet persists the requested refresh in the serialized
  // outbox itself. A 202 response therefore means safely queued, not lost.
  const response = await fetch(`${url}/functions/v1/sync-google-sheet`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      full_refresh: true,
      refresh_scope: scope,
      include_inventory: includeInventory,
      limit: 12,
      source: "admin_manual_refresh",
    }),
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok)
    throw new Error(data?.error || text || "Google Sheet sync failed");
  return { ...data, http_status: response.status };
}
function dispatchNotifications(url: string, service: string) {
  const request = fetch(`${url}/functions/v1/dispatch-notifications`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ limit: 10, channels: ["email"] }),
  }).catch(() => null);
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(request);
}
async function decrypt(v?: string | null) {
  if (!v) return {};
  const raw = Deno.env.get("FULFILLMENT_ENCRYPTION_KEY") || "";
  if (raw.length < 32) throw new Error("FULFILLMENT_ENCRYPTION_KEY is missing");
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  const key = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "decrypt",
  ]);
  const p = v.split(".");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(p[1]) },
    key,
    unb64(p[2]),
  );
  return JSON.parse(dec.decode(plain));
}
function profileNo(label: any) {
  const match = String(label || "").match(/\d+/);
  return match ? Number(match[0]) : 9999;
}
function sortSlots(a: any, b: any) {
  return (
    String(a.account_id || "").localeCompare(String(b.account_id || "")) ||
    profileNo(a.label) - profileNo(b.label) ||
    String(a.label || "").localeCompare(String(b.label || "")) ||
    String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
    String(a.id || "").localeCompare(String(b.id || ""))
  );
}
function plainObject(value: any) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function jsonArray(value: any) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
function jsonObject(value: any) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }
  return {};
}
function cleanDate(value: any, field: string) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is invalid`);
  return parsed.toISOString();
}
async function validateBundleRule(db: any, rawValue: any) {
  const raw = plainObject(rawValue);
  const sourceServiceId = String(raw.source_service_id || "").trim();
  const giftServiceId = String(raw.gift_service_id || "").trim();
  const sourceDurationIdx = Number(raw.source_duration_idx);
  const sourceTypeIdx = raw.source_type_idx === null ||
      raw.source_type_idx === undefined || raw.source_type_idx === ""
    ? null
    : Number(raw.source_type_idx);
  const giftDurationStrategy = raw.gift_duration_strategy === "fixed"
    ? "fixed"
    : "same";
  const giftDurationIdx = giftDurationStrategy === "fixed"
    ? Number(raw.gift_duration_idx)
    : null;
  const giftQuantity = Number(raw.gift_quantity);
  const quantityMode = ["fixed", "per_unit"].includes(
      String(raw.quantity_mode),
    )
    ? String(raw.quantity_mode)
    : "";
  const allocationPolicy = ["shared_reusable", "exclusive"].includes(
      String(raw.allocation_policy),
    )
    ? String(raw.allocation_policy)
    : "";
  const priority = Number(raw.priority);
  const startsAt = cleanDate(raw.starts_at, "Promotion start date");
  const endsAt = cleanDate(raw.ends_at, "Promotion end date");
  const labels = plainObject(raw.label_i18n);

  if (!sourceServiceId || !giftServiceId)
    throw new Error("Source service and free service are required");
  if (sourceServiceId === giftServiceId)
    throw new Error("The paid service and free service must be different");
  if (
    !Number.isInteger(sourceDurationIdx) ||
    sourceDurationIdx < 0 ||
    sourceDurationIdx > 4
  )
    throw new Error("Source duration must be one of 1, 2, 3, 6 or 12 months");
  if (
    sourceTypeIdx !== null &&
    (!Number.isInteger(sourceTypeIdx) || sourceTypeIdx < 0 || sourceTypeIdx > 19)
  )
    throw new Error("Source package is invalid");
  if (
    giftDurationStrategy === "fixed" &&
    (!Number.isInteger(giftDurationIdx) ||
      Number(giftDurationIdx) < 0 ||
      Number(giftDurationIdx) > 4)
  )
    throw new Error("Gift duration must be one of 1, 2, 3, 6 or 12 months");
  if (!Number.isInteger(giftQuantity) || giftQuantity < 1 || giftQuantity > 20)
    throw new Error("Gift quantity must be between 1 and 20");
  if (!quantityMode) throw new Error("Gift quantity mode is invalid");
  if (quantityMode === "per_unit" && giftQuantity !== 1)
    throw new Error(
      "Per-unit offers must use a base quantity of one so delivery cannot exceed twenty gifts",
    );
  if (!allocationPolicy) throw new Error("Gift allocation policy is invalid");
  if (!Number.isInteger(priority) || priority < 1 || priority > 10000)
    throw new Error("Priority must be between 1 and 10000");
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime())
    throw new Error("Promotion end date must be after its start date");

  const cleanLabels: Record<string, string> = {};
  for (const language of ["ar", "fr", "en"]) {
    const value = String(labels[language] || "").trim();
    if (!value) throw new Error(`Promotion label (${language}) is required`);
    if (value.length > 180)
      throw new Error(`Promotion label (${language}) is too long`);
    cleanLabels[language] = value;
  }

  const { data: services, error: servicesError } = await db
    .from("services")
    .select("id,show_types,types,p,type_prices,fulfillment_mode")
    .in("id", [sourceServiceId, giftServiceId]);
  if (servicesError) throw servicesError;
  const sourceService = (services || []).find((item: any) =>
    String(item.id) === sourceServiceId
  );
  const giftService = (services || []).find((item: any) =>
    String(item.id) === giftServiceId
  );
  if (!sourceService || !giftService)
    throw new Error("One of the selected services no longer exists");

  const sourcePrices = jsonArray(sourceService.p);
  const typePrices = jsonArray(sourceService.type_prices);
  if (sourceTypeIdx === null) {
    const hasPrice = Number(sourcePrices[sourceDurationIdx] || 0) > 0 ||
      typePrices.some((row: any) =>
        Number(jsonArray(row)[sourceDurationIdx] || 0) > 0
      );
    if (!hasPrice)
      throw new Error("The selected source duration is not sold by this service");
  } else {
    if (!sourceService.show_types || !jsonArray(typePrices[sourceTypeIdx]).length)
      throw new Error("The selected source package does not exist");
    if (Number(jsonArray(typePrices[sourceTypeIdx])[sourceDurationIdx] || 0) <= 0)
      throw new Error("The selected source package and duration are unavailable");
  }
  if (raw.include_renewals === true)
    throw new Error(
      "Renewal gifts are temporarily disabled until the existing gift can be extended safely",
    );

  if (allocationPolicy === "shared_reusable") {
    const { data: config, error: configError } = await db
      .from("service_operations_config")
      .select("inventory_model,settings")
      .eq("service_id", giftServiceId)
      .maybeSingle();
    if (configError) throw configError;
    const settings = jsonObject(config?.settings);
    if (
      !config ||
      (
        String(config.inventory_model || "") !== "profiles" &&
        settings.promotion_shared_supported !== true
      )
    )
      throw new Error(
        "The free service is not configured for reusable shared-profile inventory",
      );
  }

  const metadata = plainObject(raw.metadata);
  const campaign = String(metadata.campaign || "").trim();
  if (campaign.length > 100) throw new Error("Campaign name is too long");
  return {
    source_service_id: sourceServiceId,
    source_duration_idx: sourceDurationIdx,
    source_type_idx: sourceTypeIdx,
    gift_service_id: giftServiceId,
    gift_duration_strategy: giftDurationStrategy,
    gift_duration_idx: giftDurationIdx,
    gift_quantity: giftQuantity,
    quantity_mode: quantityMode,
    allocation_policy: allocationPolicy,
    inventory_pool: allocationPolicy === "shared_reusable"
      ? "promotion_shared"
      : "standard",
    include_renewals: false,
    label_i18n: cleanLabels,
    active: raw.active === true,
    starts_at: startsAt,
    ends_at: endsAt,
    priority,
    metadata: campaign ? { campaign } : {},
    updated_at: new Date().toISOString(),
  };
}
async function auditBundleRule(
  db: any,
  actorId: string,
  action: string,
  ruleId: string,
  serviceId: string | null,
  beforeData: any,
  afterData: any,
) {
  const { error } = await db.from("operations_audit_log").insert({
    actor_id: actorId,
    action,
    entity_type: "service_bundle_rule",
    entity_id: ruleId,
    service_id: serviceId,
    before_data: beforeData || {},
    after_data: afterData || {},
    metadata: { source: "operations_center" },
  });
  if (error) throw error;
}
serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: cors,
    });
  try {
    const url = Deno.env.get("SUPABASE_URL")!,
      service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      auth = req.headers.get("authorization") || "",
      token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token)
      return new Response(
        JSON.stringify({
          success: false,
          error: "Authentication required: missing session token",
        }),
        { status: 401, headers: cors },
      );
    const db = createClient(url, service);
    const {
      data: { user },
      error: userError,
    } = await db.auth.getUser(token);
    if (userError || !user)
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Authentication required: " +
            (userError?.message || "invalid session"),
        }),
        { status: 401, headers: cors },
      );
    const { data: admin } = await db
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!admin)
      return new Response(
        JSON.stringify({ success: false, error: "Admin only" }),
        { status: 403, headers: cors },
      );
    const body = await req.json();
    const action = body.action;
    if (action === "flush_sheet_queue") {
      const response = await fetch(`${url}/functions/v1/sync-google-sheet`, {
        method: "POST",
        headers: { Authorization: `Bearer ${service}` },
      });
      const text = await response.text();
      let result: any = null;
      try {
        result = JSON.parse(text);
      } catch {
        result = { raw: text };
      }
      if (!response.ok)
        throw new Error(result?.error || text || "Google Sheet queue failed");
      return new Response(JSON.stringify({ success: true, sync: result }), {
        headers: cors,
      });
    }
    if (action === "sync_sheet") {
      const scope = String(body.scope || "all_light");
      const result = await syncInventoryNow(
        db,
        url,
        service,
        `admin-refresh-${Date.now()}`,
        scope,
      );
      return new Response(
        JSON.stringify({
          success: true,
          sync: result,
        }),
        { headers: cors },
      );
    }
    if (action === "complete_activation") {
      if (!body.fulfillment_id)
        throw new Error("Activation request is required");
      // Execute the admin RPC with the caller's JWT so auth.uid() and the
      // audit actor remain the real operator rather than the service role.
      const userDb = createClient(url, service, {
        global: { headers: { Authorization: auth } },
      });
      const { data: completion, error: completionError } = await userDb.rpc(
        "ops_complete_activation",
        {
          p_fulfillment_id: String(body.fulfillment_id),
          p_admin_message: String(body.admin_message || ""),
        },
      );
      if (completionError) throw completionError;

      // A paid manual source may have a free automatic gift waiting behind it.
      // Retry the same order after the source is authoritative. Completion is
      // already committed, so a retry outage is returned as a warning and must
      // never make the operator repeat the activation.
      let giftRetry: any = null;
      let giftRetryError = "";
      const orderId = String(completion?.order_id || "");
      if (orderId) {
        try {
          const retryResponse = await fetch(
            `${url}/functions/v1/fulfill-order`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${service}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ order_id: orderId }),
            },
          );
          const retryText = await retryResponse.text();
          try {
            giftRetry = retryText ? JSON.parse(retryText) : {};
          } catch {
            giftRetry = { raw: retryText };
          }
          if (!retryResponse.ok || giftRetry?.success === false)
            giftRetryError = String(
              giftRetry?.error ||
                `Gift retry returned HTTP ${retryResponse.status}`,
            );
        } catch (retryError: any) {
          giftRetryError = String(retryError?.message || retryError);
        }
      }
      return new Response(
        JSON.stringify({
          success: true,
          completion,
          gift_retry: giftRetry,
          gift_retry_error: giftRetryError || null,
        }),
        { headers: cors },
      );
    }
    if (action === "list") {
      const [accountsResult, slotsResult, licensesResult, activationResult, sharedAllocationsResult, bundleRulesResult] =
        await Promise.all([
          db
            .from("inventory_accounts")
            .select(
              "id,service_id,label,capacity,status,pool_kind,expires_at,created_at,updated_at,encrypted_credentials",
            )
            .order("created_at", { ascending: false }),
          db
            .from("inventory_slots")
            .select("id,account_id,label,status,max_shared_allocations,created_at,updated_at"),
          db
            .from("inventory_licenses")
            .select("id,service_id,label,status,created_at,updated_at"),
          db
            .from("fulfillments")
            .select("id,customer_input")
            .eq("mode", "manual_activation")
            .not("customer_input", "is", null),
          db
            .from("shared_profile_allocations")
            .select(
              "id,benefit_id,fulfillment_id,account_id,slot_id,starts_at,ends_at,status,renewal_count,created_at,inventory_slots(label),fulfillments(id,order_id,service_id,delivery_summary,orders(customer_info))",
            )
            .eq("status", "active")
            .order("created_at", { ascending: false }),
          db
            .from("service_bundle_rules")
            .select("*")
            .order("priority", { ascending: true })
            .order("created_at", { ascending: true }),
        ]);
      for (const [name, result] of [
        ["accounts", accountsResult],
        ["profiles", slotsResult],
        ["licenses", licensesResult],
        ["activation inputs", activationResult],
        ["shared promotion allocations", sharedAllocationsResult],
        ["bundle rules", bundleRulesResult],
      ] as const) {
        if (result.error)
          throw new Error(`Unable to load ${name}: ${result.error.message || String(result.error)}`);
      }
      const accounts = accountsResult.data || [];
      const slots = slotsResult.data || [];
      const licenses = licensesResult.data || [];
      const activationRows = activationResult.data || [];
      const adminAccounts = await Promise.all((accounts || []).map(async (account) => {
        const credentials: any = await decrypt(account.encrypted_credentials);
        const { encrypted_credentials, ...safeAccount } = account;
        return {
          ...safeAccount,
          email: credentials.email || "",
          password: credentials.password || "",
        };
      }));
      const activationInputs = await Promise.all((activationRows || []).map(async (row: any) => {
        const input = row.customer_input && typeof row.customer_input === "object"
          ? { ...row.customer_input }
          : {};
        if (input.account_password_cipher) {
          try {
            const secret: any = await decrypt(String(input.account_password_cipher));
            input.account_password = String(secret?.password || "");
          } catch {
            input.account_password = "";
          }
          delete input.account_password_cipher;
        }
        return { fulfillment_id: row.id, customer_input: input };
      }));
      return new Response(
        JSON.stringify({
          success: true,
          accounts: adminAccounts,
          slots: (slots || []).sort(sortSlots),
          licenses: licenses || [],
          activation_inputs: activationInputs,
          shared_allocations: sharedAllocationsResult.data || [],
          bundle_rules: bundleRulesResult.data || [],
        }),
        { headers: cors },
      );
    }
    if (action === "save_bundle_rule") {
      const payload = await validateBundleRule(db, body.rule);
      const ruleId = body.rule_id ? String(body.rule_id) : null;
      let saved: any = null;
      let beforeData: any = {};
      if (ruleId) {
        const { data: current, error: currentError } = await db
          .from("service_bundle_rules")
          .select("*")
          .eq("id", ruleId)
          .single();
        if (currentError || !current)
          throw currentError || new Error("Promotion rule was not found");
        const expected = body.expected_updated_at
          ? new Date(String(body.expected_updated_at)).getTime()
          : null;
        const actual = current.updated_at
          ? new Date(String(current.updated_at)).getTime()
          : null;
        if (
          Number.isFinite(expected) &&
          Number.isFinite(actual) &&
          expected !== actual
        )
          throw new Error(
            "This promotion changed in another session. Refresh before saving again",
          );
        beforeData = current;
        const metadata = {
          ...plainObject(current.metadata),
          ...plainObject(payload.metadata),
        };
        delete metadata.archived;
        delete metadata.archived_at;
        const { data, error } = await db
          .from("service_bundle_rules")
          .update({ ...payload, metadata })
          .eq("id", ruleId)
          .select()
          .single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await db
          .from("service_bundle_rules")
          .insert(payload)
          .select()
          .single();
        if (error) {
          if (String(error.code || "") === "23505")
            throw new Error(
              "An offer for the same product, duration, package and gift already exists. Edit the existing offer instead",
            );
          throw error;
        }
        saved = data;
      }
      await auditBundleRule(
        db,
        user.id,
        ruleId ? "update_bundle_rule" : "create_bundle_rule",
        saved.id,
        saved.source_service_id,
        beforeData,
        saved,
      );
      await syncInventory(
        db,
        url,
        service,
        saved.id,
        saved.source_service_id,
      );
      return new Response(
        JSON.stringify({ success: true, rule: saved }),
        { headers: cors },
      );
    }
    if (action === "set_bundle_rule_active") {
      if (!body.rule_id) throw new Error("Promotion rule is required");
      const { data: current, error: currentError } = await db
        .from("service_bundle_rules")
        .select("*")
        .eq("id", body.rule_id)
        .single();
      if (currentError || !current)
        throw currentError || new Error("Promotion rule was not found");
      if (plainObject(current.metadata).archived_at)
        throw new Error("Restore the archived promotion before changing its status");
      const { data: saved, error } = await db
        .from("service_bundle_rules")
        .update({
          active: body.active === true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id)
        .select()
        .single();
      if (error) throw error;
      await auditBundleRule(
        db,
        user.id,
        body.active === true ? "activate_bundle_rule" : "deactivate_bundle_rule",
        current.id,
        current.source_service_id,
        current,
        saved,
      );
      await syncInventory(db, url, service, current.id, current.source_service_id);
      return new Response(
        JSON.stringify({ success: true, rule: saved }),
        { headers: cors },
      );
    }
    if (action === "archive_bundle_rule") {
      if (!body.rule_id) throw new Error("Promotion rule is required");
      const { data: current, error: currentError } = await db
        .from("service_bundle_rules")
        .select("*")
        .eq("id", body.rule_id)
        .single();
      if (currentError || !current)
        throw currentError || new Error("Promotion rule was not found");
      const metadata = {
        ...plainObject(current.metadata),
        archived: true,
        archived_at: new Date().toISOString(),
      };
      const { data: saved, error } = await db
        .from("service_bundle_rules")
        .update({
          active: false,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id)
        .select()
        .single();
      if (error) throw error;
      await auditBundleRule(
        db,
        user.id,
        "archive_bundle_rule",
        current.id,
        current.source_service_id,
        current,
        saved,
      );
      await syncInventory(db, url, service, current.id, current.source_service_id);
      return new Response(
        JSON.stringify({ success: true, rule: saved }),
        { headers: cors },
      );
    }
    if (action === "restore_bundle_rule") {
      if (!body.rule_id) throw new Error("Promotion rule is required");
      const { data: current, error: currentError } = await db
        .from("service_bundle_rules")
        .select("*")
        .eq("id", body.rule_id)
        .single();
      if (currentError || !current)
        throw currentError || new Error("Promotion rule was not found");
      const metadata = { ...plainObject(current.metadata) };
      delete metadata.archived;
      delete metadata.archived_at;
      const { data: saved, error } = await db
        .from("service_bundle_rules")
        .update({
          active: false,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id)
        .select()
        .single();
      if (error) throw error;
      await auditBundleRule(
        db,
        user.id,
        "restore_bundle_rule",
        current.id,
        current.source_service_id,
        current,
        saved,
      );
      await syncInventory(db, url, service, current.id, current.source_service_id);
      return new Response(
        JSON.stringify({ success: true, rule: saved }),
        { headers: cors },
      );
    }
    if (action === "delete_bundle_rule") {
      if (!body.rule_id) throw new Error("Promotion rule is required");
      const { data: current, error: currentError } = await db
        .from("service_bundle_rules")
        .select("*")
        .eq("id", body.rule_id)
        .single();
      if (currentError || !current)
        throw currentError || new Error("Promotion rule was not found");
      const { count, error: usageError } = await db
        .from("order_benefits")
        .select("id", { count: "exact", head: true })
        .eq("rule_id", current.id);
      if (usageError) throw usageError;
      if (Number(count || 0) > 0)
        throw new Error(
          "This promotion has customer delivery history. Archive it instead of deleting it",
        );
      const { error } = await db
        .from("service_bundle_rules")
        .delete()
        .eq("id", current.id);
      if (error) throw error;
      await auditBundleRule(
        db,
        user.id,
        "delete_bundle_rule",
        current.id,
        current.source_service_id,
        current,
        {},
      );
      await syncInventory(db, url, service, current.id, current.source_service_id);
      return new Response(JSON.stringify({ success: true }), { headers: cors });
    }
    if (action === "add_account") {
      if (!body.service_id || !body.email || !body.password)
        throw new Error("Service, email and password are required");
      const poolKind = body.pool_kind === "promotion_shared"
        ? "promotion_shared"
        : "standard";
      const defaultCapacity = String(body.service_id) === "prime" && poolKind === "promotion_shared"
        ? 6
        : 1;
      const capacity = Math.max(
        1,
        Math.min(100, Number(body.capacity || defaultCapacity)),
      );
      const { data: a, error } = await db
        .from("inventory_accounts")
        .insert({
          service_id: body.service_id,
          label: body.label || body.email,
          capacity,
          pool_kind: poolKind,
          encrypted_credentials: await encrypt({
            email: body.email,
            password: body.password,
          }),
          expires_at: body.expires_at || null,
        })
        .select()
        .single();
      if (error) throw error;
      const slots = [];
      for (let i = 0; i < capacity; i++)
        slots.push({
          account_id: a.id,
          label: body.profiles?.[i]?.name || `Profile ${i + 1}`,
          encrypted_secret: await encrypt({
            pin: body.profiles?.[i]?.pin || "",
          }),
        });
      const { error: se } = await db.from("inventory_slots").insert(slots);
      if (se) {
        const { error: cleanupError } = await db
          .from("inventory_accounts")
          .delete()
          .eq("id", a.id);
        if (cleanupError) {
          throw new Error(
            `${se.message || "Profile creation failed"}; account cleanup failed: ${cleanupError.message || String(cleanupError)}`,
          );
        }
        throw se;
      }
      await syncInventory(db, url, service, a.id, body.service_id);
      return new Response(JSON.stringify({ success: true, id: a.id }), {
        headers: cors,
      });
    }
    if (action === "add_licenses") {
      const codes = (body.codes || [])
        .map((x: any) => String(x).trim())
        .filter(Boolean)
        .slice(0, 500);
      if (!body.service_id || !codes.length)
        throw new Error("Service and codes are required");
      const rows = [];
      for (const code of codes)
        rows.push({
          service_id: body.service_id,
          label: body.label || null,
          encrypted_secret: await encrypt({ code }),
        });
      const { error } = await db.from("inventory_licenses").insert(rows);
      if (error) throw error;
      await syncInventory(
        db,
        url,
        service,
        `licenses-${Date.now()}`,
        body.service_id,
      );
      return new Response(
        JSON.stringify({ success: true, count: rows.length }),
        { headers: cors },
      );
    }
    if (action === "update_account_credentials") {
      if (!body.id) throw new Error("Account is required");
      const { data: account, error: accountError } = await db
        .from("inventory_accounts")
        .select("id,service_id,encrypted_credentials,credentials_version")
        .eq("id", body.id)
        .single();
      if (accountError || !account)
        throw accountError || new Error("Account not found");
      const current: any = await decrypt(account.encrypted_credentials);
      const email = String(
        body.email === undefined ? current.email : body.email,
      ).trim();
      const password = String(
        body.password === undefined ? current.password : body.password,
      );
      if (!email || !password)
        throw new Error("Email and password are required");
      const emailChanged = String(current.email || "") !== email,
        passwordChanged = String(current.password || "") !== password;
      const [standardAllocationsResult, sharedAllocationsResult] = await Promise.all([
        db
          .from("fulfillment_allocations")
          .select(
            "id,account_id,slot_id,ends_at,status,sheet_version,inventory_slots(label),fulfillments!inner(id,order_id,service_id,encrypted_delivery)",
          )
          .eq("account_id", account.id)
          .eq("status", "active"),
        db
          .from("shared_profile_allocations")
          .select(
            "id,account_id,slot_id,ends_at,status,sheet_version,inventory_slots(label),fulfillments!inner(id,order_id,service_id,encrypted_delivery)",
          )
          .eq("account_id", account.id)
          .eq("status", "active"),
      ]);
      if (standardAllocationsResult.error) throw standardAllocationsResult.error;
      if (sharedAllocationsResult.error) throw sharedAllocationsResult.error;
      const activeAllocations = [
        ...(standardAllocationsResult.data || []).map((allocation: any) => ({
          ...allocation,
          allocation_kind: "standard",
        })),
        ...(sharedAllocationsResult.data || []).map((allocation: any) => ({
          ...allocation,
          allocation_kind: "shared",
        })),
      ];
      const getFulfillment = (allocation: any) =>
        Array.isArray(allocation.fulfillments)
          ? allocation.fulfillments[0]
          : allocation.fulfillments;
      const expectedAllocations = activeAllocations.map((allocation: any) => ({
        id: String(allocation.id),
        allocation_kind: allocation.allocation_kind || "standard",
        fulfillment_id: String(getFulfillment(allocation)?.id || ""),
        slot_id: allocation.slot_id ? String(allocation.slot_id) : null,
        ends_at: allocation.ends_at || null,
        sheet_version: Number(allocation.sheet_version || 0),
      }));
      const currentAllocations = activeAllocations.filter((allocation: any) =>
        !allocation.ends_at || new Date(allocation.ends_at).getTime() > Date.now()
      );
      const noticesByOrder = new Map<string, any>();
      const processedFulfillments = new Set<string>();
      const fulfillmentUpdates: Array<Record<string, string>> = [];
      for (const allocation of currentAllocations) {
        const f: any = getFulfillment(allocation);
        if (!f?.id)
          throw new Error("An active allocation has no fulfillment record");
        if (processedFulfillments.has(String(f.id))) continue;
        processedFulfillments.add(String(f.id));
        const related = currentAllocations.filter((item: any) =>
          String(getFulfillment(item)?.id || "") === String(f.id)
        );
        const allocationIds = new Set(related.map((item: any) => String(item.id)));
        const slotIds = new Set(related.map((item: any) => String(item.slot_id || "")).filter(Boolean));
        const labels = new Set(related.map((item: any) =>
          String(item.inventory_slots?.label || "").trim().toLowerCase()
        ).filter(Boolean));
        const delivery: any = await decrypt(f.encrypted_delivery);
        if (delivery && typeof delivery === "object") {
          if (Array.isArray(delivery.entries)) {
            let matches = 0;
            const deliveryLabelCounts = new Map<string, number>();
            for (const entry of delivery.entries) {
              const label = String(entry?.profile || entry?.label || "").trim().toLowerCase();
              if (label) deliveryLabelCounts.set(label, (deliveryLabelCounts.get(label) || 0) + 1);
            }
            delivery.entries = delivery.entries.map((entry: any) => {
              const entryLabel = String(entry?.profile || entry?.label || "").trim().toLowerCase();
              const stableMatch = allocationIds.has(String(entry?.allocation_id || "")) ||
                slotIds.has(String(entry?.slot_id || "")) ||
                String(entry?.account_id || "") === String(account.id);
              const safeLegacyMatch = !entry?.allocation_id && !entry?.slot_id && !entry?.account_id &&
                labels.has(entryLabel) && deliveryLabelCounts.get(entryLabel) === 1;
              if (stableMatch || safeLegacyMatch) {
                matches++;
                return { ...entry, email, password };
              }
              return entry;
            });
            if (matches < 1)
              throw new Error(
                `Delivery ${f.id} could not be matched safely to account ${account.id}`,
              );
          } else {
            delivery.email = email;
            delivery.password = password;
          }
          fulfillmentUpdates.push({
            id: String(f.id),
            expected_encrypted_delivery: String(f.encrypted_delivery || ""),
            encrypted_delivery: await encrypt(delivery),
          });
        }
        if (
          body.notify === true &&
          (emailChanged || passwordChanged) &&
          f.order_id &&
          !noticesByOrder.has(String(f.order_id))
        ) {
          noticesByOrder.set(String(f.order_id), {
            order_id: String(f.order_id),
            service_id: account.service_id,
            fulfillment_id: String(f.id),
            action_url: "/my-account?order=" + f.order_id,
          });
        }
      }
      const { data: committed, error: commitError } = await db.rpc(
        "ops_update_inventory_account_credentials_atomic",
        {
          p_account_id: account.id,
          p_expected_credentials: account.encrypted_credentials,
          p_expected_credentials_version: Number(
            account.credentials_version || 0,
          ),
          p_new_credentials: await encrypt({ email, password }),
          p_expected_allocations: expectedAllocations,
          p_fulfillment_updates: fulfillmentUpdates,
          p_actor_id: user.id,
          p_before_data: { email: current.email || "" },
          p_after_data: { email },
          p_metadata: {
            notify: body.notify === true,
            email_changed: emailChanged,
            password_changed: passwordChanged,
            changed_fields: [
              emailChanged ? "email" : null,
              passwordChanged ? "password" : null,
            ].filter(Boolean),
            affected_allocations: activeAllocations.length,
            affected_fulfillments: fulfillmentUpdates.length,
          },
        },
      );
      if (commitError) throw commitError;

      // The credential update is committed atomically above. Ancillary delivery
      // is best-effort and is reported as a warning so clients do not retry the
      // sensitive transaction after a mail or projection outage.
      const postCommitWarnings: string[] = [];
      let notificationsQueued = 0;
      for (const notice of noticesByOrder.values()) {
        const { error: notifyError } = await db.rpc(
          "enqueue_customer_notification",
          {
            p_event_type: "account.changed",
            p_order_id: notice.order_id,
            p_template_key: "account_changed",
            p_title_i18n: {
              ar: "تم تحديث معلومات الحساب",
              fr: "Informations du compte mises à jour",
              en: "Account information updated",
            },
            p_body_i18n: {
              ar: "تم تحديث بيانات الحساب المرتبط بطلبك. افتح الطلب لمشاهدة المعلومات الأحدث.",
              fr: "Les identifiants liés à votre commande ont été mis à jour. Ouvrez la commande pour consulter les informations les plus récentes.",
              en: "The account details linked to your order were updated. Open the order to view the latest information.",
            },
            p_service_id: notice.service_id,
            p_fulfillment_id: notice.fulfillment_id,
            p_action_url: notice.action_url,
            p_data: {
              account_id: account.id,
              email_changed: emailChanged,
              password_changed: passwordChanged,
              action_url: notice.action_url,
            },
            p_send_email: true,
          },
        );
        if (notifyError) {
          postCommitWarnings.push(
            `Notification for order ${notice.order_id} was not queued: ${notifyError.message || String(notifyError)}`,
          );
          continue;
        }
        notificationsQueued++;
      }
      if (notificationsQueued > 0) dispatchNotifications(url, service);
      const syncResult = await syncInventory(
        db,
        url,
        service,
        account.id,
        account.service_id,
      );
      if (!syncResult.ok)
        postCommitWarnings.push(
          `Google Sheet synchronization was not queued: ${syncResult.error}`,
        );
      return new Response(
        JSON.stringify({
          success: true,
          committed: true,
          affected_allocations: activeAllocations.length,
          affected_orders: fulfillmentUpdates.length,
          notifications_queued: notificationsQueued,
          email_changed: emailChanged,
          password_changed: passwordChanged,
          transaction: committed,
          post_commit_warnings: postCommitWarnings,
        }),
        { headers: cors },
      );
    }
    if (action === "move_allocation") {
      const allocationId = String(body.allocation_id || ""),
        targetSlotId = String(body.target_slot_id || "");
      if (!allocationId || !targetSlotId)
        throw new Error("Subscription and destination profile are required");
      const { data: allocation, error: allocationError } = await db
        .from("fulfillment_allocations")
        .select(
          "id,fulfillment_id,account_id,slot_id,ends_at,status,admin_notes,sheet_version",
        )
        .eq("id", allocationId)
        .single();
      if (allocationError || !allocation)
        throw allocationError || new Error("Subscription allocation not found");
      if (String(allocation.status || "").toLowerCase() !== "active")
        throw new Error("Only an active profile can be moved");
      if (String(allocation.slot_id) === targetSlotId)
        throw new Error("Choose a different destination profile");
      const [sourceSlotResult, targetSlotResult, fulfillmentResult] =
        await Promise.all([
          db
            .from("inventory_slots")
            .select("id,account_id,label,status")
            .eq("id", allocation.slot_id)
            .single(),
          db
            .from("inventory_slots")
            .select("id,account_id,label,status,encrypted_secret")
            .eq("id", targetSlotId)
            .single(),
          db
            .from("fulfillments")
            .select("id,order_id,service_id,encrypted_delivery")
            .eq("id", allocation.fulfillment_id)
            .single(),
        ]);
      if (sourceSlotResult.error) throw sourceSlotResult.error;
      if (targetSlotResult.error) throw targetSlotResult.error;
      if (fulfillmentResult.error) throw fulfillmentResult.error;
      const sourceSlot = sourceSlotResult.data;
      const targetSlot = targetSlotResult.data;
      const fulfillment = fulfillmentResult.data;
      if (!sourceSlot || !targetSlot || !fulfillment)
        throw new Error("Profile or delivery record not found");
      if (String(targetSlot.status || "").toLowerCase() !== "available")
        throw new Error("Destination profile is not available");
      const [sourceAccountResult, targetAccountResult] = await Promise.all([
        db
          .from("inventory_accounts")
          .select("id,service_id,status")
          .eq("id", sourceSlot.account_id)
          .single(),
        db
          .from("inventory_accounts")
          .select(
            "id,service_id,status,encrypted_credentials,credentials_version",
          )
          .eq("id", targetSlot.account_id)
          .single(),
      ]);
      if (sourceAccountResult.error) throw sourceAccountResult.error;
      if (targetAccountResult.error) throw targetAccountResult.error;
      const sourceAccount = sourceAccountResult.data;
      const targetAccount = targetAccountResult.data;
      if (
        !sourceAccount ||
        !targetAccount ||
        String(targetAccount.service_id) !== String(fulfillment.service_id)
      )
        throw new Error("Destination profile must belong to the same service");
      if (String(targetAccount.status || "").toLowerCase() !== "active")
        throw new Error("Destination account is not active");

      const delivery: any = await decrypt(fulfillment.encrypted_delivery);
      if (!delivery || !Array.isArray(delivery.entries))
        throw new Error("Delivery profile could not be matched safely");
      const targetCredentials: any = await decrypt(
        targetAccount.encrypted_credentials,
      );
      const targetSecret: any = await decrypt(targetSlot.encrypted_secret);
      const sourceLabel = String(sourceSlot.label || "").trim().toLowerCase();
      let entryIndex = delivery.entries.findIndex((entry: any) =>
        String(entry.allocation_id || "") === String(allocation.id)
      );
      if (entryIndex < 0)
        entryIndex = delivery.entries.findIndex((entry: any) =>
          String(entry.slot_id || "") === String(sourceSlot.id)
        );
      if (entryIndex < 0)
        entryIndex = delivery.entries.findIndex((entry: any) =>
          String(entry.account_id || "") === String(sourceSlot.account_id) &&
          String(entry.profile || entry.label || "").trim().toLowerCase() ===
            sourceLabel
        );
      if (entryIndex < 0) {
        const legacyMatches = delivery.entries
          .map((entry: any, index: number) => ({ entry, index }))
          .filter(({ entry }: any) =>
            !entry?.allocation_id &&
            !entry?.slot_id &&
            !entry?.account_id &&
            String(entry.profile || entry.label || "")
                .trim()
                .toLowerCase() === sourceLabel
          );
        if (legacyMatches.length === 1) entryIndex = legacyMatches[0].index;
      }
      if (entryIndex < 0 && delivery.entries.length === 1) entryIndex = 0;
      if (entryIndex < 0)
        throw new Error("Delivery profile could not be matched safely");
      delivery.entries[entryIndex] = {
        ...delivery.entries[entryIndex],
        email: targetCredentials.email || "",
        password: targetCredentials.password || "",
        profile: targetSlot.label,
        pin: targetSecret.pin || targetSecret.code || "",
        account_id: targetSlot.account_id,
        slot_id: targetSlot.id,
        allocation_id: allocation.id,
      };
      const newEncryptedDelivery = await encrypt(delivery);
      const { data: moved, error: moveError } = await db.rpc(
        "ops_move_inventory_allocation_atomic",
        {
          p_allocation_id: allocation.id,
          p_target_slot_id: targetSlot.id,
          p_expected_source_account_id: sourceSlot.account_id,
          p_expected_source_slot_id: sourceSlot.id,
          p_expected_fulfillment_id: fulfillment.id,
          p_expected_allocation_sheet_version: Number(
            allocation.sheet_version || 0,
          ),
          p_expected_allocation_admin_notes: allocation.admin_notes || null,
          p_expected_source_slot_label: sourceSlot.label,
          p_expected_target_account_id: targetSlot.account_id,
          p_expected_target_account_credentials:
            targetAccount.encrypted_credentials,
          p_expected_target_credentials_version: Number(
            targetAccount.credentials_version || 0,
          ),
          p_expected_target_slot_label: targetSlot.label,
          p_expected_target_slot_secret: targetSlot.encrypted_secret,
          p_expected_fulfillment_delivery:
            fulfillment.encrypted_delivery || null,
          p_new_fulfillment_delivery: newEncryptedDelivery,
          p_actor_id: user.id,
        },
      );
      if (moveError) throw moveError;

      const sheetKick = fetch(`${url}/functions/v1/sync-google-sheet`, {
        method: "POST",
        headers: { Authorization: `Bearer ${service}` },
      }).catch(() => null);
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(sheetKick);
      return new Response(
        JSON.stringify({
          success: true,
          allocation_id: allocation.id,
          source_profile: sourceSlot.label,
          target_profile: targetSlot.label,
          transaction: moved,
        }),
        { headers: cors },
      );
    }
    if (action === "update_allocation_end") {
      if (!body.allocation_id || !body.ends_at)
        throw new Error("Allocation and end date are required");
      const parsed = new Date(body.ends_at);
      if (Number.isNaN(parsed.getTime())) throw new Error("Invalid end date");
      const { data: result, error } = await db.rpc(
        "ops_update_allocation_end",
        {
          p_allocation_id: body.allocation_id,
          p_ends_at: parsed.toISOString(),
          p_notify: body.notify === true,
          p_actor_id: user.id,
        },
      );
      if (error) throw error;
      await syncInventory(
        db,
        url,
        service,
        body.allocation_id,
        result?.service_id,
      );
      return new Response(JSON.stringify({ ...result, success: true }), {
        headers: cors,
      });
    }
    if (action === "set_status") {
      const allowed: any = {
        accounts: ["active", "maintenance", "disabled"],
        slots: ["available", "assigned", "maintenance", "disabled"],
        licenses: ["available", "assigned", "disabled"],
      };
      if (!allowed[body.kind]?.includes(body.status))
        throw new Error("Invalid inventory status");
      const table =
        body.kind === "accounts"
          ? "inventory_accounts"
          : body.kind === "slots"
            ? "inventory_slots"
            : "inventory_licenses";
      if (body.kind === "slots" || body.kind === "licenses") {
        const foreignKey = body.kind === "slots" ? "slot_id" : "license_id";
        const { data: activeAllocation, error: allocationLookupError } = await db
          .from("fulfillment_allocations")
          .select("id")
          .eq(foreignKey, body.id)
          .eq("status", "active")
          .maybeSingle();
        if (allocationLookupError) throw allocationLookupError;
        if (activeAllocation && body.status !== "assigned")
          throw new Error("This inventory item is linked to an active customer subscription");
        if (!activeAllocation && body.status === "assigned")
          throw new Error("Assigned status requires an active customer allocation");
      }
      const { error } = await db
        .from(table)
        .update({ status: body.status, updated_at: new Date().toISOString() })
        .eq("id", body.id);
      if (error) throw error;
      await syncInventory(db, url, service, body.id);
      return new Response(JSON.stringify({ success: true }), { headers: cors });
    }
    if (action === "delete") {
      if (!["accounts", "slots", "licenses"].includes(body.kind) || !body.id)
        throw new Error("Invalid inventory item");
      const table =
        body.kind === "accounts"
          ? "inventory_accounts"
          : body.kind === "slots"
            ? "inventory_slots"
            : "inventory_licenses";
      const { error } = await db.from(table).delete().eq("id", body.id);
      if (error) throw error;
      await syncInventory(db, url, service, body.id);
      return new Response(JSON.stringify({ success: true }), { headers: cors });
    }
    return new Response(
      JSON.stringify({ success: false, error: "Unknown action" }),
      { status: 400, headers: cors },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e?.message || String(e) }),
      { status: 500, headers: cors },
    );
  }
});
