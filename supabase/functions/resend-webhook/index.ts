import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { Webhook } from "https://esm.sh/svix@1.42.0?target=deno";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const item = String(value || "").trim().toLowerCase();
  return item ? [item] : [];
}

function tagValue(data: any, name: string): string {
  const tags = data?.tags;
  if (Array.isArray(tags)) {
    const match = tags.find((tag: any) => String(tag?.name || "") === name);
    return String(match?.value || "").trim();
  }
  if (tags && typeof tags === "object") return String(tags[name] || "").trim();
  return "";
}

serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
  if (!supabaseUrl || !serviceKey || !webhookSecret) {
    return json({ success: false, error: "Webhook configuration is incomplete" }, 503);
  }

  const webhookId = req.headers.get("svix-id") || "";
  const webhookTimestamp = req.headers.get("svix-timestamp") || "";
  const webhookSignature = req.headers.get("svix-signature") || "";
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return json({ success: false, error: "Missing webhook signature" }, 401);
  }

  const rawBody = await req.text();
  let event: any;
  try {
    event = new Webhook(webhookSecret).verify(rawBody, {
      "svix-id": webhookId,
      "svix-timestamp": webhookTimestamp,
      "svix-signature": webhookSignature,
    });
  } catch {
    return json({ success: false, error: "Invalid webhook signature" }, 401);
  }

  try {
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const type = String(event?.type || "unknown").slice(0, 100);
    const data = event?.data && typeof event.data === "object" ? event.data : {};
    const providerMessageId = String(data.email_id || data.id || "").slice(0, 200);
    const taggedDeliveryId = tagValue(data, "delivery_id").slice(0, 80);
    const recipients = stringList(data.to);
    const metadata = {
      created_at: String(event?.created_at || data.created_at || "").slice(0, 50),
      recipients,
      bounce_type: String(data?.bounce?.type || data?.type || "").slice(0, 100),
    };

    const existingLedger = await db.from("notification_webhook_events")
      .select("id,processed_at")
      .eq("provider", "resend")
      .eq("provider_event_id", webhookId)
      .maybeSingle();
    if (existingLedger.error) throw existingLedger.error;
    if (existingLedger.data?.processed_at) return json({ success: true, duplicate: true });
    if (!existingLedger.data) {
      const ledgerInsert = await db.from("notification_webhook_events").insert({
        provider: "resend",
        provider_event_id: webhookId,
        event_type: type,
        provider_message_id: providerMessageId || null,
        metadata,
      });
      if (ledgerInsert.error && ledgerInsert.error.code !== "23505") throw ledgerInsert.error;
      if (ledgerInsert.error?.code === "23505") {
        const racedLedger = await db.from("notification_webhook_events")
          .select("processed_at")
          .eq("provider", "resend")
          .eq("provider_event_id", webhookId)
          .maybeSingle();
        if (racedLedger.error) throw racedLedger.error;
        if (racedLedger.data?.processed_at) return json({ success: true, duplicate: true });
      }
    }

    const deliveryResult = providerMessageId
      ? await db.from("notification_deliveries")
        .select("id,event_id,status,provider_message_id,provider_metadata")
        .eq("provider", "resend")
        .eq("provider_message_id", providerMessageId)
        .maybeSingle()
      : { data: null, error: null };
    if (deliveryResult.error) throw deliveryResult.error;
    let delivery = deliveryResult.data;
    if (!delivery && taggedDeliveryId && providerMessageId) {
      const correlation = await db.from("notification_deliveries")
        .update({ provider_message_id: providerMessageId })
        .eq("id", taggedDeliveryId)
        .eq("provider", "resend")
        .is("provider_message_id", null)
        .select("id,event_id,status,provider_message_id,provider_metadata")
        .maybeSingle();
      if (correlation.error) throw correlation.error;
      delivery = correlation.data;
      if (!delivery) {
        const correlatedLookup = await db.from("notification_deliveries")
          .select("id,event_id,status,provider_message_id,provider_metadata")
          .eq("id", taggedDeliveryId)
          .eq("provider", "resend")
          .eq("provider_message_id", providerMessageId)
          .maybeSingle();
        if (correlatedLookup.error) throw correlatedLookup.error;
        delivery = correlatedLookup.data;
      }
    }
    if (taggedDeliveryId && !delivery) {
      throw new Error("Tagged notification delivery is not correlated yet");
    }

    if (delivery) {
      if (type === "email.sent") {
        const result = await db.rpc("complete_notification_delivery", {
          p_delivery_id: delivery.id,
          p_status: "sent",
          p_provider_message_id: providerMessageId,
          p_provider_metadata: { webhook_sent_at: new Date().toISOString() },
          p_worker_id: null,
        });
        if (result.error) throw result.error;
        if (result.data !== true) throw new Error("Sent webhook could not update delivery");
      } else if (type === "email.delivered") {
        const result = await db.rpc("complete_notification_delivery", {
          p_delivery_id: delivery.id,
          p_status: "delivered",
          p_provider_message_id: providerMessageId,
          p_provider_metadata: { webhook_delivered_at: new Date().toISOString() },
          p_worker_id: null,
        });
        if (result.error) throw result.error;
        if (result.data !== true) throw new Error("Delivered webhook could not update delivery");
      } else if (type === "email.bounced" || type === "email.failed") {
        const result = await db.rpc("fail_notification_delivery", {
          p_delivery_id: delivery.id,
          p_error: type === "email.bounced" ? "Resend reported a bounced email" : "Resend reported a failed email",
          p_retry_after_seconds: 86400,
          p_permanent: true,
          p_worker_id: null,
          p_provider_message_id: providerMessageId,
        });
        if (result.error) throw result.error;
        if (!result.data) throw new Error("Failure webhook could not update delivery");
      } else if (type === "email.complained" || type === "email.suppressed") {
        const result = await db.rpc("complete_notification_delivery", {
          p_delivery_id: delivery.id,
          p_status: "suppressed",
          p_provider_message_id: providerMessageId,
          p_provider_metadata: { suppression_event: type },
          p_worker_id: null,
        });
        if (result.error) throw result.error;
        if (result.data !== true) throw new Error("Suppression webhook could not update delivery");
      } else if (type === "email.delivery_delayed") {
        const result = await db.rpc("complete_notification_delivery", {
          p_delivery_id: delivery.id,
          p_status: "sent",
          p_provider_message_id: providerMessageId,
          p_provider_metadata: { delivery_delayed_at: new Date().toISOString() },
          p_worker_id: null,
        });
        if (result.error) throw result.error;
        // A delayed event can arrive after a permanent bounce. In that case the
        // dead state is authoritative and the webhook is safely idempotent.
        if (result.data !== true) {
          const current = await db.from("notification_deliveries")
            .select("status")
            .eq("id", delivery.id)
            .eq("provider_message_id", providerMessageId)
            .maybeSingle();
          if (current.error) throw current.error;
          if (!["dead", "cancelled"].includes(String(current.data?.status || ""))) {
            throw new Error("Delayed webhook could not update delivery");
          }
        }
      }

      const eventResult = await db.from("notification_events")
        .select("order_id,fulfillment_id,event_type")
        .eq("id", delivery.event_id)
        .maybeSingle();
      if (eventResult.error) throw eventResult.error;
      const trackedEventType = String(eventResult.data?.event_type || "").toLowerCase();
      if (eventResult.data?.order_id &&
          (trackedEventType.startsWith("order.") ||
            trackedEventType === "fulfillment.delivered" ||
            trackedEventType === "activation.completed")) {
        // Read the authoritative post-RPC status. Webhooks may arrive out of
        // order (for example delivered after complained), and the SQL state
        // machine intentionally preserves the stronger terminal state.
        const currentDelivery = await db.from("notification_deliveries")
          .select("status,last_error")
          .eq("id", delivery.id)
          .maybeSingle();
        if (currentDelivery.error) throw currentDelivery.error;
        const finalDeliveryStatus = String(currentDelivery.data?.status || "").toLowerCase();
        const emailStatus = ["sent", "delivered", "dead", "suppressed", "failed"]
            .includes(finalDeliveryStatus)
          ? finalDeliveryStatus
          : null;
        if (emailStatus) {
          let fulfillmentQuery = db.from("fulfillments").update({
            email_status: emailStatus,
            email_error: ["dead", "failed"].includes(emailStatus)
              ? String(currentDelivery.data?.last_error || "Email delivery failed").slice(0, 500)
              : null,
          }).eq("order_id", eventResult.data.order_id);
          if (eventResult.data.fulfillment_id) {
            fulfillmentQuery = fulfillmentQuery.eq("id", eventResult.data.fulfillment_id);
          }
          const fulfillmentUpdate = await fulfillmentQuery;
          if (fulfillmentUpdate.error) throw fulfillmentUpdate.error;
        }
      }
    }

    if (["email.bounced", "email.complained", "email.suppressed"].includes(type)) {
      for (const email of recipients) {
        const suppressionUpsert = await db.from("email_suppressions").upsert({
          email,
          reason: type,
          provider: "resend",
          provider_event_id: webhookId,
        }, { onConflict: "email" });
        if (suppressionUpsert.error) throw suppressionUpsert.error;
      }
    }

    const processedUpdate = await db.from("notification_webhook_events").update({ processed_at: new Date().toISOString() })
      .eq("provider", "resend").eq("provider_event_id", webhookId);
    if (processedUpdate.error) throw processedUpdate.error;
    return json({ success: true, matched: !!delivery });
  } catch (error: any) {
    // Never include the raw webhook body or message content in the response/logs.
    console.error("Resend webhook processing failed", String(error?.message || "unknown").slice(0, 300));
    return json({ success: false, error: "Webhook processing failed" }, 500);
  }
});
