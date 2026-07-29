// Shared deterministic sales and language logic for the Meta chatbot.
const SERVICE_ALIASES = {
  netflix: ["netflix", "net flix", "نتفلكس", "نتفليكس"],
  spotify: ["spotify", "spotifay", "سبوتيفاي", "سبوتيفي"],
  chatgpt: ["chatgpt", "chat gpt", "gpt", "شات جي بي تي", "شاتجيبيتي"],
  gemini: ["gemini", "جيميني", "جمني"],
  snapchat: ["snapchat", "snap", "سناب", "سنابشات"],
  crunchyroll: ["crunchyroll", "crunchy", "كرانشي رول", "كرانشيرول"],
  canva: ["canva", "كانفا"],
  capcut: ["capcut", "cap cut", "كاب كات", "كابكات"],
  prime: ["prime video", "prime", "برايم فيديو", "برايم"],
  shahid: ["shahid", "شاهد", "shahid vip"],
  tod: ["tod", "تي او دي"],
  watchit: ["watch it", "watchit", "واتش ات", "واتش إت"],
  iptv: ["iptv", "ip tv", "اي بي تي في"],
};

const ARABIZI_REPLACEMENTS = new Map([
  ["khsni", "احتاج"],
  ["khassni", "احتاج"],
  ["khasni", "احتاج"],
  ["n7ab", "اريد"],
  ["nheb", "اريد"],
  ["nhab", "اريد"],
  ["bghit", "اريد"],
  ["ch7al", "كم السعر"],
  ["chehal", "كم السعر"],
  ["chkoun", "من"],
  ["kifach", "كيف"],
  ["nkhalles", "ادفع"],
  ["nkhalas", "ادفع"],
  ["wa9tach", "متى"],
  ["win", "اين"],
  ["kayen", "متوفر"],
  ["makach", "غير متوفر"],
  ["compte", "حساب"],
  ["commande", "طلب"],
  ["prix", "سعر"],
  ["mois", "شهر"],
  ["svp", "من فضلك"],
]);

const PRICE_WORDS = [
  "سعر", "الاسعار", "السعر", "كم", "ثمن", "prix", "tarif", "price",
  "how much", "how much is", "cost", "combien", "coute", "coûte", "ch7al", "chehal",
];
const BUY_WORDS = [
  "اريد", "احتاج", "شراء", "نشتري", "نحب", "خصني", "ابي", "أبي",
  "buy", "need", "want", "acheter", "besoin", "khsni", "khassni", "n7ab", "nheb",
];
const GREETING_WORDS = [
  "سلام", "السلام", "مرحبا", "اهلا", "hello", "hi", "bonjour", "bonsoir", "salam", "slm",
];
const HUMAN_WORDS = [
  "انسان", "موظف", "بشر", "خدمة العملاء", "support", "conseiller", "agent",
  "human", "personne", "admin",
];
const PAYMENT_WORDS = [
  "دفع", "ادفع", "نخلص", "بريدي موب", "بطاقة", "payment", "pay", "payer",
  "paiement", "baridimob", "nkhalles",
];
const DELIVERY_WORDS = [
  "تسليم", "يوصل", "استلم", "delivery", "deliver", "livraison", "instant",
  "wa9tach", "متى",
];
const ORDER_WORDS = [
  "طلبي", "حالة الطلب", "رقم الطلب", "my order", "order status",
  "ma commande", "commande ta3i", "حسابي", "my account", "mon compte",
  "معلومات الحساب", "account credentials",
];
const WARRANTY_WORDS = [
  "ضمان", "مضمون", "التعويض", "تعويض", "يضمن", "garantie", "garanti", "remboursement",
  "compensation", "warranty", "guarantee", "guaranteed", "replacement", "replace",
];
const WEBSITE_WORDS = [
  "الموقع", "المتجر", "الرابط", "site", "website", "boutique", "en ligne", "online",
];
const PLAN_TYPE_PATTERNS = [
  ["family", /\b(?:family|famille|عائلي|العائلية)\b/i],
  ["premium", /\b(?:premium|بريميوم)\b/i],
  ["standard", /\b(?:standard|عادي|العادية)\b/i],
  ["individual", /\b(?:individual|individuel|فردي|الفردية)\b/i],
  ["full_account", /\b(?:full account|compte complet|حساب كامل)\b/i],
  ["profile", /\b(?:profile|profil|بروفايل|شاشة)\b/i],
];
const BUDGET_WORDS = [
  "ميزانية", "ميزانيتي", "عندي", "حدود", "budget", "max", "maximum", "jusqu", "حوالي",
];

function stripDiacritics(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeMessage(value) {
  const clean = stripDiacritics(String(value || "").toLowerCase())
    .replace(/[^\p{L}\p{N}\s@._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return clean.split(" ").map((token) => ARABIZI_REPLACEMENTS.get(token) || token).join(" ");
}

export function redactSensitiveText(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:\+?213|0)[567]\d{8}/g, "[phone]")
    .replace(/\b(?:password|pass|mot de passe|كلمة السر)\s*[:=]\s*\S+/gi, "[credential]")
    .replace(/\b\d{6,}\b/g, "[number]");
}

export function detectLanguage(value) {
  const raw = String(value || "");
  const normalized = normalizeMessage(raw);
  if (/[\u0600-\u06ff]/.test(raw)) return "ar";
  if (/\b(?:khsni|khassni|khasni|n7ab|nheb|nhab|ch7al|chehal|kifach|wa9tach|nkhalles|nkhalas|kayen|makach)\b/i.test(raw)) return "dz";
  if (/\b(?:bonjour|bonsoir|prix|combien|comment|merci|livraison|acheter|mois|abonnement)\b/i.test(raw)) return "fr";
  if (/\b(?:hello|price|how|buy|need|want|delivery|month|subscription)\b/i.test(raw)) return "en";
  if (/[\u0600-\u06ff]/.test(normalized)) return "dz";
  return "fr";
}

function hasAny(text, values) {
  return values.some((value) => text.includes(normalizeMessage(value)));
}

export function identifyService(value) {
  const normalized = normalizeMessage(value);
  for (const [serviceId, aliases] of Object.entries(SERVICE_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(normalizeMessage(alias)))) return serviceId;
  }
  return null;
}

const DURATION_MONTHS = [1, 2, 3, 6, 12];

function numberFromToken(value) {
  const normalized = normalizeMessage(value);
  const direct = Number(normalized.match(/\b(?:1|2|3|6|12)\b/)?.[0] || 0);
  if (DURATION_MONTHS.includes(direct)) return direct;
  if (/(?:سنة|عام|year|annual|annuel|an\b)/i.test(normalized)) return 12;
  if (/(?:ستة|سته|six)\s*(?:اشهر|أشهر|mois|months?)/i.test(normalized)) return 6;
  if (/(?:ثلاثة|ثلاث|trois|three)\s*(?:اشهر|أشهر|mois|months?)/i.test(normalized)) return 3;
  if (/(?:شهرين|شهران|deux mois|two months)/i.test(normalized)) return 2;
  if (/(?:شهر واحد|un mois|one month)/i.test(normalized)) return 1;
  return null;
}

function screenCountFromText(value) {
  const normalized = normalizeMessage(value);
  const numeric = normalized.match(/\b([1-5])\s*(?:شاش(?:ة|ات)?|بروفايل(?:ات)?|profils?|profiles?|screens?|ecrans?|écrans?)\b/i);
  if (numeric) return Number(numeric[1]);
  if (/(?:شاشتين|شاشتان|بروفايلين|بروفايلان|deux écrans|two screens)/i.test(normalized)) return 2;
  if (/(?:ثلاث شاشات|ثلاثة شاشات|trois écrans|three screens)/i.test(normalized)) return 3;
  if (/(?:اربع شاشات|أربع شاشات|quatre écrans|four screens)/i.test(normalized)) return 4;
  if (/(?:خمس شاشات|خمسة شاشات|cinq écrans|five screens)/i.test(normalized)) return 5;
  if (/(?:شاشة واحدة|بروفايل واحد|un écran|one screen)/i.test(normalized)) return 1;
  return null;
}

function quantityFromText(value) {
  const screens = screenCountFromText(value);
  if (screens) return screens;
  const normalized = normalizeMessage(value);
  const match = normalized.match(
    /\b([1-9]\d?)\s*(?:حساب(?:ات)?|اشتراك(?:ات)?|نسخ(?:ة)?|accounts?|subscriptions?|comptes?|licen[cs]es?)\b/i,
  );
  return match ? Number(match[1]) : null;
}

function planTypeFromText(value) {
  const normalized = normalizeMessage(value);
  return PLAN_TYPE_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0] || null;
}

function budgetFromText(value) {
  const normalized = normalizeMessage(value);
  if (!hasAny(normalized, BUDGET_WORDS)) return null;
  const matches = [...normalized.matchAll(/\b(\d[\d\s.,]{1,10})\s*(?:دج|dzd|da)?\b/gi)];
  for (const match of matches) {
    const amount = Number(String(match[1] || "").replace(/[^\d]/g, ""));
    if (Number.isFinite(amount) && amount >= 100 && amount <= 10_000_000) return amount;
  }
  return null;
}

function missingSalesFields(memory = {}, service = null) {
  const missing = [];
  if (!memory?.service_id) return ["service_id"];
  if (!Number(memory?.duration_months || 0)) missing.push("duration_months");
  const requiresType = Boolean(service?.show_types) || memory?.service_id === "netflix";
  const hasType = (
    memory?.type_index !== null
    && memory?.type_index !== undefined
    && Number.isInteger(Number(memory.type_index))
  )
    || Number(memory?.quantity || 0) > 0
    || Boolean(memory?.plan_type);
  if (requiresType && !hasType) missing.push("type");
  return missing;
}

export function getSalesReadiness(memory = {}, service = null) {
  const missingFields = missingSalesFields(memory, service);
  return {
    ready: missingFields.length === 0,
    missingFields,
    stage: !memory?.service_id
      ? "discovering"
      : missingFields.length
        ? "qualifying"
        : "ready_for_options",
  };
}

export function isReadyForCompletionActions(memory = {}, service = null) {
  return getSalesReadiness(memory, service).ready;
}

export function mergeConversationMemory(previous = {}, value = "", payload = "") {
  const next = { ...(previous && typeof previous === "object" ? previous : {}) };
  const serviceId = identifyService(value);
  const durationMonths = numberFromToken(value);
  const quantity = quantityFromText(value);
  const planType = planTypeFromText(value);
  const budgetDzd = budgetFromText(value);
  const normalizedPayload = String(payload || "").toUpperCase();
  const switchedService = Boolean(serviceId && next.service_id && next.service_id !== serviceId);
  if (switchedService) {
    delete next.duration_months;
    delete next.quantity;
    delete next.type_index;
    delete next.plan_type;
    delete next.missing_fields;
    next.stage = "qualifying";
  }
  if (serviceId) next.service_id = serviceId;
  if (durationMonths) next.duration_months = durationMonths;
  if (quantity) {
    next.quantity = quantity;
    if (quantity <= 5) next.type_index = Math.max(0, quantity - 1);
  }
  if (planType) next.plan_type = planType;
  if (budgetDzd) next.budget_dzd = budgetDzd;
  if (normalizedPayload.startsWith("STRIVIO_CHAT_ORDER")) {
    next.preferred_route = "chat";
    next.stage = "checkout";
  } else if (normalizedPayload.startsWith("STRIVIO_HUMAN")) {
    next.preferred_route = "human";
    next.stage = "handoff";
  } else if (normalizedPayload.startsWith("STRIVIO_WEBSITE")) {
    next.preferred_route = "website";
    next.stage = "checkout";
  } else {
    const normalized = normalizeMessage(value);
    if (hasAny(normalized, WEBSITE_WORDS) && hasAny(normalized, BUY_WORDS)) {
      next.preferred_route = "website";
    }
    const readiness = getSalesReadiness(next);
    next.stage = readiness.stage;
    next.missing_fields = readiness.missingFields;
  }
  next.missing_fields = getSalesReadiness(next).missingFields;
  next.updated_at = new Date().toISOString();
  return next;
}

export function identifyIntent(value) {
  const normalized = normalizeMessage(value);
  const serviceId = identifyService(value);
  if (hasAny(normalized, HUMAN_WORDS)) return { intent: "human_handoff", serviceId, confidence: 0.99 };
  if (hasAny(normalized, ORDER_WORDS)) return { intent: "order_status", serviceId, confidence: 0.92 };
  if (hasAny(normalized, WARRANTY_WORDS)) return { intent: "warranty", serviceId, confidence: 0.97 };
  if (hasAny(normalized, PAYMENT_WORDS)) return { intent: "payment", serviceId, confidence: 0.91 };
  if (hasAny(normalized, DELIVERY_WORDS)) return { intent: "delivery", serviceId, confidence: 0.88 };
  if (hasAny(normalized, WEBSITE_WORDS)) return { intent: "website_checkout", serviceId, confidence: 0.86 };
  if (serviceId && hasAny(normalized, PRICE_WORDS)) return { intent: "price", serviceId, confidence: 0.98 };
  if (serviceId && hasAny(normalized, BUY_WORDS)) return { intent: "purchase", serviceId, confidence: 0.95 };
  if (serviceId) return { intent: "service_interest", serviceId, confidence: 0.82 };
  if (hasAny(normalized, GREETING_WORDS)) return { intent: "greeting", serviceId: null, confidence: 0.95 };
  return { intent: "unknown", serviceId: null, confidence: 0.25 };
}

const MONTH_LABELS = {
  ar: ["شهر", "شهران", "3 أشهر", "6 أشهر", "سنة"],
  fr: ["1 mois", "2 mois", "3 mois", "6 mois", "1 an"],
  en: ["1 month", "2 months", "3 months", "6 months", "1 year"],
  dz: ["1 mois", "2 mois", "3 mois", "6 mois", "1 an"],
};

const BIO_INSTRUCTIONS = {
  ar: "للطلب أو متابعة طلبك: ادخل إلى موقع Strivio من الرابط الموجود في البايو.",
  fr: "Pour commander ou suivre votre commande, ouvrez le site Strivio depuis le lien dans la bio.",
  en: "To order or track your order, open the Strivio website from the link in our bio.",
  dz: "Bach تطلب ولا تتبع commande ta3ek، ادخل لموقع Strivio من الرابط لي في bio.",
};

const ACTION_LABELS = {
  ar: {
    website: "الطلب عبر الموقع",
    chat: "إكمال الطلب هنا",
    human: "موظف Strivio",
  },
  fr: {
    website: "Commander en ligne",
    chat: "Commander ici",
    human: "Parler à l'équipe",
  },
  en: {
    website: "Order on website",
    chat: "Order in chat",
    human: "Talk to the team",
  },
  dz: {
    website: "Commander sur le site",
    chat: "Nkemlou hna",
    human: "Parler à l'équipe",
  },
};

function serviceName(service, locale) {
  const names = service?.n || {};
  return String(names[locale] || names[locale === "dz" ? "fr" : "fr"] || names.en || service?.id || "Service");
}

function durationLabels(locale) {
  return MONTH_LABELS[locale] || MONTH_LABELS.fr;
}

export function formatDzdAmount(value, locale = "ar") {
  const numeric = typeof value === "number"
    ? value
    : Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric)) return "";
  const digits = String(Math.max(0, Math.round(numeric)));
  return `${digits} ${locale === "ar" || locale === "dz" ? "دج" : "DZD"}`;
}

export function compactDzdPrices(value) {
  return String(value || "").replace(
    /(^|[^\d])(\d{1,3}(?:(?:[ \u00a0\u202f.,])\d{3})+)(?=\s*(?:دج|DZD|DA)(?![\p{L}\p{N}]))/gimu,
    (_match, prefix, grouped) => `${prefix}${String(grouped).replace(/[ \u00a0\u202f.,]/g, "")}`,
  );
}

export function formatServicePrices(service, locale = "fr") {
  const labels = durationLabels(locale);
  const typePrices = Array.isArray(service?.type_prices) ? service.type_prices : [];
  const typeLabels = service?.types?.[locale]
    || service?.types?.[locale === "dz" ? "ar" : "fr"]
    || service?.types?.en
    || [];
  if (service?.show_types && typePrices.length) {
    return typePrices
      .map((prices, typeIndex) => {
        const available = (Array.isArray(prices) ? prices : [])
          .map((price, durationIndex) => ({
            price: Number(price || 0),
            label: labels[durationIndex] || `${durationIndex + 1}`,
          }))
          .filter((entry) => Number.isFinite(entry.price) && entry.price > 0)
          .map((entry) => `${entry.label}: ${formatDzdAmount(entry.price, locale)}`);
        if (!available.length) return "";
        const type = String(typeLabels[typeIndex] || `Option ${typeIndex + 1}`);
        return `${type}: ${available.join(" · ")}`;
      })
      .filter(Boolean)
      .join("\n");
  }
  const prices = Array.isArray(service?.p) ? service.p : [];
  return prices
    .map((price, index) => ({ price: Number(price || 0), label: labels[index] || `${index + 1}` }))
    .filter((entry) => Number.isFinite(entry.price) && entry.price > 0)
    .map((entry) => `${entry.label}: ${formatDzdAmount(entry.price, locale)}`)
    .join("\n");
}

function localized(locale, variants) {
  return variants[locale] || variants.fr;
}

function activeOfferLines(
  serviceId,
  bundleRules,
  locale,
  durationIndex = null,
  typeIndex = null,
  includeDuration = true,
) {
  const now = Date.now();
  const labels = durationLabels(locale);
  return (Array.isArray(bundleRules) ? bundleRules : [])
    .filter((rule) => {
      if (!rule?.active || rule.source_service_id !== serviceId) return false;
      if (durationIndex !== null && Number(rule.source_duration_idx) !== Number(durationIndex)) return false;
      if (
        typeIndex !== null
        && rule.source_type_idx !== null
        && rule.source_type_idx !== undefined
        && Number(rule.source_type_idx) !== Number(typeIndex)
      ) return false;
      const startsAt = rule.starts_at ? new Date(rule.starts_at).getTime() : 0;
      const endsAt = rule.ends_at ? new Date(rule.ends_at).getTime() : 0;
      return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
    })
    .map((rule) => {
      const offer = rule?.label_i18n?.[locale]
        || rule?.label_i18n?.[locale === "dz" ? "fr" : "fr"]
        || rule?.label_i18n?.en
        || "";
      if (!offer) return "";
      const duration = labels[Number(rule.source_duration_idx)] || "";
      return includeDuration && duration ? `${duration}: ${offer}` : String(offer);
    })
    .filter(Boolean);
}

function betterValueAlternative(service, bundleRules, locale, requestedDurationIndex, typeIndex, priceSource) {
  const now = Date.now();
  const activeRules = (Array.isArray(bundleRules) ? bundleRules : [])
    .filter((rule) => {
      if (!rule?.active || rule.source_service_id !== service?.id) return false;
      if (Number(rule.source_duration_idx) === Number(requestedDurationIndex)) return false;
      if (
        rule.source_type_idx !== null
        && rule.source_type_idx !== undefined
        && Number(rule.source_type_idx) !== Number(typeIndex)
      ) return false;
      const startsAt = rule.starts_at ? new Date(rule.starts_at).getTime() : 0;
      const endsAt = rule.ends_at ? new Date(rule.ends_at).getTime() : 0;
      return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
    })
    .map((rule) => ({
      rule,
      durationIndex: Number(rule.source_duration_idx),
      price: Number(priceSource?.[Number(rule.source_duration_idx)] || 0),
    }))
    .filter((entry) => entry.durationIndex >= 0 && entry.price > 0)
    .sort((a, b) => {
      const aAfter = a.durationIndex > requestedDurationIndex ? 0 : 1;
      const bAfter = b.durationIndex > requestedDurationIndex ? 0 : 1;
      return aAfter - bAfter
        || Math.abs(a.durationIndex - requestedDurationIndex) - Math.abs(b.durationIndex - requestedDurationIndex);
    });
  if (activeRules.length) {
    const selected = activeRules[0];
    return {
      durationIndex: selected.durationIndex,
      price: selected.price,
      offer: String(
        selected.rule?.label_i18n?.[locale]
        || selected.rule?.label_i18n?.[locale === "dz" ? "fr" : "fr"]
        || selected.rule?.label_i18n?.en
        || "",
      ),
    };
  }

  const requestedMonths = DURATION_MONTHS[requestedDurationIndex] || 0;
  const requestedPrice = Number(priceSource?.[requestedDurationIndex] || 0);
  if (!requestedMonths || !requestedPrice) return null;
  const requestedMonthly = requestedPrice / requestedMonths;
  const valueCandidates = DURATION_MONTHS
    .map((months, durationIndex) => ({
      months,
      durationIndex,
      price: Number(priceSource?.[durationIndex] || 0),
    }))
    .filter((entry) =>
      entry.durationIndex > requestedDurationIndex
      && entry.price > 0
      && entry.price / entry.months < requestedMonthly
    )
    .sort((a, b) => a.durationIndex - b.durationIndex);
  return valueCandidates[0] ? { ...valueCandidates[0], offer: "" } : null;
}

export function socialSafeReply(value, locale = "fr") {
  const original = compactDzdPrices(value);
  const linkPattern = /(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|store|dz|io|app|co|me)(?:\/[^\s]*)?/gi;
  let removedExternalLink = false;
  const clean = original
    .replace(linkPattern, (link) => {
      const candidate = /^https?:\/\//i.test(link) ? link : `https://${link}`;
      try {
        const host = new URL(candidate).hostname.toLowerCase();
        if (host === "striviodz.store" || host === "www.striviodz.store") return link;
      } catch {
        // Invalid links are removed instead of being sent to the customer.
      }
      removedExternalLink = true;
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!removedExternalLink) return clean;
  const instruction = localized(locale, {
    ar: "للأمان، استخدم موقع Strivio الرسمي فقط: https://www.striviodz.store",
    fr: "Pour votre sécurité, utilisez uniquement le site officiel Strivio : https://www.striviodz.store",
    en: "For your safety, use only the official Strivio website: https://www.striviodz.store",
    dz: "Bach تبقى معلوماتك آمنة، استعمل غير موقع Strivio الرسمي: https://www.striviodz.store",
  });
  return clean ? `${clean}\n\n${instruction}` : instruction;
}

export function stabilizeBidiReply(value, locale = "fr") {
  const clean = compactDzdPrices(value)
    .replace(/[\u2066\u2067\u2068\u2069]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) return "";
  return clean
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const hasArabic = /[\u0600-\u06ff]/.test(trimmed);
      const protectedRuns = hasArabic
        ? trimmed.replace(
            /(?:https?:\/\/\S+|www\.\S+|[A-Za-z][A-Za-z0-9+._/@-]*|\d+(?:[./-]\d+)*)/g,
            (run) => `\u2066${run}\u2069`,
          )
        : trimmed;
      return `${hasArabic ? "\u2067" : "\u2066"}${protectedRuns}\u2069`;
    })
    .join("\n");
}

export function buildMetaActions({
  locale = "fr",
  serviceId = "",
  websiteUrl = "https://www.striviodz.store",
  includeWebsite = true,
  includeChat = true,
  includeHuman = true,
  queryParams = {},
  attribution = null,
} = {}) {
  const labels = ACTION_LABELS[locale] || ACTION_LABELS.fr;
  const actions = [];
  if (includeWebsite) {
    const url = new URL(websiteUrl);
    if (serviceId) url.searchParams.set("service", serviceId);
    const allowedParams = new Set([
      "variant",
      "utm_medium",
      "utm_campaign",
      "utm_content",
    ]);
    for (const [key, rawValue] of Object.entries(
      queryParams && typeof queryParams === "object" ? queryParams : {},
    )) {
      if (!allowedParams.has(key)) continue;
      const safeValue = String(rawValue || "").trim().slice(0, 100);
      if (safeValue) url.searchParams.set(key, safeValue);
    }
    if (attribution) {
      url.searchParams.set("utm_source", "meta-chatbot");
      url.searchParams.set("utm_medium", "social");
      const variant = typeof attribution === "object"
        ? String(attribution.variant || "").trim().slice(0, 100)
        : "";
      if (variant) url.searchParams.set("variant", variant);
    }
    actions.push({ type: "web_url", title: labels.website, url: url.toString() });
  }
  if (includeChat) {
    actions.push({
      type: "postback",
      title: labels.chat,
      payload: `STRIVIO_CHAT_ORDER:${String(serviceId || "general").slice(0, 60)}`,
    });
  }
  if (includeHuman) {
    actions.push({
      type: "postback",
      title: labels.human,
      payload: "STRIVIO_HUMAN",
    });
  }
  return actions.slice(0, 3);
}

function qualificationQuestion(locale, missingFields, service) {
  const missing = Array.isArray(missingFields) ? missingFields[0] : "";
  if (missing === "duration_months") {
    return localized(locale, {
      ar: "ما المدة التي تحتاجها؟",
      fr: "Quelle durée souhaitez-vous ?",
      en: "Which duration would you like?",
      dz: "شحال من شهر تحتاج؟",
    });
  }
  if (missing === "type") {
    const netflix = service?.id === "netflix";
    return localized(locale, {
      ar: netflix ? "كم شاشة أو بروفايل تحتاج؟" : "ما الخطة أو النوع الذي تحتاجه؟",
      fr: netflix ? "Combien d’écrans souhaitez-vous ?" : "Quelle formule souhaitez-vous ?",
      en: netflix ? "How many screens do you need?" : "Which plan do you need?",
      dz: netflix ? "شحال من écran تحتاج؟" : "واش من formule تحتاج؟",
    });
  }
  return localized(locale, {
    ar: "ما الخدمة التي تبحث عنها؟",
    fr: "Quel service recherchez-vous ?",
    en: "Which service are you looking for?",
    dz: "واش من service تحتاج؟",
  });
}

export function deterministicReply({
  text,
  locale,
  services = [],
  knowledge = [],
  bundleRules = [],
  memory = {},
}) {
  const detectedLocale = locale || detectLanguage(text);
  const rememberedService = String(memory?.service_id || "");
  const effectiveText = !identifyService(text) && rememberedService
    ? `${rememberedService} ${text}`
    : text;
  const analysis = identifyIntent(effectiveText);
  const service = analysis.serviceId
    ? services.find((item) => String(item?.id || "") === analysis.serviceId)
    : null;
  const effectiveMemory = mergeConversationMemory(memory, text);
  const readiness = getSalesReadiness(effectiveMemory, service);
  const salesMeta = {
    readyForActions: readiness.ready,
    missingFields: readiness.missingFields,
    salesStage: readiness.stage,
  };

  if (analysis.intent === "human_handoff") {
    return {
      ...analysis,
      locale: detectedLocale,
      handoff: true,
      reply: localized(detectedLocale, {
        ar: "أكيد. حولت المحادثة لفريق Strivio وسيرد عليك أحد أفراد الفريق قريبًا.",
        fr: "Bien sûr. J’ai transmis la conversation à l’équipe Strivio. Un conseiller vous répondra bientôt.",
        en: "Of course. I handed the conversation to the Strivio team. A team member will reply shortly.",
        dz: "أكيد، حولتلك la conversation لفريق Strivio ويرد عليك واحد من الفريق قريب.",
      }),
      source: "rules",
    };
  }

  if (analysis.intent === "warranty") {
    return {
      ...analysis,
      ...salesMeta,
      locale: detectedLocale,
      handoff: false,
      precise: true,
      reply: localized(detectedLocale, {
        ar: "كل منتجات Strivio مضمونة طوال مدة الاشتراك المدفوعة.\nعند حدوث مشكلة نقوم أولًا بالإصلاح أو الاستبدال.\nإذا تعذر ذلك نعوض المدة المتبقية بخدمة مكافئة.\nلا يشمل الضمان المشاكل الناتجة عن مخالفة شروط الاستخدام.",
        fr: "Tous les produits Strivio sont entièrement garantis pendant la durée payée.\nEn cas de problème, nous réparons ou remplaçons d’abord le service.\nSi cela est impossible, la durée restante est compensée par un service équivalent.\nLa garantie exclut les problèmes causés par une violation des conditions d’utilisation.",
        en: "Every Strivio product is fully covered for the paid subscription period.\nIf an issue occurs, we first repair or replace the service.\nIf that is not possible, we compensate the remaining period with an equivalent service.\nThe warranty excludes issues caused by violating the usage terms.",
        dz: "Ga3 les produits Strivio مضمونين طول مدة الاشتراك المدفوعة.\nإذا صرات مشكلة نصلحوها أو نعوضو الخدمة أولًا.\nإذا ما قدرناش، نعوضولك المدة الباقية بخدمة مكافئة.\nالضمان ما يشملش المشاكل الناتجة عن مخالفة شروط الاستعمال.",
      }),
      source: "rules",
    };
  }

  if (analysis.intent === "order_status") {
    return {
      ...analysis,
      locale: detectedLocale,
      handoff: false,
      reply: localized(detectedLocale, {
        ar: "لحماية معلوماتك، ادخل إلى موقع Strivio من الرابط الموجود في البايو، وسجّل بنفس بريد الطلب ثم افتح «حسابي» و«مشترياتي».",
        fr: "Pour protéger vos informations, ouvrez Strivio depuis le lien dans la bio, connectez-vous avec l’e-mail de la commande puis ouvrez « Mon compte » et « Mes achats ».",
        en: "To protect your information, open Strivio from the link in our bio, sign in with the order email, then open My Account and Purchases.",
        dz: "Bach نحمي معلوماتك، ادخل لموقع Strivio من الرابط لي في bio، سجل بنفس email ta3 commande ومن بعد افتح Mon compte ثم Mes achats.",
      }),
      source: "rules",
    };
  }

  if (analysis.intent === "payment") {
    return {
      ...analysis,
      ...salesMeta,
      locale: detectedLocale,
      handoff: false,
      precise: true,
      reply: localized(detectedLocale, {
        ar: "الدفع الآمن عبر الموقع متاح بـ:\n• البطاقة الذهبية أو CIB عبر SATIM\n• BaridiMob أو CCP\n• Wise أو USDT\n• Flexy مع رسوم خدمة 19%\nالشراء من الموقع يتيح لك الكوبونات والعروض، تتبع الطلب، واستلام تفاصيله من حسابك.\nيمكنك الشراء من الموقع مباشرة أو إكمال الطلب هنا.",
        fr: "Paiement sécurisé sur le site :\n• Carte Edahabia ou CIB via SATIM\n• BaridiMob ou CCP\n• Wise ou USDT\n• Flexy avec 19 % de frais\nLe site permet aussi d’utiliser les coupons, voir les offres, suivre la commande et retrouver ses détails.\nVous pouvez commander sur le site ou continuer ici.",
        en: "Secure website payment supports:\n• Edahabia or CIB card through SATIM\n• BaridiMob or CCP\n• Wise or USDT\n• Flexy with a 19% service fee\nThe website also gives you coupons, current offers, order tracking, and access to order details.\nYou can order on the website or continue here.",
        dz: "الدفع الآمن في الموقع متوفر بـ:\n• Edahabia ولا CIB عبر SATIM\n• BaridiMob ولا CCP\n• Wise ولا USDT\n• Flexy بزيادة 19%\nفي الموقع تقدر تستعمل الكوبون، تشوف العروض، وتتبع طلبك من حسابك.\nتقدر تشري من الموقع مباشرة ولا نكملو هنا.",
      }),
      source: "rules",
    };
  }

  if (analysis.intent === "website_checkout") {
    return {
      ...analysis,
      ...salesMeta,
      locale: detectedLocale,
      handoff: false,
      precise: true,
      reply: localized(detectedLocale, {
        ar: "الشراء من موقع Strivio هو الخيار الأسرع والأسهل.\nيدعم البطاقة الذهبية وCIB بأمان عبر SATIM.\nستجد العروض والكوبونات، وتتبع الطلب، والتجديد، والدعم من حسابك.\nوإذا فضلت، يمكننا أيضًا إكمال الطلب معك هنا.",
        fr: "Commander sur le site Strivio est le choix le plus rapide et le plus simple.\nLe paiement par carte Edahabia ou CIB est sécurisé via SATIM.\nVous profitez aussi des offres, coupons, suivi, renouvellement et support depuis votre compte.\nSi vous préférez, nous pouvons également continuer ici.",
        en: "Ordering on the Strivio website is the fastest and easiest option.\nEdahabia and CIB card payments are secured through SATIM.\nYou also get offers, coupons, tracking, renewal, and support from your account.\nIf you prefer, we can continue here too.",
        dz: "الشراء من موقع Strivio هو الأسرع والأسهل.\nتقدر تخلص بـ Edahabia ولا CIB بأمان عبر SATIM.\nتلقى العروض والكوبونات، تتبع الطلب، التجديد، والدعم كامل من حسابك.\nوإذا تحب نقدروا نكملوا الطلب هنا.",
      }),
      source: "rules",
    };
  }

  if (analysis.intent === "delivery") {
    return {
      ...analysis,
      ...salesMeta,
      locale: detectedLocale,
      handoff: false,
      precise: true,
      reply: localized(detectedLocale, {
        ar: "التسليم يعتمد على نوع المنتج.\nبعض المنتجات تُسلّم تلقائيًا بعد تأكيد الدفع.\nخدمات التفعيل تطلب بيانات الخدمة داخل صفحة الطلب المحمية.\nأما الطلبات اليدوية فيجهزها فريق Strivio.\nيمكنك متابعة الحالة والتفاصيل من حسابك.",
        fr: "La livraison dépend du type de produit.\nCertains produits sont livrés automatiquement après confirmation du paiement.\nLes services d’activation demandent les informations dans la page de commande protégée.\nLes commandes manuelles sont préparées par l’équipe Strivio.\nLe suivi reste disponible dans votre compte.",
        en: "Delivery depends on the product type.\nSome products are delivered automatically after payment confirmation.\nActivation services request the required details inside the protected order page.\nManual orders are prepared by the Strivio team.\nYou can track status and details from your account.",
        dz: "التسليم يتبدل حسب نوع المنتج.\nكاين منتجات تتسلم تلقائيًا بعد تأكيد الدفع.\nخدمات التفعيل تدخل معلوماتها في صفحة الطلب المحمية.\nوالطلبات اليدوية يجهزها فريق Strivio.\nتقدر تتبع الحالة والتفاصيل من حسابك.",
      }),
      source: "rules",
    };
  }

  if (service && ["price", "purchase", "service_interest"].includes(analysis.intent)) {
    const durationIndex = DURATION_MONTHS.indexOf(Number(effectiveMemory?.duration_months || 0));
    const requestedTypeIndex = (
      effectiveMemory?.type_index !== null
      && effectiveMemory?.type_index !== undefined
      && Number.isInteger(Number(effectiveMemory.type_index))
    )
      ? Number(effectiveMemory.type_index)
      : 0;
    const hasRequiredType = !service?.show_types || Boolean(effectiveMemory?.quantity || effectiveMemory?.plan_type);
    const priceSource = service?.show_types
      ? service?.type_prices?.[requestedTypeIndex]
      : service?.p;
    const exactPrice = durationIndex >= 0 && hasRequiredType
      ? Number(priceSource?.[durationIndex] || 0)
      : 0;
    if (exactPrice > 0) {
      const typeNames = service?.types?.[detectedLocale]
        || service?.types?.[detectedLocale === "dz" ? "fr" : "fr"]
        || service?.types?.en
        || [];
      const typeName = service?.show_types
        ? String(typeNames[requestedTypeIndex] || `Option ${requestedTypeIndex + 1}`)
        : "";
      const durationName = durationLabels(detectedLocale)[durationIndex]
        || `${effectiveMemory.duration_months} months`;
      const offerLines = activeOfferLines(
        service.id,
        bundleRules,
        detectedLocale,
        durationIndex,
        requestedTypeIndex,
        false,
      );
      const exactOffer = offerLines.length
        ? localized(detectedLocale, {
            ar: `\nالهدية: ${offerLines[0]}`,
            fr: `\nCadeau : ${offerLines[0]}`,
            en: `\nGift: ${offerLines[0]}`,
            dz: `\nCadeau: ${offerLines[0]}`,
          })
        : "";
      const alternative = betterValueAlternative(
        service,
        bundleRules,
        detectedLocale,
        durationIndex,
        requestedTypeIndex,
        priceSource,
      );
      const alternativeDuration = alternative
        ? durationLabels(detectedLocale)[alternative.durationIndex] || ""
        : "";
      const alternativeGift = alternative?.offer ? ` + ${alternative.offer}` : "";
      const upsell = alternative
        ? localized(detectedLocale, {
            ar: `\nبديل أفضل: ${alternativeDuration}\nالسعر: ${formatDzdAmount(alternative.price, "ar")}${alternativeGift}`,
            fr: `\nMeilleure alternative : ${alternativeDuration}\nPrix : ${formatDzdAmount(alternative.price, "fr")}${alternativeGift}`,
            en: `\nBetter alternative: ${alternativeDuration}\nPrice: ${formatDzdAmount(alternative.price, "en")}${alternativeGift}`,
            dz: `\nاقتراح أفضل: ${alternativeDuration}\nPrix: ${formatDzdAmount(alternative.price, "dz")}${alternativeGift}`,
          })
        : "";
      return {
        ...analysis,
        ...salesMeta,
        locale: detectedLocale,
        handoff: false,
        precise: true,
        reply: localized(detectedLocale, {
          ar: `${serviceName(service, "ar")} متوفر ✅\n${typeName ? `الخطة: ${typeName}\n` : ""}المدة: ${durationName}\nالسعر: ${formatDzdAmount(exactPrice, "ar")}${exactOffer}${upsell}\nيمكنك الآن اختيار طريقة إكمال الطلب.`,
          fr: `${serviceName(service, "fr")} est disponible ✅\n${typeName ? `Formule : ${typeName}\n` : ""}Durée : ${durationName}\nPrix : ${formatDzdAmount(exactPrice, "fr")}${exactOffer}${upsell}\nVous pouvez maintenant choisir comment terminer la commande.`,
          en: `${serviceName(service, "en")} is available ✅\n${typeName ? `Plan: ${typeName}\n` : ""}Duration: ${durationName}\nPrice: ${formatDzdAmount(exactPrice, "en")}${exactOffer}${upsell}\nYou can now choose how to complete the order.`,
          dz: `${serviceName(service, "fr")} kayen ✅\n${typeName ? `Formule: ${typeName}\n` : ""}Durée: ${durationName}\nPrix: ${formatDzdAmount(exactPrice, "dz")}${exactOffer}${upsell}\nدرك تقدر تختار كيف تكمل الطلب.`,
        }),
        source: "rules",
      };
    }
    if (!readiness.ready && analysis.intent !== "price") {
      return {
        ...analysis,
        ...salesMeta,
        locale: detectedLocale,
        handoff: false,
        precise: true,
        reply: localized(detectedLocale, {
          ar: `${serviceName(service, "ar")} متوفر ✅\n${qualificationQuestion(detectedLocale, readiness.missingFields, service)}`,
          fr: `${serviceName(service, "fr")} est disponible ✅\n${qualificationQuestion(detectedLocale, readiness.missingFields, service)}`,
          en: `${serviceName(service, "en")} is available ✅\n${qualificationQuestion(detectedLocale, readiness.missingFields, service)}`,
          dz: `${serviceName(service, "fr")} kayen ✅\n${qualificationQuestion(detectedLocale, readiness.missingFields, service)}`,
        }),
        source: "rules",
      };
    }
    const prices = formatServicePrices(service, detectedLocale);
    const offers = activeOfferLines(service.id, bundleRules, detectedLocale);
    const offersText = offers.length
      ? localized(detectedLocale, {
          ar: `\nعرض مميز:\n${offers[0]}`,
          fr: `\nOffre spéciale :\n${offers[0]}`,
          en: `\nSpecial offer:\n${offers[0]}`,
          dz: `\nOffre spéciale:\n${offers[0]}`,
        })
      : "";
    if (prices) {
      const nextQuestion = readiness.ready
        ? localized(detectedLocale, {
            ar: "هل تريد إكمال الطلب من الموقع أم هنا؟",
            fr: "Souhaitez-vous commander sur le site ou continuer ici ?",
            en: "Would you like to order on the website or continue here?",
            dz: "تحب تكمل من الموقع ولا هنا؟",
          })
        : qualificationQuestion(detectedLocale, readiness.missingFields, service);
      return {
        ...analysis,
        ...salesMeta,
        locale: detectedLocale,
        handoff: false,
        precise: true,
        reply: localized(detectedLocale, {
          ar: `${serviceName(service, "ar")} متوفر ✅\n${prices}${offersText}\n${nextQuestion}`,
          fr: `${serviceName(service, "fr")} est disponible ✅\n${prices}${offersText}\n${nextQuestion}`,
          en: `${serviceName(service, "en")} is available ✅\n${prices}${offersText}\n${nextQuestion}`,
          dz: `${serviceName(service, "ar")} kayen ✅\n${prices}${offersText}\n${nextQuestion}`,
        }),
        source: "rules",
      };
    }
  }

  const normalized = normalizeMessage(text);
  for (const item of knowledge) {
    const keywords = Array.isArray(item?.keywords) ? item.keywords : [];
    if (!item?.active || !keywords.some((keyword) => normalized.includes(normalizeMessage(keyword)))) continue;
    const answer = item?.answers?.[detectedLocale]
      || item?.answers?.[detectedLocale === "dz" ? "ar" : "fr"]
      || item?.answers?.en;
    if (answer) {
      return {
        ...analysis,
        intent: item.knowledge_key || analysis.intent,
        confidence: 0.9,
        locale: detectedLocale,
        handoff: false,
        reply: String(answer),
        source: "rules",
      };
    }
  }

  if (analysis.intent === "greeting") {
    return {
      ...analysis,
      locale: detectedLocale,
      handoff: false,
      reply: localized(detectedLocale, {
        ar: "أهلًا بك في Strivio 👋 أخبرني ما الخدمة التي تبحث عنها، وسأعطيك الأسعار والتفاصيل.",
        fr: "Bienvenue chez Strivio 👋 Dites-moi quel service vous cherchez et je vous donnerai les prix et les détails.",
        en: "Welcome to Strivio 👋 Tell me which service you need and I’ll share the prices and details.",
        dz: "Marhba bik fi Strivio 👋 Goulili واش من service تحتاج ونمدلك الأسعار والتفاصيل.",
      }),
      source: "rules",
    };
  }

  return {
    ...analysis,
    locale: detectedLocale,
    handoff: false,
    reply: "",
    source: "rules",
  };
}
