/**
 * Strivio Store Configuration
 * You can easily edit your contact information, exchange rates, and fee percentages here.
 */
window.STRIVIO_CONFIG = {
  // Contact Information
  whatsappNumber: "213562961410",
  instagramHandle: "strivio.store",
  instagramUrl: "https://instagram.com/strivio.store",
  facebookUrl: "https://www.facebook.com/people/Strivio/61578300089117",

  // Payment Exchange Rates & Fees
  rates: {
    wise: 260,       // 1 EUR/USD = 260 DZD via Wise / Paysera / Paypal
    usdt: 250,       // 1 USDT = 250 DZD via Crypto USDT
    flexyFee: 0.19   // 19% additional fee for Mobilis / Djezzy / Ooredoo Flexy
  },

  // Default Language ('fr', 'ar', or 'en')
  defaultLang: "fr"
};
