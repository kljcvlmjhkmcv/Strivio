/* ═══════════════════════════════════════════════════════════════
   STRIVIO - SUPABASE BACKEND CLIENT
   اتصال قاعدة البيانات وإدارة الخدمات والطلبات
═══════════════════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://rrfguexpsfizyijekkmi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_V-uY9E5L4uSY3PP6QNoInw_YSkYmdtw';

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
    // 1. الاتصال بدالة السيرفر الآمنة RPC لحساب السعر وإنشاء الطلب
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('create_order_secure', {
      p_items: orderData.items || [],
      p_payment_method: orderData.payment_method || 'cib',
      p_coupon_code: orderData.coupon_code || null,
      p_customer_info: orderData.customer_info || {}
    });

    if (rpcError || !rpcData || !rpcData.success) {
      return null;
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
