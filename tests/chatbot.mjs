import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildMetaActions,
  compactDzdPrices,
  detectLanguage,
  deterministicReply,
  formatDzdAmount,
  getSalesReadiness,
  identifyIntent,
  isReadyForCompletionActions,
  mergeConversationMemory,
  normalizeMessage,
  redactSensitiveText,
  socialSafeReply,
  stabilizeBidiReply,
} from "../supabase/functions/meta-chatbot/chatbot-core.ts";

const services = [
  {
    id: "netflix",
    n: { ar: "نتفليكس بريميوم", fr: "Netflix Premium", en: "Netflix Premium" },
    p: [800, 1400, 1800, 3500, 5500],
    show_types: true,
    types: {
      ar: ["شاشة واحدة", "شاشتان", "3 شاشات", "4 شاشات", "5 شاشات"],
      fr: ["1 écran", "2 écrans", "3 écrans", "4 écrans", "5 écrans"],
      en: ["1 screen", "2 screens", "3 screens", "4 screens", "5 screens"],
    },
    type_prices: [
      [800, 1400, 1900, 3500, 5500],
      [1400, 2500, 3500, 6000, 9900],
      [2000, 3800, 5000, 9000, 12000],
      [0, 0, 0, 0, 0],
      [2800, 0, 8000, 14000, 16000],
    ],
  },
  {
    id: "spotify",
    n: { ar: "سبوتيفاي بريميوم", fr: "Spotify Premium", en: "Spotify Premium" },
    p: [690, 1200, 1500, 2500, 3600],
  },
];

const bundleRules = [
  {
    active: true,
    source_service_id: "netflix",
    source_duration_idx: 2,
    starts_at: null,
    ends_at: null,
    label_i18n: {
      ar: "بروفيل Prime Video مجاني لنفس المدة",
      fr: "Un profil Prime Video gratuit pour la même durée",
      en: "One free Prime Video profile for the same duration",
    },
  },
];

const knowledge = [
  {
    knowledge_key: "payment_methods",
    active: true,
    keywords: ["payment", "paiement", "ادفع"],
    answers: {
      ar: "اختر المنتج ثم ستظهر طرق الدفع.",
      fr: "Choisissez le produit puis les moyens de paiement apparaîtront.",
      en: "Choose the product and payment methods will appear.",
      dz: "Khayyer produit ومن بعد يبان paiement.",
    },
  },
];

assert.equal(detectLanguage("khsni netflix"), "dz");
assert.equal(detectLanguage("khsni netflix 3 mois 2 screens"), "dz");
assert.equal(detectLanguage("Combien coûte Spotify ?"), "fr");
assert.equal(detectLanguage("I need Netflix"), "en");
assert.equal(detectLanguage("أريد نتفلكس"), "ar");

assert.match(normalizeMessage("khsni netflix ch7al"), /احتاج netflix كم السعر/);
assert.equal(normalizeMessage("ثلاثة أشهر"), "ثلاثة اشهر");
assert.equal(identifyIntent("khsni netflix").intent, "purchase");
assert.equal(identifyIntent("ch7al spotify").intent, "price");
assert.equal(identifyIntent("kifach nkhalles").intent, "payment");
assert.equal(identifyIntent("هل يوجد ضمان كامل؟").intent, "warranty");
assert.equal(identifyIntent("I want a human agent").intent, "human_handoff");
assert.equal(identifyIntent("I need a ChatGPT account").intent, "purchase");
assert.equal(identifyIntent("Where is my order?").intent, "order_status");

const netflixReply = deterministicReply({
  text: "khsni netflix ch7al",
  locale: "dz",
  services,
  knowledge,
  bundleRules,
});
assert.equal(netflixReply.intent, "price");
assert.equal(netflixReply.serviceId, "netflix");
assert.match(netflixReply.reply, /800/);
assert.match(netflixReply.reply, /5500/);
assert.doesNotMatch(netflixReply.reply, /5[\s\u00a0\u202f,.]500/);
assert.doesNotMatch(netflixReply.reply, /\b0 دج\b/);
assert.match(netflixReply.reply, /Prime Video/);
assert.doesNotMatch(netflixReply.reply, /4 شاشات/);

const frenchSpotify = deterministicReply({
  text: "Combien coûte Spotify ?",
  locale: "fr",
  services,
  knowledge,
});
assert.equal(frenchSpotify.serviceId, "spotify");
assert.match(frenchSpotify.reply, /Spotify Premium/);
assert.match(frenchSpotify.reply, /690/);

const privacyReply = deterministicReply({
  text: "أعطني معلومات طلبي وكلمة السر",
  locale: "ar",
  services,
  knowledge,
});
assert.equal(privacyReply.intent, "order_status");
assert.match(privacyReply.reply, /البايو/);
assert.doesNotMatch(privacyReply.reply, /https?:\/\/|www\./i);

const safeInstagramReply = socialSafeReply(
  "تابع طلبك هنا https://www.striviodz.store/my-account أو عبر striviodz.store",
  "ar",
);
assert.match(safeInstagramReply, /https:\/\/www\.striviodz\.store\/my-account/i);
assert.match(safeInstagramReply, /striviodz\.store/i);
const externalLinkReply = socialSafeReply(
  "افتح https://unknown-example.com ثم تواصل معنا",
  "ar",
);
assert.doesNotMatch(externalLinkReply, /unknown-example\.com/i);
assert.match(externalLinkReply, /striviodz\.store/i);

assert.equal(formatDzdAmount(1200, "ar"), "1200 دج");
assert.equal(formatDzdAmount(1200, "fr"), "1200 DZD");
assert.equal(compactDzdPrices("Prix: 1\u202f200 DZD"), "Prix: 1200 DZD");

const paymentReply = deterministicReply({
  text: "kifach nkhalles",
  locale: "dz",
  services,
  knowledge: [],
});
assert.match(paymentReply.reply, /SATIM/);
assert.match(paymentReply.reply, /BaridiMob/);
assert.match(paymentReply.reply, /USDT/);
assert.match(paymentReply.reply, /CIB/);

const warrantyReply = deterministicReply({
  text: "هل كل المنتجات تحت ضمان؟",
  locale: "ar",
  services,
  knowledge: [],
});
assert.equal(warrantyReply.intent, "warranty");
assert.equal(warrantyReply.precise, true);
assert.match(warrantyReply.reply, /مضمونة|ضمان/);
assert.match(warrantyReply.reply, /الإصلاح|الاستبدال/);

assert.equal(
  redactSensitiveText("email me at user@example.com password: Secret123 phone 0555123456"),
  "email me at [email] [credential] phone [phone]",
);

const rememberedNetflix = mergeConversationMemory({}, "khsni netflix");
const rememberedArabicPlan = mergeConversationMemory(
  rememberedNetflix,
  "ثلاثة أشهر، ثلاث شاشات",
);
assert.equal(rememberedArabicPlan.duration_months, 3);
assert.equal(rememberedArabicPlan.quantity, 3);
const rememberedScreensOnly = mergeConversationMemory(rememberedNetflix, "3 شاشات");
assert.equal(rememberedScreensOnly.duration_months, undefined);
assert.equal(rememberedScreensOnly.quantity, 3);
const rememberedPlan = mergeConversationMemory(rememberedNetflix, "3 mois 2 écrans");
assert.equal(rememberedPlan.service_id, "netflix");
assert.equal(rememberedPlan.duration_months, 3);
assert.equal(rememberedPlan.quantity, 2);
assert.equal(getSalesReadiness(rememberedPlan, services[0]).ready, true);
assert.equal(isReadyForCompletionActions(rememberedPlan, services[0]), true);
const switchedService = mergeConversationMemory(rememberedPlan, "spotify");
assert.equal(switchedService.service_id, "spotify");
assert.equal(switchedService.duration_months, undefined);
assert.equal(switchedService.quantity, undefined);
assert.equal(switchedService.type_index, undefined);
const rememberedReply = deterministicReply({
  text: "3 mois 2 écrans",
  locale: "fr",
  services,
  knowledge,
  bundleRules,
  memory: rememberedPlan,
});
assert.match(rememberedReply.reply, /3 mois/);
assert.match(rememberedReply.reply, /3500/);
assert.doesNotMatch(rememberedReply.reply, /3[\s\u00a0\u202f,.]500/);
assert.match(rememberedReply.reply, /Prime Video/);
assert.doesNotMatch(rememberedReply.reply, /1 mois 1[\s,.]?400/);

const actions = buildMetaActions({
  locale: "fr",
  serviceId: rememberedPlan.service_id,
  websiteUrl: "https://www.striviodz.store",
});
assert.equal(actions.length, 3);
assert.equal(actions[0].type, "web_url");
assert.match(actions[0].url, /\?service=netflix$/);
assert.equal(actions[1].payload, "STRIVIO_CHAT_ORDER:netflix");
assert.equal(actions[2].payload, "STRIVIO_HUMAN");

const bidiReply = stabilizeBidiReply("السعر: 1,900 DZD\nالخدمة: Netflix", "ar");
assert.match(bidiReply, /\u2067/);
assert.match(bidiReply, /\u2069/);

const runtimeSource = readFileSync(
  new URL("../supabase/functions/meta-chatbot/index.ts", import.meta.url),
  "utf8",
);
assert.match(runtimeSource, /senderAction: "mark_seen" \| "typing_on" \| "typing_off"/);
assert.match(runtimeSource, /signal: AbortSignal\.timeout\(1500\)/);
assert.match(runtimeSource, /debounce_ms \|\| 2500/);
assert.match(runtimeSource, /ten_minute_limit \|\| 60/);
assert.match(runtimeSource, /sales_stage: stage/);
assert.match(runtimeSource, /Never hand the conversation to a human merely because a question is unclear/);
assert.match(runtimeSource, /intent: "clarification",\s+handoff: false/);
assert.doesNotMatch(runtimeSource, /out_of_stock/);

console.log("Chatbot language and safety checks passed.");
