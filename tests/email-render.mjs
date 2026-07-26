import assert from "node:assert/strict";
import { renderStrivioEmail } from "../supabase/functions/_shared/strivio-email.ts";

const actionUrl = "https://www.striviodz.store/my-account?order=test";
const externalUrl = "https://2fa.example.com/code?secret=example";

const sensitive = renderStrivioEmail({
  eventType: "order.delivered",
  templateKey: "order_delivered",
  locale: "ar",
  customerName: "Test",
  orderId: "00000000-0000-0000-0000-000000000000",
  serviceName: "Test service",
  actionUrl,
  adminNote: `استخدم الرابط ${externalUrl} للحصول على رمز التحقق`,
  entries: [{
    entry_kind: "account",
    email: "customer@example.com",
    password: "Secret123",
    code: "https://invite.example.com/redeem",
  }],
});

assert.equal((sensitive.html.match(/<a\b/gi) || []).length, 0);
assert.equal(/https?:\/\//i.test(sensitive.html), false);
assert.equal(/https?:\/\//i.test(sensitive.text), false);
assert.equal(sensitive.html.includes(externalUrl), false);
assert.equal(sensitive.text.includes(externalUrl), false);
assert.equal(sensitive.html.includes("https://invite.example.com/redeem"), false);
assert.equal(sensitive.text.includes("https://invite.example.com/redeem"), false);
assert.match(sensitive.text, /الرابط الخارجي محفوظ داخل تفاصيل الطلب/);

const processing = renderStrivioEmail({
  eventType: "order.processing",
  templateKey: "order_processing",
  locale: "fr",
  orderId: "00000000-0000-0000-0000-000000000000",
  serviceName: "Test service",
  actionUrl,
});

assert.equal((processing.html.match(/<a\b/gi) || []).length, 1);
assert.equal(processing.html.includes(`href="${actionUrl}"`), true);
assert.equal(processing.text.includes(actionUrl), true);

console.log("Email render checks passed.");
