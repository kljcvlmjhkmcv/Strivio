import assert from "node:assert/strict";
import {
  detectLanguage,
  deterministicReply,
  identifyIntent,
  normalizeMessage,
  redactSensitiveText,
} from "../supabase/functions/meta-chatbot/chatbot-core.mjs";

const services = [
  {
    id: "netflix",
    n: { ar: "نتفليكس بريميوم", fr: "Netflix Premium", en: "Netflix Premium" },
    p: [800, 1400, 1800, 3500, 5500],
  },
  {
    id: "spotify",
    n: { ar: "سبوتيفاي بريميوم", fr: "Spotify Premium", en: "Spotify Premium" },
    p: [690, 1200, 1500, 2500, 3600],
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
assert.equal(detectLanguage("Combien coûte Spotify ?"), "fr");
assert.equal(detectLanguage("I need Netflix"), "en");
assert.equal(detectLanguage("أريد نتفلكس"), "ar");

assert.match(normalizeMessage("khsni netflix ch7al"), /احتاج netflix كم السعر/);
assert.equal(identifyIntent("khsni netflix").intent, "purchase");
assert.equal(identifyIntent("ch7al spotify").intent, "price");
assert.equal(identifyIntent("kifach nkhalles").intent, "payment");
assert.equal(identifyIntent("I want a human agent").intent, "human_handoff");
assert.equal(identifyIntent("I need a ChatGPT account").intent, "purchase");
assert.equal(identifyIntent("Where is my order?").intent, "order_status");

const netflixReply = deterministicReply({
  text: "khsni netflix ch7al",
  locale: "dz",
  services,
  knowledge,
});
assert.equal(netflixReply.intent, "price");
assert.equal(netflixReply.serviceId, "netflix");
assert.match(netflixReply.reply, /800/);
assert.match(netflixReply.reply, /5[\s,.]?500/);
assert.doesNotMatch(netflixReply.reply, /\b0 دج\b/);

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
assert.match(privacyReply.reply, /my-account/);

assert.equal(
  redactSensitiveText("email me at user@example.com password: Secret123 phone 0555123456"),
  "email me at [email] [credential] phone [phone]",
);

console.log("Chatbot language and safety checks passed.");
