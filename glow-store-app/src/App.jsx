import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Gift, Menu, Truck, X } from 'lucide-react';
import { gsap } from 'gsap';
import { useCarouselTransition, usePageReveals, useSmoothPage } from './animations.js';
import ClickSpark from './components/ClickSpark.jsx';
import { bundlePrice, products, slides, wilayas } from './data.js';
import { supabase } from './supabase.js';

const text = {
  ar: {
    skip: 'تخطي إلى المحتوى', announcement: 'باك Gabrini المختار لكِ · ليب ستيك هدية',
    navProducts: 'المنتجات', navBundle: 'العرض', navOrder: 'اطلبي الآن', language: 'Français',
    heroKicker: 'Glow Store · Gabrini', heroTitle: 'ثلاث لمسات، باك واحد.', heroBody: 'فاونديشن وباودر، ومعهم ليب ستيك هدية تختارين درجته.',
    cta: 'اختاري درجاتك', sliderHint: 'اسحبي الصور أو اختاري صورة من الأسفل', bundleTag: 'عرض Glow Store',
    bundleTitle: 'ثلاث لمسات،\nباك واحد.', bundleBody: 'فاونديشن + باودر + ليب ستيك هدية', priceUnit: 'دج', selectBundle: 'جهزي الباك', included: 'الليب ستيك هدية',
    shade101: 'فاونديشن Gabrini — الدرجة 101', shade102: 'فاونديشن Gabrini — الدرجة 102', shade103: 'فاونديشن Gabrini — الدرجة 103', shade104: 'فاونديشن Gabrini — الدرجة 104',
    lineKicker: 'اختاري الدرجات', lineTitle: 'اختاري لونك.', lineBody: 'اختاري الدرجة المناسبة لكل منتج.', compareTitle: 'مقارنة الدرجات',
    chooseShade: 'اختاري الدرجة', freeGift: 'هدية مع الباك', includedBundle: 'ضمن الباك', singlesSoon: 'سعر القطعة المنفردة يُضاف لاحقاً',
    orderKicker: 'خطوة بسيطة', orderTitle: 'أكملي طلبك.', orderBody: 'أدخلي بياناتك واختاري الولاية، ويظهر الإجمالي مع التوصيل.',
    formTitle: 'بيانات التوصيل', firstName: 'الاسم', lastName: 'اللقب', phone: 'رقم الهاتف', phonePlaceholder: '05 xx xx xx xx', wilaya: 'ولاية التوصيل', wilayaPlaceholder: 'اختاري ولايتك',
    address: 'العنوان بالتحديد', addressPlaceholder: 'الحي، الشارع، رقم العمارة أو علامة قريبة', addressOptional: 'اختياري', delivery: 'طريقة التوصيل', home: 'للمنزل', office: 'لمكتب التوصيل',
    commune: 'البلدية', communePlaceholder: 'اختاري البلدية', communeBeforeWilaya: 'اختاري الولاية أولاً', communesLoading: 'جار تحميل البلديات…',
    reviewOrder: 'اطلبي الآن', summaryTitle: 'إجمالي الطلب', packPrice: 'سعر الباك', shipping: 'سعر التوصيل', total: 'الإجمالي مع التوصيل', chooseWilayaForShipping: 'اختاري الولاية لمعرفة سعر التوصيل',
    homeFee: '600 دج', officeFee: '400 دج', orderNote: 'تُحفظ بيانات الطلب بأمان لمراجعتها وتجهيز التوصيل.', orderError: 'تعذر تسجيل الطلب الآن. تحققي من البيانات وحاولي مرة أخرى.', orderConnectionError: 'خدمة الطلبات غير متاحة مؤقتاً. حاولي مرة أخرى بعد قليل.',
    orderPreview: 'تفاصيل طلبك', customerLabel: 'الاسم واللقب', phoneLabel: 'رقم الهاتف', foundationLabel: 'الفاونديشن', powderLabel: 'الباودر', lipstickLabel: 'الليب ستيك (هدية)', deliveryLabel: 'التوصيل', addressLabel: 'العنوان',
    previewOnly: 'تم تسجيل طلبك بنجاح. سنتواصل معك لتأكيده.', editDetails: 'إغلاق التفاصيل', faqKicker: 'كل اللي تحتاجين تعرفينه', faqTitle: 'أسئلة سريعة.',
    faq1q: 'وش يحتوي الباك؟', faq1a: 'فاونديشن Gabrini بدرجة تختارينها، باودر بدرجة 01 أو 02، وليب ستيك هدية بدرجة من 01 إلى 07.',
    faq2q: 'كيف أختار درجاتي؟', faq2a: 'اختاري الدائرة اللونية ورقمها تحت كل منتج. ولعرض الفرق بين الدرجات، اضغطي على «مقارنة الدرجات».',
    faq3q: 'أقدر أختار التوصيل للمنزل أو المكتب؟', faq3a: 'نعم، اختاري الولاية والبلدية وطريقة التوصيل، ويظهر السعر مباشرة.', faq4q: 'هل المنتجات أصلية؟', faq4a: 'نعم، منتجات Gabrini المعروضة في متجرنا أصلية 100٪، ونحرص على تقديمها بعبوتها الأصلية.',
    close: 'إغلاق', socials: 'تابعينا', footerLine: 'اختيارات جمالك، بكل بساطة.', rights: 'جميع الحقوق محفوظة',
    carouselPrev: 'الصورة السابقة', carouselNext: 'الصورة التالية', carouselStatus: 'صورة {{current}} من {{total}}',
    wilayaMissing: 'اختاري ولاية التوصيل', choiceMissing: 'اختاري طريقة التوصيل',
  },
  fr: {
    skip: 'Aller au contenu', announcement: 'Le pack Gabrini choisi pour toi · Crayon à lèvres offert',
    navProducts: 'Les produits', navBundle: 'Le pack', navOrder: 'Commander', language: 'العربية',
    heroKicker: 'Glow Store · Gabrini', heroTitle: 'Trois essentiels, un seul pack.', heroBody: 'Fond de teint et poudre, avec un crayon à lèvres offert dans la teinte de ton choix.',
    cta: 'Choisir mes teintes', sliderHint: 'Fais glisser ou choisis une image ci-dessous', bundleTag: 'Le pack Glow Store',
    bundleTitle: 'Trois essentiels,\nun seul pack.', bundleBody: 'Fond de teint + poudre + crayon à lèvres offert', priceUnit: 'DA', selectBundle: 'Composer mon pack', included: 'Crayon à lèvres offert',
    shade101: 'Fond de teint Gabrini — teinte 101', shade102: 'Fond de teint Gabrini — teinte 102', shade103: 'Fond de teint Gabrini — teinte 103', shade104: 'Fond de teint Gabrini — teinte 104',
    lineKicker: 'Choisis tes teintes', lineTitle: 'Choisis ta teinte.', lineBody: 'Choisis la teinte pour chaque produit.', compareTitle: 'Comparer les teintes',
    chooseShade: 'Choisir une teinte', freeGift: 'Offert avec le pack', includedBundle: 'Inclus dans le pack', singlesSoon: 'Prix à l’unité à ajouter plus tard',
    orderKicker: 'En quelques étapes', orderTitle: 'Finalise ta commande.', orderBody: 'Saisis tes coordonnées et choisis ta wilaya pour voir le total avec livraison.',
    formTitle: 'Coordonnées de livraison', firstName: 'Prénom', lastName: 'Nom', phone: 'Téléphone', phonePlaceholder: '05 xx xx xx xx', wilaya: 'Wilaya de livraison', wilayaPlaceholder: 'Choisir une wilaya',
    address: 'Adresse précise', addressPlaceholder: 'Quartier, rue, numéro ou repère à proximité', addressOptional: 'Facultatif', delivery: 'Mode de livraison', home: 'À domicile', office: 'Au bureau de livraison',
    commune: 'Commune', communePlaceholder: 'Choisir une commune', communeBeforeWilaya: 'Choisis d’abord une wilaya', communesLoading: 'Chargement des communes…',
    reviewOrder: 'Commander maintenant', summaryTitle: 'Total de la commande', packPrice: 'Prix du pack', shipping: 'Livraison', total: 'Total avec livraison', chooseWilayaForShipping: 'Choisis une wilaya pour voir le prix de livraison',
    homeFee: '600 DA', officeFee: '400 DA', orderNote: 'Tes coordonnées sont enregistrées de manière sécurisée pour préparer la livraison.', orderError: 'La commande n’a pas pu être enregistrée. Vérifie les informations et réessaie.', orderConnectionError: 'Le service de commande est momentanément indisponible. Réessaie dans un instant.',
    orderPreview: 'Détails de ta commande', customerLabel: 'Nom et prénom', phoneLabel: 'Téléphone', foundationLabel: 'Fond de teint', powderLabel: 'Poudre', lipstickLabel: 'Crayon à lèvres (offert)', deliveryLabel: 'Livraison', addressLabel: 'Adresse',
    previewOnly: 'Ta commande a bien été enregistrée. Nous te contacterons pour la confirmer.', editDetails: 'Fermer le récapitulatif', faqKicker: 'Tout ce qu’il faut savoir', faqTitle: 'Questions rapides.',
    faq1q: 'Que contient le pack ?', faq1a: 'Un fond de teint Gabrini au choix, une poudre en teinte 01 ou 02 et un crayon à lèvres offert en teinte 01 à 07.',
    faq2q: 'Comment choisir mes teintes ?', faq2a: 'Choisis le cercle coloré et son numéro sous chaque produit. Appuie sur « Comparer les teintes » pour voir les différences.',
    faq3q: 'Puis-je choisir une livraison à domicile ou au bureau ?', faq3a: 'Oui. Choisis la wilaya, la commune et le mode de livraison. Le tarif s’affiche directement.', faq4q: 'Les produits sont-ils authentiques ?', faq4a: 'Oui, les produits Gabrini présentés dans notre boutique sont 100 % authentiques et sont proposés dans leur emballage d’origine.',
    close: 'Fermer', socials: 'Retrouve-nous', footerLine: 'Tes essentiels beauté, tout simplement.', rights: 'Tous droits réservés',
    carouselPrev: 'Image précédente', carouselNext: 'Image suivante', carouselStatus: 'Image {{current}} sur {{total}}',
    wilayaMissing: 'Choisis une wilaya', choiceMissing: 'Choisis un mode de livraison',
  },
};

const asset = (path) => `${import.meta.env.BASE_URL}${path}`;

function ShadePicker({ product, value, onChange, label, lang, onCompare }) {
  return (
    <fieldset className="shade-fieldset">
      <legend>{label}</legend><button className="shade-compare-button" type="button" onClick={() => onCompare(product)} aria-label={`${product.compareLabel[lang]}: ${product.title[lang]}`}>{product.compareLabel[lang]} <span aria-hidden="true">↗</span></button>
      <div className={`shade-options ${product.id === 'lipstick' ? 'shade-options-wide' : ''}`} role="group" aria-label={label}>
        {product.shades.map((shade) => (
          <button
            className={`shade-option ${value === shade.id ? 'is-selected' : ''}`}
            type="button"
            key={shade.id}
            onClick={() => onChange(shade.id)}
            aria-pressed={value === shade.id}
            aria-label={`${label}: ${shade.id}`}
            title={`${label}: ${shade.id}`}
          >
            <span className="shade-dot" style={{ '--swatch': shade.color }} aria-hidden="true" />
            <span className="shade-number">{shade.id}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SparkleTrail() {
  return (
    <div className="sparkle-trail" aria-hidden="true">
        <svg className="sparkle-trail-line" viewBox="0 0 64 420" fill="none">
          <defs><linearGradient id="sparkle-thread" x1="30" y1="0" x2="34" y2="420" gradientUnits="userSpaceOnUse"><stop stopColor="#D8A652"/><stop offset=".48" stopColor="#D58FA8"/><stop offset="1" stopColor="#D8A652"/></linearGradient></defs>
          <path d="M33 2C5 45 53 72 27 112S10 179 37 213 48 278 20 316 15 369 34 418" stroke="url(#sparkle-thread)" strokeWidth="2.3" strokeLinecap="round" />
      </svg>
        <span className="sparkle-star sparkle-a">✦</span><span className="sparkle-star sparkle-b">✧</span>
        <span className="sparkle-star sparkle-c">✦</span><span className="sparkle-star sparkle-d">✧</span>
        <span className="sparkle-star sparkle-e">✦</span><span className="sparkle-star sparkle-f">✧</span>
    </div>
  );
}

function SocialIcon({ network }) {
  if (network === 'instagram') return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="18" cy="6" r=".8" fill="currentColor" stroke="none" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M13.7 21v-8.2h2.8l.42-3.2H13.7V7.55c0-.93.26-1.56 1.6-1.56h1.72V3.13A23 23 0 0 0 14.5 3c-2.5 0-4.2 1.53-4.2 4.34V9.6H7.5v3.2h2.8V21z" /></svg>;
}

function App() {
  const root = useRef(null);
  const mediaRef = useRef(null);
  const dragStart = useRef(null);
  const [lang, setLang] = useState('ar');
  const [slideIndex, setSlideIndex] = useState(0);
  const [selected, setSelected] = useState({ foundation: '101', powder: '01', lipstick: '01' });
  const [delivery, setDelivery] = useState('home');
  const [wilayaCode, setWilayaCode] = useState('');
  const [communeId, setCommuneId] = useState('');
  const [communes, setCommunes] = useState([]);
  const [communesLoading, setCommunesLoading] = useState(false);
  const [communesError, setCommunesError] = useState(false);
  const [preview, setPreview] = useState(null);
  const [storeSettings, setStoreSettings] = useState({ bundle_price_dzd: bundlePrice, delivery_home_dzd: 600, delivery_office_dzd: 400 });
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [comparisonProduct, setComparisonProduct] = useState(null);
  const [openFaq, setOpenFaq] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const t = text[lang];
  const isArabic = lang === 'ar';
  const slide = slides[slideIndex];
  const slideImage = slide.image;
  const filteredCommunes = communes.filter((commune) => commune.wilaya_code === Number(wilayaCode));
  const storePrice = storeSettings.bundle_price_dzd ?? bundlePrice;
  const deliveryFee = wilayaCode ? (delivery === 'home' ? storeSettings.delivery_home_dzd : storeSettings.delivery_office_dzd) : null;
  const orderTotal = storePrice + (deliveryFee ?? 0);

  useSmoothPage();
  usePageReveals(root);
  useCarouselTransition(mediaRef, slideIndex, isArabic);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
    document.title = isArabic ? 'Glow Store — جمالك، على ذوقك' : 'Glow Store — La beauté, à ton style';
  }, [isArabic, lang]);

  useEffect(() => {
    if (!comparisonProduct) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') setComparisonProduct(null); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [comparisonProduct]);

  useEffect(() => {
    if (!wilayaCode || communes.length) return undefined;
    let active = true;
    setCommunesLoading(true);
    fetch(asset('data/communes.json'))
      .then((response) => {
        if (!response.ok) throw new Error('Could not load communes');
        return response.json();
      })
      .then((data) => { if (active) { setCommunes(data); setCommunesError(false); } })
      .catch(() => { if (active) setCommunesError(true); })
      .finally(() => { if (active) setCommunesLoading(false); });
    return () => { active = false; };
  }, [wilayaCode, communes.length]);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.from('glow_store_settings').select('bundle_price_dzd,delivery_home_dzd,delivery_office_dzd').eq('id', true).single()
      .then(({ data }) => { if (active && data) setStoreSettings(data); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const activeThumb = root.current?.querySelector('.carousel-thumb.is-active');
    activeThumb?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }, [slideIndex]);

  const setShade = (id, shade) => {
    setSelected((state) => ({ ...state, [id]: shade }));
    setPreview(null);
  };
  const moveSlide = (direction) => setSlideIndex((current) => (current + direction + slides.length) % slides.length);
  const changeLanguage = () => {
    const next = isArabic ? 'fr' : 'ar';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLang(next);
      return;
    }
    setSwitching(true);
    gsap.to('.language-content', {
      autoAlpha: 0.35, y: 5, duration: 0.13, ease: 'power1.out',
      onComplete: () => {
        setLang(next);
        requestAnimationFrame(() => {
          gsap.fromTo('.language-content', { autoAlpha: 0.5, y: -4 }, {
            autoAlpha: 1, y: 0, duration: 0.24, ease: 'power2.out', clearProps: 'transform',
            onComplete: () => setSwitching(false),
          });
        });
      },
    });
  };

  const onDragStart = (event) => {
    if (event.target.closest('button')) return;
    dragStart.current = event.clientX;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onDragEnd = (event) => {
    if (dragStart.current === null) return;
    const delta = event.clientX - dragStart.current;
    if (Math.abs(delta) > 44) {
      const swipedForward = isArabic ? delta > 0 : delta < 0;
      moveSlide(swipedForward ? 1 : -1);
    }
    dragStart.current = null;
  };
  const onCarouselKeyDown = (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const forward = isArabic ? 'ArrowLeft' : 'ArrowRight';
      moveSlide(event.key === forward ? 1 : -1);
    }
  };

  const jumpToOrder = () => {
    setMenuOpen(false);
    document.getElementById('order')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  const jumpToProducts = () => {
    document.getElementById('products')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  const handleOrderPreview = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!supabase) { setOrderError(t.orderConnectionError); return; }
    const fields = new FormData(form);
    const wilaya = wilayas.find(([code]) => code === fields.get('wilaya'));
    const commune = communes.find((item) => item.id === Number(fields.get('commune')));
    setOrderSubmitting(true); setOrderError(''); setPreview(null);
    try {
      const { data, error } = await supabase.rpc('submit_glow_order', {
        p_first_name: fields.get('firstName'), p_last_name: fields.get('lastName'), p_phone: fields.get('phone'),
        p_wilaya_code: Number(fields.get('wilaya')), p_commune_id: Number(fields.get('commune')), p_delivery_method: delivery,
        p_address: fields.get('address') || '', p_foundation_shade: selected.foundation, p_powder_shade: selected.powder,
        p_lipstick_shade: selected.lipstick, p_website: fields.get('website') || '',
      });
      if (error) throw error;
      setPreview({
        orderNumber: data.order_number, firstName: fields.get('firstName'), lastName: fields.get('lastName'), phone: fields.get('phone'),
        wilaya: wilaya ? (isArabic ? wilaya[1] : wilaya[2]) : '',
        commune: commune ? (isArabic ? commune.name_ar : commune.name) : '',
        address: fields.get('address'), delivery: delivery === 'home' ? t.home : t.office,
        deliveryFee: data.delivery_fee_dzd, total: data.total_dzd,
      });
    } catch {
      setOrderError(t.orderError);
    } finally { setOrderSubmitting(false); }
  };

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <ClickSpark className="site" style={{ height: 'auto' }} disabled={window.matchMedia('(prefers-reduced-motion: reduce)').matches} sparkColor={['#bd718d', '#e5a8bb', '#9a7776']} sparkCount={7} sparkSize={10} sparkRadius={30} duration={420}>
      <a className="skip-link" href="#main">{t.skip}</a>
      <div className="announcement"><span className="announcement-dot" />{t.announcement}</div>
      <header className="site-header">
        <div className="header-inner page-container">
          <a className="brand" href="#top" aria-label="Glow Store" onClick={() => setMenuOpen(false)}>
            <img src={asset('glow-store-logo.png')} alt="Glow Store" />
          </a>
          <nav className={`main-nav ${menuOpen ? 'nav-open' : ''}`} aria-label={isArabic ? 'التنقل الرئيسي' : 'Navigation principale'}>
            <a href="#products" onClick={() => setMenuOpen(false)}>{t.navProducts}</a>
            <a href="#bundle" onClick={() => setMenuOpen(false)}>{t.navBundle}</a>
              <button type="button" className="nav-order ambient-cta" onClick={jumpToOrder}>{t.navOrder}<ArrowLeft size={15} /></button>
          </nav>
          <div className="header-actions">
            <button className="language-button" type="button" onClick={changeLanguage} aria-label={isArabic ? 'Passer au français' : 'Changer la langue en arabe'} disabled={switching}>
              <span className="language-indicator">{isArabic ? 'FR' : 'ع'}</span>{t.language}
            </button>
            <button className="menu-toggle" type="button" aria-label={menuOpen ? t.close : (isArabic ? 'فتح القائمة' : 'Ouvrir le menu')} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
        <SparkleTrail />
      </header>

      <main id="main" className="language-content" aria-busy={switching}>
        <section className="hero page-container" id="top" aria-labelledby="hero-title">
          <div className="hero-visual" data-hero-enter ref={mediaRef}>
            <div className="carousel-frame" onPointerDown={onDragStart} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} onKeyDown={onCarouselKeyDown} tabIndex="0" role="region" aria-roledescription={isArabic ? 'عارض صور' : 'carrousel'} aria-label={isArabic ? 'صور منتجات Glow Store — استخدمي الأسهم للتنقل' : 'Photos des produits Glow Store — utilise les flèches pour naviguer'}>
              <div className="carousel-image-wrap">
                <img className="carousel-image" key={slideImage} src={asset(slideImage)} alt={slide[lang]} draggable="false" decoding="async" />
              </div>
              <button className="carousel-arrow arrow-previous" type="button" onClick={() => moveSlide(-1)} aria-label={t.carouselPrev}>{isArabic ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}</button>
              <button className="carousel-arrow arrow-next" type="button" onClick={() => moveSlide(1)} aria-label={t.carouselNext}>{isArabic ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}</button>
            </div>
            <div className="carousel-thumbnails" role="group" aria-label={isArabic ? 'صور المنتجات المتاحة' : 'Images des produits disponibles'}>
              {slides.map((item, index) => <button key={item.image} type="button" className={`carousel-thumb ${slideIndex === index ? 'is-active' : ''}`} onClick={() => setSlideIndex(index)} aria-label={item[lang]} aria-pressed={slideIndex === index}>
                <img src={asset(item.thumbnail || item.image)} alt="" draggable="false" decoding="async" />
                <span>{item.kind === 'bundle' ? (isArabic ? 'الباك' : 'Pack') : item.kind === 'foundation' ? (isArabic ? 'فاونديشن' : 'Fond') : item.kind === 'powder' ? (isArabic ? 'باودر' : 'Poudre') : (isArabic ? 'ليب' : 'Lèvres')}</span>
              </button>)}
            </div>
          </div>
          <div className="hero-copy">
            <p className="eyebrow" data-hero-enter><span className="eyebrow-line" />{t.heroKicker}</p>
            <h1 id="hero-title" data-hero-enter>{t.heroTitle}</h1>
            <p className="hero-description" data-hero-enter>{t.heroBody}</p>
            <div className="hero-price-row" id="bundle" data-hero-enter>
              <div className="hero-price"><strong>{storePrice.toLocaleString(isArabic ? 'ar-DZ' : 'fr-FR')}</strong><span>{t.priceUnit}</span></div>
              <span className="hero-gift"><Gift size={15} />{t.included}</span>
            </div>
          </div>
        </section>

        <section className="products-section section-pad" id="products" aria-labelledby="products-title">
          <div className="page-container">
            <div className="section-heading" data-reveal>
              <div><p className="eyebrow"><span className="eyebrow-line" />{t.lineKicker}</p><h2 id="products-title">{t.lineTitle}</h2></div>
              <p className="section-intro">{t.lineBody}</p>
            </div>
            <div className="product-grid">
              {products.map((product) => <article className={`product-card ${product.id === 'lipstick' ? 'gift-card' : ''}`} key={product.id} data-reveal>
                <div className="product-info">
                  <div className="product-heading"><h3>{product.title[lang]}</h3><p>{product.detail[lang]}{product.free ? ` · ${t.freeGift}` : ''}</p></div>
                  <ShadePicker product={product} value={selected[product.id]} onChange={(shade) => setShade(product.id, shade)} label={t.chooseShade} lang={lang} onCompare={setComparisonProduct} />
                </div>
              </article>)}
            </div>
          </div>
        </section>

        <section className="order-section section-pad" id="order" aria-labelledby="order-title">
          <div className="page-container order-layout">
            <div className="order-heading" data-reveal><p className="eyebrow"><span className="eyebrow-line" />{t.orderKicker}</p><h2 id="order-title">{t.orderTitle}</h2><p className="section-intro">{t.orderBody}</p></div>
            <div className="form-card" data-reveal>
              <div className="form-heading"><div><span className="form-step">Glow Store</span><h3>{t.formTitle}</h3></div><span className="form-icon"><Truck size={20} /></span></div>
              <form onSubmit={handleOrderPreview}>
                <div className="form-grid">
                  <label className="field"><span>{t.firstName}<i>*</i></span><input type="text" name="firstName" autoComplete="given-name" required /></label>
                  <label className="field"><span>{t.lastName}<i>*</i></span><input type="text" name="lastName" autoComplete="family-name" required /></label>
                  <label className="field field-full"><span>{t.phone}<i>*</i></span><input type="tel" name="phone" placeholder={t.phonePlaceholder} autoComplete="tel" inputMode="tel" minLength="9" maxLength="16" required /></label>
                  <label className="field field-full"><span>{t.wilaya}<i>*</i></span><span className="select-wrap"><select name="wilaya" value={wilayaCode} onChange={(event) => { setWilayaCode(event.target.value); setCommuneId(''); setPreview(null); }} required><option value="" disabled>{t.wilayaPlaceholder}</option>{wilayas.map(([code, ar, fr]) => <option key={code} value={code}>{code} — {isArabic ? ar : fr}</option>)}</select><ChevronDown size={17} /></span></label>
                  {wilayaCode && <label className="field field-full"><span>{t.commune}<i>*</i></span><span className="select-wrap"><select name="commune" value={communeId} onChange={(event) => { setCommuneId(event.target.value); setPreview(null); }} required disabled={communesLoading || communesError}><option value="" disabled>{communesLoading ? t.communesLoading : communesError ? (isArabic ? 'تعذر تحميل قائمة البلديات' : 'Impossible de charger les communes') : t.communePlaceholder}</option>{filteredCommunes.map((commune) => <option key={commune.id} value={commune.id}>{isArabic ? commune.name_ar : commune.name}</option>)}</select><ChevronDown size={17} /></span></label>}
                  <fieldset className="delivery-choice field-full">
                    <legend>{t.delivery}<i>*</i></legend>
                    <div className="delivery-options">
                      {[['home', t.home], ['office', t.office]].map(([value, label]) => <label className={`delivery-option ${delivery === value ? 'is-selected' : ''}`} key={value}><input type="radio" name="delivery" value={value} checked={delivery === value} onChange={() => { setDelivery(value); setPreview(null); }} /><span className="delivery-radio" /><span>{label}{wilayaCode && <small>{(value === 'home' ? storeSettings.delivery_home_dzd : storeSettings.delivery_office_dzd).toLocaleString(isArabic ? 'ar-DZ' : 'fr-FR')} {t.priceUnit}</small>}</span></label>)}
                    </div>
                  </fieldset>
                  <label className="field field-full address-optional"><span>{t.address}<small>{t.addressOptional}</small></span><textarea name="address" rows="2" placeholder={t.addressPlaceholder} autoComplete="street-address" /></label>
                </div>
                <div className="checkout-total" aria-live="polite">
                  <div><span>{t.packPrice}</span><strong>{storePrice.toLocaleString(isArabic ? 'ar-DZ' : 'fr-FR')} {t.priceUnit}</strong></div>
                  <div><span>{t.shipping}</span><strong>{deliveryFee === null ? t.chooseWilayaForShipping : `${deliveryFee.toLocaleString(isArabic ? 'ar-DZ' : 'fr-FR')} ${t.priceUnit}`}</strong></div>
                  <div className="checkout-total-final"><span>{t.total}</span><strong>{deliveryFee === null ? `${storePrice.toLocaleString(isArabic ? 'ar-DZ' : 'fr-FR')} ${t.priceUnit} +` : `${orderTotal.toLocaleString(isArabic ? 'ar-DZ' : 'fr-FR')} ${t.priceUnit}`}</strong></div>
                </div>
                <label className="order-honeypot" aria-hidden="true">Website<input type="text" name="website" tabIndex="-1" autoComplete="off" /></label>
                {orderError && <p className="order-error" role="alert">{orderError}</p>}
                <button className="button button-dark form-submit ambient-cta" type="submit" disabled={orderSubmitting}>{orderSubmitting ? (isArabic ? 'جارٍ تسجيل الطلب…' : 'Enregistrement…') : t.reviewOrder}<ArrowLeft size={17} /></button>
                <p className="form-note"><span className="note-mark">i</span>{t.orderNote}</p>
                {preview && <div className="order-preview" role="status" aria-live="polite">
                  <div className="preview-heading"><span className="preview-check"><Check size={16} /></span><div><h4>{t.orderPreview} · {preview.orderNumber}</h4><p>{t.previewOnly}</p></div><button type="button" aria-label={t.close} onClick={() => setPreview(null)}><X size={17} /></button></div>
                  <dl className="preview-list">
                    <div><dt>{t.customerLabel}</dt><dd>{preview.firstName} {preview.lastName}</dd></div><div><dt>{t.phoneLabel}</dt><dd dir="ltr">{preview.phone}</dd></div>
                    <div><dt>{t.foundationLabel}</dt><dd>{selected.foundation}</dd></div><div><dt>{t.powderLabel}</dt><dd>{selected.powder}</dd></div><div><dt>{t.lipstickLabel}</dt><dd>{selected.lipstick}</dd></div>
                    <div><dt>{t.deliveryLabel}</dt><dd>{preview.delivery} · {preview.wilaya} · {preview.commune}</dd></div>{preview.address && <div><dt>{t.addressLabel}</dt><dd>{preview.address}</dd></div>}
                    <div><dt>{t.shipping}</dt><dd>{preview.deliveryFee.toLocaleString(isArabic ? 'ar-DZ' : 'fr-FR')} {t.priceUnit}</dd></div>
                    <div className="preview-total"><dt>{t.total}</dt><dd>{preview.total.toLocaleString(isArabic ? 'ar-DZ' : 'fr-FR')} {t.priceUnit}</dd></div>
                  </dl>
                  <button className="preview-edit" type="button" onClick={() => setPreview(null)}>{t.editDetails}</button>
                </div>}
              </form>
            </div>
          </div>
        </section>

        <section className="faq-section section-pad" aria-labelledby="faq-title">
          <div className="page-container faq-layout">
            <div className="faq-intro" data-reveal><p className="eyebrow"><span className="eyebrow-line" />{t.faqKicker}</p><h2 id="faq-title">{t.faqTitle}</h2></div>
            <div className="faq-list" data-reveal>
              {[[t.faq1q, t.faq1a], [t.faq2q, t.faq2a], [t.faq3q, t.faq3a], [t.faq4q, t.faq4a]].map(([question, answer], index) => <article className={`faq-item ${openFaq === index ? 'faq-open' : ''}`} key={question}><h3><button type="button" aria-expanded={openFaq === index} onClick={() => setOpenFaq((current) => current === index ? -1 : index)}>{question}<span className="faq-plus">{openFaq === index ? <X size={17} /> : <ChevronDown size={17} />}</span></button></h3>{openFaq === index && <p className="faq-answer">{answer}</p>}</article>)}
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="page-container footer-main">
          <a className="brand footer-brand" href="#top" onClick={(event) => { event.preventDefault(); scrollToTop(); }}><img src={asset('glow-store-logo.png')} alt="Glow Store" /></a>
          <p>{t.footerLine}</p>
          <div className="footer-socials"><span>{t.socials}</span><a href="https://www.instagram.com/glow.store.dz/" target="_blank" rel="noreferrer" aria-label="Instagram Glow Store"><SocialIcon network="instagram" /><span>glow.store.dz</span></a><a href="https://www.facebook.com/glow.store.dz/" target="_blank" rel="noreferrer" aria-label="Facebook Glow Store"><SocialIcon network="facebook" /><span>Glow Store</span></a></div>
        </div>
        <div className="page-container footer-bottom"><span>glowdz.store</span><span>© {new Date().getFullYear()} Glow Store · {t.rights}</span><button type="button" onClick={scrollToTop}>{isArabic ? 'للأعلى' : 'Haut de page'}<ArrowRight size={15} /></button></div>
      </footer>
      <div className="mobile-order-bar"><span><strong>{(wilayaCode ? orderTotal : storePrice).toLocaleString(isArabic ? 'ar-DZ' : 'fr-FR')}</strong> {t.priceUnit}</span><button className="ambient-cta" type="button" onClick={jumpToOrder}>{t.selectBundle}<ArrowLeft size={16} /></button></div>
      {comparisonProduct && <div className="comparison-modal" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setComparisonProduct(null); }}><div className="comparison-dialog" role="dialog" aria-modal="true" aria-label={`${t.compareTitle}: ${comparisonProduct.title[lang]}`}><button className="comparison-close" type="button" onClick={() => setComparisonProduct(null)} aria-label={t.close}><X size={21} /></button><h2>{comparisonProduct.title[lang]} · {t.compareTitle}</h2><img src={asset(comparisonProduct.comparisonImage)} alt={comparisonProduct.comparisonAlt[lang]} /></div></div>}
    </ClickSpark>
  );
}

export default App;
