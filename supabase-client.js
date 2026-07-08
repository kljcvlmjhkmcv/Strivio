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
    console.log('✅ Supabase connected successfully.');
  } else {
    console.warn('⚠️ Supabase SDK not found in window.');
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
      console.error('❌ Error loading services from Supabase:', error.message);
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
        best_value: s.best_value !== undefined && s.best_value !== null ? Number(s.best_value) : 2
      };
    });
  } catch (e) {
    console.error('❌ Exception loading services:', e);
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
      console.error('❌ Error loading coupons from Supabase:', error.message);
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
    console.error('❌ Exception loading coupons:', e);
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
      console.error('❌ Error validating coupon via RPC:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('❌ Exception in validateCouponInDB:', e);
    return null;
  }
}

/* حفظ طلب العميل في قاعدة البيانات بأمان تام عبر السيرفر وإصدار فاتورة SlickPay */
async function saveOrderToDB(orderData) {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) {
    console.warn('⚠️ Cannot save order to DB: Supabase client not initialized.');
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
      if (rpcError) console.error('❌ Error saving order via RPC:', rpcError.message);
      else if (rpcData) console.error('❌ RPC returned failure:', rpcData.error || 'Unknown error');
      return null;
    }

    console.log('✅ Order created securely via RPC:', rpcData);

    // 2. إذا كانت طريقة الدفع ليست cib، نرجع بيانات RPC فوراً دون استدعاء SlickPay
    if (orderData.payment_method !== 'cib') {
      return rpcData;
    }

    // 3. إذا كانت طريقة الدفع cib، نتصل بـ SlickPay v2 لإنشاء الفاتورة ورابط الدفع عبر SATIM
    console.log('⏳ Initiating SlickPay v2 invoice creation for CIB/SATIM...');
    
    const slickHeaders = {
      'Authorization': 'Bearer 45913|clm8s1Msb8UcGqz5WMr8xFlYpbk6gzaBRQISVjJU',
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const slickPayload = {
      amount: Number(rpcData.total_payable),
      url: "https://striviodz.store/thank-you.html",
      return_url: "https://striviodz.store/thank-you.html",
      success_url: "https://striviodz.store/thank-you.html",
      firstname: orderData.customer_info?.firstname || "Strivio",
      lastname: orderData.customer_info?.lastname || "Client",
      email: orderData.customer_info?.email || "client@striviodz.store",
      phone: orderData.customer_info?.phone || "0550000000",
      address: orderData.customer_info?.address || "Algeria",
      items: (orderData.items || []).map(function(item) {
        return {
          name: (item.nameData && item.nameData.ar) ? item.nameData.ar : (item.name || 'Subscription'),
          price: Number(item.unitPrice || item.price || 0),
          quantity: Number(item.qty || 1),
          qty: Number(item.qty || 1)
        };
      })
    };

    try {
      let slickResponse = await fetch("https://prodapi.slick-pay.com/api/v2/users/invoices", {
        method: 'POST',
        headers: slickHeaders,
        body: JSON.stringify(slickPayload)
      });

      if (!slickResponse.ok) {
        console.warn('⚠️ prodapi failed with status', slickResponse.status, '- trying api.slick-pay.com...');
        slickResponse = await fetch("https://api.slick-pay.com/api/v2/users/invoices", {
          method: 'POST',
          headers: slickHeaders,
          body: JSON.stringify(slickPayload)
        });
      }

      const slickResult = await slickResponse.json();
      console.log('📦 SlickPay API response:', slickResult);

      const invoiceData = slickResult.data || slickResult;
      const paymentId = invoiceData.id ? String(invoiceData.id) : (invoiceData.invoice_id ? String(invoiceData.invoice_id) : null);
      const paymentUrl = invoiceData.url || invoiceData.payment_url || invoiceData.redirect_url || invoiceData.link || null;

      if (!paymentUrl) {
        console.error('❌ SlickPay did not return a valid payment_url:', slickResult);
        return rpcData;
      }

      // 4. تحديث سجل الطلب في جدول orders بـ payment_id و payment_url
      if (rpcData.order_id && paymentId) {
        const { error: updateErr } = await supabaseClient
          .from('orders')
          .update({
            payment_id: paymentId,
            payment_url: paymentUrl
          })
          .eq('id', rpcData.order_id);

        if (updateErr) {
          console.warn('⚠️ Could not update order with SlickPay info:', updateErr.message);
        } else {
          console.log('✅ Order updated in DB with SlickPay payment ID and URL.');
        }
      }

      // 5. إضافة payment_url إلى rpcData وإرجاعه
      rpcData.payment_url = paymentUrl;
      return rpcData;

    } catch (slickErr) {
      console.error('❌ Error calling SlickPay API:', slickErr);
      return rpcData;
    }

  } catch (e) {
    console.error('❌ Exception saving order:', e);
    return null;
  }
}

/* جلب الإعدادات (روابط التواصل وأرقام الهاتف) من قاعدة البيانات */
async function loadSettingsFromDB() {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient.from('settings').select('config').eq('id', 1).single();
    if (!error && data && data.config) {
      window.CONFIG = data.config;
      return data.config;
    }
    return null;
  } catch (e) {
    console.error('❌ Exception loading settings:', e);
    return null;
  }
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
    console.error('❌ Exception loading reviews:', e);
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
      console.error('❌ Error loading faqs from Supabase:', error.message);
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
    console.error('❌ Exception loading faqs:', e);
    return [];
  }
}

// تهيئة الاتصال عند تحميل الملف
initSupabase();

