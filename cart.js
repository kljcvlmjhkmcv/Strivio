/* Strivio Secure Cart Core v4.0 — Obfuscated & Protected Checkout Engine */
(function(_0x3f1a, _0x5c8e){
  var _0x1a9d = function(_0x4b2f){
    while(--_0x4b2f){
      _0x3f1a['push'](_0x3f1a['shift']());
    }
  };
  _0x1a9d(++_0x5c8e);
}([], 0x3b2));

(function(){
  // Anti-F12 Protection & Debugger Shield
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) || (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.key === 'S' || e.key === 's'))) {
      e.preventDefault();
    }
  });
  setInterval(function(){
    var _0x2a = new Date().getTime();
    debugger;
    var _0x2b = new Date().getTime();
    if (_0x2b - _0x2a > 100) {
      document.body.innerHTML = '<div style="background:#121212;color:#ff3333;height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-weight:bold;font-size:24px">Protected Code — Access Denied</div>';
    }
  }, 1000);

  var L = localStorage.getItem('strivio_lang') || (window.STRIVIO_CONFIG ? window.STRIVIO_CONFIG.defaultLang : 'fr');
  var $ = function(id){ return document.getElementById(id); };

  var TX = {
    fr: {
      home:'Accueil', subs:'Abonnements', faq:'FAQ',
      title:'Votre Panier', sub:'Vérifiez vos abonnements et choisissez votre mode de paiement.',
      emptyTitle:'Votre panier est vide', emptySub:'Vous n\'avez sélectionné aucun abonnement pour le moment.', emptyBtn:'⚡ Découvrir le catalogue',
      items:'Articles dans le panier', payTitle:'Mode de Paiement', paySub:'Sélectionnez comment vous souhaitez régler :',
      promoTitle:'Code Promo / Réduction', promoPlaceholder:'Ex: STRIVIO10', promoBtn:'Appliquer',
      promoSuccess:'Code promo appliqué avec succès !', promoError:'Code promo invalide ou expiré.',
      sumTitle:'Résumé de la commande', subtotal:'Sous-total :', discount:'Réduction :', flexyFee:'Frais Flexy (19%) :', total:'Total à Payer :',
      rateWise:'Taux Wise (1€ = 260 DZD) :', rateUsdt:'Taux USDT (1$ = 250 DZD) :',
      confirmBtn:'💬 Confirmer sur WhatsApp',
      pm: {
        baridimob: 'BaridiMob (CCP)', ccp: 'Algérie Poste (CCP / Mandat)',
        paysera: 'Paysera / Wise / Revolut (Euro)', paypal: 'PayPal (Euro / USD)',
        usdt: 'Crypto USDT (TRC20 / BEP20)', mobilis: 'Mobilis Flexy (+19% frais)',
        djezzy: 'Djezzy Flexy (+19% frais)', ooredoo: 'Ooredoo Flexy (+19% frais)'
      }
    },
    ar: {
      home:'الرئيسية', subs:'الاشتراكات', faq:'الأسئلة الشائعة',
      title:'سلة المشتريات', sub:'راجع اشتراكاتك المختارة وحدد طريقة الدفع الأنسب لك.',
      emptyTitle:'سلة المشتريات فارغة حالياً', emptySub:'لم تقم بإضافة أي اشتراك إلى السلة بعد.', emptyBtn:'⚡ تصفح قائمة الاشتراكات',
      items:'الاشتراكات المختارة', payTitle:'طريقة الدفع', paySub:'اختر وسيلة الدفع التي تناسبك :',
      promoTitle:'كود الخصم / قسيمة التخفيض', promoPlaceholder:'مثال: STRIVIO10', promoBtn:'تطبيق الخصم',
      promoSuccess:'تم تطبيق كود الخصم بنجاح!', promoError:'كود الخصم غير صحيح أو منتهي الصلاحية.',
      sumTitle:'ملخص الطلب والفاتورة', subtotal:'المجموع الفرعي :', discount:'قيمة الخصم :', flexyFee:'رسوم الفليكسي (19%) :', total:'الإجمالي المطلوب دفعه :',
      rateWise:'سعر صرف Wise (1€ = 260 د.ج) :', rateUsdt:'سعر صرف USDT (1$ = 250 د.ج) :',
      confirmBtn:'💬 تأكيد وإرسال الطلب عبر واتساب',
      pm: {
        baridimob: 'تطبيق بريدي موب (BaridiMob)', ccp: 'بريد الجزائر (حساب CCP / حوالة)',
        paysera: 'بايسيرا / وايز / ريفولوت (باليورو)', paypal: 'باي بال PayPal (يورو / دولار)',
        usdt: 'عملة رقمية USDT (TRC20 / BEP20)', mobilis: 'فليكسي موبيليس (+19% رسوم إضافية)',
        djezzy: 'فليكسي جازي (+19% رسوم إضافية)', ooredoo: 'فليكسي أوريدو (+19% رسوم إضافية)'
      }
    },
    en: {
      home:'Home', subs:'Subscriptions', faq:'FAQ',
      title:'Your Shopping Cart', sub:'Review your selected subscriptions and choose your payment method.',
      emptyTitle:'Your cart is empty', emptySub:'You haven\'t added any subscriptions to your cart yet.', emptyBtn:'⚡ Browse Catalog',
      items:'Cart Items', payTitle:'Payment Method', paySub:'Select how you would like to pay :',
      promoTitle:'Promo Code / Discount', promoPlaceholder:'Ex: STRIVIO10', promoBtn:'Apply',
      promoSuccess:'Promo code applied successfully!', promoError:'Invalid or expired promo code.',
      sumTitle:'Order Summary', subtotal:'Subtotal :', discount:'Discount :', flexyFee:'Flexy Fee (19%) :', total:'Total to Pay :',
      rateWise:'Wise Rate (1€ = 260 DZD) :', rateUsdt:'USDT Rate (1$ = 250 DZD) :',
      confirmBtn:'💬 Confirm Order on WhatsApp',
      pm: {
        baridimob: 'BaridiMob (CCP App)', ccp: 'Algeria Post (CCP / Transfer)',
        paysera: 'Paysera / Wise / Revolut (Euro)', paypal: 'PayPal (Euro / USD)',
        usdt: 'Crypto USDT (TRC20 / BEP20)', mobilis: 'Mobilis Flexy (+19% fee)',
        djezzy: 'Djezzy Flexy (+19% fee)', ooredoo: 'Ooredoo Flexy (+19% fee)'
      }
    }
  };

  var _cart = JSON.parse(localStorage.getItem('strivio_cart') || '[]');
  var _selPayMethod = 'baridimob';
  var _appliedCoupon = null;

  function renderUI(){
    var tx = TX[L] || TX.fr;
    var hr = $('HR');
    if(hr){
      hr.dir = L === 'ar' ? 'rtl' : 'ltr';
      hr.lang = L;
    }

    if($('NLH')) $('NLH').textContent = tx.home;
    if($('NLS')) $('NLS').textContent = tx.subs;
    if($('NLF')) $('NLF').textContent = tx.faq;
    if($('MLH')) $('MLH').textContent = tx.home;
    if($('MLS')) $('MLS').textContent = tx.subs;
    if($('MLF')) $('MLF').textContent = tx.faq;

    if($('PGTL')) $('PGTL').textContent = tx.title;
    if($('PGST')) $('PGST').textContent = tx.sub;
    if($('EMPTY_TL')) $('EMPTY_TL').textContent = tx.emptyTitle;
    if($('EMPTY_ST')) $('EMPTY_ST').textContent = tx.emptySub;
    if($('EMPTY_BTN')) $('EMPTY_BTN').textContent = tx.emptyBtn;

    if($('ITM_TL')) $('ITM_TL').textContent = tx.items;
    if($('PAY_TL')) $('PAY_TL').textContent = tx.payTitle;
    if($('PAY_ST')) $('PAY_ST').textContent = tx.paySub;
    if($('PRM_TL')) $('PRM_TL').textContent = tx.promoTitle;
    if($('PRM_INP')) $('PRM_INP').placeholder = tx.promoPlaceholder;
    if($('PRM_BTN')) $('PRM_BTN').textContent = tx.promoBtn;
    if($('SUM_TL')) $('SUM_TL').textContent = tx.sumTitle;
    if($('L_SUB')) $('L_SUB').textContent = tx.subtotal;
    if($('L_DIS')) $('L_DIS').textContent = tx.discount;
    if($('L_FEE')) $('L_FEE').textContent = tx.flexyFee;
    if($('L_TOT')) $('L_TOT').textContent = tx.total;
    if($('BTN_CONF')) $('BTN_CONF').textContent = tx.confirmBtn;

    // Render payment method labels
    for(var k in tx.pm){
      if($('PM_' + k)) $('PM_' + k).textContent = tx.pm[k];
    }

    renderCartItems();
    updateSummary();
  }

  function renderCartItems(){
    var container = $('CART_LIST');
    var emptyDiv = $('EMPTY_CART');
    var mainDiv = $('MAIN_CART');
    if(!container) return;

    _cart = JSON.parse(localStorage.getItem('strivio_cart') || '[]');

    if(_cart.length === 0){
      if(emptyDiv) emptyDiv.classList.remove('hidden');
      if(mainDiv) mainDiv.classList.add('hidden');
      return;
    } else {
      if(emptyDiv) emptyDiv.classList.add('hidden');
      if(mainDiv) mainDiv.classList.remove('hidden');
    }

    container.innerHTML = _cart.map(function(item, idx){
      var typeBadge = item.typeText ? '<span class="px-2 py-0.5 rounded text-[11px] font-bold" style="background:rgba(57,255,20,.12);color:#39ff14;border:1px solid rgba(57,255,20,.3)">'+item.typeText+'</span>' : '';
      var itemTotal = (item.unitPrice * (item.qty || 1)).toLocaleString();
      
      return [
        '<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-2xl border transition-all" style="background:#181818;border-color:#2A2A2A">',
          '<div class="flex items-center gap-3">',
            '<div class="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-md" style="background:'+item.color+'">' + item.name.charAt(0) + '</div>',
            '<div>',
              '<h4 class="font-display font-bold text-white text-base sm:text-lg">' + item.name + '</h4>',
              '<div class="flex flex-wrap items-center gap-2 mt-1">',
                '<span class="text-xs text-[#E0E0E0]">' + item.durText + '</span>',
                typeBadge,
              '</div>',
            '</div>',
          '</div>',
          '<div class="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-0" style="border-color:rgba(255,255,255,.05)">',
            '<div class="flex items-center gap-2 px-2 py-1 rounded-lg border" style="background:#121212;border-color:#2A2A2A">',
              '<button type="button" class="w-7 h-7 rounded flex items-center justify-center text-white hover:bg-[#2A2A2A] font-bold" onclick="window._cartQty(' + idx + ', -1)">-</button>',
              '<span class="w-6 text-center font-bold text-white text-sm">' + (item.qty || 1) + '</span>',
              '<button type="button" class="w-7 h-7 rounded flex items-center justify-center text-white hover:bg-[#2A2A2A] font-bold" onclick="window._cartQty(' + idx + ', 1)">+</button>',
            '</div>',
            '<div class="text-right">',
              '<div class="font-display font-bold text-white text-base sm:text-lg">' + itemTotal + ' <span class="text-xs font-normal text-[#39ff14]">DZD</span></div>',
              '<div class="text-[11px] text-[#E0E0E0]">' + item.unitPrice.toLocaleString() + ' DZD / u</div>',
            '</div>',
            '<button type="button" class="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors" onclick="window._cartDel(' + idx + ')">',
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
            '</button>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function updateSummary(){
    var tx = TX[L] || TX.fr;
    var subtotal = _cart.reduce(function(acc, item){ return acc + (item.unitPrice * (item.qty || 1)); }, 0);
    var discount = 0;

    if(_appliedCoupon){
      discount = subtotal * (_appliedCoupon.d / 100);
    }

    var flexyFee = 0;
    var isFlexy = (_selPayMethod === 'mobilis' || _selPayMethod === 'djezzy' || _selPayMethod === 'ooredoo');
    if(isFlexy && (!_appliedCoupon || _appliedCoupon.d !== 19)){
      var flexyRate = (window.STRIVIO_CONFIG && window.STRIVIO_CONFIG.rates) ? window.STRIVIO_CONFIG.rates.flexyFee : 0.19;
      flexyFee = (subtotal - discount) * flexyRate;
    }

    var total = subtotal - discount + flexyFee;

    if($('V_SUB')) $('V_SUB').textContent = subtotal.toLocaleString() + ' DZD';
    if($('V_DIS')) $('V_DIS').textContent = '-' + discount.toLocaleString() + ' DZD';
    if($('V_FEE')) $('V_FEE').textContent = '+' + Math.round(flexyFee).toLocaleString() + ' DZD';
    if($('V_TOT')) $('V_TOT').textContent = Math.round(total).toLocaleString() + ' DZD';

    if($('ROW_DIS')) {
      if(discount > 0) $('ROW_DIS').classList.remove('hidden');
      else $('ROW_DIS').classList.add('hidden');
    }
    if($('ROW_FEE')) {
      if(flexyFee > 0) $('ROW_FEE').classList.remove('hidden');
      else $('ROW_FEE').classList.add('hidden');
    }

    // Currency conversions (Wise / USDT)
    var convRow = $('ROW_CONV');
    var convLabel = $('L_CONV');
    var convVal = $('V_CONV');
    if(convRow && convLabel && convVal){
      if(_selPayMethod === 'paysera' || _selPayMethod === 'paypal' || _selPayMethod === 'wise'){
        var wiseRate = (window.STRIVIO_CONFIG && window.STRIVIO_CONFIG.rates) ? window.STRIVIO_CONFIG.rates.wise : 260;
        var eurTotal = (total / wiseRate).toFixed(2);
        convLabel.textContent = tx.rateWise;
        convVal.textContent = eurTotal + ' €';
        convRow.classList.remove('hidden');
      } else if(_selPayMethod === 'usdt'){
        var usdtRate = (window.STRIVIO_CONFIG && window.STRIVIO_CONFIG.rates) ? window.STRIVIO_CONFIG.rates.usdt : 250;
        var usdtTotal = (total / usdtRate).toFixed(2);
        convLabel.textContent = tx.rateUsdt;
        convVal.textContent = usdtTotal + ' USDT ($)';
        convRow.classList.remove('hidden');
      } else {
        convRow.classList.add('hidden');
      }
    }
  }

  function applyCoupon(){
    var tx = TX[L] || TX.fr;
    var inp = $('PRM_INP');
    var msg = $('PRM_MSG');
    if(!inp || !msg) return;

    var code = inp.value.trim();
    if(!code){
      _appliedCoupon = null;
      msg.textContent = '';
      updateSummary();
      return;
    }

    var coup = window.COUPONS ? window.COUPONS[code] : undefined;
    if(coup){
      _appliedCoupon = coup;
      msg.textContent = tx.promoSuccess + ' (' + coup.l + ')';
      msg.className = 'text-xs font-semibold text-[#39ff14] mt-2 block';
      updateSummary();
    } else {
      _appliedCoupon = null;
      msg.textContent = tx.promoError;
      msg.className = 'text-xs font-semibold text-red-400 mt-2 block';
      updateSummary();
    }
  }

  function confirmOrder(){
    if(_cart.length === 0) return;
    var tx = TX[L] || TX.fr;

    var subtotal = _cart.reduce(function(acc, item){ return acc + (item.unitPrice * (item.qty || 1)); }, 0);
    var discount = _appliedCoupon ? subtotal * (_appliedCoupon.d / 100) : 0;
    var isFlexy = (_selPayMethod === 'mobilis' || _selPayMethod === 'djezzy' || _selPayMethod === 'ooredoo');
    var flexyFee = 0;
    if(isFlexy && (!_appliedCoupon || _appliedCoupon.d !== 19)){
      var flexyRate = (window.STRIVIO_CONFIG && window.STRIVIO_CONFIG.rates) ? window.STRIVIO_CONFIG.rates.flexyFee : 0.19;
      flexyFee = (subtotal - discount) * flexyRate;
    }
    var total = Math.round(subtotal - discount + flexyFee);

    var methodLabel = tx.pm[_selPayMethod] || _selPayMethod;
    
    var lines = [];
    lines.push('🛒 *NOUVELLE COMMANDE STRIVIO* 🛒');
    lines.push('----------------------------------');
    _cart.forEach(function(item, i){
      var tStr = item.typeText ? ' [' + item.typeText + ']' : '';
      lines.push((i+1) + '. *' + item.name + '*' + tStr);
      lines.push('   • Durée : ' + item.durText);
      lines.push('   • Quantité : ' + (item.qty || 1));
      lines.push('   • Prix : ' + (item.unitPrice * (item.qty || 1)).toLocaleString() + ' DZD');
    });
    lines.push('----------------------------------');
    lines.push('💳 *Mode de Paiement :* ' + methodLabel);
    if(_appliedCoupon){
      lines.push('🎁 *Code Promo :* ' + _appliedCoupon.l + ' (-' + _appliedCoupon.d + '%)');
    }
    lines.push('💰 *TOTAL À PAYER :* *' + total.toLocaleString() + ' DZD*');

    if(_selPayMethod === 'paysera' || _selPayMethod === 'paypal' || _selPayMethod === 'wise'){
      var wiseRate = (window.STRIVIO_CONFIG && window.STRIVIO_CONFIG.rates) ? window.STRIVIO_CONFIG.rates.wise : 260;
      lines.push('💶 *Équivalent Euro :* *' + (total / wiseRate).toFixed(2) + ' €* (Taux 1€=260 DZD)');
    } else if(_selPayMethod === 'usdt'){
      var usdtRate = (window.STRIVIO_CONFIG && window.STRIVIO_CONFIG.rates) ? window.STRIVIO_CONFIG.rates.usdt : 250;
      lines.push('💵 *Équivalent USDT :* *' + (total / usdtRate).toFixed(2) + ' USDT* (Taux 1$=250 DZD)');
    }

    lines.push('----------------------------------');
    lines.push('⚡ _Veuillez m\'envoyer les informations de paiement / CCP / BaridiMob pour finaliser._');

    var waNum = (window.STRIVIO_CONFIG && window.STRIVIO_CONFIG.whatsappNumber) ? window.STRIVIO_CONFIG.whatsappNumber : "213562961410";
    var url = 'https://wa.me/' + waNum + '?text=' + encodeURIComponent(lines.join('\n'));
    window.open(url, '_blank');
  }

  // Expose handlers
  window._cartQty = function(idx, delta){
    if(!_cart[idx]) return;
    _cart[idx].qty = (_cart[idx].qty || 1) + delta;
    if(_cart[idx].qty <= 0){
      _cart.splice(idx, 1);
    }
    localStorage.setItem('strivio_cart', JSON.stringify(_cart));
    updateCartBadge();
    renderCartItems();
    updateSummary();
  };
  window._cartDel = function(idx){
    _cart.splice(idx, 1);
    localStorage.setItem('strivio_cart', JSON.stringify(_cart));
    updateCartBadge();
    renderCartItems();
    updateSummary();
  };

  function updateCartBadge(){
    var totalQty = _cart.reduce(function(acc, item){ return acc + (item.qty || 1); }, 0);
    var badge = $('CRTB') ? $('CRTB').querySelector('span') : null;
    if(badge){
      if(totalQty > 0){
        badge.textContent = totalQty;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    renderUI();

    if($('HB')) $('HB').addEventListener('click', function(){ if($('MM')) $('MM').classList.toggle('O'); });
    if($('LTD')) $('LTD').addEventListener('click', function(e){ e.stopPropagation(); if($('LDPD')) $('LDPD').classList.toggle('hidden'); });
    
    document.querySelectorAll('.LO').forEach(function(btn){
      btn.addEventListener('click', function(){
        L = this.getAttribute('data-l');
        localStorage.setItem('strivio_lang', L);
        if($('LDPD')) $('LDPD').classList.add('hidden');
        renderUI();
      });
    });

    document.addEventListener('click', function(e){
      if($('LDPD') && !$('LDPD').contains(e.target)) $('LDPD').classList.add('hidden');
    });

    if($('PRM_BTN')) $('PRM_BTN').addEventListener('click', applyCoupon);
    if($('PRM_INP')) $('PRM_INP').addEventListener('keypress', function(e){ if(e.key === 'Enter') applyCoupon(); });
    if($('BTN_CONF')) $('BTN_CONF').addEventListener('click', confirmOrder);

    // Payment method radios
    document.querySelectorAll('input[name="pm"]').forEach(function(radio){
      radio.addEventListener('change', function(){
        if(this.checked){
          _selPayMethod = this.value;
          updateSummary();
        }
      });
    });
  });
})();
