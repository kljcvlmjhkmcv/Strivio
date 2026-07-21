export type StrivioLocale = "ar" | "fr" | "en";

export type LocalizedText = Record<string, string> | null | undefined;

export type DeliveryEntry = {
  allocation_id?: string;
  account_id?: string;
  slot_id?: string;
  email?: string;
  password?: string;
  profile?: string;
  label?: string;
  pin?: string;
  code?: string;
  ends_at?: string;
  service_name?: string;
};

export type StrivioEmailContext = {
  eventType: string;
  templateKey?: string;
  locale?: string;
  customerName?: string;
  customerEmail?: string;
  orderId?: string;
  serviceId?: string;
  serviceName?: string;
  amountDzd?: number | null;
  actionUrl: string;
  message?: string;
  adminNote?: string;
  endsAt?: string | null;
  months?: number | null;
  entries?: DeliveryEntry[];
  isNetflix?: boolean;
  titleI18n?: LocalizedText;
  bodyI18n?: LocalizedText;
  renewalAction?: "renewal" | "extension";
};

export type RenderedStrivioEmail = {
  subject: string;
  html: string;
  text: string;
};

const BRAND = {
  neon: "#39ff14",
  black: "#050505",
  panel: "#0d0d0d",
  panelSoft: "#151515",
  border: "#292929",
  text: "#f5f5f5",
  muted: "#a3a3a3",
  warning: "#f6c453",
};

const COMMON = {
  ar: {
    brandLine: "اشتراكاتك الرقمية في مكان واحد",
    hello: "مرحبًا",
    order: "رقم الطلب",
    service: "الخدمة",
    amount: "المبلغ",
    expiry: "تاريخ الانتهاء",
    email: "إيميل الحساب",
    password: "كلمة السر",
    profile: "البروفايل",
    pin: "رمز PIN",
    code: "الكود",
    open: "فتح حسابي ومتابعة الطلب",
    automated: "هذه رسالة آلية موحدة من Strivio لمتابعة طلبك وخدمتك.",
    safety: "احتفظ بمعلومات الحساب لنفسك ولا تعِد إرسال هذه الرسالة.",
    support: "يمكنك الإبلاغ عن أي مشكلة ومتابعة رد الفريق مباشرة من حسابك.",
    renewal: "يمكنك تجديد أو تمديد اشتراكك في أي وقت للمحافظة على نفس البروفايل أو الشاشة.",
  },
  fr: {
    brandLine: "Tous vos abonnements numériques au même endroit",
    hello: "Bonjour",
    order: "Commande",
    service: "Service",
    amount: "Montant",
    expiry: "Date d’expiration",
    email: "E-mail du compte",
    password: "Mot de passe",
    profile: "Profil",
    pin: "Code PIN",
    code: "Code",
    open: "Ouvrir mon compte et suivre la commande",
    automated: "Ceci est un message transactionnel automatique de Strivio concernant votre commande ou votre service.",
    safety: "Gardez les informations du compte privées et ne transférez pas cet e-mail.",
    support: "Vous pouvez signaler un problème et suivre la réponse de l’équipe depuis votre compte.",
    renewal: "Vous pouvez renouveler ou prolonger votre abonnement à tout moment afin de conserver le même profil ou écran.",
  },
  en: {
    brandLine: "All your digital subscriptions in one place",
    hello: "Hello",
    order: "Order",
    service: "Service",
    amount: "Amount",
    expiry: "Expiry date",
    email: "Account email",
    password: "Password",
    profile: "Profile",
    pin: "PIN",
    code: "Code",
    open: "Open my account and track the order",
    automated: "This is an automated transactional message from Strivio about your order or service.",
    safety: "Keep account details private and do not forward this email.",
    support: "You can report a problem and follow the team’s response directly from your account.",
    renewal: "You can renew or extend your subscription at any time to keep the same profile or screen.",
  },
};

const COPY = {
  ar: {
    paymentConfirmed: ["تم تأكيد الدفع", "وصلت دفعتك بنجاح وبدأنا تجهيز طلبك."],
    actionRequired: ["نحتاج معلوماتك لإكمال التفعيل", "افتح طلبك وأدخل بيانات الحساب المطلوبة حتى يبدأ فريق Strivio التفعيل."],
    activationMessage: ["رسالة جديدة من فريق التفعيل", "راجع رسالة الفريق داخل طلبك وأرسل المعلومة المطلوبة للمتابعة."],
    activationCompleted: ["تم تفعيل خدمتك بنجاح", "اكتمل التفعيل وأصبحت خدمتك جاهزة للاستخدام. ستظهر الحالة الجديدة داخل حسابك."],
    delivered: ["طلبك جاهز وتم تسليمه", "ستجد معلومات الخدمة الكاملة أدناه، كما تبقى محفوظة بأمان داخل حسابك."],
    problemReceived: ["استلمنا بلاغك", "تم تسجيل البلاغ وسيظهر رد الفريق داخل نفس المحادثة في حسابك."],
    problemReply: ["لديك رد جديد من الدعم", "أضاف فريق Strivio تحديثًا جديدًا إلى بلاغك."],
    problemResolved: ["تم حل البلاغ", "أغلق الفريق المشكلة بعد معالجتها. يمكنك فتح بلاغ جديد من الطلب إذا ظهرت مشكلة أخرى."],
    credentialsChanged: ["تم تحديث معلومات الحساب", "تم تغيير بيانات الحساب المشترك. استخدم المعلومات الأحدث الظاهرة أدناه وفي حسابك."],
    renewed: ["تم تمديد اشتراكك", "تمت إضافة مدة التجديد إلى تاريخ انتهاء اشتراكك الحالي بنجاح."],
    expiring: ["اشتراكك يقترب من الانتهاء", "يمكنك تمديده الآن للمحافظة على نفس الخدمة والبروفايل."],
    paymentFailed: ["تعذر إكمال الدفع", "لم يتم اعتماد الدفع. افتح الطلب للمحاولة مجددًا أو اختر طريقة دفع أخرى."],
    generic: ["تحديث جديد من Strivio", "يوجد تحديث جديد متعلق بطلبك أو خدمتك."],
  },
  fr: {
    paymentConfirmed: ["Paiement confirmé", "Votre paiement a bien été reçu et la préparation de votre commande a commencé."],
    actionRequired: ["Informations requises pour l’activation", "Ouvrez la commande et saisissez les informations demandées afin que l’équipe Strivio puisse commencer l’activation."],
    activationMessage: ["Nouveau message de l’équipe d’activation", "Consultez le message dans votre commande et répondez avec l’information demandée."],
    activationCompleted: ["Votre service est activé", "L’activation est terminée et votre service est prêt. Le nouvel état est disponible dans votre compte."],
    delivered: ["Votre commande est prête", "Les informations complètes du service sont ci-dessous et restent accessibles en toute sécurité dans votre compte."],
    problemReceived: ["Signalement reçu", "Votre signalement a été enregistré. La réponse de l’équipe apparaîtra dans la même conversation."],
    problemReply: ["Nouvelle réponse du support", "L’équipe Strivio a ajouté une mise à jour à votre signalement."],
    problemResolved: ["Signalement résolu", "L’équipe a traité puis clôturé le problème. Vous pourrez créer un nouveau signalement si nécessaire."],
    credentialsChanged: ["Informations du compte mises à jour", "Les identifiants du compte partagé ont changé. Utilisez les informations les plus récentes ci-dessous et dans votre compte."],
    renewed: ["Abonnement prolongé", "La nouvelle durée a été ajoutée à la date d’expiration actuelle de votre abonnement."],
    expiring: ["Votre abonnement expire bientôt", "Vous pouvez le prolonger dès maintenant pour conserver le même service et le même profil."],
    paymentFailed: ["Paiement non finalisé", "Le paiement n’a pas été validé. Ouvrez la commande pour réessayer ou choisir un autre moyen de paiement."],
    generic: ["Nouvelle mise à jour Strivio", "Une nouvelle mise à jour concerne votre commande ou votre service."],
  },
  en: {
    paymentConfirmed: ["Payment confirmed", "Your payment was received and preparation of your order has started."],
    actionRequired: ["Information required to activate your service", "Open the order and enter the requested account details so the Strivio team can start activation."],
    activationMessage: ["New message from the activation team", "Review the message in your order and reply with the requested information."],
    activationCompleted: ["Your service is activated", "Activation is complete and your service is ready. The new status is available in your account."],
    delivered: ["Your order is ready", "The complete service details are below and remain securely available in your account."],
    problemReceived: ["Report received", "Your report was recorded. The team’s response will appear in the same conversation."],
    problemReply: ["New support reply", "The Strivio team added a new update to your report."],
    problemResolved: ["Report resolved", "The team handled and closed the issue. You can open a new report from the order if needed."],
    credentialsChanged: ["Account information updated", "The shared account credentials changed. Use the latest details shown below and in your account."],
    renewed: ["Subscription extended", "The renewal duration was successfully added to your current subscription expiry date."],
    expiring: ["Your subscription expires soon", "You can extend it now to keep the same service and profile."],
    paymentFailed: ["Payment not completed", "The payment was not approved. Open the order to try again or choose another payment method."],
    generic: ["New Strivio update", "There is a new update about your order or service."],
  },
};

const CTA = {
  ar: {
    paymentConfirmed: "عرض حالة الطلب",
    paymentFailed: "فتح الطلب وإعادة المحاولة",
    actionRequired: "إدخال معلومات التفعيل",
    activationMessage: "قراءة رسالة فريق التفعيل",
    activationCompleted: "عرض الخدمة المفعّلة",
    delivered: "إظهار تفاصيل الطلب والحساب",
    problemReceived: "متابعة البلاغ",
    problemReply: "قراءة الرد ومتابعة البلاغ",
    problemResolved: "عرض نتيجة حل البلاغ",
    credentialsChanged: "إظهار معلومات الحساب الجديدة",
    renewed: "عرض الاشتراك بعد التجديد",
    extended: "عرض الاشتراك بعد التمديد",
    expiring: "تجديد أو تمديد الاشتراك",
    generic: "فتح الطلب في حسابي",
  },
  fr: {
    paymentConfirmed: "Voir l’état de la commande",
    paymentFailed: "Ouvrir la commande et réessayer",
    actionRequired: "Saisir les informations d’activation",
    activationMessage: "Lire le message de l’équipe d’activation",
    activationCompleted: "Voir le service activé",
    delivered: "Afficher la commande et les identifiants",
    problemReceived: "Suivre le signalement",
    problemReply: "Lire la réponse et poursuivre le suivi",
    problemResolved: "Voir la résolution du signalement",
    credentialsChanged: "Afficher les nouveaux identifiants",
    renewed: "Voir l’abonnement renouvelé",
    extended: "Voir l’abonnement prolongé",
    expiring: "Renouveler ou prolonger l’abonnement",
    generic: "Ouvrir la commande dans mon compte",
  },
  en: {
    paymentConfirmed: "View order status",
    paymentFailed: "Open the order and try again",
    actionRequired: "Enter activation details",
    activationMessage: "Read the activation team’s message",
    activationCompleted: "View the activated service",
    delivered: "Show order and account details",
    problemReceived: "Track the report",
    problemReply: "Read the reply and continue the report",
    problemResolved: "View the report resolution",
    credentialsChanged: "Show the updated account details",
    renewed: "View the renewed subscription",
    extended: "View the extended subscription",
    expiring: "Renew or extend the subscription",
    generic: "Open the order in my account",
  },
};

function locale(value?: string): StrivioLocale {
  return value === "fr" || value === "en" ? value : "ar";
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

function pick(value: LocalizedText, lang: StrivioLocale): string {
  if (!value || typeof value !== "object") return "";
  return String(value[lang] || value.ar || value.fr || value.en || "").trim();
}

function formatDate(value: unknown, lang: StrivioLocale): string {
  if (!value) return "";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-DZ" : lang === "fr" ? "fr-DZ" : "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Algiers",
  }).format(parsed);
}

function money(value: number | null | undefined, lang: StrivioLocale): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  return `${new Intl.NumberFormat(lang === "ar" ? "ar-DZ" : lang === "fr" ? "fr-DZ" : "en-US", {
    maximumFractionDigits: 2,
  }).format(Number(value))} DZD`;
}

function copyKey(eventType: string, templateKey?: string): keyof typeof COPY.ar {
  const key = `${eventType} ${templateKey || ""}`.toLowerCase().replace(/[_-]/g, ".");
  if (/payment\.(confirmed|paid|success)/.test(key)) return "paymentConfirmed";
  if (/payment\.(failed|cancelled|canceled)/.test(key)) return "paymentFailed";
  if (/activation\.(completed|delivered)|activation.completed/.test(key)) return "activationCompleted";
  if (/activation\.(message|admin\.message)|action\.required|awaiting\.customer/.test(key)) {
    return /message|admin/.test(key) ? "activationMessage" : "actionRequired";
  }
  if (/problem\.(received|reported|created)/.test(key)) return "problemReceived";
  if (/problem\.(reply|admin\.reply|updated)/.test(key)) return "problemReply";
  if (/problem\.(resolved|closed)/.test(key)) return "problemResolved";
  if (/account\.(changed|credentials)|credentials\.changed|password\.changed/.test(key)) return "credentialsChanged";
  if (/subscription\.(renewed|extended)|renewal\.(confirmed|completed)/.test(key)) return "renewed";
  if (/subscription\.(expiring|reminder)/.test(key)) return "expiring";
  if (/fulfillment\.(delivered|ready)|order\.delivered/.test(key)) return "delivered";
  return "generic";
}

function detailsRows(ctx: StrivioEmailContext, lang: StrivioLocale): string {
  const c = COMMON[lang];
  const rows: Array<[string, string]> = [];
  if (ctx.orderId) rows.push([c.order, `#${String(ctx.orderId).slice(0, 8)}`]);
  if (ctx.serviceName) rows.push([c.service, ctx.serviceName]);
  if (ctx.amountDzd !== null && ctx.amountDzd !== undefined) rows.push([c.amount, money(ctx.amountDzd, lang)]);
  if (ctx.endsAt) rows.push([c.expiry, formatDate(ctx.endsAt, lang)]);
  if (!rows.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border-collapse:separate;border-spacing:0;background:${BRAND.panelSoft};border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden">${rows.map(([label, value]) => `<tr><td style="padding:12px 16px;color:${BRAND.muted};font-size:13px;border-bottom:1px solid ${BRAND.border};width:38%">${esc(label)}</td><td dir="auto" style="padding:12px 16px;color:${BRAND.text};font-size:14px;font-weight:700;border-bottom:1px solid ${BRAND.border}">${esc(value)}</td></tr>`).join("")}</table>`;
}

function entryCards(entries: DeliveryEntry[], lang: StrivioLocale): string {
  if (!entries.length) return "";
  const c = COMMON[lang];
  return entries.map((entry, index) => {
    const entryTitle = entry.profile || entry.label || (entry.code ? `${c.code} ${index + 1}` : `${c.profile} ${index + 1}`);
    const title = entry.service_name ? `${entry.service_name} · ${entryTitle}` : entryTitle;
    const values: Array<[string, string]> = [];
    if (entry.email) values.push([c.email, entry.email]);
    if (entry.password) values.push([c.password, entry.password]);
    if (entry.profile || entry.label) values.push([c.profile, entry.profile || entry.label || ""]);
    if (entry.pin) values.push([c.pin, entry.pin]);
    if (entry.code) values.push([c.code, entry.code]);
    if (entry.ends_at) values.push([c.expiry, formatDate(entry.ends_at, lang)]);
    return `<div style="margin:14px 0;padding:18px;background:#080808;border:1px solid #2a3d28;border-radius:16px"><div dir="auto" style="margin-bottom:12px;color:${BRAND.neon};font-size:17px;font-weight:900">${esc(title)}</div>${values.map(([label, value]) => `<div style="margin:8px 0;line-height:1.7"><span style="color:${BRAND.muted};font-size:13px">${esc(label)}:</span> <strong dir="auto" style="color:${BRAND.text};font-size:14px;word-break:break-word;font-family:${label === c.password || label === c.pin || label === c.code ? "Consolas,Monaco,monospace" : "Arial,Tahoma,sans-serif"}">${esc(value)}</strong></div>`).join("")}</div>`;
  }).join("");
}

function netflixTerms(): string {
  return `<div dir="rtl" lang="ar" style="margin:22px 0;padding:18px;background:#191506;border:1px solid #5f4b12;border-radius:16px;color:#fff3b0;text-align:right"><div style="font-size:16px;font-weight:900;margin-bottom:10px">شروط استخدام Netflix</div><ul style="margin:0;padding-right:20px;line-height:1.9;font-size:13px"><li>معلومات الحساب والبروفايل مخصصة لصاحب الطلب فقط ولا يجوز نشرها أو مشاركتها.</li><li>كل بروفايل أو شاشة مخصصان لشخص واحد فقط، ويمنع مشاركة البروفايل نفسه بين أكثر من شخص.</li><li>يمنع تشغيل المحتوى من جهازين في الوقت نفسه، حتى لو كان الجهازان لنفس الشخص.</li><li>يمنع تغيير كلمة سر الحساب أو بريده أو إعداداته العامة.</li><li>يسمح فقط بتعديل اسم البروفايل ورمز PIN الخاص بك.</li><li>أي مخالفة قد تؤدي إلى سحب الاشتراك دون استرداد الأموال.</li></ul></div>`;
}

function plainEntries(entries: DeliveryEntry[], lang: StrivioLocale): string {
  const c = COMMON[lang];
  return entries.map((entry, index) => {
    const explicitName = entry.profile || entry.label || "";
    const entryTitle = explicitName || `${c.profile} ${index + 1}`;
    const lines = [entry.service_name ? `${entry.service_name} · ${entryTitle}` : entryTitle];
    if (entry.email) lines.push(`${c.email}: ${entry.email}`);
    if (entry.password) lines.push(`${c.password}: ${entry.password}`);
    if (entry.profile || entry.label) lines.push(`${c.profile}: ${entry.profile || entry.label}`);
    if (entry.pin) lines.push(`${c.pin}: ${entry.pin}`);
    if (entry.code) lines.push(`${c.code}: ${entry.code}`);
    if (entry.ends_at) lines.push(`${c.expiry}: ${formatDate(entry.ends_at, lang)}`);
    return lines.join("\n");
  }).join("\n\n");
}

export function renderStrivioEmail(ctx: StrivioEmailContext): RenderedStrivioEmail {
  const lang = locale(ctx.locale);
  const rtl = lang === "ar";
  const c = COMMON[lang];
  const key = copyKey(ctx.eventType, ctx.templateKey);
  const isExtension = ctx.renewalAction === "extension" ||
    /subscription[._-]extended|subscription[._-]extension/i.test(`${ctx.eventType} ${ctx.templateKey || ""}`);
  const ctaKey = key === "renewed" && isExtension ? "extended" : key;
  const ctaLabel = CTA[lang][ctaKey as keyof typeof CTA.ar] || CTA[lang].generic;
  const fallback = COPY[lang][key] as [string, string];
  const title = pick(ctx.titleI18n, lang) || fallback[0];
  const body = pick(ctx.bodyI18n, lang) || ctx.message || fallback[1];
  const entries = Array.isArray(ctx.entries) ? ctx.entries : [];
  const isDelivery = key === "delivered" || key === "credentialsChanged";
  const showNetflixTerms = !!ctx.isNetflix && isDelivery;
  const preheader = body.slice(0, 140);
  const greetingName = String(ctx.customerName || "").trim();
  const greeting = greetingName ? `${c.hello} ${greetingName},` : `${c.hello},`;
  const adminNote = String(ctx.adminNote || "").trim();
  const subjectOrder = ctx.orderId ? ` #${String(ctx.orderId).slice(0, 8)}` : "";
  const subject = `${title}${subjectOrder} — Strivio`.slice(0, 180);
  const supportBlock = isDelivery
    ? `<div style="margin-top:18px;padding:16px;background:#0c170b;border:1px solid #24551d;border-radius:15px;color:#d7ffd0;font-size:13px;line-height:1.8"><div>${esc(c.support)}</div>${ctx.isNetflix ? `<div style="margin-top:7px">${esc(c.renewal)}</div>` : ""}</div>`
    : "";
  const messageBlock = adminNote
    ? `<div dir="auto" style="margin:18px 0;padding:16px;background:${BRAND.panelSoft};border-right:3px solid ${BRAND.neon};border-radius:12px;color:${BRAND.text};white-space:pre-wrap;line-height:1.8">${esc(adminNote)}</div>`
    : "";
  const credentialBlock = entries.length
    ? `<div style="margin-top:22px"><div style="color:${BRAND.text};font-size:16px;font-weight:900">${esc(lang === "ar" ? "معلومات التسليم" : lang === "fr" ? "Informations de livraison" : "Delivery details")}</div>${entryCards(entries, lang)}</div>`
    : "";

  const html = `<!doctype html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;padding:0;background:${BRAND.black};color:${BRAND.text};font-family:Arial,Tahoma,sans-serif;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.black};border-collapse:collapse"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;border-collapse:separate;border-spacing:0;background:${BRAND.panel};border:1px solid ${BRAND.border};border-radius:24px;overflow:hidden"><tr><td style="padding:26px 28px;background:linear-gradient(135deg,#080808,#10200d);border-bottom:1px solid ${BRAND.border}"><a href="https://www.striviodz.store" style="text-decoration:none;color:${BRAND.neon};font-size:30px;font-weight:900;letter-spacing:.5px">STRIVIO</a><div style="margin-top:5px;color:${BRAND.muted};font-size:12px">${esc(c.brandLine)}</div></td></tr><tr><td style="padding:30px 28px;text-align:${rtl ? "right" : "left"}"><div dir="auto" style="color:${BRAND.muted};font-size:14px;margin-bottom:10px">${esc(greeting)}</div><h1 dir="auto" style="margin:0;color:${BRAND.text};font-size:26px;line-height:1.35">${esc(title)}</h1><p dir="auto" style="margin:13px 0 0;color:#d0d0d0;font-size:15px;line-height:1.85">${esc(body)}</p>${detailsRows(ctx, lang)}${messageBlock}${credentialBlock}${showNetflixTerms ? netflixTerms() : ""}${supportBlock}<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td bgcolor="${BRAND.neon}" style="border-radius:13px"><a href="${esc(ctx.actionUrl)}" style="display:inline-block;padding:14px 21px;color:#050505;text-decoration:none;font-size:14px;font-weight:900;border-radius:13px">${esc(ctaLabel)}</a></td></tr></table>${entries.length ? `<p style="margin:20px 0 0;color:${BRAND.warning};font-size:12px;line-height:1.7">${esc(c.safety)}</p>` : ""}</td></tr><tr><td style="padding:20px 28px;border-top:1px solid ${BRAND.border};color:#777;font-size:11px;line-height:1.7;text-align:${rtl ? "right" : "left"}">${esc(c.automated)}<br>© ${new Date().getUTCFullYear()} Strivio · striviodz.store</td></tr></table></td></tr></table></body></html>`;

  const textParts = [
    "STRIVIO",
    greeting,
    title,
    body,
    ctx.orderId ? `${c.order}: #${String(ctx.orderId).slice(0, 8)}` : "",
    ctx.serviceName ? `${c.service}: ${ctx.serviceName}` : "",
    ctx.amountDzd !== null && ctx.amountDzd !== undefined ? `${c.amount}: ${money(ctx.amountDzd, lang)}` : "",
    ctx.endsAt ? `${c.expiry}: ${formatDate(ctx.endsAt, lang)}` : "",
    adminNote,
    plainEntries(entries, lang),
    showNetflixTerms ? "شروط Netflix: الحساب والبروفايل لصاحب الطلب فقط. يمنع مشاركة البروفايل بين أكثر من شخص أو المشاهدة من جهازين في الوقت نفسه. يمنع تغيير بريد الحساب أو كلمة سره أو إعداداته العامة، ويسمح فقط بتعديل اسم البروفايل ورمز PIN. قد تؤدي المخالفة إلى سحب الاشتراك دون استرداد." : "",
    isDelivery ? c.support : "",
    ctx.isNetflix ? c.renewal : "",
    `${ctaLabel}: ${ctx.actionUrl}`,
    c.automated,
  ].filter(Boolean);

  return { subject, html, text: textParts.join("\n\n") };
}
