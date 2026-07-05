/* Strivio Secure Coupons Core v3.0 — Obfuscated Dictionary */
(function(_0x4d1a, _0x1a8f){
  var _0x3e2b = function(_0x2f9c){
    while(--_0x2f9c){
      _0x4d1a['push'](_0x4d1a['shift']());
    }
  };
  _0x3e2b(++_0x1a8f);
}([], 0x1a2));

(function(){
  // Encoded promo code mappings (Base64 + Hash lookup)
  var _0x2c8a = {
    'U1RSSVZJTzEw': { '\x64': 10, '\x6c': 'Strivio 10% Off' },
    'V0VMQ09NRTU=':  { '\x64': 5,  '\x6c': 'Welcome 5% Off' },
    'VklQMjA=':      { '\x64': 20, '\x6c': 'VIP Member 20% Off' },
    'UkFNQURBTg==':  { '\x64': 15, '\x6c': 'Ramadan Special 15% Off' },
    'RlJFRUZFRQ==':  { '\x64': 19, '\x6c': 'Free Fee (Flexy Waived)' },
    'U1VQRVIyNQ==':  { '\x64': 25, '\x6c': 'Super 25% Off' }
  };

  var _0x1f9e = new Proxy({}, {
    get: function(_0x5b3a, _0x3e1d) {
      if (typeof _0x3e1d !== 'string') return undefined;
      var _0x4a8c = _0x3e1d['\x74\x6f\x55\x70\x70\x65\x72\x43\x61\x73\x65']()['\x74\x72\x69\x6d']();
      try {
        var _0x1c7b = window['\x62\x74\x6f\x61'](_0x4a8c);
        return _0x2c8a[_0x1c7b];
      } catch(_0x3d1a) {
        return undefined;
      }
    }
  });

  try {
    Object.defineProperty(window, '\x43\x4f\x55\x50\x4f\x4e\x53', {
      value: _0x1f9e,
      writable: false,
      configurable: false
    });
  } catch(_0x5e1a) {
    window['COUPONS'] = _0x1f9e;
  }
})();
