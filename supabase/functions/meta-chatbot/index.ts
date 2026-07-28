import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  detectLanguage,
  deterministicReply,
  identifyIntent,
  normalizeMessage,
  redactSensitiveText,
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
  const appSecret = Deno.env.get("META_APP_SECRET") || "";
  const provided = req.headers.get("x-hub-signature-256") || "";
  if (!appSecret || !provided.startsWith("sha256=")) return false;
  const expected = await hmacHex(appSecret, rawBody);
  return constantTimeEqual(provided.slice(7), expected);
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

async function sendMetaReply(channel: string, accountId: string, recipientId: string, text: string) {
  const token = graphToken(channel);
  if (!token) throw new Error(`Missing access token for ${channel}`);
  const endpoint = `https://graph.facebook.com/v25.0/${encodeURIComponent(accountId)}/messages`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: text.slice(0, 1900) },
      messaging_type: "RESPONSE",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Meta send failed (${response.status}): ${String(payload?.error?.message || "unknown")}`);
  return String(payload?.message_id || "");
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
  history,
  diagnostics,
}: {
  text: string;
  locale: string;
  services: any[];
  knowledge: any[];
  history: any[];
  diagnostics?: { error?: string };
}) {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || "";
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
  const catalog = services.map((service) => ({
    id: service.id,
    names: service.n,
    prices_dzd: service.p,
    fulfillment_mode: service.fulfillment_mode,
    unavailable: service.out_of_stock || null,
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
    "Mirror the customer's language and script. Keep the reply friendly, concise, and suitable for a direct message.",
    "Use only the catalog and facts below. Never invent a price, duration, stock state, policy, promotion, or order status.",
    "A numeric price of 0 means that duration is unavailable; never advertise it.",
    "Never request or reveal a password, PIN, payment credential, or account credential.",
    "Never disclose customer-specific order information in social messages. Direct order-status requests to https://www.striviodz.store/my-account.",
    "If the request is ambiguous, sensitive, angry, asks for a human, or cannot be answered from supplied facts, set handoff=true.",
    "Return only JSON matching: {reply:string, language:'ar'|'fr'|'en'|'dz', intent:string, confidence:number, handoff:boolean}.",
    `Preferred detected language: ${locale}`,
    `Catalog: ${JSON.stringify(catalog)}`,
    `Knowledge: ${JSON.stringify(facts)}`,
    `Recent conversation: ${JSON.stringify(safeHistory)}`,
    `Customer message: ${safeText}`,
  ].join("\n\n");
  const response = await fetch(
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
          temperature: 0.25,
          maxOutputTokens: 500,
          responseFormat: {
            text: {
              mimeType: "application/json",
              schema: {
                type: "object",
                properties: {
                  reply: { type: "string" },
                  language: { type: "string", enum: ["ar", "fr", "en", "dz"] },
                  intent: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  handoff: { type: "boolean" },
                },
                required: ["reply", "language", "intent", "confidence", "handoff"],
                additionalProperties: false,
              },
            },
          },
        },
      }),
    },
  );
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
  const [settingsResult, servicesResult, knowledgeResult] = await Promise.all([
    db.from("chatbot_settings").select("*").eq("id", 1).maybeSingle(),
    db.from("services")
      .select("id,n,p,out_of_stock,fulfillment_mode,fulfillment_config,sort_order")
      .order("sort_order", { ascending: true }),
    db.from("chatbot_knowledge")
      .select("knowledge_key,category,answers,keywords,priority,active")
      .eq("active", true)
      .order("priority", { ascending: true }),
  ]);
  if (settingsResult.error) throw settingsResult.error;
  if (servicesResult.error) throw servicesResult.error;
  if (knowledgeResult.error) throw knowledgeResult.error;
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
    const updated = await db.from("chatbot_conversations")
      .update({
        locale: event.locale,
        last_inbound_at: now,
        unread_count: Number(existing.data.unread_count || 0) + 1,
        metadata: { ...(existing.data.metadata || {}), last_event_type: event.eventType },
      })
      .eq("id", existing.data.id)
      .select("*")
      .single();
    if (updated.error) throw updated.error;
    return updated.data;
  }
  const created = await db.from("chatbot_conversations").insert({
    channel: event.channel,
    channel_account_id: event.accountId,
    external_user_id: event.senderId,
    external_thread_id: event.threadId || null,
    locale: event.locale,
    last_inbound_at: now,
    unread_count: 1,
    metadata: { last_event_type: event.eventType },
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
      const text = String(item?.message?.text || item?.postback?.title || "").trim();
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
        locale: detectLanguage(text),
        eventType: item?.postback ? "postback" : "message",
        timestamp: Number(item?.timestamp || entry?.time || Date.now()),
      });
    }
  }
  return events;
}

async function handleInbound(db: any, event: any, botData: any, shouldSend: boolean) {
  const duplicate = await db.from("chatbot_messages")
    .select("id")
    .eq("provider_message_id", event.providerMessageId)
    .maybeSingle();
  if (duplicate.error) throw duplicate.error;
  if (duplicate.data) return { duplicate: true };

  const conversation = await upsertConversation(db, event);
  const detected = identifyIntent(event.text);
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
    metadata: { event_type: event.eventType, timestamp: event.timestamp },
  }).select("id").single();
  if (inbound.error) throw inbound.error;

  if (!botData.settings.enabled || !botData.settings.auto_reply_enabled || conversation.mode !== "bot") {
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
  if (inboundBurst > 8) {
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
  });
  const aiDiagnostics: { error?: string } = {};
  if (!answer.reply && botData.settings.ai_enabled && botData.settings.provider === "gemini") {
    const ai = await askGemini({
      text: event.text,
      locale: event.locale,
      services: botData.services,
      knowledge: botData.knowledge,
      history: recent,
      diagnostics: aiDiagnostics,
    });
    if (ai) answer = { ...answer, ...ai };
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

  if (answer.handoff) {
    await db.from("chatbot_conversations").update({
      mode: "human",
      handoff_reason: answer.intent || "requested",
    }).eq("id", conversation.id);
  }

  let providerMessageId = "";
  let deliveryStatus = shouldSend ? "queued" : "sent";
  let deliveryError = "";
  if (shouldSend) {
    try {
      providerMessageId = await sendMetaReply(
        event.channel,
        event.accountId,
        event.senderId,
        answer.reply,
      );
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
    metadata: deliveryError ? { error: deliveryError } : {},
  });
  if (outbound.error) throw outbound.error;

  await db.from("chatbot_conversations").update({
    last_outbound_at: new Date().toISOString(),
  }).eq("id", conversation.id);

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
    ai_diagnostic: event.eventType === "test" ? aiDiagnostics.error : undefined,
  };
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

    let providerMessageId = "";
    try {
      providerMessageId = await sendMetaReply(
        conversation.channel,
        conversation.channel_account_id,
        conversation.external_user_id,
        text,
      );
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
      message_text: text,
      normalized_text: normalizeMessage(text),
      locale: detectLanguage(text),
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
