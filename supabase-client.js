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
        n: s.n,
        f: s.f,
        types: s.types || null,
        p: s.p,
        typePrices: s.type_prices || null
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

/* حفظ طلب العميل في قاعدة البيانات بأمان تام عبر السيرفر */
async function saveOrderToDB(orderData) {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) {
    console.warn('⚠️ Cannot save order to DB: Supabase client not initialized.');
    return null;
  }

  try {
    // الاتصال بدالة السيرفر الآمنة RPC لحساب السعر وإنشاء الطلب
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('create_order_secure', {
      p_items: orderData.items || [],
      p_payment_method: orderData.payment_method || 'cib',
      p_coupon_code: orderData.coupon_code || null,
      p_customer_info: orderData.customer_info || {}
    });

    if (!rpcError && rpcData && rpcData.success) {
      console.log('✅ Order created securely via RPC:', rpcData);
      return rpcData;
    }

    if (rpcError) {
      console.error('❌ Error saving order via RPC:', rpcError.message);
    } else if (rpcData && !rpcData.success) {
      console.error('❌ RPC returned failure:', rpcData.error || 'Unknown error');
      return rpcData;
    }

    return null;
  } catch (e) {
    console.error('❌ Exception saving order:', e);
    return null;
  }
}

// تهيئة الاتصال عند تحميل الملف
initSupabase();
