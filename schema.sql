-- ====================================================================
-- STRIVIO STORE - SUPABASE DATABASE SCHEMA & MIGRATION
-- ====================================================================
-- انسخ هذا الكود بالكامل وضعه في محرر الـ SQL (SQL Editor) في حسابك على Supabase
-- ثم اضغط على زر Run لمرة واحدة لإنشاء الجداول وإدخال جميع المنتجات والأسعار
-- ====================================================================

-- 1. إنشاء جدول الخدمات والمنتجات (services)
CREATE TABLE IF NOT EXISTS public.services (
  id TEXT PRIMARY KEY,
  cat TEXT NOT NULL,
  pop TEXT,
  show_types BOOLEAN DEFAULT false,
  bg TEXT,
  icon_type TEXT,
  icon_size INTEGER,
  icon_src TEXT,
  n JSONB NOT NULL,
  f JSONB NOT NULL,
  types JSONB,
  p JSONB NOT NULL,
  type_prices JSONB,
  promo JSONB,
  out_of_stock JSONB,
  best_value INTEGER DEFAULT 2,
  sort_order INTEGER DEFAULT 0
);

-- التحديث التلقائي للجداول الموجودة مسبقاً (Migration)
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS promo JSONB;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS out_of_stock JSONB;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS best_value INTEGER DEFAULT 2;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS pop TEXT;

-- 2. إنشاء جدول أكواد الخصم (coupons)
CREATE TABLE IF NOT EXISTS public.coupons (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'pct' or 'fixed'
  val NUMERIC NOT NULL,
  active BOOLEAN DEFAULT true
);

-- 3. إنشاء جدول طلبات العملاء (orders)
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  items JSONB NOT NULL,
  subtotal NUMERIC NOT NULL,
  discount NUMERIC DEFAULT 0,
  coupon_code TEXT,
  flexy_fee NUMERIC DEFAULT 0,
  total_payable NUMERIC NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'paid', 'completed', 'cancelled'
  customer_info JSONB
);

-- ====================================================================
-- تفعيل سياسات الأمان (Row Level Security - RLS) و الدوال الآمنة (RPC)
-- ====================================================================

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access on services" ON public.services;
CREATE POLICY "Allow public read access on services"
  ON public.services FOR SELECT
  USING (true);

-- منع العامة تماماً من قراءة أو تعديل جدول الكوبونات (لا توجد سياسة SELECT للعامة)
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access on active coupons" ON public.coupons;

-- منع العامة من الإضافة المباشرة في جدول الطلبات (تتم الإضافة فقط عبر دالة الـ RPC الآمنة)
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public insert on orders" ON public.orders;

-- ====================================================================
-- صلاحيات المدير (الذي يسجل دخوله بحساب Supabase Auth)
-- ====================================================================
DROP POLICY IF EXISTS "Allow admin full access on services" ON public.services;
CREATE POLICY "Allow admin full access on services"
  ON public.services FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow admin full access on coupons" ON public.coupons;
CREATE POLICY "Allow admin full access on coupons"
  ON public.coupons FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow admin full access on orders" ON public.orders;
CREATE POLICY "Allow admin full access on orders"
  ON public.orders FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ====================================================================
-- دوال السيرفر الآمنة (Backend RPC Functions) - حماية 100% ضد التلاعب
-- ====================================================================

-- 1. دالة التحقق الآمن من الكوبون في الباك اند دون كشف القائمة للعامة
CREATE OR REPLACE FUNCTION public.validate_coupon(
  p_code TEXT,
  p_subtotal NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_val NUMERIC;
  v_type TEXT;
  v_disc NUMERIC := 0;
BEGIN
  IF p_code IS NULL OR LENGTH(TRIM(p_code)) = 0 THEN
    RETURN jsonb_build_object('valid', false, 'message', 'الكوبون فارغ');
  END IF;

  SELECT val, type INTO v_val, v_type
  FROM public.coupons
  WHERE UPPER(code) = UPPER(TRIM(p_code)) AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'message', 'كود الخصم غير صحيح أو غير فعال');
  END IF;

  IF v_type = 'pct' THEN
    v_disc := ROUND((p_subtotal * v_val) / 100);
  ELSE
    v_disc := LEAST(p_subtotal, v_val);
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', UPPER(TRIM(p_code)),
    'discount', v_disc,
    'type', v_type,
    'val', v_val
  );
END;
$$;

-- 2. دالة إتمام الطلب وحساب السعر الحقيقي في الباك اند (منع التلاعب بالأسعار)
CREATE OR REPLACE FUNCTION public.create_order_secure(
  p_items JSONB,
  p_payment_method TEXT,
  p_coupon_code TEXT DEFAULT NULL,
  p_customer_info JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subtotal NUMERIC := 0;
  v_discount NUMERIC := 0;
  v_sub_after_disc NUMERIC := 0;
  v_flexy_fee NUMERIC := 0;
  v_total_payable NUMERIC := 0;
  v_coupon_val NUMERIC;
  v_coupon_type TEXT;
  v_order_id UUID;
  v_item JSONB;
  v_service_id TEXT;
  v_dur_idx INTEGER;
  v_type_idx INTEGER;
  v_qty INTEGER;
  v_unit_price NUMERIC;
  v_service_record RECORD;
  v_verified_items JSONB := '[]'::jsonb;
  v_verified_item JSONB;
BEGIN
  -- 1. حساب السعر الحقيقي لكل منتج من جدول الخدمات في السيرفر
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_service_id := v_item->>'id';
    v_dur_idx := COALESCE((v_item->>'durIdx')::int, 0);
    v_type_idx := COALESCE((v_item->>'typeIdx')::int, 0);
    v_qty := COALESCE((v_item->>'qty')::int, 1);
    IF v_qty < 1 THEN v_qty := 1; END IF;
    
    SELECT * INTO v_service_record FROM public.services WHERE id = v_service_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Service % not found', v_service_id;
    END IF;

    -- تحديد سعر الوحدة المعتمد في السيرفر
    IF v_service_record.type_prices IS NOT NULL AND jsonb_array_length(v_service_record.type_prices) > v_type_idx THEN
      v_unit_price := ((v_service_record.type_prices->v_type_idx)->>v_dur_idx)::numeric;
    ELSE
      v_unit_price := (v_service_record.p->>v_dur_idx)::numeric;
    END IF;

    IF v_unit_price IS NULL THEN
      v_unit_price := 0;
    END IF;

    v_subtotal := v_subtotal + (v_unit_price * v_qty);

    v_verified_item := jsonb_build_object(
      'id', v_service_id,
      'title', COALESCE(v_item->>'name', v_item->>'title', v_service_record.n->>'ar'),
      'durIdx', v_dur_idx,
      'durLabel', COALESCE(v_item->>'durLabel', ''),
      'typeIdx', v_type_idx,
      'typeLabel', COALESCE(v_item->>'typeLabel', ''),
      'qty', v_qty,
      'unitPrice', v_unit_price,
      'price', v_unit_price * v_qty
    );
    v_verified_items := v_verified_items || v_verified_item;
  END LOOP;

  -- 2. التحقق من الكوبون وحساب الخصم
  IF p_coupon_code IS NOT NULL AND LENGTH(TRIM(p_coupon_code)) > 0 THEN
    SELECT val, type INTO v_coupon_val, v_coupon_type
    FROM public.coupons
    WHERE UPPER(code) = UPPER(TRIM(p_coupon_code)) AND active = true;
    
    IF FOUND THEN
      IF v_coupon_type = 'pct' THEN
        v_discount := ROUND((v_subtotal * v_coupon_val) / 100);
      ELSE
        v_discount := LEAST(v_subtotal, v_coupon_val);
      END IF;
    END IF;
  END IF;

  v_sub_after_disc := GREATEST(0, v_subtotal - v_discount);

  -- 3. حساب رسوم فليكسي (19%)
  IF p_payment_method = 'flexy' THEN
    v_flexy_fee := ROUND(v_sub_after_disc * 0.19);
  ELSE
    v_flexy_fee := 0;
  END IF;

  v_total_payable := v_sub_after_disc + v_flexy_fee;

  -- 4. إدراج الطلب الموثق في قاعدة البيانات
  INSERT INTO public.orders (
    items,
    subtotal,
    discount,
    coupon_code,
    flexy_fee,
    total_payable,
    payment_method,
    status,
    customer_info
  ) VALUES (
    v_verified_items,
    v_subtotal,
    v_discount,
    p_coupon_code,
    v_flexy_fee,
    v_total_payable,
    p_payment_method,
    'pending',
    p_customer_info
  ) RETURNING id INTO v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'flexy_fee', v_flexy_fee,
    'total_payable', v_total_payable
  );
END;
$$;

-- ====================================================================
-- إدخال بيانات الخدمات والمنتجات الـ 13 (مع أسعار الشاشات و الـ IPTV)
-- ====================================================================

INSERT INTO public.services (id, cat, pop, show_types, bg, icon_type, icon_size, icon_src, n, f, types, p, type_prices, sort_order)
VALUES
(
  'spotify', 'music', 'popular', false,
  'linear-gradient(145deg,#0d2e12,#081a0a)', 'svg', 72,
  '<svg viewBox="0 0 24 24"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" fill="#1DB954"/></svg>',
  '{"en": "Spotify Premium", "fr": "Spotify Premium", "ar": "سبوتيفاي بريميوم"}',
  '{"en": ["Offline Downloads", "No Ads", "Full Warranty"], "fr": ["Télécharg. Hors Ligne", "Sans Publicités", "Garantie Complète"], "ar": ["تحميل بدون إنترنت", "بدون إعلانات", "ضمان كامل"]}',
  '{"en": ["Individual Account", "Family Plan (6 Accs)", "Duo Plan"], "fr": ["Compte Individuel", "Plan Famille (6 Comptes)", "Plan Duo"], "ar": ["حساب فردي", "باقة العائلة (6 حسابات)", "باقة ثنائية"]}',
  '[700, 1300, 1900, 3500, 6500]',
  '[[700, 1300, 1900, 3500, 6500], [1200, 2200, 3200, 6000, 11000], [900, 1700, 2500, 4500, 8500]]',
  1
),
(
  'netflix', 'streaming', 'hot', true,
  'linear-gradient(145deg,#2d0a0a,#1a0505)', 'svg', 72,
  '<svg viewBox="10 0 500 520"><linearGradient id="a_netflix" gradientUnits="userSpaceOnUse" x1="108.142" x2="176.518" y1="240.643" y2="189.038"><stop offset="0" stop-color="#c20000" stop-opacity="0"/><stop offset="1" stop-color="#9d0000"/></linearGradient><linearGradient id="b_netflix" x1="400.786" x2="338.861" xlink:href="#a_netflix" y1="312.035" y2="337.837"/><path d="m216.398 16h-91.87v480c30.128-7.135 61.601-10.708 91.87-12.052z" fill="#c20000"/><path d="m216.398 16h-91.87v367.267c30.128-7.135 61.601-10.707 91.87-12.051z" fill="url(#a_netflix)"/><path d="m387.472 496v-480h-91.87v468.904c53.636 3.416 91.87 11.096 91.87 11.096z" fill="#c20000"/><path d="m387.472 496v-318.555h-91.87v307.459c53.636 3.416 91.87 11.096 91.87 11.096z" fill="url(#b_netflix)"/><path d="m387.472 496-171.074-480h-91.87l167.03 468.655c55.75 3.276 95.914 11.345 95.914 11.345z" fill="#fa0000"/></svg>',
  '{"en": "Netflix Premium", "fr": "Netflix Premium", "ar": "نتفليكس بريميوم"}',
  '{"en": ["4K Ultra HD", "Private Screen", "Full Warranty"], "fr": ["4K Ultra HD", "Écran Privé", "Garantie Complète"], "ar": ["4K الترا HD", "شاشة خاصة", "ضمان كامل"]}',
  '{"en": ["1 Screen", "2 Screens", "3 Screens", "4 Screens", "5 Screens"], "fr": ["1 Écran", "2 Écrans", "3 Écrans", "4 Écrans", "5 Écrans"], "ar": ["شاشة واحدة", "شاشتان", "3 شاشات", "4 شاشات", "5 شاشات"]}',
  '[1500, 2800, 4000, 7500, 14000]',
  '[[1500, 2800, 4000, 7500, 14000], [2800, 5200, 7500, 14000, 26000], [4000, 7500, 11000, 20000, 38000], [5200, 9800, 14500, 27000, 50000], [6500, 12000, 18000, 33000, 62000]]',
  2
),
(
  'chatgpt', 'ai', 'trending', false,
  'linear-gradient(145deg,#061610,#030c08)', 'svg', 72,
  '<svg viewBox="-0.17090198558635983 0.482230148717937 41.14235318283891 40.0339509076386"><path d="M37.532 16.87a9.963 9.963 0 0 0-.856-8.184 10.078 10.078 0 0 0-10.855-4.835A9.964 9.964 0 0 0 18.306.5a10.079 10.079 0 0 0-9.614 6.977 9.967 9.967 0 0 0-6.664 4.834 10.08 10.08 0 0 0 1.24 11.817 9.965 9.965 0 0 0 .856 8.185 10.079 10.079 0 0 0 10.855 4.835 9.965 9.965 0 0 0 7.516 3.35 10.078 10.078 0 0 0 9.617-6.981 9.967 9.967 0 0 0 6.663-4.834 10.079 10.079 0 0 0-1.243-11.813zM22.498 37.886a7.474 7.474 0 0 1-4.799-1.735c.061-.033.168-.091.237-.134l7.964-4.6a1.294 1.294 0 0 0 .655-1.134V19.054l3.366 1.944a.12.12 0 0 1 .066.092v9.299a7.505 7.505 0 0 1-7.49 7.496zm-16.106-6.88a7.471 7.471 0 0 1-.894-5.023c.06.036.162.099.237.141l7.964 4.6a1.297 1.297 0 0 0 1.308 0l9.724-5.614v3.888a.12.12 0 0 1-.048.103l-8.051 4.649a7.504 7.504 0 0 1-10.24-2.744zM4.297 13.62A7.469 7.469 0 0 1 8.2 10.333c0 .068-.004.19-.004.274v9.201a1.294 1.294 0 0 0 .654 1.132l9.723 5.614-3.366 1.944a.12.12 0 0 1-.114.01L7.04 23.856a7.504 7.504 0 0 1-2.743-10.237zm27.658 6.437l-9.724-5.615 3.367-1.943a.121.121 0 0 1 .113-.01l8.052 4.648a7.498 7.498 0 0 1-1.158 13.528v-9.476a1.293 1.293 0 0 0-.65-1.132zm3.35-5.043a7.395 7.395 0 0 0-.236-.141l-7.965-4.6a1.298 1.298 0 0 0-1.308 0l-9.723 5.614v-3.888a.12.12 0 0 1 .048-.103l8.05-4.645a7.497 7.497 0 0 1 11.135 7.763zm-21.063 6.929l-3.367-1.944a.12.12 0 0 1-.065-.092v-9.299a7.497 7.497 0 0 1 12.293-5.756 6.94 6.94 0 0 0-.236.134l-7.965 4.6a1.294 1.294 0 0 0-.654 1.132l-.006 11.225zM16.071 18l4.33-2.501 4.332 2.5v5l-4.331 2.5-4.331-2.5V18z" fill="#10a37f"/></svg>',
  '{"en": "ChatGPT Plus", "fr": "ChatGPT Plus", "ar": "شات جي بي تي بلس"}',
  '{"en": ["GPT 5.5 Access", "DALL·E 3 Images", "Full Warranty"], "fr": ["Accès GPT 5.5", "Images DALL·E 3", "Garantie Complète"], "ar": ["وصول GPT 5.5", "صور DALL·E 3", "ضمان كامل"]}',
  '{"en": ["Shared Account (Plus)", "Private Account (Plus)", "Team Workspace"], "fr": ["Compte Partagé (Plus)", "Compte Privé (Plus)", "Espace Équipe"], "ar": ["حساب مشترك (Plus)", "حساب خاص بك (Plus)", "مساحة فريق / شركات"]}',
  '[2000, 3800, 5500, 10000, 19000]',
  '[[2000, 3800, 5500, 10000, 19000], [3500, 6800, 9800, 18000, 34000], [7000, 13500, 19000, 35000, 65000]]',
  3
),
(
  'gemini', 'ai', null, false,
  'linear-gradient(145deg,#0d0820,#06041a)', 'svg', 72,
  '<svg viewBox="-3 -3 34 34"><radialGradient id="gemini_grad" cx="-576.08" cy="491.7" gradientTransform="matrix(28.2302 9.54441 76.4642 -226.16369 -21336.18 116711.38)" gradientUnits="userSpaceOnUse" r="1"><stop offset=".07" stop-color="#9168c0"/><stop offset=".34" stop-color="#5684d1"/><stop offset=".67" stop-color="#1ba1e3"/></radialGradient><path d="M14 28c0-1.94-.37-3.76-1.12-5.46-.72-1.7-1.72-3.19-2.98-4.45s-2.74-2.25-4.44-2.97C3.76 14.37 1.94 14 0 14c1.94 0 3.76-.36 5.46-1.09 1.7-.75 3.19-1.75 4.44-3.01 1.26-1.26 2.25-2.74 2.98-4.44C13.63 3.76 14 1.94 14 0c0 1.94.36 3.76 1.09 5.46.75 1.7 1.75 3.19 3.01 4.44 1.26 1.26 2.74 2.26 4.45 3.01 1.7.72 3.52 1.09 5.46 1.09-1.94 0-3.76.37-5.46 1.12-1.7.72-3.19 1.71-4.45 2.97s-2.26 2.74-3.01 4.45A13.86 13.86 0 0 0 14 28z" fill="url(#gemini_grad)"/></svg>',
  '{"en": "Gemini Pro", "fr": "Gemini Pro", "ar": "جيميني برو"}',
  '{"en": ["Gemini Advanced AI", "5TB Google Drive", "Full Warranty"], "fr": ["Gemini Advanced", "5To Google Drive", "Garantie Complète"], "ar": ["جيميني أدفانسد", "5TB تخزين جوجل", "ضمان كامل"]}',
  '{"en": ["Shared Pro Account", "Private Google Account (5TB)"], "fr": ["Compte Pro Partagé", "Compte Google Privé (5To)"], "ar": ["حساب برو مشترك", "حساب جوجل خاص (5TB)"]}',
  '[1800, 3400, 5000, 9000, 17000]',
  '[[1800, 3400, 5000, 9000, 17000], [3200, 6000, 8800, 16000, 30000]]',
  4
),
(
  'snapchat', 'social', null, false,
  'linear-gradient(145deg,#1f1c00,#141300)', 'svg', 72,
  '<svg viewBox="-1.5 -1.5 27 27"><path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301.165-.088.344-.104.464-.104.182 0 .359.029.509.09.45.149.734.479.734.838.015.449-.39.839-1.213 1.168-.089.029-.209.075-.344.119-.45.135-1.139.36-1.333.81-.09.224-.061.524.12.868l.015.015c.06.136 1.526 3.475 4.791 4.014.255.044.435.27.42.509 0 .075-.015.149-.045.225-.24.569-1.273.988-3.146 1.271-.059.091-.12.375-.164.57-.029.179-.074.36-.134.553-.076.271-.27.405-.555.405h-.03c-.135 0-.313-.031-.538-.074-.36-.075-.765-.135-1.273-.135-.3 0-.599.015-.913.074-.6.104-1.123.464-1.723.884-.853.599-1.826 1.288-3.294 1.288-.06 0-.119-.015-.18-.015h-.149c-1.468 0-2.427-.675-3.279-1.288-.599-.42-1.107-.779-1.707-.884-.314-.045-.629-.074-.928-.074-.54 0-.958.089-1.272.149-.211.043-.391.074-.54.074-.374 0-.523-.224-.583-.42-.061-.192-.09-.389-.135-.567-.046-.181-.105-.494-.166-.57-1.918-.222-2.95-.642-3.189-1.226-.031-.063-.052-.15-.055-.225-.015-.243.165-.465.42-.509 3.264-.54 4.73-3.879 4.791-4.02l.016-.029c.18-.345.224-.645.119-.869-.195-.434-.884-.658-1.332-.809-.121-.029-.24-.074-.346-.119-1.107-.435-1.257-.93-1.197-1.273.09-.479.674-.793 1.168-.793.146 0 .27.029.383.074.42.194.789.3 1.104.3.234 0 .384-.06.465-.105l-.046-.569c-.098-1.626-.225-3.651.307-4.837C7.392 1.077 10.739.807 11.727.807l.419-.015h.06z" fill="#FFFC00"/></svg>',
  '{"en": "Snapchat+", "fr": "Snapchat+", "ar": "سناب شات بلس"}',
  '{"en": ["Exclusive Features", "Priority Support", "Full Warranty"], "fr": ["Fonctionnalités Exclusives", "Support Prioritaire", "Garantie Complète"], "ar": ["ميزات حصرية", "دعم أولوية", "ضمان كامل"]}',
  '{"en": ["Standard Snapchat+", "VIP Priority Badge"], "fr": ["Snapchat+ Standard", "Badge VIP Prioritaire"], "ar": ["سناب شات+ قياسي", "شارة VIP أولوية"]}',
  '[600, 1100, 1600, 3000, 5500]',
  '[[600, 1100, 1600, 3000, 5500], [900, 1600, 2400, 4500, 8000]]',
  5
),
(
  'crunchyroll', 'streaming', null, false,
  'linear-gradient(145deg,#1e0900,#120600)', 'svg', 72,
  '<svg viewBox="-1.5 -1.5 27 27"><path d="M2.909 13.436C2.914 7.61 7.642 2.893 13.468 2.898c5.576.005 10.137 4.339 10.51 9.819q.021-.351.022-.706C24.007 5.385 18.64.006 12.012 0S.007 5.36 0 11.988 5.36 23.994 11.988 24q.412 0 .815-.027c-5.526-.338-9.9-4.928-9.894-10.538Zm16.284.155a4.1 4.1 0 0 1-4.095-4.103 4.1 4.1 0 0 1 2.712-3.855 8.95 8.95 0 0 0-4.187-1.037 9.007 9.007 0 1 0 8.997 9.016q-.001-.847-.15-1.651a4.1 4.1 0 0 1-3.278 1.63Z" fill="#F47521"/></svg>',
  '{"en": "Crunchyroll Premium", "fr": "Crunchyroll Premium", "ar": "كرانشيرول بريميوم"}',
  '{"en": ["Ad-Free Anime", "Simulcast Access", "Full Warranty"], "fr": ["Animés Sans Pub", "Accès Simulcast", "Garantie Complète"], "ar": ["أنيمي بدون إعلانات", "Simulcast", "ضمان كامل"]}',
  '{"en": ["Mega Fan (4 Screens)", "Fan Plan (1 Screen)"], "fr": ["Mega Fan (4 Écrans)", "Plan Fan (1 Écran)"], "ar": ["ميغا فان (4 شاشات)", "باقة فان (شاشة واحدة)"]}',
  '[900, 1700, 2400, 4500, 8500]',
  '[[900, 1700, 2400, 4500, 8500], [600, 1100, 1600, 3000, 5500]]',
  6
),
(
  'canva', 'creative', null, false,
  'linear-gradient(145deg,#150828,#0a1218)', 'svg', 72,
  '<svg viewBox="1 1 22 22"><radialGradient id="canva_perfect_grad" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="rotate(-99.876 15.767 3.818) scale(15.6209 21.2069)"><stop offset=".2" stop-color="#7D2AE8"/><stop offset=".5" stop-color="#5A32FA"/><stop offset=".971" stop-color="#00C4CC"/></radialGradient><path fill="url(#canva_perfect_grad)" d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20"/><path d="M6.287 5.33a.225.225 0 0 1 .414 0l.263.612c.2.465.571.835 1.036 1.036l.611.263a.225.225 0 0 1 0 .413l-.61.264c-.466.2-.837.57-1.037 1.036l-.263.61a.225.225 0 0 1-.414 0l-.263-.61a1.98 1.98 0 0 0-1.036-1.036l-.611-.264a.225.225 0 0 1 0-.413l.61-.263c.466-.2.837-.571 1.037-1.036l.263-.611Z" fill="#fff"/><path d="M13.118 5.496c2.04 0 3.254 1.027 3.254 2.423 0 1.44-1.041 2.46-1.928 2.46-.22 0-.332-.108-.332-.287 0-.399.642-.998.642-2.13 0-.952-.581-1.55-1.534-1.55-2.04 0-4.361 2.409-4.361 6.575 0 2.46 1.222 4.24 3.194 4.24 1.706 0 3.18-1.224 4.033-2.954.076-.153.148-.223.23-.223.12 0 .235.103.235.327 0 1.01-1.81 4.123-4.938 4.123-2.949 0-4.86-2.21-4.86-5.557 0-.742.09-1.448.254-2.11a6 6 0 0 1 .262-.787c.195-.421.608-1.167 1.061-1.362l.612-.263c.642-.277.8-1.031.475-1.544 1.062-.88 2.351-1.38 3.701-1.38ZM4.108 9.169a.145.145 0 0 1 .266 0l.17.394c.13.3.369.54.67.669l.393.17a.145.145 0 0 1 0 .267l-.394.17c-.3.129-.54.368-.669.668l-.17.395a.145.145 0 0 1-.266 0l-.17-.395a1.28 1.28 0 0 0-.67-.668l-.394-.17a.145.145 0 0 1 0-.267l.395-.17c.3-.13.54-.369.669-.67z" fill="#fff"/></svg>',
  '{"en": "Canva Pro", "fr": "Canva Pro", "ar": "كانفا برو"}',
  '{"en": ["All Pro Features", "Brand Kit", "Full Warranty"], "fr": ["Toutes les Fonctions Pro", "Brand Kit", "Garantie Complète"], "ar": ["كل مزايا Pro", "Brand Kit", "ضمان كامل"]}',
  '{"en": ["Pro Invitation (Your Email)", "Private Pro Account", "Team Admin License"], "fr": ["Invitation Pro (Votre Email)", "Compte Pro Privé", "Licence Admin Équipe"], "ar": ["دعوة Pro (بريدك الشخصي)", "حساب Pro خاص", "ترخيص مسؤول فريق"]}',
  '[1200, 2200, 3200, 6000, 11000]',
  '[[1200, 2200, 3200, 6000, 11000], [2000, 3800, 5500, 10000, 18000], [4500, 8500, 12000, 22000, 40000]]',
  7
),
(
  'capcut', 'creative', null, false,
  'linear-gradient(145deg,#0a0a0a,#101010)', 'svg', 72,
  '<svg viewBox="-1 -1 26 26" fill="#ffffff" fill-rule="evenodd"><path d="M24.189 6.442V2.671l-4.535 2.383V4.91c.002-1.505-1.078-2.411-2.638-2.411H2.64C.993 2.5 0 3.407 0 4.91V8.72L6.354 12 0 15.316v3.8C0 20.595 1 21.5 2.64 21.5h14.373c1.56 0 2.639-.907 2.639-2.382v-.197l4.536 2.409v-3.828L13.64 12 24.19 6.443zM9.982 13.873l7.797 4.083H2.157l7.825-4.083zm7.741-7.828l-7.742 4.057-7.825-4.057h15.567z"/></svg>',
  '{"en": "CapCut Pro", "fr": "CapCut Pro", "ar": "كاب كات برو"}',
  '{"en": ["AI Editing Tools", "No Watermark", "Full Warranty"], "fr": ["Outils IA Édition", "Sans Filigrane", "Garantie Complète"], "ar": ["أدوات تحرير AI", "بدون علامة مائية", "ضمان كامل"]}',
  '{"en": ["Pro Shared Account", "Private Pro Account"], "fr": ["Compte Pro Partagé", "Compte Pro Privé"], "ar": ["حساب برو مشترك", "حساب برو خاص"]}',
  '[800, 1500, 2100, 3900, 7200]',
  '[[800, 1500, 2100, 3900, 7200], [1500, 2800, 4000, 7500, 14000]]',
  8
),
(
  'prime', 'streaming', null, false,
  'linear-gradient(145deg,#001828,#001020)', 'svg', 72,
  '<svg viewBox="1 3 46 42"><path fill="#29b6f6" d="M31.473,14.813c0.273-0.163,0.556-0.339,0.852-0.492c0.765-0.392,1.616-0.59,2.481-0.547c0.623,0.034,1.192,0.208,1.628,0.666c0.416,0.426,0.568,0.95,0.613,1.518c0.011,0.121,0.011,0.24,0.011,0.371v5.658c0,0.492-0.066,0.556-0.556,0.556H35.17c-0.087,0-0.174,0-0.263-0.011c-0.13-0.011-0.24-0.121-0.263-0.25c-0.023-0.121-0.023-0.24-0.023-0.36v-5.059c0.011-0.208-0.011-0.403-0.066-0.6c-0.087-0.339-0.392-0.579-0.742-0.6c-0.645-0.043-1.289,0.087-1.879,0.361c-0.087,0.023-0.142,0.11-0.13,0.197v5.747c0,0.11,0,0.208-0.023,0.316c0,0.153-0.121,0.263-0.273,0.263l0,0c-0.163,0.011-0.327,0.011-0.503,0.011h-1.158c-0.403,0-0.492-0.099-0.492-0.503v-5.168c0-0.186-0.011-0.384-0.053-0.568c-0.076-0.371-0.392-0.634-0.765-0.655c-0.655-0.043-1.321,0.087-1.913,0.371c-0.087,0.023-0.142,0.121-0.121,0.208v5.823c0,0.403-0.087,0.492-0.492,0.492h-1.465c-0.384,0-0.479-0.11-0.479-0.479v-7.583c0-0.087,0.011-0.174,0.034-0.263c0.043-0.13,0.174-0.208,0.305-0.208h1.366c0.197,0,0.316,0.121,0.384,0.305c0.053,0.153,0.087,0.297,0.142,0.46c0.11,0,0.174-0.076,0.25-0.121c0.6-0.371,1.234-0.689,1.945-0.819c0.547-0.11,1.092-0.11,1.639,0c0.513,0.11,0.973,0.416,1.268,0.852c0.023,0.034,0.043,0.053,0.066,0.076C31.452,14.79,31.462,14.79,31.473,14.813z M15.327,15.229c0.076-0.023,0.142-0.066,0.186-0.13c0.197-0.197,0.403-0.384,0.623-0.556c0.568-0.437,1.279-0.655,1.989-0.6c0.284,0.011,0.384,0.099,0.403,0.371c0.023,0.371,0.011,0.753,0.011,1.126c0.011,0.153,0,0.297-0.023,0.448c-0.043,0.197-0.121,0.273-0.316,0.297c-0.153,0.011-0.297,0-0.448-0.011c-0.732-0.066-1.442,0.076-2.131,0.305c-0.153,0.053-0.153,0.163-0.153,0.284v5.241c0,0.099,0,0.186-0.011,0.284c-0.011,0.142-0.121,0.25-0.263,0.25c-0.076,0.011-0.163,0.011-0.24,0.011h-1.421c-0.076,0-0.163,0-0.24-0.011c-0.142-0.011-0.25-0.13-0.263-0.273c-0.011-0.087-0.011-0.174-0.011-0.263v-7.43c0-0.503,0.053-0.556,0.556-0.556h1.05c0.284,0,0.416,0.099,0.492,0.371C15.195,14.66,15.261,14.934,15.327,15.229z M19.587,18.265v-3.878c0.011-0.263,0.11-0.361,0.371-0.371c0.568-0.011,1.137-0.011,1.705,0c0.25,0,0.327,0.076,0.35,0.327c0.011,0.099,0.011,0.186,0.011,0.284v7.276c0,0.121-0.011,0.24-0.023,0.36c-0.011,0.142-0.121,0.24-0.263,0.25c-0.066,0.011-0.121,0.011-0.186,0.011h-1.518c-0.053,0-0.099,0-0.153-0.011c-0.153-0.011-0.284-0.13-0.297-0.284c-0.011-0.087-0.011-0.174-0.011-0.263C19.587,20.755,19.587,19.51,19.587,18.265z M20.855,10.104c0.174-0.011,0.35,0.023,0.513,0.076c0.59,0.197,0.895,0.71,0.842,1.376c-0.043,0.568-0.469,1.026-1.039,1.115c-0.24,0.043-0.492,0.043-0.732,0c-0.623-0.121-1.081-0.579-1.039-1.366C19.466,10.53,19.98,10.104,20.855,10.104z M11.404,17.37c-0.043-0.568-0.197-1.126-0.426-1.639c-0.448-0.939-1.137-1.628-2.184-1.868c-1.202-0.263-2.284,0-3.268,0.732c-0.066,0.066-0.142,0.121-0.229,0.163c-0.023-0.011-0.043-0.023-0.043-0.034c-0.034-0.11-0.053-0.218-0.087-0.327c-0.087-0.273-0.197-0.371-0.492-0.371c-0.327,0-0.666,0.011-0.994,0c-0.25-0.011-0.479,0.023-0.655,0.218c0,3.823,0,7.659,0.011,11.47c0.142,0.229,0.36,0.273,0.613,0.263c0.392-0.011,0.787,0,1.179,0c0.689,0,0.689,0,0.689-0.677v-3.113c0-0.076-0.034-0.163,0.043-0.229c0.547,0.426,1.213,0.689,1.902,0.753c0.963,0.099,1.834-0.142,2.568-0.797c0.536-0.492,0.929-1.126,1.137-1.826C11.461,19.194,11.48,18.287,11.404,17.37z M8.793,19.631c-0.076,0.339-0.25,0.645-0.503,0.874c-0.284,0.24-0.634,0.384-1.005,0.384c-0.556,0.034-1.103-0.087-1.595-0.35c-0.121-0.053-0.197-0.174-0.186-0.305v-1.978c0-0.655,0.011-1.312,0-1.966c-0.011-0.153,0.076-0.284,0.218-0.339c0.6-0.284,1.224-0.416,1.879-0.284c0.46,0.066,0.852,0.361,1.039,0.787c0.163,0.35,0.263,0.732,0.284,1.115C8.991,18.265,8.991,18.965,8.793,19.631z M41.045,18.976c0.819,0.153,1.66,0.163,2.481,0.034c0.479-0.066,0.939-0.208,1.366-0.437c0.492-0.284,0.852-0.677,1.005-1.224c0.384-1.376-0.208-2.765-1.639-3.276c-0.7-0.229-1.442-0.305-2.174-0.208c-1.726,0.197-2.85,1.147-3.363,2.797c-0.36,1.126-0.316,2.271-0.023,3.408c0.384,1.453,1.344,2.316,2.797,2.621c0.829,0.186,1.671,0.153,2.502,0.023c0.437-0.076,0.874-0.186,1.289-0.35c0.25-0.099,0.384-0.25,0.371-0.536c-0.011-0.263,0-0.536,0-0.808c0-0.327-0.13-0.426-0.448-0.35c-0.318,0.076-0.623,0.142-0.939,0.208c-0.677,0.142-1.376-0.142-2.055,0.023c-0.929-0.186-1.529-0.982-1.476-1.966C40.837,18.944,40.945,18.953,41.045,18.976z M40.771,17.305c0.034-0.263,0.11-0.513,0.208-0.753c0.327-0.797,1.016-1.071,1.715-1.026c0.197,0.011,0.392,0.053,0.579,0.13c0.284,0.121,0.469,0.384,0.503,0.689c0.034,0.186,0.023,0.384-0.034,0.568c-0.13,0.392-0.448,0.556-0.829,0.634c-0.229,0.053-0.469,0.076-0.71,0.053c-0.426,0-0.863-0.034-1.289-0.099C40.748,17.479,40.748,17.479,40.771,17.305z" fill="#ffffff"/><path d="M25.127,38.063c-0.414-0.011-0.83-0.011-1.242,0c-0.57-0.03-1.14-0.052-1.71-0.093c-1.513-0.115-3.017-0.342-4.487-0.685c-5.09-1.181-9.557-3.555-13.455-7.006c-0.364-0.323-0.705-0.653-1.058-0.986c-0.082-0.074-0.156-0.177-0.197-0.28c-0.063-0.145-0.03-0.301,0.074-0.414c0.104-0.113,0.271-0.156,0.414-0.093c0.093,0.041,0.186,0.082,0.271,0.134c3.722,2.302,7.784,3.98,12.044,4.975c1.431,0.332,2.87,0.59,4.322,0.778c2.083,0.26,4.186,0.353,6.28,0.28c1.129-0.03,2.25-0.134,3.369-0.28c2.612-0.332,5.194-0.923,7.691-1.752c1.316-0.434,2.601-0.934,3.856-1.513c0.186-0.104,0.414-0.134,0.622-0.082c0.342,0.082,0.549,0.434,0.466,0.778c-0.011,0.041-0.03,0.093-0.052,0.134c-0.082,0.156-0.197,0.29-0.342,0.393c-1.192,0.934-2.478,1.752-3.835,2.436c-2.56,1.294-5.298,2.218-8.116,2.747C28.414,37.824,26.777,38,25.127,38.063z M42.946,27.957c0.685,0.022,1.357,0.063,2.02,0.238c0.186,0.052,0.364,0.115,0.538,0.197c0.238,0.093,0.393,0.323,0.425,0.57c0.041,0.29,0.052,0.59,0.03,0.891c-0.134,1.773-0.685,3.482-1.597,5.006c-0.332,0.549-0.735,1.047-1.201,1.483c-0.093,0.093-0.208,0.167-0.332,0.208c-0.197,0.052-0.323-0.052-0.332-0.249c0.011-0.104,0.03-0.208,0.074-0.312c0.364-0.975,0.715-1.938,0.995-2.944c0.167-0.549,0.28-1.108,0.353-1.68c0.022-0.208,0.03-0.414,0.011-0.622c-0.011-0.353-0.238-0.653-0.581-0.757c-0.323-0.104-0.653-0.167-0.995-0.186c-0.954-0.041-1.906,0-2.851,0.125l-1.253,0.156c-0.134,0.011-0.26,0-0.332-0.125c-0.074-0.125-0.041-0.249,0.03-0.373c0.082-0.115,0.186-0.219,0.312-0.29c0.767-0.549,1.628-0.882,2.54-1.099C41.505,28.048,42.22,27.978,42.946,27.957z" fill="#ffffff"/></svg>',
  '{"en": "Prime Video", "fr": "Prime Video", "ar": "برايم فيديو"}',
  '{"en": ["Full HD Streaming", "Private Screen", "Full Warranty"], "fr": ["Streaming Full HD", "Écran Privé", "Garantie Complète"], "ar": ["بث Full HD", "شاشة خاصة", "ضمان كامل"]}',
  '{"en": ["Shared Profile (4K)", "Private Screen (PIN)", "Full Account (6 Profiles)"], "fr": ["Profil Partagé (4K)", "Écran Privé (PIN)", "Compte Complet (6 Profils)"], "ar": ["بروفايل مشترك (4K)", "شاشة خاصة برمز PIN", "حساب كامل (6 بروفايلات)"]}',
  '[900, 1700, 2400, 4500, 8500]',
  '[[900, 1700, 2400, 4500, 8500], [1500, 2800, 4000, 7500, 14000], [2500, 4800, 6800, 12500, 24000]]',
  9
),
(
  'shahid', 'streaming', null, false,
  'linear-gradient(145deg,#05160e,#0b261a)', 'svg', 72,
  '<svg viewBox="-2 -2 52 52" fill="none" stroke="#4fc3af" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.1016" cy="15.0698" r="4.6016"/><circle cx="23.9125" cy="14.9504" r="4.6016"/><circle cx="38.8984" cy="14.9788" r="4.6016"/><path d="M5.3366,33.8726V26.4314H42.8283v11.22H35.0258v-3.857c-9.8857.0189-19.8437.03-29.6888.0783Z"/></svg>',
  '{"en": "Shahid VIP", "fr": "Shahid VIP", "ar": "شاهد VIP"}',
  '{"en": ["Arabic & Gulf Content", "4K HD Quality", "Full Warranty"], "fr": ["Contenu Arabe & Golf", "Qualité 4K HD", "Garantie Complète"], "ar": ["محتوى عربي وخليجي", "جودة 4K HD", "ضمان كامل"]}',
  '{"en": ["VIP Shared Profile", "VIP Private Screen (PIN)", "VIP + Sport Package"], "fr": ["Profil VIP Partagé", "Écran VIP Privé (PIN)", "Pack VIP + Sport"], "ar": ["بروفايل VIP مشترك", "شاشة VIP خاصة برمز PIN", "باقة VIP + رياضة"]}',
  '[1100, 2000, 2900, 5500, 10000]',
  '[[1100, 2000, 2900, 5500, 10000], [1800, 3400, 4800, 9000, 17000], [2200, 4000, 5800, 11000, 20000]]',
  10
),
(
  'tod', 'streaming', null, false,
  'linear-gradient(145deg,#160f02,#261a05)', 'svg', 72,
  '<svg viewBox="50 200 960 550" fill="#FEBC16"><path fill-rule="evenodd" clip-rule="evenodd" d="M800.41,346.09H566.53c-0.04,0-0.07-0.01-0.1-0.01H110.87c-20.24,0-36.64,16.4-36.64,36.64v43.29c0,0.33,0.26,0.59,0.59,0.59h114.83c0.33,0,0.59,0.28,0.59,0.6v306.1c0,0.33,0.28,0.59,0.6,0.59h85.6c0.33,0,0.6-0.26,0.6-0.59V427.2c0-0.33,0.26-0.6,0.59-0.6h101.09c-14.27,19.84-24.84,42.56-30.77,67.25c-0.04,0.16-0.08,0.3-0.1,0.46c-0.3,1.27-0.6,2.56-0.88,3.85c-0.05,0.28-0.12,0.56-0.18,0.84c-0.25,1.18-0.49,2.38-0.71,3.57c-0.08,0.39-0.16,0.77-0.22,1.17c-0.21,1.12-0.41,2.22-0.59,3.33c-0.09,0.49-0.17,0.97-0.25,1.47c-0.16,1.04-0.33,2.07-0.47,3.12c-0.09,0.58-0.16,1.14-0.24,1.72c-0.13,0.98-0.26,1.96-0.38,2.94c-0.08,0.66-0.16,1.31-0.22,1.97c-0.1,0.92-0.21,1.84-0.29,2.76c-0.08,0.75-0.13,1.48-0.2,2.23c-0.08,0.85-0.14,1.69-0.21,2.56c-0.07,0.84-0.1,1.68-0.16,2.53c-0.05,0.76-0.1,1.54-0.13,2.3c-0.05,1-0.08,2.01-0.12,3.01c-0.03,0.63-0.05,1.26-0.07,1.89c-0.04,1.6-0.05,3.22-0.07,4.84c0,0.03,0,0.05,0,0.09c0,15.03,1.58,29.57,4.56,43.44c18.89,87.94,94.66,149.96,190.88,149.96c110.15,0,196.44-85.4,196.44-194.41c0-42.87-12.71-81.64-34.78-113.01l100.86,0.13c69.39,0,116.01,45.36,116.01,112.87c0,68.14-46.62,113.92-116.01,113.92c-30.97,0-56.07,25.1-56.07,56.07v24.45h56.07c119.03,0,205.42-81.33,205.42-193.39C1005.83,427.86,919.44,346.09,800.41,346.09z M540.14,653.42h-0.25c-0.03,0-0.07,0-0.09,0c-0.3,0.01-0.6,0.01-0.91,0.01c-61.54,0-107.95-48.97-107.95-113.93c0-59.32,39.02-105.19,92.84-112.04c0.81-0.1,1.64-0.2,2.45-0.28c3.73-0.39,7.52-0.6,11.38-0.62h0.79c1.02,0.01,2.05,0.03,3.06,0.07c1.52,0.07,3.57,0.16,5.5,0.3c1.38,0.1,2.76,0.25,4.12,0.41c0.64,0.08,1.67,0.22,2.3,0.3c0.04,0,0.08,0,0.12,0.01c53.61,7.51,92.34,53.51,92.34,112.84C645.84,604.44,600.48,652.76,540.14,653.42z"/></svg>',
  '{"en": "TOD", "fr": "TOD", "ar": "تي او دي"}',
  '{"en": ["Sports & Movies", "beIN Sports Access", "Full Warranty"], "fr": ["Sports & Films", "Accès beIN Sports", "Garantie Complète"], "ar": ["رياضة وأفلام", "beIN Sports", "ضمان كامل"]}',
  '{"en": ["Mobile Plan", "Total 4K Package", "beIN Sports Ultimate"], "fr": ["Plan Mobile", "Pack Total 4K", "beIN Sports Ultimate"], "ar": ["باقة الموبايل", "باقة توتال 4K", "باقة beIN Sports الشاملة"]}',
  '[1300, 2400, 3500, 6500, 12000]',
  '[[1300, 2400, 3500, 6500, 12000], [2200, 4000, 5800, 10500, 19000], [3500, 6500, 9500, 18000, 34000]]',
  11
),
(
  'watchit', 'streaming', null, false,
  'linear-gradient(145deg,#020b16,#041424)', 'svg', 72,
  '<svg viewBox="10 -50 1280 800" fill="#FEBC16"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 0 C0.68 -0 1.36 -0.01 2.06 -0.01 C4.32 -0.02 6.59 -0.02 8.85 -0.01 C10.49 -0.01 12.14 -0.02 13.78 -0.02 C18.29 -0.04 22.8 -0.04 27.31 -0.03 C32.18 -0.03 37.05 -0.04 41.91 -0.05 C51.44 -0.07 60.97 -0.08 70.5 -0.08 C78.25 -0.08 85.99 -0.08 93.74 -0.09 C115.69 -0.11 137.64 -0.12 159.6 -0.11 C160.78 -0.11 161.96 -0.11 163.18 -0.11 C164.37 -0.11 165.55 -0.11 166.77 -0.11 C185.99 -0.11 205.2 -0.13 224.41 -0.16 C244.14 -0.19 263.86 -0.2 283.58 -0.2 C294.66 -0.2 305.74 -0.21 316.81 -0.23 C326.24 -0.24 335.66 -0.25 345.09 -0.24 C349.9 -0.23 354.71 -0.23 359.52 -0.25 C363.93 -0.26 368.33 -0.26 372.73 -0.24 C374.32 -0.24 375.92 -0.24 377.51 -0.25 C379.68 -0.27 381.84 -0.26 384.01 -0.24 C385.21 -0.24 386.41 -0.24 387.65 -0.24 C393.75 0.68 397.96 4.74 401.94 9.26 C409.44 22.38 405.52 37.25 402.55 51.19 C401.92 54.13 401.31 57.07 400.71 60.01 C399.21 67.3 397.68 74.59 396.15 81.87 C394.85 88.06 393.56 94.25 392.29 100.44 C391.69 103.33 391.07 106.22 390.46 109.1 C390.09 110.88 389.73 112.65 389.37 114.42 C389.1 115.61 389.1 115.61 388.83 116.83 C387.83 121.87 388.01 125.35 389.94 130.26 C393.68 134.96 397.93 137.79 404 138.5 C411.48 138.32 416.4 133.8 421.94 129.26 C423.21 128.23 424.47 127.21 425.74 126.19 C428.49 123.96 431.22 121.73 433.96 119.49 C438.48 115.8 443.1 112.25 447.74 108.71 C455.38 102.88 462.91 96.9 470.4 90.87 C477.08 85.5 483.84 80.24 490.67 75.05 C496.91 70.29 503.08 65.46 509.24 60.6 C512.13 58.31 515.04 56.04 517.94 53.76 C519.11 52.84 520.27 51.92 521.44 51.01 C531.94 42.76 531.94 42.76 542.44 34.51 C543.31 33.83 543.31 33.83 544.19 33.13 C545.35 32.22 546.51 31.31 547.68 30.39 C551.29 27.56 554.89 24.72 558.49 21.88 C560.27 20.48 562.06 19.08 563.85 17.69 C565.59 16.32 567.33 14.93 569.03 13.52 C579.07 5.37 590.89 0.11 603.77 0.11 C615.59 0.08 627.98 0.04 639.77 0.02 C662.33 -0.01 673.85 -0.03 685.36 -0.03 C725.26 -0.11 756.08 -0.16 791.82 -0.21 C809.4 -0.26 815.62 -0.2 823.73 5.83 C829.6 12.37 831.2 19.47 831.15 28.09 C824.16 65.9 821.54 78.85 815.05 110.29 C813.46 117.37 812.48 122.77 815.5 131.51 C819.07 135.53 822.71 137.92 828.14 138.49 C839.19 137.97 855.89 121.56 866.56 113.13 C879.88 102.82 893.94 91.76 918.44 72.51 C939.44 56.01 960.44 39.51 974.37 28.54 C999.36 8.96 1028.02 -0.01 1059.19 -0.08 C1091.06 -0.11 1133.32 -0.16 1160.08 -0.2 C1191.06 -0.23 1211.95 -0.34 1238.19 12.29 C1246.07 20.52 1249.37 30.28 1249.14 41.6 C1227.88 91.48 1147.81 224.32 1108.74 289.09 C1035.93 410.24 966.94 524.38 898.44 638.26 C873.73 679.32 850.6 713.78 834.59 719.44 C798.78 713.94 769.94 678.26 741.43 630.69 C695.71 554.98 651.94 482.26 615.21 421.14 C604.74 403.37 603.94 402.26 601.94 402.26 C598.31 408.14 589.37 423.64 578.74 441.34 C538.06 508.88 519.43 539.82 490.24 588.28 C468.79 623.93 442.16 668.01 415.94 706.26 C393.42 718.28 379.49 720.53 348.56 704.07 C319.25 657.57 287.52 604.88 254.84 550.56 C197.44 455.26 143.23 365.22 64.13 233.76 C16.26 153.49 -35.75 65.32 -41.44 40.44 C-41.55 27.08 -38.06 19.2 -30.83 11.59 C-22.27 4.38 -11.18 0.01 0 0 Z"/></svg>',
  '{"en": "Watch It", "fr": "Watch It", "ar": "واتش إت"}',
  '{"en": ["Egyptian Drama & Movies", "Exclusive Series", "Full Warranty"], "fr": ["Dramas Égyptiens", "Séries Exclusives", "Garantie Complète"], "ar": ["دراما ومسلسلات مصرية", "مسلسلات حصرية", "ضمان كامل"]}',
  '{"en": ["Standard Profile", "VIP Screen (Ad-Free)"], "fr": ["Profil Standard", "Écran VIP (Sans Pub)"], "ar": ["بروفايل قياسي", "شاشة VIP (بدون إعلانات)"]}',
  '[700, 1300, 1800, 3400, 6200]',
  '[[700, 1300, 1800, 3400, 6200], [1100, 2000, 2900, 5500, 10000]]',
  12
),
(
  'iptv', 'streaming', 'hot', true,
  'linear-gradient(145deg,#240c30,#110419)', 'svg', 72,
  '<svg viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="3"/><polyline points="17 2 12 7 7 2"/></svg>',
  '{"en": "IPTV Subscription", "fr": "Abonnement IPTV", "ar": "اشتراك IPTV"}',
  '{"en": ["4K / FHD Quality", "VOD Movies & Series", "Anti-Freeze Server", "Instant Activation"], "fr": ["Qualité 4K / FHD", "Films & Séries VOD", "Serveur Anti-Coupure", "Activation Instantanée"], "ar": ["جودة 4K / FHD", "أفلام ومسلسلات VOD", "سيرفر بدون تقطيع", "تفعيل فوري"]}',
  '{"en": ["Iron Pro", "Atlas Pro", "Neo 4K", "KD Max", "Lynx"], "fr": ["Iron Pro", "Atlas Pro", "Neo 4K", "KD Max", "Lynx"], "ar": ["Iron Pro", "Atlas Pro", "Neo 4K", "KD Max", "Lynx"]}',
  '[800, 1500, 2200, 3800, 6800]',
  '[[800, 1500, 2200, 3800, 6800], [1000, 1800, 2700, 4800, 8500], [1200, 2200, 3200, 5800, 10000], [1400, 2600, 3800, 6800, 12000], [1600, 3000, 4400, 8000, 14500]]',
  13
)
ON CONFLICT (id) DO UPDATE SET
  cat = EXCLUDED.cat,
  pop = EXCLUDED.pop,
  show_types = EXCLUDED.show_types,
  bg = EXCLUDED.bg,
  icon_type = EXCLUDED.icon_type,
  icon_size = EXCLUDED.icon_size,
  icon_src = EXCLUDED.icon_src,
  n = EXCLUDED.n,
  f = EXCLUDED.f,
  types = EXCLUDED.types,
  p = EXCLUDED.p,
  type_prices = EXCLUDED.type_prices,
  sort_order = EXCLUDED.sort_order;

-- ====================================================================
-- إدخال أكواد الخصم الافتراضية
-- ====================================================================

INSERT INTO public.coupons (code, type, val, active)
VALUES
  ('STRIVIO10', 'pct', 0.10, true),
  ('VIP20', 'pct', 0.20, true),
  ('WELCOME5', 'fixed', 500, true)
ON CONFLICT (code) DO UPDATE SET
  type = EXCLUDED.type,
  val = EXCLUDED.val,
  active = EXCLUDED.active;

-- ====================================================================
-- ضبط الباقات للخدمات الأخرى (ما عدا نتفلكس و IPTV) لتكون type 1 إلى 5 ومخفية افتراضياً
-- ====================================================================
UPDATE public.services
SET 
  show_types = false,
  types = '{"en": ["type 1", "type 2", "type 3", "type 4", "type 5"], "fr": ["type 1", "type 2", "type 3", "type 4", "type 5"], "ar": ["type 1", "type 2", "type 3", "type 4", "type 5"]}'::jsonb,
  type_prices = jsonb_build_array(p, p, p, p, p)
WHERE id NOT IN ('netflix', 'iptv');

-- ====================================================================
-- 4. قيد السعر الموجب في جدول الطلبات (positive_total)
-- ====================================================================
ALTER TABLE public.orders ADD CONSTRAINT positive_total CHECK (total_payable >= 0);

-- ====================================================================
-- 5. جدول الإعدادات (settings)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  config JSONB NOT NULL
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access on settings" ON public.settings;
CREATE POLICY "Allow public read access on settings" ON public.settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow admin full access on settings" ON public.settings;
CREATE POLICY "Allow admin full access on settings" ON public.settings FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

INSERT INTO public.settings (id, config) VALUES (1, '{
  "email": "mailto:support@strivio.com",
  "phone": "tel:+213XXXXXXXXX",
  "whatsapp": "213562961410",
  "telegram": "",
  "instagram": "https://instagram.com/strivio.store",
  "facebook": "https://www.facebook.com/people/Strivio/61578300089117",
  "tiktok": "",
  "youtube": ""
}'::jsonb) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config;

-- ====================================================================
-- 6. جدول التقييمات (reviews)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.reviews (
  id SERIAL PRIMARY KEY,
  i TEXT NOT NULL,
  n TEXT NOT NULL,
  s TEXT NOT NULL,
  d TEXT NOT NULL,
  t TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true
);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access on reviews" ON public.reviews;
CREATE POLICY "Allow public read access on reviews" ON public.reviews FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow admin full access on reviews" ON public.reviews;
CREATE POLICY "Allow admin full access on reviews" ON public.reviews FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

INSERT INTO public.reviews (id, i, n, s, d, t, sort_order) VALUES
(1, 'A', 'Amir K.', 'Netflix Premium', '2 days ago', 'Ordered Netflix at 2am, had credentials by 2:02am. Genuinely shocked. This is how all digital stores should work.', 1),
(2, 'S', 'Sara M.', 'Spotify Premium', '5 days ago', 'Support was insanely responsive. Had a small Spotify issue and they sorted it in under 5 minutes. 10/10.', 2),
(3, 'Y', 'Youssef B.', 'Prime Video', '1 week ago', 'أفضل أسعار وجدتها. اشتريت 3 أشهر Prime والسعر كان لا يصدق. الموقع نظيف جداً. سأعود دائماً.', 3),
(4, 'L', 'Lina R.', 'ChatGPT Plus', '2 weeks ago', 'The warranty is real — my account had an issue and they replaced it immediately. No questions asked. Very professional.', 4),
(5, 'R', 'Rayan T.', 'Shahid VIP', '3 weeks ago', 'دفعت بـ Flexy وجاني الاشتراك في أقل من دقيقة. قلت لكل أصحابي. Strivio هو المتجر الأول في الجزائر.', 5),
(6, 'H', 'Hana S.', 'Canva Pro', '1 month ago', 'Bought from Strivio 4 times now. Every single time it''s been perfect. The site is clean, everything just works.', 6)
ON CONFLICT (id) DO UPDATE SET i=EXCLUDED.i, n=EXCLUDED.n, s=EXCLUDED.s, d=EXCLUDED.d, t=EXCLUDED.t, sort_order=EXCLUDED.sort_order;

-- ====================================================================
-- 7. جدول الأسئلة الشائعة (faq)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.faq (
  id TEXT PRIMARY KEY,
  icon TEXT NOT NULL,
  q JSONB NOT NULL,
  a JSONB NOT NULL,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true
);
ALTER TABLE public.faq ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read access on faq" ON public.faq;
CREATE POLICY "Allow public read access on faq" ON public.faq FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow admin full access on faq" ON public.faq;
CREATE POLICY "Allow admin full access on faq" ON public.faq FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

INSERT INTO public.faq (id, icon, q, a, sort_order) VALUES
('buying', '🛒', '{"fr": "Comment passer une commande sur Strivio ?", "ar": "كيفية الشراء وإتمام الطلب من متجر Strivio؟", "en": "How do I place an order on Strivio?"}'::jsonb, '{"fr": "Sélectionnez simplement votre abonnement préféré, choisissez la durée et l''option souhaitée, puis cliquez sur \"Acheter Maintenant\" ou ajoutez-le au panier. Lors du paiement, vous serez redirigé automatiquement vers WhatsApp avec les détails pré-remplis pour valider immédiatement votre commande.", "ar": "اختر الخدمة والمدة المحددة، ثم اضغط على \"اشتر الآن\" أو اضفها للسلة. عند إتمام الطلب، سيتم نسخ التعديلات فوراً وتوجيهك إلى واتساب لإرسال الطلب والتأكيد الفوري مع فريق الدعم.", "en": "Select your preferred subscription, duration, and tier, then click \"Buy Now\" or add to cart. At checkout, click confirm to automatically copy your order details and redirect to WhatsApp for instant confirmation."}'::jsonb, 1),
('delivery', '⚡', '{"fr": "Combien de temps prend la livraison de l''abonnement ?", "ar": "ما هي مدة تسليم الحساب بعد الدفع؟", "en": "How long does delivery take after payment?"}'::jsonb, '{"fr": "La livraison est instantanée ou prend en moyenne 5 à 15 minutes après la vérification de votre paiement par notre équipe sur WhatsApp.", "ar": "التسليم فوري ويستغرق في الغالب بين 5 إلى 15 دقيقة فور تأكيد عملية الدفع من قبل فريقنا عبر واتساب.", "en": "Delivery is instant or takes between 5 to 15 minutes average after payment confirmation on WhatsApp."}'::jsonb, 2),
('warranty', '🛡️', '{"fr": "Quelle est la garantie proposée sur les abonnements ?", "ar": "ما هو الضمان المقدم على الاشتراكات والحسابات؟", "en": "What warranty is provided with the subscriptions?"}'::jsonb, '{"fr": "Tous nos abonnements bénéficient d''une garantie complète durant toute la période souscrite (Garantie 100%). En cas de problème, nous remplaçons le compte ou résolvons le souci sous 24h.", "ar": "جميع اشتراكاتنا مضمونة 100% طوال فترة الاشتراك الكاملة. في حال حدوث أي استفسار أو مشكلة، يتم التعويض أو إصلاح الحساب فوراً عبر الدعم الفني.", "en": "All our subscriptions come with a 100% full-term warranty. In case of any technical issue, we replace or fix the account immediately."}'::jsonb, 3),
('payment', '💳', '{"fr": "Quels sont les modes de paiement acceptés ?", "ar": "ما هي طرق الدفع المتاحة في المتجر؟", "en": "What payment methods do you accept?"}'::jsonb, '{"fr": "Nous acceptons BariDi Mob, CCP, Wise (EUR) au taux de 1€ = 260 DZD, USDT (Crypto) au taux de 1$ = 250 DZD, ainsi que le paiement par Flexy (+19%).", "ar": "نوفر دفع عبر بريدي موب (BariDi Mob)، التحويل البريدي (CCP)، تحويل Wise باليورو (1€ = 260 دج)، تحويل USDT الكريبتو (1$ = 250 دج)، وبطاقات فليكسي Flexy (+19%).", "en": "We accept BariDi Mob, CCP, Wise (EUR rate: 1€ = 260 DZD), USDT Crypto (rate: 1$ = 250 DZD), and Flexy mobile recharge (+19%)."}'::jsonb, 4),
('crypto_wise', '🌐', '{"fr": "Comment payer par Wise ou USDT Crypto ?", "ar": "كيف أتمم الدفع عبر Wise أو USDT؟", "en": "How to complete payment via Wise or USDT Crypto?"}'::jsonb, '{"fr": "Dans votre panier, choisissez \"Wise\" ou \"USDT\". Le montant sera automatiquement converti au taux officiel du store. Une fois la commande confirmée sur WhatsApp, nous vous transmettrons l''adresse USDT (TRC20) ou l''email Wise pour effectuer le virement.", "ar": "عند الوصول للسلة، اختر Wise أو USDT وسيتم احتساب التوتال تلقائياً باليورو أو USDT. بعد الضغط على تأكيد الطلب، سيرسل لك فريق الدعم عنوان المحفظة أو إيميل Wise لإتمام التحويل.", "en": "In your cart, select Wise or USDT. The total converts automatically. Upon order confirmation on WhatsApp, our support team will provide the USDT (TRC20) address or Wise email."}'::jsonb, 5)
ON CONFLICT (id) DO UPDATE SET icon=EXCLUDED.icon, q=EXCLUDED.q, a=EXCLUDED.a, sort_order=EXCLUDED.sort_order;

