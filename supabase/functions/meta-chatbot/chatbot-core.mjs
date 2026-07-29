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
  "how much", "ch7al", "chehal",
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
  if (/\b(?:bonjour|bonsoir|prix|combien|comment|merci|livraison|acheter|mois|abonnement)\b/i.test(raw)) return "fr";
  if (/\b(?:hello|price|how|buy|need|want|delivery|month|subscription)\b/i.test(raw)) return "en";
  if (/\b(?:khsni|khassni|n7ab|nheb|ch7al|chehal|kifach|wa9tach|nkhalles|kayen)\b/i.test(raw)) return "dz";
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

export function identifyIntent(value) {
  const normalized = normalizeMessage(value);
  const serviceId = identifyService(value);
  if (hasAny(normalized, HUMAN_WORDS)) return { intent: "human_handoff", serviceId, confidence: 0.99 };
  if (hasAny(normalized, ORDER_WORDS)) return { intent: "order_status", serviceId, confidence: 0.92 };
  if (hasAny(normalized, PAYMENT_WORDS)) return { intent: "payment", serviceId, confidence: 0.91 };
  if (hasAny(normalized, DELIVERY_WORDS)) return { intent: "delivery", serviceId, confidence: 0.88 };
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

function serviceName(service, locale) {
  const names = service?.n || {};
  return String(names[locale] || names[locale === "dz" ? "ar" : "fr"] || names.en || service?.id || "Service");
}

function durationLabels(locale) {
  return MONTH_LABELS[locale] || MONTH_LABELS.fr;
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
          .map((entry) => `${entry.label} ${entry.price.toLocaleString("fr-FR")} دج`);
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
    .map((entry) => `${entry.label}: ${entry.price.toLocaleString("fr-FR")} دج`)
    .join("\n");
}

function localized(locale, variants) {
  return variants[locale] || variants.fr;
}

function activeOfferLines(serviceId, bundleRules, locale) {
  const now = Date.now();
  const labels = durationLabels(locale);
  return (Array.isArray(bundleRules) ? bundleRules : [])
    .filter((rule) => {
      if (!rule?.active || rule.source_service_id !== serviceId) return false;
      const startsAt = rule.starts_at ? new Date(rule.starts_at).getTime() : 0;
      const endsAt = rule.ends_at ? new Date(rule.ends_at).getTime() : 0;
      return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
    })
    .map((rule) => {
      const offer = rule?.label_i18n?.[locale]
        || rule?.label_i18n?.[locale === "dz" ? "ar" : "fr"]
        || rule?.label_i18n?.en
        || "";
      if (!offer) return "";
      const duration = labels[Number(rule.source_duration_idx)] || "";
      return duration ? `${duration}: ${offer}` : String(offer);
    })
    .filter(Boolean);
}

export function socialSafeReply(value, locale = "fr") {
  const original = String(value || "");
  const linkPattern = /(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|store|dz|io|app|co|me)(?:\/[^\s]*)?/gi;
  const hadLink = new RegExp(linkPattern.source, "i").test(original);
  const clean = original
    .replace(linkPattern, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!hadLink) return clean;
  const instruction = BIO_INSTRUCTIONS[locale] || BIO_INSTRUCTIONS.fr;
  return clean ? `${clean}\n\n${instruction}` : instruction;
}

export function deterministicReply({ text, locale, services = [], knowledge = [], bundleRules = [] }) {
  const detectedLocale = locale || detectLanguage(text);
  const analysis = identifyIntent(text);
  const service = analysis.serviceId
    ? services.find((item) => String(item?.id || "") === analysis.serviceId)
    : null;

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
      locale: detectedLocale,
      handoff: false,
      reply: localized(detectedLocale, {
        ar: "طرق الدفع المتاحة: بطاقة CIB أو الذهبية عبر SATIM، بريدي موب، CCP، Wise باليورو، USDT، وFlexy مع رسوم خدمة 19%. سعر تحويل Wise وUSDT الحالي يظهر داخل السلة، ويمكن إدخال الكوبون فيها قبل تأكيد الطلب.",
        fr: "Paiements disponibles : carte CIB ou Edahabia via SATIM, BaridiMob, CCP, Wise en EUR, USDT et Flexy avec 19 % de frais. Le taux actuel Wise/USDT et le champ coupon s’affichent dans le panier avant confirmation.",
        en: "Available payments: CIB or Edahabia card through SATIM, BaridiMob, CCP, Wise in EUR, USDT, and Flexy with a 19% fee. Current Wise/USDT rates and coupon validation appear in the cart before confirmation.",
        dz: "T9der tkhalles b CIB wela Edahabia عبر SATIM، BaridiMob، CCP، Wise باليورو، USDT، ولا Flexy بزيادة 19%. Taux ta3 Wise وUSDT والكوبون يبانولك في السلة قبل التأكيد.",
      }),
      source: "rules",
    };
  }

  if (analysis.intent === "delivery") {
    return {
      ...analysis,
      locale: detectedLocale,
      handoff: false,
      reply: localized(detectedLocale, {
        ar: "طريقة التسليم تعتمد على المنتج: المنتجات ذات المخزون تُسلَّم بعد تأكيد الدفع عندما يكون المخزون جاهزًا، وخدمات تفعيل الحساب تطلب بيانات الخدمة داخل صفحة الطلب المحمية، أما التسليم اليدوي فيجهزه فريق Strivio وتتابع حالته من حسابك.",
        fr: "La livraison dépend du produit : les produits en stock sont livrés après confirmation du paiement, l’activation manuelle demande les identifiants du service dans la page de commande protégée, et la livraison manuelle est préparée par l’équipe Strivio. Le suivi reste disponible dans votre compte.",
        en: "Delivery depends on the product: stocked products are delivered after payment confirmation, manual activation asks for the service login inside the protected order page, and manual delivery is prepared by the Strivio team. You can track progress in your account.",
        dz: "Livraison تتبدل حسب produit: لي عندو stock يتسلم بعد تأكيد الدفع، manual activation تدخل معلومات الخدمة داخل صفحة الطلب المحمية، وmanual delivery يجهزها فريق Strivio. الحالة تقدر تتبعها من حسابك.",
      }),
      source: "rules",
    };
  }

  if (service && ["price", "purchase", "service_interest"].includes(analysis.intent)) {
    const prices = formatServicePrices(service, detectedLocale);
    const offers = activeOfferLines(service.id, bundleRules, detectedLocale);
    const offersText = offers.length
      ? localized(detectedLocale, {
          ar: `\nالعروض الحالية:\n${offers.join("\n")}`,
          fr: `\nOffres actuelles :\n${offers.join("\n")}`,
          en: `\nCurrent offers:\n${offers.join("\n")}`,
          dz: `\nLes offres لي كاينين:\n${offers.join("\n")}`,
        })
      : "";
    if (prices) {
      return {
        ...analysis,
        locale: detectedLocale,
        handoff: false,
        reply: localized(detectedLocale, {
          ar: `${serviceName(service, "ar")} متوفر ✅\n${prices}${offersText}\nللطلب ادخل إلى موقع Strivio من الرابط الموجود في البايو.`,
          fr: `${serviceName(service, "fr")} est disponible ✅\n${prices}${offersText}\nPour commander, ouvrez Strivio depuis le lien dans la bio.`,
          en: `${serviceName(service, "en")} is available ✅\n${prices}${offersText}\nTo order, open Strivio from the link in our bio.`,
          dz: `${serviceName(service, "ar")} kayen ✅\n${prices}${offersText}\nBach تطلب، ادخل لموقع Strivio من الرابط لي في bio.`,
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
