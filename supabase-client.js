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

/* جلب أكواد الخصم النشطة من قاعدة البيانات */
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

/* حفظ طلب العميل في قاعدة البيانات عند الضغط على تأكيد الطلب */
async function saveOrderToDB(orderData) {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) {
    console.warn('⚠️ Cannot save order to DB: Supabase client not initialized.');
    return null;
  }

  try {
    const { data, error } = await supabaseClient
      .from('orders')
      .insert([orderData])
      .select();

    if (error) {
      console.error('❌ Error saving order to Supabase:', error.message);
      return null;
    }

    console.log('✅ Order saved to Supabase DB successfully:', data);
    return data && data[0] ? data[0] : true;
  } catch (e) {
    console.error('❌ Exception saving order:', e);
    return null;
  }
}

// تهيئة الاتصال عند تحميل الملف
initSupabase();
