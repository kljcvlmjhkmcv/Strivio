import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  buildMetaActions,
  detectLanguage,
  deterministicReply,
  identifyIntent,
  mergeConversationMemory,
  normalizeMessage,
  redactSensitiveText,
  socialSafeReply,
  stabilizeBidiReply,
} from "./chatbot-core.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const ALLOWED_ORIGINS = new Set([
  "https://www.striviodz.store",
  "https://striviodz.store",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...JSON_HEADERS,
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://www.striviodz.store",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyMetaSignature(req: Request, rawBody: string) {
  const provided = req.headers.get("x-hub-signature-256") || "";
  if (!provided.startsWith("sha256=")) return false;

  // Messenger webhooks are signed with the Meta app secret, while the
  // Instagram Login setup uses its own Instagram app secret.
  const secrets = Array.from(new Set([
    Deno.env.get("META_APP_SECRET") || "",
    Deno.env.get("META_INSTAGRAM_APP_SECRET") || "",
  ].filter(Boolean)));
  if (!secrets.length) return false;

  let valid = false;
  for (const secret of secrets) {
    const expected = await hmacHex(secret, rawBody);
    valid = constantTimeEqual(provided.slice(7), expected) || valid;
  }
  return valid;
}

async function isAdminRequest(db: any, req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;
  const userResult = await db.auth.getUser(token);
  const userId = userResult.data?.user?.id;
  if (!userId) return false;
  const admin = await db.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
  return !admin.error && Boolean(admin.data);
}

function graphToken(channel: string) {
  if (channel === "instagram") {
    return Deno.env.get("META_INSTAGRAM_ACCESS_TOKEN")
      || Deno.env.get("META_PAGE_ACCESS_TOKEN")
      || "";
  }
  return Deno.env.get("META_PAGE_ACCESS_TOKEN") || "";
}

type MetaAction = {
  type: "web_url" | "postback";
  title: string;
  url?: string;
  payload?: string;
};

function metaEndpoint(channel: string, accountId: string) {
  return channel === "instagram"
    ? "https://graph.instagram.com/v25.0/me/messages"
    : `https://graph.facebook.com/v25.0/${encodeURIComponent(accountId)}/messages`;
}

async function postMetaMessage(
  channel: string,
  accountId: string,
  recipientId: string,
  message: Record<string, unknown>,
) {
  const token = graphToken(channel);
  if (!token) throw new Error(`Missing access token for ${channel}`);
  const body: Record<string, unknown> = {
    recipient: { id: recipientId },
    message,
  };
  if (channel !== "instagram") body.messaging_type = "RESPONSE";
  const response = await fetch(metaEndpoint(channel, accountId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Meta send failed (${response.status}): ${String(payload?.error?.message || "unknown")}`);
  return String(payload?.message_id || "");
}

async function sendMetaReply(
  channel: string,
  accountId: string,
  recipientId: string,
  text: string,
  options: { actions?: MetaAction[]; locale?: string } = {},
) {
  const locale = options.locale || detectLanguage(text);
  const outboundText = channel === "instagram"
    ? socialSafeReply(text, locale)
    : String(text || "").trim();
  if (!outboundText) throw new Error("Reply is empty after safety filtering");
  const actions = Array.isArray(options.actions) ? options.actions.slice(0, 3) : [];
  if (!actions.length) {
    const messageId = await postMetaMessage(
      channel,
      accountId,
      recipientId,
      { text: outboundText.slice(0, 1900) },
    );
    return { messageId, template: false, fallback: false, error: "" };
  }

  const buttons = actions.map((action) => action.type === "web_url"
    ? {
        type: "web_url",
        url: String(action.url || "").slice(0, 1000),
        title: String(action.title || "").slice(0, 20),
      }
    : {
        type: "postback",
        title: String(action.title || "").slice(0, 20),
        payload: String(action.payload || "").slice(0, 1000),
      });
  try {
    const messageId = await postMetaMessage(channel, accountId, recipientId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: outboundText.slice(0, 600),
          buttons,
        },
      },
    });
    return { messageId, template: true, fallback: false, error: "" };
  } catch (error) {
    const templateError = String(error?.message || error).slice(0, 500);
    const fallbackText = socialSafeReply(outboundText, locale);
    const messageId = await postMetaMessage(
      channel,
      accountId,
      recipientId,
      { text: fallbackText.slice(0, 1900) },
    );
    return { messageId, template: false, fallback: true, error: templateError };
  }
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function askGemini({
  text,
  locale,
  services,
  knowledge,
  bundleRules,
  history,
  memory,
  diagnostics,
}: {
  text: string;
  locale: string;
  services: any[];
  knowledge: any[];
  bundleRules: any[];
  history: any[];
  memory?: Record<string, unknown>;
  diagnostics?: { error?: string };
}) {
  const apiKey = (Deno.env.get("GEMINI_API_KEY") || "").replace(/[^A-Za-z0-9._-]/g, "");
  if (!apiKey) {
    if (diagnostics) diagnostics.error = "GEMINI_API_KEY is missing";
    return null;
  }
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
  const safeText = redactSensitiveText(text).slice(0, 1200);
  const safeHistory = history.slice(-8).map((item) => ({
    role: item.sender_role,
    text: redactSensitiveText(item.message_text).slice(0, 500),
  }));
  const durationMonths = [1, 2, 3, 6, 12];
  const catalog = services.map((service) => {
    const typeLabels = service?.types || {};
    const typePrices = Array.isArray(service?.type_prices) ? service.type_prices : [];
    const plans = service?.show_types && typePrices.length
      ? typePrices.map((prices: any[], typeIndex: number) => ({
          type_index: typeIndex,
          names: {
            ar: typeLabels?.ar?.[typeIndex] || `الخيار ${typeIndex + 1}`,
            fr: typeLabels?.fr?.[typeIndex] || `Option ${typeIndex + 1}`,
            en: typeLabels?.en?.[typeIndex] || `Option ${typeIndex + 1}`,
          },
          durations: durationMonths
            .map((months, durationIndex) => ({
              months,
              price_dzd: Number(prices?.[durationIndex] || 0),
            }))
            .filter((item) => item.price_dzd > 0),
        })).filter((plan: any) => plan.durations.length)
      : [{
          type_index: 0,
          names: { ar: "عادي", fr: "Standard", en: "Standard" },
          durations: durationMonths
            .map((months, durationIndex) => ({
              months,
              price_dzd: Number(service?.p?.[durationIndex] || 0),
            }))
            .filter((item) => item.price_dzd > 0),
        }];
    return {
      id: service.id,
      names: service.n,
      plans,
      delivery_mode: service.fulfillment_mode,
      out_of_stock: service.out_of_stock?.all === true || service.out_of_stock === true,
      duration_notes: service.dur_notes || service.promo?.dur_notes || [],
      promotion: service.promo || null,
    };
  });
  const now = Date.now();
  const offers = (Array.isArray(bundleRules) ? bundleRules : [])
    .filter((rule) => {
      if (!rule?.active) return false;
      const startsAt = rule.starts_at ? new Date(rule.starts_at).getTime() : 0;
      const endsAt = rule.ends_at ? new Date(rule.ends_at).getTime() : 0;
      return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
    })
    .map((rule) => ({
      source_service_id: rule.source_service_id,
      source_duration_months: durationMonths[Number(rule.source_duration_idx)] || null,
      source_type_index: rule.source_type_idx,
      gift_service_id: rule.gift_service_id,
      gift_duration: rule.gift_duration_strategy === "same"
        ? "same_as_paid_plan"
        : durationMonths[Number(rule.gift_duration_idx)] || null,
      gift_quantity: Number(rule.gift_quantity || 1),
      quantity_mode: rule.quantity_mode,
      included_on_renewal: Boolean(rule.include_renewals),
      labels: rule.label_i18n,
    }));
  const facts = knowledge
    .filter((item) => item.active)
    .slice(0, 30)
    .map((item) => ({
      key: item.knowledge_key,
      category: item.category,
      answers: item.answers,
    }));
  const prompt = [
    "You are Strivio's sales assistant for Instagram and Facebook messages.",
    "Understand Arabic, French, English, Algerian Darija, and Algerian Arabizi such as khsni, n7ab, ch7al, kifach, wa9tach.",
    "Mirror the customer's language and script. Keep the reply friendly, structured, accurate, and under 560 characters.",
    "When language is dz, answer in Algerian Darija/Arabizi that matches the customer's writing, not formal French.",
    "For Arabic or Darija, avoid mixing Arabic and Latin words in one sentence. Put service names, numbers and Latin terms on separate short labeled lines when useful.",
    "Prefer one fact per line. Never use Markdown tables. Do not use URLs in text.",
    "Use only the catalog, active offers, operational rules, and knowledge below. Never invent a price, duration, stock state, policy, promotion, coupon, or order status.",
    "A numeric price of 0 means that duration is unavailable; never advertise it.",
    "For typed products such as Netflix screens or IPTV packages, quote the exact matching plan. If screen count, package, or duration is missing, ask one short clarification instead of guessing.",
    "If the customer asks for Netflix for 1 or 2 months and a matching 3-month active gift offer exists, first quote the exact requested price, then briefly suggest the exact 3-month price and its free gift. Never replace the requested choice.",
    "Mention a free gift only when it exists in Active offers and the requested paid duration/type matches. State whether it is excluded from renewals.",
    "If the customer asks for all prices, list only available prices and group them clearly by product type.",
    "Never include a URL, domain name, clickable link, or protocol in any reply. Say 'use the link in our bio' in the customer's language.",
    "Never request or reveal a password, PIN, payment credential, or account credential.",
    "Never disclose customer-specific order information in social messages. For order status, tell the customer to open Strivio from the bio, sign in using the order email, then open My Account and Purchases.",
    "Buying flow: choose a service, duration and type/quantity; add to cart; enter name, email and phone; choose payment; confirm; then follow delivery from My Account.",
    "Payment methods: CIB/Dahabia card through SATIM; BaridiMob; CCP; Wise in EUR with the current rate shown in cart; USDT with the current rate shown in cart; Flexy with a 19% service fee. Coupons are validated in cart.",
    "Delivery modes: automatic_slot and automatic_account are delivered after payment confirmation when stock is ready; manual_activation asks the customer for their service login inside the protected order page and Strivio activates it; manual_delivery is prepared and delivered by the Strivio team.",
    "When the customer is ready to buy, offer both choices: order securely on the website, or continue manually in this chat. Interactive buttons are added by the backend, so do not write button labels or a link.",
    "If the request is ambiguous, sensitive, angry, asks for a human, or cannot be answered from supplied facts, set handoff=true.",
    "Return only JSON matching: {reply:string, language:'ar'|'fr'|'en'|'dz', intent:string, confidence:number, handoff:boolean}.",
    `Preferred detected language: ${locale}`,
    `Catalog: ${JSON.stringify(catalog)}`,
    `Active offers: ${JSON.stringify(offers)}`,
    `Knowledge: ${JSON.stringify(facts)}`,
    `Remembered conversation context (may be incomplete; never treat it as verified customer identity): ${JSON.stringify(memory || {})}`,
    `Recent conversation: ${JSON.stringify(safeHistory)}`,
    `Customer message: ${safeText}`,
  ].join("\n\n");
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 1400,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                reply: { type: "STRING" },
                language: { type: "STRING", enum: ["ar", "fr", "en", "dz"] },
                intent: { type: "STRING" },
                confidence: { type: "NUMBER", minimum: 0, maximum: 1 },
                handoff: { type: "BOOLEAN" },
              },
              required: ["reply", "language", "intent", "confidence", "handoff"],
            },
          },
        }),
      },
    );
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    if (diagnostics) diagnostics.error = `Gemini network error: ${message}`;
    console.warn("Gemini request could not be sent", { model, error: message });
    return null;
  }
  const responseText = await response.text();
  if (!response.ok) {
    if (diagnostics) diagnostics.error = `Gemini HTTP ${response.status}: ${responseText.slice(0, 500)}`;
    console.warn("Gemini request failed", {
      status: response.status,
      body: responseText.slice(0, 800),
      model,
    });
    return null;
  }
  const payload = safeJson(responseText);
  const output = String(payload?.candidates?.[0]?.content?.parts?.[0]?.text || "");
  const parsed = safeJson(output);
  if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) {
    if (diagnostics) diagnostics.error = `Gemini response parse failed: ${responseText.slice(0, 500)}`;
    console.warn("Gemini response could not be parsed", {
      model,
      body: responseText.slice(0, 800),
    });
    return null;
  }
  return {
    reply: parsed.reply.trim().slice(0, 1900),
    locale: ["ar", "fr", "en", "dz"].includes(parsed.language) ? parsed.language : locale,
    intent: String(parsed.intent || "ai_answer").slice(0, 100),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0.7))),
    handoff: Boolean(parsed.handoff),
    source: "gemini",
  };
}

async function loadBotData(db: any) {
  const [settingsResult, servicesResult, knowledgeResult, bundleRulesResult] = await Promise.all([
    db.from("chatbot_settings").select("*").eq("id", 1).maybeSingle(),
    db.from("services")
      .select("id,n,p,dur_notes,show_types,types,type_prices,promo,out_of_stock,fulfillment_mode,sort_order")
      .order("sort_order", { ascending: true }),
    db.from("chatbot_knowledge")
      .select("knowledge_key,category,answers,keywords,priority,active")
      .eq("active", true)
      .order("priority", { ascending: true }),
    db.from("service_bundle_rules")
      .select("source_service_id,source_duration_idx,source_type_idx,gift_service_id,gift_duration_strategy,gift_duration_idx,gift_quantity,quantity_mode,include_renewals,label_i18n,active,starts_at,ends_at,priority")
      .eq("active", true)
      .order("priority", { ascending: true }),
  ]);
  if (settingsResult.error) throw settingsResult.error;
  if (servicesResult.error) throw servicesResult.error;
  if (knowledgeResult.error) throw knowledgeResult.error;
  if (bundleRulesResult.error) throw bundleRulesResult.error;
  return {
    settings: settingsResult.data || {
      enabled: true,
      auto_reply_enabled: true,
      ai_enabled: true,
      provider: "gemini",
      default_locale: "fr",
    },
    services: servicesResult.data || [],
    knowledge: knowledgeResult.data || [],
    bundleRules: bundleRulesResult.data || [],
  };
}

async function upsertConversation(db: any, event: any) {
  const now = new Date().toISOString();
  const existing = await db.from("chatbot_conversations")
    .select("*")
    .eq("channel", event.channel)
    .eq("channel_account_id", event.accountId)
    .eq("external_user_id", event.senderId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const memory = mergeConversationMemory(
      existing.data.memory || existing.data.metadata?.memory || {},
      event.text,
      event.payload,
    );
    const updated = await db.from("chatbot_conversations")
      .update({
        locale: event.locale,
        last_inbound_at: now,
        unread_count: Number(existing.data.unread_count || 0) + 1,
        memory,
        follow_up_due_at: null,
        metadata: {
          ...(existing.data.metadata || {}),
          memory,
          last_event_type: event.eventType,
        },
      })
      .eq("id", existing.data.id)
      .select("*")
      .single();
    if (updated.error) throw updated.error;
    return updated.data;
  }
  const memory = mergeConversationMemory({}, event.text, event.payload);
  const created = await db.from("chatbot_conversations").insert({
    channel: event.channel,
    channel_account_id: event.accountId,
    external_user_id: event.senderId,
    external_thread_id: event.threadId || null,
    locale: event.locale,
    last_inbound_at: now,
    unread_count: 1,
    memory,
    metadata: { memory, last_event_type: event.eventType },
  }).select("*").single();
  if (created.error) throw created.error;
  return created.data;
}

function extractMetaEvents(payload: any) {
  const channel = payload?.object === "instagram" ? "instagram" : "messenger";
  const events: any[] = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const item of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      if (item?.message?.is_echo) continue;
      const payloadValue = String(item?.postback?.payload || item?.message?.quick_reply?.payload || "").trim();
      const text = String(item?.message?.text || item?.postback?.title || payloadValue || "").trim();
      const providerMessageId = String(item?.message?.mid || item?.postback?.mid || "").trim();
      const senderId = String(item?.sender?.id || "").trim();
      const accountId = String(item?.recipient?.id || entry?.id || "").trim();
      if (!text || !senderId || !accountId) continue;
      events.push({
        channel,
        accountId,
        senderId,
        threadId: senderId,
        providerMessageId: providerMessageId || `${channel}:${entry?.time || Date.now()}:${senderId}`,
        text: text.slice(0, 4000),
        payload: payloadValue.slice(0, 1000),
        locale: detectLanguage(text),
        eventType: item?.postback ? "postback" : "message",
        timestamp: Number(item?.timestamp || entry?.time || Date.now()),
      });
    }
  }
  return events;
}

function isSalesIntent(intent: string) {
  return ["price", "purchase", "service_interest", "payment", "delivery", "ai_answer"].includes(String(intent || ""));
}

function shouldAttachActions(answer: any, memory: any) {
  return Boolean(memory?.service_id) || isSalesIntent(answer?.intent) || answer?.intent === "greeting";
}

function followUpText(locale: string, memory: any) {
  const service = String(memory?.service_id || "").trim();
  const serviceLabel = service ? ` ${service}` : "";
  const variants: Record<string, string> = {
    ar: `هل ما زلت مهتمًا بطلب${serviceLabel}؟ يمكنك الطلب من الموقع أو إكماله هنا، وأنا أساعدك.`,
    fr: `Êtes-vous toujours intéressé par${serviceLabel} ? Vous pouvez commander sur le site ou continuer ici.`,
    en: `Are you still interested in${serviceLabel}? You can order on the website or continue here.`,
    dz: `ما زلت مهتم بـ${serviceLabel}؟ تقدر تطلب من الموقع ولا نكملو هنا.`,
  };
  return variants[locale] || variants.fr;
}

async function canUseAi(db: any, conversationId: string, settings: any) {
  const hourLimit = Math.max(4, Number(settings.max_ai_replies_per_hour || 16));
  const dailyLimit = Math.max(20, Number(settings.daily_ai_limit || 300));
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [conversationUsage, dailyUsage] = await Promise.all([
    db.from("chatbot_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("reply_source", "gemini")
      .gte("created_at", hourAgo),
    db.from("chatbot_messages")
      .select("id", { count: "exact", head: true })
      .eq("reply_source", "gemini")
      .gte("created_at", dayStart.toISOString()),
  ]);
  if (conversationUsage.error || dailyUsage.error) return true;
  return Number(conversationUsage.count || 0) < hourLimit
    && Number(dailyUsage.count || 0) < dailyLimit;
}

async function handleInbound(db: any, event: any, botData: any, shouldSend: boolean) {
  const duplicate = await db.from("chatbot_messages")
    .select("id")
    .eq("provider_message_id", event.providerMessageId)
    .maybeSingle();
  if (duplicate.error) throw duplicate.error;
  if (duplicate.data) return { duplicate: true };

  const conversation = await upsertConversation(db, event);
  const memory = conversation.memory || conversation.metadata?.memory || {};
  const payloadValue = String(event.payload || "");
  const isChatOrderPostback = payloadValue.startsWith("STRIVIO_CHAT_ORDER:");
  const isHumanPostback = payloadValue === "STRIVIO_HUMAN";
  const detected = isChatOrderPostback
    ? { intent: "manual_checkout", serviceId: memory.service_id || null, confidence: 1 }
    : identifyIntent(event.text);
  const inbound = await db.from("chatbot_messages").insert({
    conversation_id: conversation.id,
    provider_message_id: event.providerMessageId,
    direction: "inbound",
    sender_role: "customer",
    message_text: event.text,
    normalized_text: normalizeMessage(event.text),
    locale: event.locale,
    intent: detected.intent,
    confidence: detected.confidence,
    reply_source: null,
    delivery_status: "received",
    metadata: {
      event_type: event.eventType,
      timestamp: event.timestamp,
      postback_payload: payloadValue || null,
    },
  }).select("id").single();
  if (inbound.error) throw inbound.error;

  const isDiagnosticTest = event.eventType === "test";
  if (
    !botData.settings.enabled ||
    !botData.settings.auto_reply_enabled ||
    (!isDiagnosticTest && conversation.mode !== "bot")
  ) {
    return { stored: true, replied: false, mode: conversation.mode };
  }

  const recentResult = await db.from("chatbot_messages")
    .select("sender_role,message_text,created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(9);
  if (recentResult.error) throw recentResult.error;
  const recent = (recentResult.data || []).reverse();

  const oneMinuteAgo = Date.now() - 60_000;
  const inboundBurst = recent.filter((item: any) =>
    item.sender_role === "customer" && new Date(item.created_at).getTime() >= oneMinuteAgo
  ).length;
  const burstLimit = Math.max(3, Number(botData.settings.burst_limit_per_minute || 6));
  if (inboundBurst > burstLimit) {
    await db.from("chatbot_conversations").update({
      mode: "human",
      handoff_reason: "rate_limit",
    }).eq("id", conversation.id);
    return { stored: true, replied: false, handoff: true, reason: "rate_limit" };
  }

  let answer = deterministicReply({
    text: event.text,
    locale: event.locale,
    services: botData.services,
    knowledge: botData.knowledge,
    bundleRules: botData.bundleRules,
    memory,
  });
  if (isChatOrderPostback) {
    const variants: Record<string, string> = {
      ar: "ممتاز، سنكمل الطلب هنا. اكتب الخدمة والمدة والكمية التي تريدها، وسيستلم فريق Strivio المحادثة لتأكيد الطلب والدفع.",
      fr: "Parfait, nous continuons ici. Indiquez le service, la durée et la quantité. L’équipe Strivio prendra la conversation pour confirmer la commande et le paiement.",
      en: "Great, we’ll continue here. Send the service, duration and quantity. The Strivio team will take over to confirm the order and payment.",
      dz: "مليح، نكملو الطلب هنا. اكتب الخدمة والمدة والكمية، وفريق Strivio يكمل معاك تأكيد الطلب والدفع.",
    };
    answer = {
      ...answer,
      reply: variants[event.locale] || variants.fr,
      locale: event.locale,
      intent: "manual_checkout",
      confidence: 1,
      handoff: true,
      source: "rules",
    };
  } else if (isHumanPostback) {
    answer = deterministicReply({
      text: event.locale === "fr" ? "conseiller" : event.locale === "en" ? "human agent" : "موظف",
      locale: event.locale,
      services: botData.services,
      knowledge: botData.knowledge,
      bundleRules: botData.bundleRules,
      memory,
    });
  }
  const aiDiagnostics: { error?: string } = {};
  const keepRuleAnswer = answer.handoff
    || answer.precise === true
    || ["human_handoff", "order_status", "greeting"].includes(answer.intent);
  const aiAllowed = !keepRuleAnswer
    && botData.settings.ai_enabled
    && botData.settings.provider === "gemini"
    && await canUseAi(db, conversation.id, botData.settings);
  if (aiAllowed) {
    const ai = await askGemini({
      text: event.text,
      locale: event.locale,
      services: botData.services,
      knowledge: botData.knowledge,
      bundleRules: botData.bundleRules,
      history: recent,
      memory,
      diagnostics: aiDiagnostics,
    });
    if (ai) answer = { ...answer, ...ai };
  } else if (!keepRuleAnswer && botData.settings.ai_enabled) {
    aiDiagnostics.error = "AI usage limit reached; deterministic reply used";
  }

  if (!answer.reply) {
    const variants = botData.settings.human_handoff_message || {};
    answer = {
      ...answer,
      reply: String(variants[event.locale] || variants.fr || "L’équipe Strivio vous répondra bientôt."),
      handoff: true,
      source: "rules",
      confidence: 0.2,
    };
    await db.from("chatbot_unanswered").insert({
      conversation_id: conversation.id,
      message_id: inbound.data.id,
      message_text: event.text,
      normalized_text: normalizeMessage(event.text),
      locale: event.locale,
      reason: "unknown_intent",
    });
  }

  answer.reply = event.channel === "instagram"
    ? socialSafeReply(answer.reply, answer.locale || event.locale)
    : String(answer.reply || "").trim();
  answer.reply = stabilizeBidiReply(answer.reply, answer.locale || event.locale);

  if (answer.handoff) {
    await db.from("chatbot_conversations").update({
      mode: "human",
      handoff_reason: answer.intent || "requested",
    }).eq("id", conversation.id);
  }

  let providerMessageId = "";
  let deliveryStatus = shouldSend ? "queued" : "sent";
  let deliveryError = "";
  let usedTemplate = false;
  let usedFallback = false;
  const actions = shouldAttachActions(answer, memory)
    ? buildMetaActions({
        locale: answer.locale || event.locale,
        serviceId: String(memory.service_id || answer.serviceId || ""),
        websiteUrl: String(botData.settings.website_url || "https://www.striviodz.store"),
        includeWebsite: botData.settings.structured_messages_enabled !== false
          && botData.settings.website_buttons_enabled !== false,
        includeChat: botData.settings.structured_messages_enabled !== false
          && botData.settings.manual_checkout_enabled !== false
          && !answer.handoff,
        includeHuman: botData.settings.structured_messages_enabled !== false
          && !answer.handoff,
      })
    : [];
  if (shouldSend) {
    try {
      const sent = await sendMetaReply(
        event.channel,
        event.accountId,
        event.senderId,
        answer.reply,
        { actions, locale: answer.locale || event.locale },
      );
      providerMessageId = sent.messageId;
      usedTemplate = sent.template;
      usedFallback = sent.fallback;
      deliveryError = sent.error || "";
      deliveryStatus = "sent";
    } catch (error) {
      deliveryStatus = "failed";
      deliveryError = String(error?.message || error);
    }
  }

  const outbound = await db.from("chatbot_messages").insert({
    conversation_id: conversation.id,
    provider_message_id: providerMessageId || null,
    direction: "outbound",
    sender_role: "bot",
    message_text: answer.reply,
    normalized_text: normalizeMessage(answer.reply),
    locale: answer.locale,
    intent: answer.intent,
    confidence: answer.confidence,
    reply_source: answer.source,
    delivery_status: deliveryStatus,
    metadata: {
      ...(deliveryError ? { error: deliveryError } : {}),
      actions,
      template: usedTemplate,
      template_fallback: usedFallback,
      memory_snapshot: memory,
    },
  });
  if (outbound.error) throw outbound.error;

  const conversationChanges: Record<string, unknown> = {
    last_outbound_at: new Date().toISOString(),
  };
  if (
    !answer.handoff
    && deliveryStatus === "sent"
    && botData.settings.follow_up_enabled !== false
    && isSalesIntent(answer.intent)
    && Number(conversation.follow_up_count || 0) < Number(botData.settings.max_followups_per_conversation || 1)
  ) {
    const delay = Math.max(30, Number(botData.settings.follow_up_delay_minutes || 120));
    conversationChanges.follow_up_due_at = new Date(Date.now() + delay * 60_000).toISOString();
  }
  await db.from("chatbot_conversations").update(conversationChanges).eq("id", conversation.id);

  return {
    stored: true,
    replied: deliveryStatus === "sent",
    reply: answer.reply,
    locale: answer.locale,
    intent: answer.intent,
    confidence: answer.confidence,
    source: answer.source,
    handoff: Boolean(answer.handoff),
    delivery_status: deliveryStatus,
    error: deliveryError || undefined,
    actions,
    structured_message: usedTemplate,
    structured_fallback: usedFallback,
    memory,
    ai_diagnostic: event.eventType === "test" ? aiDiagnostics.error : undefined,
  };
}

async function processFollowUps(db: any, botData: any, limitValue: number) {
  if (botData.settings.follow_up_enabled === false) return { processed: 0, sent: 0, skipped: 0 };
  const maximum = Math.min(50, Math.max(1, Number(limitValue || 20)));
  const nowIso = new Date().toISOString();
  const windowStart = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const maximumFollowUps = Math.max(0, Number(botData.settings.max_followups_per_conversation || 1));
  if (!maximumFollowUps) return { processed: 0, sent: 0, skipped: 0 };

  const dueResult = await db.from("chatbot_conversations")
    .select("*")
    .eq("mode", "bot")
    .in("channel", ["instagram", "messenger"])
    .not("follow_up_due_at", "is", null)
    .lte("follow_up_due_at", nowIso)
    .gte("last_inbound_at", windowStart)
    .lt("follow_up_count", maximumFollowUps)
    .order("follow_up_due_at", { ascending: true })
    .limit(maximum);
  if (dueResult.error) throw dueResult.error;

  let sentCount = 0;
  let skipped = 0;
  for (const conversation of dueResult.data || []) {
    const memory = conversation.memory || conversation.metadata?.memory || {};
    const locale = String(conversation.locale || botData.settings.default_locale || "fr");
    const text = stabilizeBidiReply(followUpText(locale, memory), locale);
    const actions = buildMetaActions({
      locale,
      serviceId: String(memory.service_id || ""),
      websiteUrl: String(botData.settings.website_url || "https://www.striviodz.store"),
      includeWebsite: botData.settings.website_buttons_enabled !== false,
      includeChat: botData.settings.manual_checkout_enabled !== false,
      includeHuman: true,
    });
    try {
      const sent = await sendMetaReply(
        conversation.channel,
        conversation.channel_account_id,
        conversation.external_user_id,
        text,
        { actions, locale },
      );
      const messageResult = await db.from("chatbot_messages").insert({
        conversation_id: conversation.id,
        provider_message_id: sent.messageId || null,
        direction: "outbound",
        sender_role: "bot",
        message_text: text,
        normalized_text: normalizeMessage(text),
        locale,
        intent: "sales_follow_up",
        confidence: 1,
        reply_source: "scheduler",
        delivery_status: "sent",
        metadata: {
          actions,
          template: sent.template,
          template_fallback: sent.fallback,
          ...(sent.error ? { warning: sent.error } : {}),
        },
      });
      if (messageResult.error) throw messageResult.error;
      const updated = await db.from("chatbot_conversations").update({
        follow_up_due_at: null,
        follow_up_sent_at: nowIso,
        follow_up_count: Number(conversation.follow_up_count || 0) + 1,
        last_outbound_at: nowIso,
      }).eq("id", conversation.id);
      if (updated.error) throw updated.error;
      sentCount += 1;
    } catch (error) {
      skipped += 1;
      console.warn("Chatbot follow-up failed", {
        conversation_id: conversation.id,
        error: String(error?.message || error).slice(0, 500),
      });
      await db.from("chatbot_conversations").update({
        follow_up_due_at: null,
        metadata: {
          ...(conversation.metadata || {}),
          last_follow_up_error: String(error?.message || error).slice(0, 500),
        },
      }).eq("id", conversation.id);
    }
  }
  return { processed: (dueResult.data || []).length, sent: sentCount, skipped };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode") || "";
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    const expected = Deno.env.get("META_VERIFY_TOKEN") || "";
    if (mode === "subscribe" && expected && constantTimeEqual(token, expected)) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    return json(req, { success: false, error: "Webhook verification failed" }, 403);
  }

  if (req.method !== "POST") return json(req, { success: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return json(req, { success: false, error: "Backend configuration is incomplete" }, 503);
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rawBody = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(req, { success: false, error: "Invalid JSON" }, 400);
  }

  const isTest = payload?.mode === "test";
  const isAdminReply = payload?.mode === "admin_reply";
  const isConversationUpdate = payload?.mode === "conversation_update";
  const isFollowUpWorker = payload?.mode === "process_followups";
  if (isFollowUpWorker) {
    const expectedWorkerSecret = Deno.env.get("META_CHATBOT_WORKER_SECRET") || "";
    const providedWorkerSecret = req.headers.get("x-chatbot-worker-secret") || "";
    if (!expectedWorkerSecret || !constantTimeEqual(expectedWorkerSecret, providedWorkerSecret)) {
      return json(req, { success: false, error: "Worker authorization failed" }, 401);
    }
    const botData = await loadBotData(db);
    const result = await processFollowUps(db, botData, Number(payload?.limit || 20));
    return json(req, { success: true, result });
  }
  if (isTest || isAdminReply || isConversationUpdate) {
    if (!(await isAdminRequest(db, req))) return json(req, { success: false, error: "Admin only" }, 401);
  }

  if (isTest) {
    const text = String(payload?.text || "").trim();
    if (!text || text.length > 4000) return json(req, { success: false, error: "Invalid test message" }, 400);
    const botData = await loadBotData(db);
    const testEvent = {
      channel: "test",
      accountId: "strivio-test",
      senderId: String(payload?.sender_id || "admin-test").slice(0, 200),
      threadId: "admin-test",
      providerMessageId: `test:${crypto.randomUUID()}`,
      text,
      locale: detectLanguage(text),
      eventType: "test",
      timestamp: Date.now(),
    };
    const result = await handleInbound(db, testEvent, botData, false);
    return json(req, { success: true, result });
  }

  if (isAdminReply) {
    const conversationId = String(payload?.conversation_id || "").trim();
    const text = String(payload?.text || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(conversationId) || !text || text.length > 1900) {
      return json(req, { success: false, error: "Invalid conversation or message" }, 400);
    }
    const conversationResult = await db.from("chatbot_conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();
    if (conversationResult.error) throw conversationResult.error;
    const conversation = conversationResult.data;
    if (!conversation || !["instagram", "messenger"].includes(conversation.channel)) {
      return json(req, { success: false, error: "Conversation not found" }, 404);
    }
    const outboundText = conversation.channel === "instagram"
      ? socialSafeReply(text, detectLanguage(text))
      : text;
    if (!outboundText) {
      return json(req, { success: false, error: "Message is empty after link filtering" }, 400);
    }

    let providerMessageId = "";
    try {
      const sent = await sendMetaReply(
        conversation.channel,
        conversation.channel_account_id,
        conversation.external_user_id,
        outboundText,
      );
      providerMessageId = sent.messageId;
    } catch (error) {
      return json(req, {
        success: false,
        error: String(error?.message || error),
      }, 502);
    }

    const inserted = await db.from("chatbot_messages").insert({
      conversation_id: conversation.id,
      provider_message_id: providerMessageId || null,
      direction: "outbound",
      sender_role: "admin",
      message_text: outboundText,
      normalized_text: normalizeMessage(outboundText),
      locale: detectLanguage(outboundText),
      intent: "admin_reply",
      confidence: 1,
      reply_source: "admin",
      delivery_status: "sent",
      metadata: {},
    });
    if (inserted.error) throw inserted.error;
    const updated = await db.from("chatbot_conversations").update({
      mode: "human",
      unread_count: 0,
      last_outbound_at: new Date().toISOString(),
      handoff_reason: "admin_reply",
    }).eq("id", conversation.id);
    if (updated.error) throw updated.error;
    return json(req, { success: true, provider_message_id: providerMessageId });
  }

  if (isConversationUpdate) {
    const conversationId = String(payload?.conversation_id || "").trim();
    const mode = String(payload?.conversation_mode || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(conversationId) || !["bot", "human", "paused", "closed"].includes(mode)) {
      return json(req, { success: false, error: "Invalid conversation update" }, 400);
    }
    const changes: Record<string, unknown> = {
      mode,
      unread_count: 0,
      handoff_reason: mode === "bot" ? null : String(payload?.reason || mode).slice(0, 160),
    };
    const updated = await db.from("chatbot_conversations")
      .update(changes)
      .eq("id", conversationId)
      .select("id,mode,unread_count")
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return json(req, { success: false, error: "Conversation not found" }, 404);
    return json(req, { success: true, conversation: updated.data });
  }

  if (!(await verifyMetaSignature(req, rawBody))) {
    return json(req, { success: false, error: "Invalid Meta signature" }, 401);
  }

  const events = extractMetaEvents(payload);
  if (!events.length) return json(req, { success: true, ignored: true });
  const botData = await loadBotData(db);
  const results = [];
  for (const event of events.slice(0, 20)) {
    try {
      results.push(await handleInbound(db, event, botData, true));
    } catch (error) {
      results.push({ success: false, error: String(error?.message || error) });
    }
  }
  return json(req, { success: true, results });
});
