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
} from "./chatbot-core.ts";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function postMetaSenderAction(
  channel: string,
  accountId: string,
  recipientId: string,
  senderAction: "mark_seen" | "typing_on" | "typing_off",
) {
  const token = graphToken(channel);
  if (!token) return false;
  const body: Record<string, unknown> = {
    recipient: { id: recipientId },
    sender_action: senderAction,
  };
  if (channel !== "instagram") body.messaging_type = "RESPONSE";
  const response = await fetch(metaEndpoint(channel, accountId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(1500),
  });
  // Instagram support for sender actions can vary by API surface. Treat an
  // unsupported action as a capability miss, never as a failed customer reply.
  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    console.info("Meta sender action unavailable", {
      channel,
      sender_action: senderAction,
      status: response.status,
      error: payload.slice(0, 240),
    });
    return false;
  }
  return true;
}

async function setMetaTyping(
  channel: string,
  accountId: string,
  recipientId: string,
  enabled: boolean,
) {
  try {
    if (enabled && channel === "messenger") {
      await Promise.all([
        postMetaSenderAction(channel, accountId, recipientId, "mark_seen"),
        postMetaSenderAction(channel, accountId, recipientId, "typing_on"),
      ]);
      return;
    }
    await postMetaSenderAction(
      channel,
      accountId,
      recipientId,
      enabled ? "typing_on" : "typing_off",
    );
  } catch (error) {
    console.info("Meta typing indicator skipped", {
      channel,
      error: String(error?.message || error).slice(0, 240),
    });
  }
}

function socialReplyWithOfficialLinks(
  value: string,
  locale = "fr",
  allowStrivioLinks = true,
) {
  if (!allowStrivioLinks) {
    return socialSafeReply(value, locale)
      .replace(/(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|store|dz|io|app|co|me)(?:\/[^\s]*)?/gi, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }
  const officialLinks: string[] = [];
  const protectedValue = String(value || "").replace(
    /https?:\/\/(?:www\.)?striviodz\.store(?:\/[^\s]*)?/gi,
    (url) => {
      const token = `STRIVIOOFFICIALLINK${officialLinks.length}TOKEN`;
      officialLinks.push(url);
      return token;
    },
  );
  let clean = socialSafeReply(protectedValue, locale);
  officialLinks.forEach((url, index) => {
    clean = clean.replace(`STRIVIOOFFICIALLINK${index}TOKEN`, url);
  });
  return clean;
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
  options: { actions?: MetaAction[]; locale?: string; allowStrivioLinks?: boolean } = {},
) {
  const locale = options.locale || detectLanguage(text);
  const outboundText = channel === "instagram"
    ? socialReplyWithOfficialLinks(text, locale, options.allowStrivioLinks !== false)
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
    const fallbackText = channel === "instagram"
      ? socialReplyWithOfficialLinks(outboundText, locale, options.allowStrivioLinks !== false)
      : outboundText;
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
  conversationState,
  allowStrivioLinks,
  replyCharLimit,
  diagnostics,
}: {
  text: string;
  locale: string;
  services: any[];
  knowledge: any[];
  bundleRules: any[];
  history: any[];
  memory?: Record<string, unknown>;
  conversationState?: Record<string, unknown>;
  allowStrivioLinks?: boolean;
  replyCharLimit?: number;
  diagnostics?: { error?: string };
}) {
  const apiKey = (Deno.env.get("GEMINI_API_KEY") || "").replace(/[^A-Za-z0-9._-]/g, "");
  if (!apiKey) {
    if (diagnostics) diagnostics.error = "GEMINI_API_KEY is missing";
    return null;
  }
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
  const safeText = redactSensitiveText(text).slice(0, 1200);
  const safeHistory = history.slice(-16).map((item) => ({
    role: item.sender_role,
    text: redactSensitiveText(item.message_text).slice(0, 500),
    intent: String(item.intent || "").slice(0, 80),
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
    `Mirror the customer's language and script. Keep the reply friendly, structured, accurate, and under ${Math.max(240, Math.min(900, Number(replyCharLimit || 560)))} characters.`,
    "When language is dz, answer in Algerian Darija/Arabizi that matches the customer's writing, not formal French.",
    "For Arabic or Darija, avoid mixing Arabic and Latin words in one sentence. Put service names, numbers and Latin terms on separate short labeled lines when useful.",
    "Prefer one fact per line. Never use Markdown tables.",
    "Format Algerian dinar prices without grouping spaces or separators: write 1200 DZD, never 1 200 DZD or 1,200 DZD.",
    "Use only the catalog, active offers, operational rules, and knowledge below. Never invent a price, duration, policy, promotion, coupon, warranty term, or order status. Do not discuss stock availability.",
    "A numeric price of 0 means that duration is unavailable; never advertise it.",
    "For typed products such as Netflix screens or IPTV packages, quote the exact matching plan. If screen count, package, or duration is missing, ask one short clarification instead of guessing.",
    "If the customer asks for Netflix for 1 or 2 months and a matching 3-month active gift offer exists, first quote the exact requested price, then briefly suggest the exact 3-month price and its free gift. Never replace the requested choice.",
    "Mention a free gift only when it exists in Active offers and the requested paid duration/type matches. State whether it is excluded from renewals.",
    "If the customer asks for all prices, list only available prices and group them clearly by product type.",
    allowStrivioLinks
      ? "You may include only an official https://www.striviodz.store URL when the customer explicitly asks for the link. Never include any other domain."
      : "Never include a URL, domain name, clickable link, or protocol in any reply. Say 'use the link in our bio' in the customer's language.",
    "Never request or reveal a password, PIN, payment credential, or account credential.",
    "Never disclose customer-specific order information in social messages. For order status, tell the customer to open Strivio from the bio, sign in using the order email, then open My Account and Purchases.",
    "Buying flow: choose a service, duration and type/quantity; add to cart; enter name, email and phone; choose payment; confirm; then follow delivery from My Account.",
    "There are exactly two customer-friendly order routes. Route 1: order on the website and pay directly by Edahabia or CIB card, then track delivery and support from My Account. Route 2: continue manually in the conversation and pay by BaridiMob, CCP, Wise, USDT, or Flexy; Flexy adds a 19% service fee. Explain these routes simply and never mention implementation details or payment gateway names.",
    "Delivery modes: automatic_slot and automatic_account use automatic delivery after payment confirmation; manual_activation asks the customer for their service login inside the protected order page and Strivio activates it; manual_delivery is prepared and delivered by the Strivio team.",
    "First understand the requested service, duration, type/quantity and missing needs. Ask only one short, relevant clarification in each reply, but keep helping for as many turns as the customer needs.",
    "Never hand the conversation to a human merely because a question is unclear. Keep the bot active and ask one shorter clarification. Set handoff=true only when the customer explicitly asks for a human/manual order, or when there is a real account, order, payment or warranty problem that requires staff action.",
    "Only when the purchase choice is sufficiently clear, explain briefly that the website supports CIB and Edahabia card payment plus protected tracking and account support, while manual chat ordering supports BaridiMob and the other listed manual methods.",
    "For sales variant A, emphasize secure CIB/Dahabia payment and protected tracking. For variant B, emphasize ease, current offers, and managing the subscription from My Account. Do not change any factual claim.",
    "When the customer is ready to buy, offer both choices: order securely on the website, or continue manually in this chat. Interactive buttons are added by the backend, so do not write button labels.",
    "Warranty: answer only from supplied Knowledge. If no warranty fact exists, hand off rather than inventing a promise.",
    "If a request is broad, answer all parts that are supported by the supplied facts. If it is ambiguous, ask one useful clarification and keep the bot active. Set handoff=true only when the customer explicitly asks for a person/manual handling, or reports a customer-specific account, order, payment, or warranty problem that needs staff action.",
    "Return only JSON matching: {reply:string, language:'ar'|'fr'|'en'|'dz', intent:string, confidence:number, handoff:boolean, needs_clarification:boolean, summary:string, unknown_question:string}.",
    `Preferred detected language: ${locale}`,
    `Catalog: ${JSON.stringify(catalog)}`,
    `Active offers: ${JSON.stringify(offers)}`,
    `Knowledge: ${JSON.stringify(facts)}`,
    `Remembered conversation context (may be incomplete; never treat it as verified customer identity): ${JSON.stringify(memory || {})}`,
    `Conversation sales state: ${JSON.stringify(conversationState || {})}`,
    `Recent conversation: ${JSON.stringify(safeHistory)}`,
    `Customer message: ${safeText}`,
  ].join("\n\n");
  const requestBody = JSON.stringify({
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
          needs_clarification: { type: "BOOLEAN" },
          summary: { type: "STRING" },
          unknown_question: { type: "STRING" },
        },
        required: [
          "reply",
          "language",
          "intent",
          "confidence",
          "handoff",
          "needs_clarification",
          "summary",
          "unknown_question",
        ],
      },
    },
  });
  let response: Response | null = null;
  let responseText = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: requestBody,
          signal: AbortSignal.timeout(9000),
        },
      );
      responseText = await response.text();
      if (response.ok) break;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) break;
    } catch (error) {
      const message = String(error?.message || error).slice(0, 500);
      if (attempt === 2) {
        if (diagnostics) diagnostics.error = `Gemini network error: ${message}`;
        console.warn("Gemini request could not be sent", { model, error: message });
        return null;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
  }
  if (!response?.ok) {
    if (diagnostics) {
      diagnostics.error = response
        ? `Gemini HTTP ${response.status}: ${responseText.slice(0, 500)}`
        : "Gemini request failed without a response";
    }
    console.warn("Gemini request failed", {
      status: response?.status || 0,
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
    needsClarification: Boolean(parsed.needs_clarification),
    summary: String(parsed.summary || "").trim().slice(0, 500),
    unknownQuestion: String(parsed.unknown_question || "").trim().slice(0, 500),
    source: "gemini",
  };
}

async function loadBotData(db: any) {
  const [settingsResult, servicesResult, knowledgeResult, bundleRulesResult] = await Promise.all([
    db.from("chatbot_settings").select("*").eq("id", 1).maybeSingle(),
    db.from("services")
      .select("id,n,p,dur_notes,show_types,types,type_prices,promo,fulfillment_mode,sort_order")
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

function stableSalesVariant(seed: string) {
  let hash = 0;
  for (const char of String(seed || "")) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return hash % 2 === 0 ? "A" : "B";
}

function isRejectionText(value: string) {
  const text = normalizeMessage(value);
  return /(?:لا شكرا|لست مهتم|ماني مهتم|مش مهتم|ما نيش مهتم|non merci|pas interesse|pas intéressé|not interested|stop|arrete|arrête)/i
    .test(text);
}

function limitReplyToOneQuestion(value: string) {
  let seenQuestion = false;
  return String(value || "").replace(/[?؟]/g, (mark) => {
    if (!seenQuestion) {
      seenQuestion = true;
      return mark;
    }
    return ".";
  });
}

function compactDzdPrices(value: string) {
  return String(value || "").replace(
    /\b\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?=\s*(?:DZD|DA|دج))/giu,
    (price) => price.replace(/[ \u00a0\u202f]/g, ""),
  );
}

function limitReplyLength(value: string, maximum: number) {
  const text = String(value || "").trim();
  const limit = Math.max(240, Math.min(1200, Number(maximum || 560)));
  if (text.length <= limit) return text;
  const sliced = text.slice(0, Math.max(1, limit - 1));
  const boundary = Math.max(sliced.lastIndexOf("\n"), sliced.lastIndexOf(" "));
  return `${(boundary > limit * 0.7 ? sliced.slice(0, boundary) : sliced).trim()}…`;
}

function checkoutReadiness(memory: any, services: any[]) {
  const serviceId = String(memory?.service_id || "").trim();
  const duration = Number(memory?.duration_months || 0);
  if (!serviceId || !duration) return false;
  const service = services.find((item) => String(item?.id || "") === serviceId);
  if (!service) return false;
  if (service.show_types) {
    return Number.isInteger(Number(memory?.type_index))
      || Number(memory?.quantity || 0) > 0;
  }
  return true;
}

function stageForTurn({
  answer,
  memory,
  services,
  text,
}: {
  answer: any;
  memory: any;
  services: any[];
  text: string;
}) {
  if (isRejectionText(text)) return "lost";
  if (answer?.intent === "manual_checkout" || memory?.preferred_route === "chat") return "manual";
  if (memory?.preferred_route === "website") return "website";
  if (answer?.handoff || answer?.intent === "human_handoff") return "handoff";
  if (checkoutReadiness(memory, services)) return "ready_to_buy";
  if (answer?.intent === "price" && memory?.service_id) return "offered";
  if (memory?.service_id) return "qualifying";
  return "exploring";
}

function addAttributionToActions(
  actions: MetaAction[],
  event: any,
  conversationMetadata: any,
) {
  return actions.map((action) => {
    if (action.type !== "web_url" || !action.url) return action;
    try {
      const url = new URL(action.url);
      if (!/(^|\.)striviodz\.store$/i.test(url.hostname)) return action;
      url.searchParams.set("utm_source", event.channel === "instagram" ? "instagram" : "messenger");
      url.searchParams.set("utm_medium", "social_chatbot");
      url.searchParams.set(
        "utm_campaign",
        String(event.attribution?.campaign_id || event.attribution?.ref || "conversation").slice(0, 100),
      );
      const variant = String(conversationMetadata?.sales_variant || "");
      if (variant) url.searchParams.set("utm_content", `chatbot_${variant.toLowerCase()}`);
      return { ...action, url: url.toString() };
    } catch {
      return action;
    }
  });
}

function localeForInbound(text: string, detectedLocale: string, previousLocale = "") {
  const hasLetters = /[\p{L}]/u.test(String(text || ""));
  if (!hasLetters && ["ar", "fr", "en", "dz"].includes(previousLocale)) {
    return previousLocale;
  }
  return detectedLocale;
}

async function upsertConversation(db: any, event: any, settings: any) {
  const now = new Date().toISOString();
  const existing = await db.from("chatbot_conversations")
    .select("*")
    .eq("channel", event.channel)
    .eq("channel_account_id", event.accountId)
    .eq("external_user_id", event.senderId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const resolvedLocale = localeForInbound(event.text, event.locale, existing.data.locale);
    const memory = mergeConversationMemory(
      existing.data.memory || existing.data.metadata?.memory || {},
      event.text,
      event.payload,
    );
    const previousMetadata = existing.data.metadata || {};
    const salesVariant = previousMetadata.sales_variant
      || (settings.website_pitch_ab_enabled === true
        ? stableSalesVariant(`${event.channel}:${event.senderId}`)
        : null);
    const attribution = settings.campaign_attribution_enabled === false
      ? previousMetadata.attribution || {}
      : {
          ...(previousMetadata.attribution || {}),
          ...(event.attribution || {}),
        };
    const leadSource = String(
      attribution.source
        || (attribution.ad_id ? "meta_ads" : "")
        || existing.data.lead_source
        || event.channel,
    ).slice(0, 100);
    const updated = await db.from("chatbot_conversations")
      .update({
        locale: resolvedLocale,
        last_inbound_at: now,
        unread_count: Number(existing.data.unread_count || 0) + 1,
        memory,
        follow_up_due_at: null,
        follow_up_count: 0,
        follow_up_sent_at: null,
        lead_source: leadSource,
        campaign_metadata: attribution,
        metadata: {
          ...previousMetadata,
          memory,
          last_event_type: event.eventType,
          last_provider_message_id: event.providerMessageId,
          reply_generation: event.replyGeneration,
          reply_not_before: event.replyNotBefore,
          last_inbound_timestamp: event.timestamp,
          sales_variant: salesVariant,
          attribution,
          follow_up_stopped_reason: null,
        },
      })
      .eq("id", existing.data.id)
      .select("*")
      .single();
    if (updated.error) throw updated.error;
    return updated.data;
  }
  const memory = mergeConversationMemory({}, event.text, event.payload);
  const salesVariant = settings.website_pitch_ab_enabled === true
    ? stableSalesVariant(`${event.channel}:${event.senderId}`)
    : null;
  const attribution = settings.campaign_attribution_enabled === false
    ? {}
    : event.attribution || {};
  const leadSource = String(
    attribution.source || (attribution.ad_id ? "meta_ads" : "") || event.channel,
  ).slice(0, 100);
  const created = await db.from("chatbot_conversations").insert({
    channel: event.channel,
    channel_account_id: event.accountId,
    external_user_id: event.senderId,
    external_thread_id: event.threadId || null,
    locale: event.locale,
    last_inbound_at: now,
    unread_count: 1,
    memory,
    lead_source: leadSource,
    campaign_metadata: attribution,
    metadata: {
      memory,
      last_event_type: event.eventType,
      last_provider_message_id: event.providerMessageId,
      reply_generation: event.replyGeneration,
      reply_not_before: event.replyNotBefore,
      last_inbound_timestamp: event.timestamp,
      sales_variant: salesVariant,
      attribution,
    },
  }).select("*").single();
  if (created.error) {
    // Two webhook deliveries for the same new customer can race. The unique
    // conversation key is the authority; retry through the update path.
    if (String(created.error.code || "") === "23505") {
      const winner = await db.from("chatbot_conversations")
        .select("id")
        .eq("channel", event.channel)
        .eq("channel_account_id", event.accountId)
        .eq("external_user_id", event.senderId)
        .maybeSingle();
      if (!winner.error && winner.data) return upsertConversation(db, event, settings);
    }
    throw created.error;
  }
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
      const referral = item?.referral || item?.message?.referral || {};
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
        attribution: {
          ref: String(referral?.ref || "").slice(0, 200) || null,
          source: String(referral?.source || "").slice(0, 100) || null,
          type: String(referral?.type || "").slice(0, 100) || null,
          ad_id: String(referral?.ad_id || referral?.ads_context_data?.ad_id || "").slice(0, 120) || null,
          campaign_id: String(
            referral?.campaign_id || referral?.ads_context_data?.campaign_id || "",
          ).slice(0, 120) || null,
        },
      });
    }
  }
  return events;
}

function isSalesIntent(intent: string) {
  return ["price", "purchase", "service_interest", "payment", "delivery", "ai_answer"].includes(String(intent || ""));
}

function hasMultipleInformationTopics(value: string) {
  const text = normalizeMessage(value);
  const topicPatterns = [
    /(?:سعر|اسعار|ثمن|prix|tarif|price|combien|ch7al|chehal)/i,
    /(?:دفع|نخلص|بطاق|ذهبي|baridimob|flexy|wise|usdt|ccp|cib|paiement|payer|payment)/i,
    /(?:تسليم|استلم|يوصل|livraison|delivery|deliver)/i,
    /(?:ضمان|تعويض|garantie|warranty|guarantee|replacement)/i,
    /(?:عرض|عروض|هدية|مجاني|offre|promo|gift|free)/i,
    /(?:تجديد|تمديد|renouvel|renew|extend)/i,
    /(?:الموقع|المحادثة|يدوي|site|website|chat|manuel|manual)/i,
  ];
  return topicPatterns.filter((pattern) => pattern.test(text)).length > 1;
}

function comprehensiveFallbackAnswer(locale: string, memory: any, services: any[]) {
  const service = services.find((item) => String(item?.id || "") === String(memory?.service_id || ""));
  const serviceName = String(
    service?.n?.[locale]
    || service?.n?.[locale === "dz" ? "ar" : "fr"]
    || service?.n?.fr
    || service?.n?.en
    || "",
  ).trim();
  const variants: Record<string, string> = {
    ar: `${serviceName ? `${serviceName} متوفر.\n` : ""}• السعر والعروض: يعتمدان على المدة والخطة، وسأعطيك السعر والعرض المطابق بعد اختيارك.\n• الطلب والدفع: إما من الموقع بالبطاقة الذهبية أو CIB مع التتبع من حسابك، أو هنا في المحادثة عبر BaridiMob أو CCP أو Wise أو USDT أو Flexy. تضاف 19% عند Flexy.\n• التسليم: تلقائي بعد الدفع للخدمات الجاهزة، أو تفعيل/تسليم من الفريق حسب نوع المنتج.\n• الضمان: كامل طوال المدة المدفوعة، مع الإصلاح أو الاستبدال عند وجود مشكلة مشمولة.\nما المدة والخطة أو الكمية التي تريدها؟`,
    fr: `${serviceName ? `${serviceName} est disponible.\n` : ""}• Prix et offres : ils dépendent de la durée et de la formule choisies.\n• Commande et paiement : soit sur le site par carte Edahabia ou CIB avec suivi depuis votre compte, soit ici par BaridiMob, CCP, Wise, USDT ou Flexy. Flexy ajoute 19 %.\n• Livraison : automatique après paiement pour les services prêts, ou activation/livraison par l’équipe selon le produit.\n• Garantie : complète pendant toute la durée payée, avec correction ou remplacement si le problème est couvert.\nQuelle durée et quelle formule ou quantité souhaitez-vous ?`,
    en: `${serviceName ? `${serviceName} is available.\n` : ""}• Prices and offers depend on the selected duration and plan.\n• Ordering and payment: use the website with an Edahabia or CIB card and track it from your account, or continue here with BaridiMob, CCP, Wise, USDT, or Flexy. Flexy adds 19%.\n• Delivery: automatic after payment for ready services, or team activation/delivery depending on the product.\n• Warranty: full coverage throughout the paid period, with a fix or replacement for covered issues.\nWhich duration and plan or quantity do you need?`,
    dz: `${serviceName ? `${serviceName} كاين.\n` : ""}• السعر والعروض: يتبدلوا حسب المدة والخطة، ونعطيك السعر والعرض الصحيح كي تختار.\n• الطلب والدفع: يا من الموقع بالذهبية ولا CIB وتتابع الطلب من حسابك، يا هنا في المحادثة بـ BaridiMob ولا CCP ولا Wise ولا USDT ولا Flexy. في Flexy كاينة زيادة 19%.\n• التسليم: آلي بعد الدفع للخدمات الجاهزة، ولا يفعله ويسلمه الفريق حسب نوع المنتج.\n• الضمان: كامل طول المدة لي خلصتها، مع الإصلاح ولا الاستبدال إذا المشكل داخل الضمان.\nقولّي المدة والخطة ولا الكمية لي تحتاجها؟`,
  };
  return {
    reply: variants[locale] || variants.fr,
    locale,
    intent: "service_information",
    confidence: 0.9,
    handoff: false,
    needsClarification: true,
    precise: true,
    source: "rules",
  };
}

function shouldAttachActions(answer: any, memory: any, services: any[], stage: string) {
  if (answer?.handoff || ["handoff", "lost", "manual"].includes(stage)) return false;
  return ["ready_to_buy", "website"].includes(stage)
    && checkoutReadiness(memory, services)
    && Number(answer?.confidence || 0) >= 0.6;
}

function followUpText(locale: string, memory: any, followUpCount = 0) {
  const service = String(memory?.service_id || "").trim();
  const duration = Number(memory?.duration_months || 0);
  const quantity = Number(memory?.quantity || 0);
  const details = [
    service,
    duration ? `${duration} mois` : "",
    quantity > 1 ? `x${quantity}` : "",
  ].filter(Boolean).join(" · ");
  const serviceLabel = details ? ` ${details}` : "";
  const finalReminder = Number(followUpCount || 0) >= 1;
  const variants: Record<string, string> = {
    ar: finalReminder
      ? `تذكير أخير بخصوص${serviceLabel}. يمكنك إكماله بأمان من الموقع أو المتابعة معنا هنا.`
      : `جهزت لك اختيار${serviceLabel}. هل تريد إكماله بأمان من الموقع أم نكمل الطلب هنا؟`,
    fr: finalReminder
      ? `Dernier rappel pour${serviceLabel}. Finalisez en sécurité sur le site ou continuez ici.`
      : `Votre choix${serviceLabel} est prêt. Voulez-vous finaliser sur le site ou continuer ici ?`,
    en: finalReminder
      ? `Final reminder for${serviceLabel}. Check out securely on the website or continue here.`
      : `Your${serviceLabel} choice is ready. Would you like to check out on the website or continue here?`,
    dz: finalReminder
      ? `آخر تذكير على${serviceLabel}. تقدر تكمل بأمان من الموقع ولا نكملو هنا.`
      : `وجدتلك اختيار${serviceLabel}. تحب تكمل بأمان من الموقع ولا نكملو الطلب هنا؟`,
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
  const isDiagnosticTest = event.eventType === "test";
  const debounceMs = isDiagnosticTest
    ? 0
    : Math.max(500, Math.min(5000, Number(botData.settings.debounce_ms || 2500)));
  event.replyGeneration = crypto.randomUUID();
  event.replyNotBefore = new Date(Date.now() + debounceMs).toISOString();

  const duplicate = await db.from("chatbot_messages")
    .select("id")
    .eq("provider_message_id", event.providerMessageId)
    .maybeSingle();
  if (duplicate.error) throw duplicate.error;
  if (duplicate.data) return { duplicate: true };

  const conversation = await upsertConversation(db, event, botData.settings);
  event.locale = String(conversation.locale || event.locale || botData.settings.default_locale || "fr");
  let memory = conversation.memory || conversation.metadata?.memory || {};
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
  let inboundMessageId = String(inbound.data?.id || "");
  if (inbound.error) {
    if (String(inbound.error.code || "") !== "23505") throw inbound.error;
    const existingInbound = await db.from("chatbot_messages")
      .select("id")
      .eq("provider_message_id", event.providerMessageId)
      .maybeSingle();
    if (existingInbound.error) throw existingInbound.error;
    inboundMessageId = String(existingInbound.data?.id || "");
    if (!inboundMessageId) return { duplicate: true };
  }

  if (
    !botData.settings.enabled ||
    !botData.settings.auto_reply_enabled ||
    (!isDiagnosticTest && conversation.mode !== "bot")
  ) {
    return { stored: true, replied: false, mode: conversation.mode };
  }

  if (shouldSend && botData.settings.typing_enabled !== false) {
    await setMetaTyping(event.channel, event.accountId, event.senderId, true);
  }

  if (debounceMs > 0) {
    await sleep(debounceMs);
    const currentResult = await db.from("chatbot_conversations")
      .select("id,mode,memory,metadata,follow_up_count")
      .eq("id", conversation.id)
      .maybeSingle();
    if (currentResult.error) throw currentResult.error;
    const current = currentResult.data;
    if (
      !current
      || current.mode !== "bot"
      || current.metadata?.reply_generation !== event.replyGeneration
      || current.metadata?.last_provider_message_id !== event.providerMessageId
    ) {
      return { stored: true, replied: false, superseded: true };
    }
    conversation.memory = current.memory || conversation.memory;
    conversation.metadata = current.metadata || conversation.metadata;
    conversation.follow_up_count = current.follow_up_count;
    memory = conversation.memory || conversation.metadata?.memory || memory;
  }

  const recentResult = await db.from("chatbot_messages")
    .select("sender_role,message_text,created_at,intent,metadata")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(24);
  if (recentResult.error) throw recentResult.error;
  const recent = (recentResult.data || []).reverse();
  const pendingTurn: string[] = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const item = recent[index];
    if (item.sender_role !== "customer") break;
    pendingTurn.unshift(String(item.message_text || "").trim());
    if (pendingTurn.length >= 6) break;
  }
  const turnText = pendingTurn.filter(Boolean).join("\n").slice(0, 4000) || event.text;
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const [minuteUsage, tenMinuteUsage] = await Promise.all([
    db.from("chatbot_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .eq("direction", "inbound")
      .gte("created_at", oneMinuteAgo),
    db.from("chatbot_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .eq("direction", "inbound")
      .gte("created_at", tenMinutesAgo),
  ]);
  const burstLimit = Math.max(5, Number(botData.settings.burst_limit_per_minute || 15));
  const tenMinuteLimit = Math.max(
    burstLimit,
    Number(botData.settings.ten_minute_limit || 60),
  );
  if (
    (!minuteUsage.error && Number(minuteUsage.count || 0) > burstLimit)
    || (!tenMinuteUsage.error && Number(tenMinuteUsage.count || 0) > tenMinuteLimit)
  ) {
    await db.from("chatbot_conversations").update({
      mode: "human",
      handoff_reason: "rate_limit",
      follow_up_due_at: null,
      sales_stage: "handoff",
      conversion_route: "human",
      metadata: {
        ...(conversation.metadata || {}),
        stage: "handoff",
        follow_up_stopped_reason: "rate_limit",
        rate_limit: {
          minute_count: Number(minuteUsage.count || 0),
          ten_minute_count: Number(tenMinuteUsage.count || 0),
          at: new Date().toISOString(),
        },
      },
    }).eq("id", conversation.id);
    if (shouldSend && botData.settings.typing_enabled !== false) {
      await setMetaTyping(event.channel, event.accountId, event.senderId, false);
    }
    return { stored: true, replied: false, handoff: true, reason: "rate_limit" };
  }

  let answer = deterministicReply({
    text: turnText,
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
  const conversationState = {
    stage: String(conversation.metadata?.stage || "new"),
    sales_variant: conversation.metadata?.sales_variant || null,
    attribution: conversation.metadata?.attribution || {},
  };
  const isComprehensiveQuestion = hasMultipleInformationTopics(turnText);
  const keepRuleAnswer = answer.handoff
    || ["human_handoff", "order_status", "greeting"].includes(answer.intent)
    || (answer.precise === true && !isComprehensiveQuestion);
  const aiAllowed = !keepRuleAnswer
    && botData.settings.ai_enabled
    && botData.settings.provider === "gemini"
    && await canUseAi(db, conversation.id, botData.settings);
  if (aiAllowed) {
    const ai = await askGemini({
      text: turnText,
      locale: event.locale,
      services: botData.services,
      knowledge: botData.knowledge,
      bundleRules: botData.bundleRules,
      history: recent,
      memory,
      conversationState,
      allowStrivioLinks: botData.settings.allow_strivio_links !== false,
      replyCharLimit: Number(botData.settings.reply_char_limit || 560),
      diagnostics: aiDiagnostics,
    });
    if (ai) {
      answer = { ...answer, ...ai };
    } else if (isComprehensiveQuestion) {
      answer = {
        ...answer,
        ...comprehensiveFallbackAnswer(event.locale, memory, botData.services),
      };
    }
  } else if (!keepRuleAnswer && botData.settings.ai_enabled) {
    aiDiagnostics.error = "AI usage limit reached; deterministic reply used";
  }

  if (!answer.reply) {
    const variants: Record<string, string> = {
      ar: "حتى أساعدك بدقة، اكتب اسم الخدمة التي تريدها وسؤالك عنها باختصار.",
      fr: "Pour vous répondre précisément, indiquez le service recherché et votre question en quelques mots.",
      en: "To help you precisely, tell me the service you need and your question in a few words.",
      dz: "باش نعاونك بدقة، اكتبلي اسم الخدمة لي تحتاجها والسؤال تاعك باختصار.",
    };
    answer = {
      ...answer,
      reply: variants[event.locale] || variants.fr,
      intent: "clarification",
      handoff: false,
      needsClarification: true,
      source: "rules",
      confidence: 0.2,
    };
    await db.from("chatbot_unanswered").insert({
      conversation_id: conversation.id,
      message_id: inboundMessageId,
      message_text: event.text,
      normalized_text: normalizeMessage(event.text),
      locale: event.locale,
      reason: "unknown_intent",
    });
  }

  if (answer.unknownQuestion) {
    const unanswered = await db.from("chatbot_unanswered").insert({
      conversation_id: conversation.id,
      message_id: inboundMessageId || null,
      message_text: event.text,
      normalized_text: normalizeMessage(event.text),
      locale: event.locale,
      reason: "ai_unknown_question",
      metadata: {
        question: String(answer.unknownQuestion).slice(0, 500),
        summary: String(answer.summary || "").slice(0, 500),
      },
    });
    if (unanswered.error) {
      console.warn("Could not store chatbot unknown question", {
        error: String(unanswered.error.message || unanswered.error).slice(0, 300),
      });
    }
  }

  if (typeof answer.needsClarification !== "boolean") {
    answer.needsClarification = /[?؟]/.test(String(answer.reply || ""))
      && !checkoutReadiness(memory, botData.services);
  }
  const allowedHandoffIntents = new Set([
    "human_handoff",
    "manual_checkout",
    "support_issue",
    "warranty_inquiry",
  ]);
  if (answer.handoff && !allowedHandoffIntents.has(String(answer.intent || ""))) {
    answer.handoff = false;
  }
  const replyCharacterLimit = Number(botData.settings.reply_char_limit || 560);
  answer.reply = limitReplyLength(
    compactDzdPrices(limitReplyToOneQuestion(answer.reply)),
    replyCharacterLimit,
  );
  if (
    botData.settings.allow_strivio_links !== false
    && ["offer", "price"].includes(String(answer.intent || ""))
    && !/https:\/\/www\.striviodz\.store/i.test(String(answer.reply || ""))
  ) {
    const catalogFooter: Record<string, string> = {
      ar: "جميع العروض والأسعار: https://www.striviodz.store",
      fr: "Toutes les offres et tous les prix : https://www.striviodz.store",
      en: "All offers and prices: https://www.striviodz.store",
      dz: "كامل العروض والأسعار: https://www.striviodz.store",
    };
    const footer = catalogFooter[answer.locale || event.locale] || catalogFooter.fr;
    answer.reply = `${limitReplyLength(answer.reply, replyCharacterLimit - footer.length - 1)}\n${footer}`;
  }

  answer.reply = event.channel === "instagram"
    ? socialReplyWithOfficialLinks(
        answer.reply,
        answer.locale || event.locale,
        botData.settings.allow_strivio_links !== false,
      )
    : String(answer.reply || "").trim();
  answer.reply = stabilizeBidiReply(answer.reply, answer.locale || event.locale);
  const stage = stageForTurn({
    answer,
    memory,
    services: botData.services,
    text: turnText,
  });

  if (answer.handoff) {
    await db.from("chatbot_conversations").update({
      mode: "human",
      handoff_reason: answer.intent || "requested",
      follow_up_due_at: null,
    }).eq("id", conversation.id);
  }

  let providerMessageId = "";
  let deliveryStatus = shouldSend ? "queued" : "sent";
  let deliveryError = "";
  let usedTemplate = false;
  let usedFallback = false;
  const baseActions = shouldAttachActions(answer, memory, botData.services, stage)
    ? buildMetaActions({
        locale: answer.locale || event.locale,
        serviceId: String(memory.service_id || answer.serviceId || ""),
        websiteUrl: String(botData.settings.website_url || "https://www.striviodz.store"),
        includeWebsite: botData.settings.structured_messages_enabled !== false
          && botData.settings.website_buttons_enabled !== false,
        includeChat: botData.settings.structured_messages_enabled !== false
          && botData.settings.manual_checkout_enabled !== false
          && stage !== "website"
          && !answer.handoff,
        includeHuman: botData.settings.structured_messages_enabled !== false
          && stage !== "website"
          && !answer.handoff,
      })
    : [];
  const actions = botData.settings.conversion_tracking_enabled === false
    ? baseActions
    : addAttributionToActions(baseActions, event, conversation.metadata || {});
  if (shouldSend) {
    const sendLease = await db.from("chatbot_conversations")
      .select("mode,metadata")
      .eq("id", conversation.id)
      .maybeSingle();
    if (sendLease.error) throw sendLease.error;
    if (
      !sendLease.data
      || (sendLease.data.mode !== "bot" && !(answer.handoff && sendLease.data.mode === "human"))
      || sendLease.data.metadata?.reply_generation !== event.replyGeneration
    ) {
      return { stored: true, replied: false, superseded: true };
    }
    if (botData.settings.typing_enabled !== false) {
      await setMetaTyping(event.channel, event.accountId, event.senderId, false);
    }
    const finalLease = await db.from("chatbot_conversations")
      .select("mode,metadata")
      .eq("id", conversation.id)
      .maybeSingle();
    if (finalLease.error) throw finalLease.error;
    if (
      !finalLease.data
      || (finalLease.data.mode !== "bot" && !(answer.handoff && finalLease.data.mode === "human"))
      || finalLease.data.metadata?.reply_generation !== event.replyGeneration
    ) {
      return { stored: true, replied: false, superseded: true, reason: "manual_takeover" };
    }
    try {
      const sent = await sendMetaReply(
        event.channel,
        event.accountId,
        event.senderId,
        answer.reply,
        {
          actions,
          locale: answer.locale || event.locale,
          allowStrivioLinks: botData.settings.allow_strivio_links !== false,
        },
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
      needs_clarification: Boolean(answer.needsClarification),
      conversation_stage: stage,
      conversation_summary: String(answer.summary || "").slice(0, 500) || null,
      aggregated_inbound_count: pendingTurn.length,
    },
  });
  if (outbound.error) throw outbound.error;

  const conversationChanges: Record<string, unknown> = {
    last_outbound_at: new Date().toISOString(),
    sales_stage: stage,
    lead_source: String(
      conversation.lead_source
        || conversation.metadata?.attribution?.source
        || (conversation.metadata?.attribution?.ad_id ? "meta_ads" : "")
        || event.channel,
    ).slice(0, 100),
    campaign_metadata: conversation.metadata?.attribution || {},
    metadata: {
      ...(conversation.metadata || {}),
      memory,
      stage,
      summary: String(answer.summary || conversation.metadata?.summary || "").slice(0, 500),
      unknown_questions: [
        ...(Array.isArray(conversation.metadata?.unknown_questions)
          ? conversation.metadata.unknown_questions
          : []),
        ...(answer.unknownQuestion ? [{
          text: String(answer.unknownQuestion).slice(0, 500),
          at: new Date().toISOString(),
        }] : []),
      ].slice(-20),
      last_reply_source: answer.source,
      last_reply_intent: answer.intent,
      follow_up_stopped_reason: ["handoff", "manual", "website", "lost"].includes(stage)
        ? stage
        : null,
    },
  };
  if (stage === "website") conversationChanges.conversion_route = "website";
  if (stage === "manual") conversationChanges.conversion_route = "manual";
  if (stage === "handoff") conversationChanges.conversion_route = "human";
  const maximumFollowUps = Math.min(
    2,
    Math.max(0, Number(botData.settings.max_followups_per_conversation ?? 2)),
  );
  if (
    !answer.handoff
    && deliveryStatus === "sent"
    && botData.settings.follow_up_enabled !== false
    && isSalesIntent(answer.intent)
    && stage === "ready_to_buy"
    && !isRejectionText(turnText)
    && Number(conversation.follow_up_count || 0) < maximumFollowUps
  ) {
    const delay = Math.max(30, Number(botData.settings.follow_up_delay_minutes || 120));
    conversationChanges.follow_up_due_at = new Date(Date.now() + delay * 60_000).toISOString();
  } else if (["handoff", "manual", "website", "lost"].includes(stage)) {
    conversationChanges.follow_up_due_at = null;
  }
  const conversationUpdate = await db.from("chatbot_conversations")
    .update(conversationChanges)
    .eq("id", conversation.id)
    .contains("metadata", { reply_generation: event.replyGeneration });
  if (conversationUpdate.error) throw conversationUpdate.error;

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
    sales_stage: stage,
    ai_diagnostic: event.eventType === "test" ? aiDiagnostics.error : undefined,
  };
}

async function processFollowUps(db: any, botData: any, limitValue: number) {
  if (botData.settings.follow_up_enabled === false) return { processed: 0, sent: 0, skipped: 0 };
  const maximum = Math.min(50, Math.max(1, Number(limitValue || 20)));
  const nowIso = new Date().toISOString();
  const windowStart = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const maximumFollowUps = Math.min(
    2,
    Math.max(0, Number(botData.settings.max_followups_per_conversation ?? 2)),
  );
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
    const stage = String(conversation.sales_stage || conversation.metadata?.stage || "");
    if (["handoff", "manual", "website", "lost", "won"].includes(stage)) {
      await db.from("chatbot_conversations").update({
        follow_up_due_at: null,
      }).eq("id", conversation.id);
      skipped += 1;
      continue;
    }
    const locale = String(conversation.locale || botData.settings.default_locale || "fr");
    const followUpIndex = Number(conversation.follow_up_count || 0);
    const text = stabilizeBidiReply(followUpText(locale, memory, followUpIndex), locale);
    const baseActions = buildMetaActions({
      locale,
      serviceId: String(memory.service_id || ""),
      websiteUrl: String(botData.settings.website_url || "https://www.striviodz.store"),
      includeWebsite: botData.settings.website_buttons_enabled !== false,
      includeChat: botData.settings.manual_checkout_enabled !== false,
      includeHuman: true,
    });
    const actions = botData.settings.conversion_tracking_enabled === false
      ? baseActions
      : addAttributionToActions(baseActions, {
          channel: conversation.channel,
          attribution: conversation.metadata?.attribution || {},
        }, conversation.metadata || {});
    try {
      const sent = await sendMetaReply(
        conversation.channel,
        conversation.channel_account_id,
        conversation.external_user_id,
        text,
        {
          actions,
          locale,
          allowStrivioLinks: botData.settings.allow_strivio_links !== false,
        },
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
      const nextFollowUpCount = followUpIndex + 1;
      const secondDelay = Math.max(
        60,
        Number(botData.settings.second_follow_up_delay_minutes || 360),
      );
      const nextDueAt = nextFollowUpCount < maximumFollowUps
        ? new Date(Date.now() + secondDelay * 60_000).toISOString()
        : null;
      const updated = await db.from("chatbot_conversations").update({
        follow_up_due_at: nextDueAt,
        follow_up_sent_at: nowIso,
        follow_up_count: nextFollowUpCount,
        last_outbound_at: nowIso,
        metadata: {
          ...(conversation.metadata || {}),
          last_follow_up_number: nextFollowUpCount,
          follow_up_completed: nextFollowUpCount >= maximumFollowUps,
        },
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
    const manualTakeoverAt = new Date().toISOString();
    const takeover = await db.from("chatbot_conversations").update({
      mode: "human",
      handoff_reason: "admin_reply_pending",
      follow_up_due_at: null,
      metadata: {
        ...(conversation.metadata || {}),
        reply_generation: `admin:${crypto.randomUUID()}`,
        follow_up_stopped_reason: "admin_reply",
        manual_takeover_at: manualTakeoverAt,
      },
    }).eq("id", conversation.id).select("id").maybeSingle();
    if (takeover.error) throw takeover.error;
    if (!takeover.data) {
      return json(req, { success: false, error: "Conversation not found" }, 404);
    }
    const outboundText = conversation.channel === "instagram"
      ? socialReplyWithOfficialLinks(text, detectLanguage(text), true)
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
      last_outbound_at: manualTakeoverAt,
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
  const results = await Promise.all(events.slice(0, 20).map(async (event) => {
    try {
      return await handleInbound(db, event, botData, true);
    } catch (error) {
      return { success: false, error: String(error?.message || error) };
    }
  }));
  return json(req, { success: true, results });
});
