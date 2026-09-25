import assert from 'node:assert/strict';
import fs from 'node:fs';

const createSource = fs.readFileSync(new URL('../supabase/functions/create-payment/index.ts', import.meta.url), 'utf8');
const verifySource = fs.readFileSync(new URL('../supabase/functions/verify-payment/index.ts', import.meta.url), 'utf8');
const redirectSource = fs.readFileSync(new URL('../payment-redirect.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/202609190100_harden_slickpay_payments.sql', import.meta.url), 'utf8');
const stateGuard = fs.readFileSync(new URL('../supabase/migrations/202609190200_guard_cib_paid_state.sql', import.meta.url), 'utf8');

assert.match(migration, /v_paid\s*:=\s*v_payment_status\s*=\s*'paid'\s+and\s+v_amount_matches/i,
  'payment must require the explicit paid status and a matching amount');
assert.match(verifySource, /exclude generic status\/completed fields/i,
  'provider parsing must exclude generic lifecycle fields');
assert.doesNotMatch(verifySource, /completed\s*===\s*true|paymentCompleted\s*===\s*true/,
  'generic completed flags must never prove payment');
assert.match(createSource, /Never retry invoice creation automatically/,
  'invoice POSTs must not be retried after an ambiguous network result');
assert.match(createSource, /payment_claim_attempt/,
  'invoice creation must use the atomic attempt claim');
assert.match(createSource, /\(\?:\\\/api\\\/v2\)\?\\\/users\\\/invoices\\\/satim\\\/payment/,
  'invoice creation must accept the documented SlickPay API-prefixed SATIM URL');
assert.match(createSource, /\\\/invoice\\\/payment\\\//,
  'invoice creation must accept SlickPay production hosted invoice URLs');
assert.match(createSource, /providerIdFromPaymentUrl\(paymentUrl\)/,
  'invoice creation must recover the production invoice id from its trusted URL');
assert.match(createSource, /Object\.values\(current\)/,
  'invoice creation must discover trusted payment URLs in nested SlickPay envelopes');
assert.match(createSource, /url\.hostname\.toLowerCase\(\) === "cib\.satim\.dz"/,
  'invoice creation must accept only the official SATIM card-entry host');
assert.match(createSource, /url\.searchParams\.has\("mdOrder"\)/,
  'invoice creation must require a SATIM session identifier');
assert.match(migration, /payment_attempts_one_active_per_order/,
  'the database must enforce one active attempt per order');
assert.match(migration, /provider_invoice_id\)\s*\n?\s*\)/,
  'provider invoice identity must be unique');
assert.match(stateGuard, /cannot be marked paid without a verified matching provider payment/i,
  'CIB orders must be guarded at the database boundary');
assert.match(createSource, /const redirectBridge = `\$\{origin\}\/payment-redirect\?order_id=/,
  'SATIM browser returns must pass through the payment result bridge');
assert.match(createSource, /url:\s*redirectBridge/,
  'the generic provider return URL must use the bridge because SATIM cancel may ignore cancel_url');
assert.match(verifySource, /"annule", "annulee", "ignored", "ignore"/,
  'provider cancellation states in English and French must be canonicalized');
assert.match(verifySource, /String\(payFlag\) === "1"/,
  'SlickPay pay_status=1 must be accepted as an explicit paid flag');
assert.doesNotMatch(verifySource, /String\(payFlag\) === "0"\) return "failed"/,
  'pay_status=0 alone must not be treated as failure');
assert.match(redirectSource, /gateway_result=/,
  'the redirect bridge must forward the browser result for server verification');
assert.doesNotMatch(redirectSource, /thank-you\?success=1/,
  'the redirect bridge must never declare success from browser parameters');

console.log('Payment safety checks passed.');
