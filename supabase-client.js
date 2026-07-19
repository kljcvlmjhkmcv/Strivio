/* ═══════════════════════════════════════════════════════════════
   STRIVIO - SUPABASE BACKEND CLIENT
   اتصال قاعدة البيانات وإدارة الخدمات والطلبات
═══════════════════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://rrfguexpsfizyijekkmi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_V-uY9E5L4uSY3PP6QNoInw_YSkYmdtw';

/* Shared in-site feedback and tactile button motion. Keeps errors and success
   states inside the Strivio UI instead of browser alert popups. */
(function installStrivioFeedback(){
  if(window.__strivioFeedbackInstalled)return;
  window.__strivioFeedbackInstalled=true;
  var style=document.createElement('style');
  style.textContent=`
    .app-notice-host{position:fixed;z-index:9999;inset:auto 18px 18px;display:grid;gap:10px;max-width:min(420px,calc(100vw - 36px));pointer-events:none}
    .app-notice{pointer-events:auto;display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid #303030;border-radius:18px;background:linear-gradient(145deg,#171717,#0b0b0b);color:#f4f4f4;box-shadow:0 18px 55px #0009;animation:noticeIn .28s cubic-bezier(.2,.8,.2,1) both;direction:rtl}
    .app-notice.is-leaving{animation:noticeOut .22s ease both}.app-notice__icon{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;font-weight:900;flex:0 0 auto}.app-notice__body{flex:1;line-height:1.65;font-size:13px}.app-notice__close{border:0;background:transparent;color:#999;font-size:20px;line-height:1;cursor:pointer}.app-notice.success{border-color:#39ff1466}.app-notice.success .app-notice__icon{background:#39ff1422;color:#39ff14}.app-notice.error{border-color:#ff646466}.app-notice.error .app-notice__icon{background:#ff646422;color:#ff8585}.app-notice.info .app-notice__icon{background:#ffffff18;color:#fff}
    button,.btn,.ghost,a[role=button]{transition:transform .18s ease,box-shadow .18s ease,filter .18s ease,border-color .18s ease,background-color .18s ease!important}button:hover,.btn:hover,.ghost:hover,a[role=button]:hover{transform:translateY(-1px)}button:active,.btn:active,.ghost:active,a[role=button]:active{transform:translateY(1px) scale(.975);filter:brightness(1.12)}.press-ripple{position:absolute;border-radius:999px;pointer-events:none;background:#39ff1455;transform:scale(0);animation:pressRipple .55s ease-out forwards}
    @keyframes noticeIn{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}@keyframes noticeOut{to{opacity:0;transform:translateY(10px) scale(.97)}}@keyframes pressRipple{to{opacity:0;transform:scale(1)}}
    @media (max-width:640px){.app-notice-host{inset:auto 12px 12px;max-width:none}}
  `;
  document.head.appendChild(style);
  function host(){var h=document.querySelector('.app-notice-host');if(!h){h=document.createElement('div');h.className='app-notice-host';h.setAttribute('aria-live','polite');document.body.appendChild(h)}return h}
  window.showAppNotice=function(message,options){options=options||{};var tone=options.tone||'info',h=host(),n=document.createElement('div');n.className='app-notice '+tone;n.setAttribute('role','status');var icon=tone==='error'?'!':tone==='success'?'✓':'i';n.innerHTML='<span class="app-notice__icon">'+icon+'</span><div class="app-notice__body"></div><button type="button" class="app-notice__close" aria-label="Close">×</button>';n.querySelector('.app-notice__body').textContent=String(message||'');n.querySelector('.app-notice__close').onclick=function(){n.classList.add('is-leaving');setTimeout(function(){n.remove()},220)};h.appendChild(n);var ttl=Number(options.duration||4200);if(ttl>0)setTimeout(function(){if(n.isConnected)n.querySelector('.app-notice__close').click()},ttl);return n};
  document.addEventListener('pointerdown',function(e){var b=e.target.closest&&e.target.closest('button,.btn,.ghost,a[role=button]');if(!b||b.disabled)return;var r=b.getBoundingClientRect(),s=Math.max(r.width,r.height)*1.5,span=document.createElement('span');span.className='press-ripple';span.style.width=span.style.height=s+'px';span.style.left=(e.clientX-r.left-s/2)+'px';span.style.top=(e.clientY-r.top-s/2)+'px';if(getComputedStyle(b).position==='static')b.style.position='relative';b.style.overflow='hidden';b.appendChild(span);setTimeout(function(){span.remove()},600)});
})();

let supabaseClient = null;

function initSupabase() {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabaseClient = supabaseClient;
  }
}

/* جلب المنتجات والأسعار من قاعدة البيانات */
async function loadServicesFromDB() {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient
      .from('services')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      return null;
    }

    if (!data || data.length === 0) return null;

    var parseJ = function(v, def) {
      if (!v) return def;
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch(e) { return def; }
      }
      return v;
    };

    return data.map(function(s) {
      return {
        id: s.id,
        cat: s.cat,
        pop: s.pop || null,
        showTypes: !!s.show_types,
        bg: s.bg,
        iconType: s.icon_type,
        iconSize: s.icon_size || 72,
        iconSrc: s.icon_src,
        n: parseJ(s.n, {}),
        f: parseJ(s.f, {}),
        types: parseJ(s.types, null),
        p: parseJ(s.p, []),
        typePrices: parseJ(s.type_prices, null),
        promo: parseJ(s.promo, null),
        dur_notes: parseJ(s.dur_notes, (parseJ(s.promo, {}) || {}).dur_notes || null),
        out_of_stock: parseJ(s.out_of_stock, null),
        best_value: s.best_value !== undefined && s.best_value !== null ? Number(s.best_value) : 2,
        fulfillment_mode: s.fulfillment_mode || 'manual_delivery',
        fulfillment_config: parseJ(s.fulfillment_config, {})
      };
    });
  } catch (e) {
    return null;
  }
}

/* جلب أكواد الخصم النشطة من قاعدة البيانات (للأدمن فقط) */
async function loadCouponsFromDB() {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) return null;

  try {
    const { data, error } = await supabaseClient
      .from('coupons')
      .select('*')
      .eq('active', true);

    if (error) {
      return null;
    }

    const couponsObj = {};
    if (data) {
      data.forEach(function(c) {
        couponsObj[c.code] = { type: c.type, val: Number(c.val) };
      });
    }
    return couponsObj;
  } catch (e) {
    return null;
  }
}

/* التحقق الآمن من كود الخصم عبر السيرفر دون كشف الكوبونات */
async function validateCouponInDB(code, subtotal) {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient.rpc('validate_coupon', {
      p_code: code,
      p_subtotal: subtotal || 0
    });
    if (error) {
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

/* حفظ طلب العميل في قاعدة البيانات بأمان تام عبر السيرفر وإصدار فاتورة SlickPay */
async function saveOrderToDB(orderData) {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) {
    return null;
  }

  try {
    // Renewal items are created by the dedicated secure RPC so the server can
    // validate ownership and extend the exact selected subscriptions after payment.
    const items = orderData.items || [];
    const renewalItems = items.filter(function(item){ return item && item.renewal && Array.isArray(item.renewal.target_ids); });
    let rpcData, rpcError;
    if (renewalItems.length) {
      if (items.length !== 1 || renewalItems.length !== 1) {
        return { success: false, error_message: 'Complete subscription renewals in their own cart.' };
      }
      const renewalItem = renewalItems[0];
      const customerInfo = Object.assign({}, orderData.customer_info || {}, {
        order_kind: 'renewal',
        renewal_coupon_code: orderData.coupon_code || null,
        renewal_source_order_id: renewalItem.renewal.source_order_id || null
      });
      const renewalResult = await supabaseClient.rpc('create_renewal_order', {
        p_target_ids: renewalItem.renewal.target_ids,
        p_target_kind: renewalItem.renewal.target_kind,
        p_duration_idx: Number(renewalItem.durIdx || 0),
        p_payment_method: orderData.payment_method === 'test' ? 'baridimob' : (orderData.payment_method || 'cib'),
        p_customer_info: customerInfo
      });
      rpcData = renewalResult.data;
      rpcError = renewalResult.error;
    } else {
      const orderResult = await supabaseClient.rpc('create_order_secure', {
        p_items: items,
        p_payment_method: orderData.payment_method === 'test' ? 'baridimob' : (orderData.payment_method || 'cib'),
        p_coupon_code: orderData.coupon_code || null,
        p_customer_info: orderData.customer_info || {}
      });
      rpcData = orderResult.data;
      rpcError = orderResult.error;
    }

    if (rpcError || !rpcData || !rpcData.success) {
      return {
        success: false,
        error_message: (rpcError && rpcError.message) || (rpcData && (rpcData.error_message || rpcData.error)) || 'Order creation failed'
      };
    }

    // Link the order to the authenticated customer before payment starts.
    const ownerResult = await supabaseClient.rpc('attach_order_owner_and_profile', {
      p_order_id: rpcData.order_id,
      p_customer_info: orderData.customer_info || {}
    });
    if (ownerResult.error) {
      console.error('Could not attach customer to order', ownerResult.error);
      return null;
    }

    // إرسال إشعار تليجرام الشامل للطلب الجديد وحفظ معرّف الرسالة لتعديلها لاحقاً
    const tgMsgId = await sendOrUpdateTelegramOrderAlert(rpcData, orderData, orderData.payment_method === 'cib' ? 'pending_payment' : 'pending');
    if (tgMsgId && rpcData.order_id && supabaseClient) {
      try {
        await supabaseClient.rpc('update_order_telegram_msg_id', { p_order_id: rpcData.order_id, p_tg_msg_id: tgMsgId });
        rpcData.telegram_msg_id = tgMsgId;
      } catch(e) {}
    }

    if (orderData.payment_method === 'test') {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session || !session.access_token) return Object.assign(rpcData, { success: false, error_message: 'Admin session required' });
      const testRes = await fetch(`${SUPABASE_URL}/functions/v1/simulate-payment`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json', 'x-client-info': 'strivio-admin-test' },
        body: JSON.stringify({ order_id: rpcData.order_id })
      });
      const testData = await testRes.json().catch(function(){ return null; });
      if (!testRes.ok || !testData || !testData.success) return Object.assign(rpcData, { success: false, error_message: (testData && testData.error) || 'Test payment failed' });
      return Object.assign(rpcData, { simulated_paid: true, fulfillment_status: testData.fulfillment_status });
    }

    // 2. إذا كانت طريقة الدفع ليست cib، نرجع بيانات RPC فوراً دون استدعاء SlickPay
    if (orderData.payment_method !== 'cib') {
      return rpcData;
    }

    // 3. إذا كانت طريقة الدفع cib، نتصل بـ Edge Function لإنشاء الفاتورة ورابط الدفع دون كشف المفاتيح
    try {
      if (supabaseClient && typeof supabaseClient.functions?.invoke === 'function') {
        const { data: invokeData, error: invokeErr } = await supabaseClient.functions.invoke('create-payment', {
          body: { order_id: rpcData.order_id, origin_url: window.location.origin }
        });
        if (!invokeErr && invokeData && invokeData.success && invokeData.payment_url) {
          rpcData.payment_url = invokeData.payment_url;
          if (invokeData.telegram_msg_id) rpcData.telegram_msg_id = invokeData.telegram_msg_id;
          return rpcData;
        } else if (invokeErr || (invokeData && !invokeData.success)) {
          console.error("create-payment Edge Function invoke error:", invokeErr || invokeData);
          if (invokeData && invokeData.error) rpcData.error_message = invokeData.error;
        }
      }

      if (!rpcData.payment_url) {
        const edgeUrl = `${supabaseClient.supabaseUrl}/functions/v1/create-payment`;
        const edgeRes = await fetch(edgeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'apikey': SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            order_id: rpcData.order_id,
            origin_url: window.location.origin
          })
        });

        if (edgeRes.ok) {
          const edgeJson = await edgeRes.json();
          if (edgeJson.success && edgeJson.payment_url) {
            rpcData.payment_url = edgeJson.payment_url;
            if (edgeJson.telegram_msg_id) rpcData.telegram_msg_id = edgeJson.telegram_msg_id;
            return rpcData;
          } else {
            console.error("create-payment edgeJson not success:", edgeJson);
            if (edgeJson.error) rpcData.error_message = edgeJson.error;
          }
        } else {
          var errText = await edgeRes.text().catch(function(){ return ""; });
          console.error("create-payment fetch error status:", edgeRes.status, errText);
          rpcData.error_message = `HTTP ${edgeRes.status}: ${errText}`;
        }
      }
    } catch (edgeErr) {
      console.error("create-payment exception:", edgeErr);
      rpcData.error_message = edgeErr && edgeErr.message ? edgeErr.message : String(edgeErr);
    }

    return rpcData;

  } catch (e) {
    return null;
  }
}

/* إرسال أو تعديل إشعار تليجرام عبر Edge Function لضمان عدم كشف التوكن في المتصفح */
async function sendOrUpdateTelegramOrderAlert(rpcData, orderData, status, existingMsgId = null) {
  if (!window.supabaseClient) return null;
  try {
    if (typeof window.supabaseClient.functions?.invoke === 'function') {
      const { data: invokeData, error: invokeErr } = await window.supabaseClient.functions.invoke('send-telegram', {
        body: { rpcData, orderData, status, existingMsgId }
      });
      if (!invokeErr && invokeData && invokeData.message_id) {
        return invokeData.message_id;
      }
    }

    const edgeUrl = `${window.supabaseClient.supabaseUrl}/functions/v1/send-telegram`;
    const res = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        rpcData,
        orderData,
        status,
        existingMsgId
      })
    });
    if (res.ok) {
      const json = await res.json();
      return json.message_id || existingMsgId;
    }
  } catch (err) {
    console.error("sendOrUpdateTelegramOrderAlert error:", err);
  }
  return existingMsgId;
}

/* جلب الإعدادات (روابط التواصل وأرقام الهاتف) من قاعدة البيانات */
async function loadSettingsFromDB() {
  if (!supabaseClient) initSupabase();
  window.CONFIG = window.CONFIG || {};
  if (!supabaseClient) {
    return window.CONFIG;
  }
  try {
    const { data, error } = await supabaseClient.from('settings').select('config').eq('id', 1).single();
    if (!error && data && data.config) {
      window.CONFIG = data.config;
    }
  } catch (e) {
  }
  return window.CONFIG;
}

/* جلب التقييمات من قاعدة البيانات */
async function loadReviewsFromDB() {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from('reviews').select('*').eq('active', true).order('sort_order', { ascending: true });
    if (!error && data) {
      window.REVIEWS = data;
      return data;
    }
    return [];
  } catch (e) {
    return [];
  }
}

/* جلب الأسئلة الشائعة من قاعدة البيانات */
async function loadFaqsFromDB() {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from('faq').select('*').eq('active', true).order('sort_order', { ascending: true });
    if (error) {
      return [];
    }
    if (!data || data.length === 0) return [];

    var parseJ = function(v, def) {
      if (!v) return def;
      if (typeof v === 'string') {
        try { return JSON.parse(v); } catch(e) { return def; }
      }
      return v;
    };

    const parsedFaqs = data.map(function(item) {
      return {
        id: item.id,
        icon: item.icon || '❓',
        q: parseJ(item.q, { fr: '', ar: '', en: '' }),
        a: parseJ(item.a, { fr: '', ar: '', en: '' }),
        sort_order: item.sort_order || 0,
        active: item.active !== false
      };
    });

    window.FAQS = parsedFaqs;
    return parsedFaqs;
  } catch (e) {
    return [];
  }
}

// تهيئة الاتصال عند تحميل الملف
initSupabase();

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
window.escapeHtml = escapeHtml;

window.sendOrUpdateTelegramOrderAlert = sendOrUpdateTelegramOrderAlert;
