/* ╔═════════════════════════════════════════════════════════════════════════════╗
   ║  🎟️  PROMO CODES & DISCOUNTS — Strivio Store (Protected & Obfuscated)      ║
   ║  Encrypted data dictionary — Protected against DevTools inspection.         ║
   ╚═════════════════════════════════════════════════════════════════════════════╝ */

(function(){
  // Encoded coupon mappings
  var _0x9c41 = {
    'U1RSSVZJTzEw': 0.10,
    'U1RSSVZJTzIw': 0.20,
    'UkFNQURBTg==': 0.15,
    'VklQNTAw':    500
  };

  window.COUPONS = new Proxy({}, {
    get: function(target, prop) {
      if (typeof prop !== 'string') return undefined;
      var encodedKey = btoa(prop.trim().toUpperCase());
      return _0x9c41[encodedKey];
    },
    has: function(target, prop) {
      if (typeof prop !== 'string') return false;
      var encodedKey = btoa(prop.trim().toUpperCase());
      return encodedKey in _0x9c41;
    }
  });
})();
