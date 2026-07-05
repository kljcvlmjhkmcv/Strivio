/* ╔═════════════════════════════════════════════════════════════════════════════╗
   ║  ❓  FREQUENTLY ASKED QUESTIONS — Strivio Store                           ║
   ║  Easy modification catalog — Add or edit questions and answers below.       ║
   ╚═════════════════════════════════════════════════════════════════════════════╝ */

var FAQS = [
  {
    id: 'buying',
    icon: '🛒',
    q: {
      fr: 'Comment passer une commande sur Strivio ?',
      ar: 'كيفية الشراء وإتمام الطلب من متجر Strivio؟',
      en: 'How do I place an order on Strivio?'
    },
    a: {
      fr: 'Sélectionnez simplement votre abonnement préféré, choisissez la durée et l\'option souhaitée, puis cliquez sur "Acheter Maintenant" ou ajoutez-le au panier. Lors du paiement, vous serez redirigé automatiquement vers WhatsApp avec les détails pré-remplis pour valider immédiatement votre commande.',
      ar: 'اختر الخدمة والمدة المحددة، ثم اضغط على "اشتر الآن" أو اضفها للسلة. عند إتمام الطلب، سيتم نسخ التعديلات فوراً وتوجيهك إلى واتساب لإرسال الطلب والتأكيد الفوري مع فريق الدعم.',
      en: 'Select your preferred subscription, duration, and tier, then click "Buy Now" or add to cart. At checkout, click confirm to automatically copy your order details and redirect to WhatsApp for instant confirmation.'
    }
  },
  {
    id: 'delivery',
    icon: '⚡',
    q: {
      fr: 'Combien de temps prend la livraison de l\'abonnement ?',
      ar: 'ما هي مدة تسليم الحساب بعد الدفع؟',
      en: 'How long does delivery take after payment?'
    },
    a: {
      fr: 'La livraison est instantanée ou prend en moyenne 5 à 15 minutes après la vérification de votre paiement par notre équipe sur WhatsApp.',
      ar: 'التسليم فوري ويستغرق في الغالب بين 5 إلى 15 دقيقة فور تأكيد عملية الدفع من قبل فريقنا عبر واتساب.',
      en: 'Delivery is instant or takes between 5 to 15 minutes average after payment confirmation on WhatsApp.'
    }
  },
  {
    id: 'warranty',
    icon: '🛡️',
    q: {
      fr: 'Quelle est la garantie proposée sur les abonnements ?',
      ar: 'ما هو الضمان المقدم على الاشتراكات والحسابات؟',
      en: 'What warranty is provided with the subscriptions?'
    },
    a: {
      fr: 'Tous nos abonnements bénéficient d\'une garantie complète durant toute la période souscrite (Garantie 100%). En cas de problème, nous remplaçons le compte ou résolvons le souci sous 24h.',
      ar: 'جميع اشتراكاتنا مضمونة 100% طوال فترة الاشتراك الكاملة. في حال حدوث أي استفسار أو مشكلة، يتم التعويض أو إصلاح الحساب فوراً عبر الدعم الفني.',
      en: 'All our subscriptions come with a 100% full-term warranty. In case of any technical issue, we replace or fix the account immediately.'
    }
  },
  {
    id: 'payment',
    icon: '💳',
    q: {
      fr: 'Quels sont les modes de paiement acceptés ?',
      ar: 'ما هي طرق الدفع المتاحة في المتجر؟',
      en: 'What payment methods do you accept?'
    },
    a: {
      fr: 'Nous acceptons BariDi Mob, CCP, Wise (EUR) au taux de 1€ = 260 DZD, USDT (Crypto) au taux de 1$ = 250 DZD, ainsi que le paiement par Flexy (+19%).',
      ar: 'نوفر دفع عبر بريدي موب (BariDi Mob)، التحويل البريدي (CCP)، تحويل Wise باليورو (1€ = 260 دج)، تحويل USDT الكريبتو (1$ = 250 دج)، وبطاقات فليكسي Flexy (+19%).',
      en: 'We accept BariDi Mob, CCP, Wise (EUR rate: 1€ = 260 DZD), USDT Crypto (rate: 1$ = 250 DZD), and Flexy mobile recharge (+19%).'
    }
  },
  {
    id: 'crypto_wise',
    icon: '🌐',
    q: {
      fr: 'Comment payer par Wise ou USDT Crypto ?',
      ar: 'كيف أتمم الدفع عبر Wise أو USDT؟',
      en: 'How to complete payment via Wise or USDT Crypto?'
    },
    a: {
      fr: 'Dans votre panier, choisissez "Wise" ou "USDT". Le montant sera automatiquement converti au taux officiel du store. Une fois la commande confirmée sur WhatsApp, nous vous transmettrons l\'adresse USDT (TRC20) ou l\'email Wise pour effectuer le virement.',
      ar: 'عند الوصول للسلة، اختر Wise أو USDT وسيتم احتساب التوتال تلقائياً باليورو أو USDT. بعد الضغط على تأكيد الطلب، سيرسل لك فريق الدعم عنوان المحفظة أو إيميل Wise لإتمام التحويل.',
      en: 'In your cart, select Wise or USDT. The total converts automatically. Upon order confirmation on WhatsApp, our support team will provide the USDT (TRC20) address or Wise email.'
    }
  }
];