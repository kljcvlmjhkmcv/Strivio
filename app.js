/* Strivio Secure Store App Core v4.0 — Obfuscated & Protected Engine */
(function(_0x1b8f, _0x3e1a){
  var _0x2c4d = function(_0x5f9a){
    while(--_0x5f9a){
      _0x1b8f['push'](_0x1b8f['shift']());
    }
  };
  _0x2c4d(++_0x3e1a);
}([], 0x2a1));

(function(){
  // Anti-F12 Protection & Debugger Shield
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) || (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.key === 'S' || e.key === 's'))) {
      e.preventDefault();
    }
  });
  setInterval(function(){
    var _0x1a = new Date().getTime();
    debugger;
    var _0x1b = new Date().getTime();
    if (_0x1b - _0x1a > 100) {
      document.body.innerHTML = '<div style="background:#121212;color:#ff3333;height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-weight:bold;font-size:24px">Protected Code — Access Denied</div>';
    }
  }, 1000);

  var L = localStorage.getItem('strivio_lang') || (window.STRIVIO_CONFIG ? window.STRIVIO_CONFIG.defaultLang : 'fr');
  var $ = function(id){ return document.getElementById(id); };

  var TX = {
    fr: {
      home:'Accueil', subs:'Abonnements', faq:'FAQ',
      heroTag:'⚡ LE N°1 DES ABONNEMENTS PREMIUM EN ALGÉRIE',
      heroTitle:'Vos plateformes favorites à prix <span class="NT">imbattables</span>.',
      heroSub:'Accès instantané à Netflix, IPTV, Spotify, Shahid, ChatGPT et +20 services. Garantie 100% sur toute la durée.',
      catalogTitle:'Nos Abonnements',
      catalogSub:'Choisissez votre plateforme et activez votre abonnement en quelques clics.',
      all:'Tout', pop:'Populaire', new:'Nouveau', ai:'IA & Tech',
      from:'À partir de', mo:'/mois', order:'Commander',
      selDur:'Sélectionnez la durée :', selType:'Choisissez le type / écran :',
      features:'Inclus dans l\'abonnement :',
      addCart:'🛒 Ajouter au Panier', buyNow:'⚡ Acheter Maintenant',
      close:'Fermer', added:'Ajouté au panier !',
      durs:['1 Mois','2 Mois','3 Mois','6 Mois','1 An'],
      whyTitle:'Pourquoi choisir <span class="NT">Strivio</span> ?',
      w1t:'⚡ Livraison Instantanée', w1d:'Votre compte ou code d\'activation est envoyé sur WhatsApp en moins de 5 minutes après validation.',
      w2t:'🛡️ Garantie 100%', w2d:'Un abonnement stable et sans coupure. En cas de souci technique, nous remplaçons immédiatement.',
      w3t:'💬 Support 24/7', w3d:'Notre équipe est disponible tous les jours sur WhatsApp pour répondre à vos questions.'
    },
    ar: {
      home:'الرئيسية', subs:'الاشتراكات', faq:'الأسئلة الشائعة',
      heroTag:'⚡ المتجر رقم 1 للاشتراكات الرقمية في الجزائر',
      heroTitle:'منصاتك المفضلة بأرخص الأسعار و<span class="NT">أعلى ضمان</span>.',
      heroSub:'وصول فوري لنتفليكس، IPTV، سبوتيفاي، شاهد، ChatGPT وأكثر من 20 خدمة. ضمان كامل 100% طوال فترة الاشتراك.',
      catalogTitle:'قائمة الاشتراكات',
      catalogSub:'اختر منصتك المفضلة وقم بتفعيل اشتراكك بثوانٍ معدودة.',
      all:'الكل', pop:'الأكثر طلباً', new:'جديدنا', ai:'ذكاء اصطناعي',
      from:'يبدأ من', mo:'/شهر', order:'اطلب الآن',
      selDur:'اختر مدة الاشتراك :', selType:'اختر نوع الحساب / الشاشات :',
      features:'مميزات الاشتراك :',
      addCart:'🛒 أضف إلى السلة', buyNow:'⚡ اشترِ الآن مباشرة',
      close:'إغلاق', added:'تمت الإضافة إلى السلة!',
      durs:['شهر واحد','شهران','3 أشهر','6 أشهر','سنة كاملة'],
      whyTitle:'لماذا تختار متجر <span class="NT">Strivio</span> ؟',
      w1t:'⚡ تسليم فوري وسريع', w1d:'يتم إرسال حسابك أو كود التفعيل عبر الواتساب في أقل من 5 دقائق من تأكيد الطلب.',
      w2t:'🛡️ ضمان شامل 100%', w2d:'اشتراك مستقر وبدون أي تقطيع. في حال حدوث أي طارئ فني نستبدل الحساب فوراً.',
      w3t:'💬 دعم فني 24/7', w3d:'فريق الدعم متاح يومياً على مدار الساعة عبر الواتساب لمساعدتك والإجابة على استفساراتك.'
    },
    en: {
      home:'Home', subs:'Subscriptions', faq:'FAQ',
      heroTag:'⚡ #1 PREMIUM SUBSCRIPTION STORE IN ALGERIA',
      heroTitle:'Your favorite platforms at <span class="NT">unbeatable</span> prices.',
      heroSub:'Instant access to Netflix, IPTV, Spotify, Shahid, ChatGPT and +20 services. 100% Warranty for the entire duration.',
      catalogTitle:'Our Subscriptions',
      catalogSub:'Choose your platform and activate your subscription in a few clicks.',
      all:'All', pop:'Popular', new:'New', ai:'AI & Tech',
      from:'From', mo:'/mo', order:'Order Now',
      selDur:'Select duration :', selType:'Select account type / screens :',
      features:'Included features :',
      addCart:'🛒 Add to Cart', buyNow:'⚡ Buy Now',
      close:'Close', added:'Added to cart!',
      durs:['1 Month','2 Months','3 Months','6 Months','1 Year'],
      whyTitle:'Why choose <span class="NT">Strivio</span> ?',
      w1t:'⚡ Instant Delivery', w1d:'Your account or activation code is sent via WhatsApp in less than 5 minutes after validation.',
      w2t:'🛡️ 100% Warranty', w2d:'Stable and uninterrupted subscription. In case of any technical issue, we replace it immediately.',
      w3t:'💬 24/7 Support', w3d:'Our team is available every day on WhatsApp to answer your questions and assist you.'
    }
  };

  var _selService = null;
  var _selTypeIdx = 0;
  var _selDurIdx = 0;
  var _activeFilter = 'ALL';

  function updateCartBadge(){
    var cart = JSON.parse(localStorage.getItem('strivio_cart') || '[]');
    var totalQty = cart.reduce(function(acc, item){ return acc + (item.qty || 1); }, 0);
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

    if($('HTG')) $('HTG').innerHTML = tx.heroTag;
    if($('HTT')) $('HTT').innerHTML = tx.heroTitle;
    if($('HSB')) $('HSB').innerHTML = tx.heroSub;
    if($('CTT')) $('CTT').textContent = tx.catalogTitle;
    if($('CSB')) $('CSB').textContent = tx.catalogSub;

    if($('FA')) $('FA').textContent = tx.all;
    if($('FP')) $('FP').textContent = tx.pop;
    if($('FN')) $('FN').textContent = tx.new;
    if($('FAI')) $('FAI').textContent = tx.ai;

    if($('WTT')) $('WTT').innerHTML = tx.whyTitle;
    if($('W1T')) $('W1T').textContent = tx.w1t;
    if($('W1D')) $('W1D').textContent = tx.w1d;
    if($('W2T')) $('W2T').textContent = tx.w2t;
    if($('W2D')) $('W2D').textContent = tx.w2d;
    if($('W3T')) $('W3T').textContent = tx.w3t;
    if($('W3D')) $('W3D').textContent = tx.w3d;

    if($('LCD')) $('LCD').textContent = L.toUpperCase();
    if($('FLD')) $('FLD').className = 'F' + L.toUpperCase();

    renderServices(_activeFilter);
    updateCartBadge();
  }

  function renderServices(filter){
    _activeFilter = filter;
    var tx = TX[L] || TX.fr;
    var grid = $('PG');
    if(!grid) return;

    var services = window.SERVICES || [];
    var filtered = services.filter(function(s){
      if(filter === 'ALL') return true;
      if(filter === 'POP') return s.pop === true || s.tag === 'POPULAR';
      if(filter === 'NEW') return s.new === true || s.tag === 'NEW';
      if(filter === 'AI') return s.tag === 'AI' || s.tag === 'GOOGLE AI';
      return true;
    });

    grid.innerHTML = filtered.map(function(s){
      // Lowest price across all types and durations
      var minP = s.p[0];
      if(s.typePrices && s.typePrices[0]){
        minP = s.typePrices[0][0];
      }
      var tagHtml = s.tag ? '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider" style="background:rgba(57,255,20,.12);color:#39ff14;border:1px solid rgba(57,255,20,.3)">'+s.tag+'</span>' : '';
      
      return [
        '<div class="group relative rounded-2xl p-5 transition-all duration-300 flex flex-col justify-between cursor-pointer overflow-hidden" style="background:#181818;border:1px solid #2A2A2A" onclick="window._openStrivioModal('+s.id+')">',
          '<div class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style="background:radial-gradient(circle at top right, rgba(57,255,20,.08), transparent 70%)"></div>',
          '<div>',
            '<div class="flex items-start justify-between gap-3 mb-4">',
              '<div class="w-12 h-12 rounded-xl flex items-center justify-center text-white flex-shrink-0 shadow-lg" style="background:'+s.color+';box-shadow:0 0 20px '+s.color+'40">'+s.icon+'</div>',
              tagHtml,
            '</div>',
            '<h3 class="font-display font-bold text-lg text-white group-hover:text-[#39ff14] transition-colors mb-1">'+s.name+'</h3>',
            '<p class="text-xs font-medium" style="color:rgba(224,224,224,.5)">'+tx.from+' <span class="text-white font-bold text-sm">'+minP.toLocaleString()+' DZD</span> '+tx.mo+'</p>',
          '</div>',
          '<div class="mt-6 pt-4 border-t flex items-center justify-between" style="border-color:rgba(255,255,255,.06)">',
            '<span class="text-xs font-bold text-[#39ff14] flex items-center gap-1">'+tx.order+' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></span>',
            '<div class="w-7 h-7 rounded-full flex items-center justify-center transition-transform group-hover:scale-110" style="background:rgba(57,255,20,.1);color:#39ff14"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('');
  }

  function openModal(id){
    var services = window.SERVICES || [];
    var s = services.find(function(item){ return item.id === id; });
    if(!s) return;

    _selService = s;
    _selTypeIdx = 0;
    _selDurIdx = 0;

    var tx = TX[L] || TX.fr;
    var m = $('MO');
    if(!m) return;

    if($('MICO')) {
      $('MICO').innerHTML = s.icon;
      $('MICO').style.background = s.color;
      $('MICO').style.boxShadow = '0 0 25px ' + s.color + '60';
    }
    if($('MTL')) $('MTL').textContent = s.name;
    if($('MFTL')) $('MFTL').textContent = tx.features;
    if($('MDTL')) $('MDTL').textContent = tx.selDur;

    // Render Features
    var feats = (s.f && s.f[L]) ? s.f[L] : (s.f ? s.f.fr : []);
    if($('MFL')){
      $('MFL').innerHTML = feats.map(function(f){
        return '<li class="flex items-center gap-2.5 text-xs sm:text-sm text-[#E0E0E0]"><svg class="flex-shrink-0 text-[#39ff14]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg><span>'+f+'</span></li>';
      }).join('');
    }

    // Render Types / Screens if applicable
    var typeContainer = $('MTYPE_CONT');
    var typeList = $('MTYPE_LIST');
    if(s.types && s.types[L] && s.types[L].length > 0){
      typeContainer.classList.remove('hidden');
      if($('MTYPETL')) $('MTYPETL').textContent = tx.selType;
      typeList.innerHTML = s.types[L].map(function(tName, idx){
        var activeCls = (idx === _selTypeIdx) ? 'border-[#39ff14] bg-[#39ff14]/10 text-[#39ff14] font-bold shadow-[0_0_15px_rgba(57,255,20,0.25)]' : 'border-[#2A2A2A] bg-[#141414] text-[#E0E0E0] hover:border-[#39ff14]/50';
        return '<button type="button" class="px-3.5 py-2 rounded-xl border text-xs sm:text-sm transition-all text-center '+activeCls+'" onclick="window._selModalType('+idx+')">'+tName+'</button>';
      }).join('');
    } else {
      typeContainer.classList.add('hidden');
    }

    renderModalDurations();
    updateModalTotal();

    m.classList.remove('hidden');
    setTimeout(function(){ m.classList.add('O'); }, 10);
    document.body.style.overflow = 'hidden';
  }

  function renderModalDurations(){
    var tx = TX[L] || TX.fr;
    var durList = $('MDUR_LIST');
    if(!durList || !_selService) return;

    durList.innerHTML = tx.durs.map(function(dName, idx){
      // Calculate exact price for this duration based on selected type/screen
      var price = _selService.p[idx];
      if(_selService.typePrices && _selService.typePrices[_selTypeIdx] && _selService.typePrices[_selTypeIdx][idx] !== undefined){
        price = _selService.typePrices[_selTypeIdx][idx];
      }

      var activeCls = (idx === _selDurIdx) ? 'border-[#39ff14] bg-[#39ff14]/10 text-white font-bold shadow-[0_0_15px_rgba(57,255,20,0.25)]' : 'border-[#2A2A2A] bg-[#141414] text-[#E0E0E0] hover:border-[#39ff14]/50';
      return [
        '<button type="button" class="p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all '+activeCls+'" onclick="window._selModalDur('+idx+')">',
          '<span class="text-xs">'+dName+'</span>',
          '<span class="font-display font-bold text-sm sm:text-base text-[#39ff14]">'+price.toLocaleString()+' DZD</span>',
        '</button>'
      ].join('');
    }).join('');
  }

  function updateModalTotal(){
    var tx = TX[L] || TX.fr;
    if(!_selService) return;

    var price = _selService.p[_selDurIdx];
    if(_selService.typePrices && _selService.typePrices[_selTypeIdx] && _selService.typePrices[_selTypeIdx][_selDurIdx] !== undefined){
      price = _selService.typePrices[_selTypeIdx][_selDurIdx];
    }

    if($('MBTN_CART')) $('MBTN_CART').innerHTML = tx.addCart;
    if($('MBTN_BUY')) $('MBTN_BUY').innerHTML = tx.buyNow + ' — <span class="text-white font-black ml-1">' + price.toLocaleString() + ' DZD</span>';
  }

  function closeModal(){
    var m = $('MO');
    if(!m) return;
    m.classList.remove('O');
    setTimeout(function(){ m.classList.add('hidden'); document.body.style.overflow = ''; }, 250);
  }

  function addToCart(redirect){
    if(!_selService) return;
    var tx = TX[L] || TX.fr;

    var price = _selService.p[_selDurIdx];
    if(_selService.typePrices && _selService.typePrices[_selTypeIdx] && _selService.typePrices[_selTypeIdx][_selDurIdx] !== undefined){
      price = _selService.typePrices[_selTypeIdx][_selDurIdx];
    }

    var durText = tx.durs[_selDurIdx];
    var typeText = (_selService.types && _selService.types[L]) ? _selService.types[L][_selTypeIdx] : null;

    var cart = JSON.parse(localStorage.getItem('strivio_cart') || '[]');
    
    // Check if identical item already exists in cart
    var existingIdx = cart.findIndex(function(item){
      return item.id === _selService.id && item.durIdx === _selDurIdx && item.typeIdx === _selTypeIdx;
    });

    if(existingIdx > -1){
      cart[existingIdx].qty = (cart[existingIdx].qty || 1) + 1;
    } else {
      cart.push({
        id: _selService.id,
        name: _selService.name,
        color: _selService.color,
        durIdx: _selDurIdx,
        durText: durText,
        typeIdx: _selTypeIdx,
        typeText: typeText,
        unitPrice: price,
        qty: 1
      });
    }

    localStorage.setItem('strivio_cart', JSON.stringify(cart));
    updateCartBadge();
    closeModal();

    if(redirect){
      window.location.href = 'cart';
    } else {
      showToast(tx.added);
    }
  }

  function showToast(msg){
    var t = $('PTOAST');
    if(!t) return;
    t.textContent = msg;
    t.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(function(){
      t.classList.add('translate-y-20', 'opacity-0');
    }, 3000);
  }

  // Expose global handlers to window securely
  window._openStrivioModal = openModal;
  window._closeStrivioModal = closeModal;
  window._selModalType = function(idx){
    _selTypeIdx = idx;
    var s = _selService;
    if(s && s.types && s.types[L]){
      var btns = $('MTYPE_LIST') ? $('MTYPE_LIST').querySelectorAll('button') : [];
      btns.forEach(function(b, i){
        if(i === idx){
          b.className = 'px-3.5 py-2 rounded-xl border text-xs sm:text-sm transition-all text-center border-[#39ff14] bg-[#39ff14]/10 text-[#39ff14] font-bold shadow-[0_0_15px_rgba(57,255,20,0.25)]';
        } else {
          b.className = 'px-3.5 py-2 rounded-xl border text-xs sm:text-sm transition-all text-center border-[#2A2A2A] bg-[#141414] text-[#E0E0E0] hover:border-[#39ff14]/50';
        }
      });
    }
    renderModalDurations();
    updateModalTotal();
  };
  window._selModalDur = function(idx){
    _selDurIdx = idx;
    renderModalDurations();
    updateModalTotal();
  };
  window._strivioAddCart = function(redirect){ addToCart(redirect); };

  // Event Listeners setup on DOM ready
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
      if($('MO') && e.target === $('MO')) closeModal();
    });

    if($('MCL')) $('MCL').addEventListener('click', closeModal);
    if($('MBTN_CART')) $('MBTN_CART').addEventListener('click', function(){ addToCart(false); });
    if($('MBTN_BUY')) $('MBTN_BUY').addEventListener('click', function(){ addToCart(true); });

    // Filter buttons
    document.querySelectorAll('[data-f]').forEach(function(btn){
      btn.addEventListener('click', function(){
        document.querySelectorAll('[data-f]').forEach(function(b){
          b.className = 'px-4 py-2 rounded-full border text-xs font-semibold transition-all border-[#2A2A2A] bg-[#1A1A1A] text-[#E0E0E0] hover:border-[#39ff14]/50';
        });
        this.className = 'px-4 py-2 rounded-full border text-xs font-semibold transition-all border-[#39ff14] bg-[#39ff14]/15 text-[#39ff14] shadow-[0_0_15px_rgba(57,255,20,0.25)]';
        renderServices(this.getAttribute('data-f'));
      });
    });
  });
})();
