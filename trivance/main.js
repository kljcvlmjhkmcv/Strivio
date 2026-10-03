const API_URL = 'https://rrfguexpsfizyijekkmi.supabase.co/functions/v1/trivance-order';
const money = value => `${new Intl.NumberFormat('fr-DZ').format(value)} دج`;
const byId = id => document.getElementById(id);
const form = byId('order-form');
const wilayaSelect = byId('wilaya');
const communeSelect = byId('commune');
const statusElement = byId('form-status');
const config = { price: 2900, home_fee: 600, office_fee: 400 };
let wilayas = [];
let communes = [];
let quantity = 1;
let submitting = false;
let requestId = crypto.randomUUID();

function selectedDelivery() {
  return form.querySelector('input[name="delivery"]:checked').value;
}

function updateTotal() {
  const total = config.price * quantity + (selectedDelivery() === 'home' ? config.home_fee : config.office_fee);
  byId('hero-price').textContent = money(config.price);
  byId('mobile-price').textContent = money(config.price);
  byId('home-fee').textContent = money(config.home_fee);
  byId('office-fee').textContent = money(config.office_fee);
  byId('order-total').textContent = money(total);
  byId('quantity').value = quantity;
  byId('quantity').textContent = quantity;
  byId('decrease').disabled = quantity === 1;
  byId('increase').disabled = quantity === 3;
}

function setStatus(message, kind = '') {
  statusElement.textContent = message;
  statusElement.className = `form-status ${kind}`;
}

function fillCommunes() {
  const code = Number(wilayaSelect.value);
  const matching = communes.filter(item => item.wilaya_code === code);
  communeSelect.replaceChildren(new Option(code ? 'اختر البلدية' : 'اختر الولاية أولًا', ''));
  for (const item of matching) communeSelect.add(new Option(item.name_ar, item.id));
  communeSelect.disabled = !code;
}

async function loadLocations() {
  const [wilayaResponse, communeResponse] = await Promise.all([
    fetch('./data/wilayas.json'), fetch('./data/communes.json')
  ]);
  if (!wilayaResponse.ok || !communeResponse.ok) throw new Error('Location data unavailable');
  [wilayas, communes] = await Promise.all([wilayaResponse.json(), communeResponse.json()]);
  for (const item of wilayas) wilayaSelect.add(new Option(`${String(item.code).padStart(2, '0')} · ${item.name_ar}`, item.code));
}

async function loadConfig() {
  const response = await fetch(API_URL, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error('Store unavailable');
  const data = await response.json();
  if (!data.available || !Number.isInteger(data.price) || !Number.isInteger(data.home_fee) || !Number.isInteger(data.office_fee)) throw new Error('Store unavailable');
  Object.assign(config, data);
  updateTotal();
}

function setupGallery() {
  const image = byId('main-product-image');
  const counter = document.querySelector('.media-index');
  const thumbs = [...document.querySelectorAll('.thumb')];
  thumbs.forEach((button, index) => button.addEventListener('click', () => {
    thumbs.forEach(item => { item.classList.remove('is-active'); item.setAttribute('aria-pressed', 'false'); });
    button.classList.add('is-active');
    button.setAttribute('aria-pressed', 'true');
    image.classList.add('is-changing');
    const next = new Image();
    next.onload = () => { image.src = next.src; image.alt = button.dataset.alt; image.classList.remove('is-changing'); };
    next.onerror = () => image.classList.remove('is-changing');
    next.src = button.dataset.image;
    counter.textContent = `${String(index + 1).padStart(2, '0')} / 03`;
  }));
  let touchStart = null;
  image.addEventListener('touchstart', event => { touchStart = event.changedTouches[0].clientX; }, { passive: true });
  image.addEventListener('touchend', event => {
    if (touchStart === null) return;
    const distance = event.changedTouches[0].clientX - touchStart;
    touchStart = null;
    if (Math.abs(distance) < 40) return;
    const active = thumbs.findIndex(button => button.classList.contains('is-active'));
    thumbs[(active + (distance < 0 ? 1 : -1) + thumbs.length) % thumbs.length].click();
  }, { passive: true });
}

function detectLocation() {
  const button = byId('detect-location');
  if (!navigator.geolocation) { setStatus('تحديد الموقع غير متاح على هذا الجهاز.', 'error'); return; }
  if (!communes.length) { setStatus('انتظر تحميل قائمة البلديات ثم أعد المحاولة.', 'error'); return; }
  button.disabled = true;
  button.textContent = 'جار تحديد الموقع...';
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude } = position.coords;
    if (latitude < 18 || latitude > 38 || longitude < -9 || longitude > 12) {
      setStatus('موقعك خارج الجزائر. اختر الولاية والبلدية يدويًا.', 'error');
    } else {
      const candidate = communes.filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
        .reduce((best, item) => {
          const dx = (item.longitude - longitude) * Math.cos(latitude * Math.PI / 180);
          const dy = item.latitude - latitude;
          const distance = dx * dx + dy * dy;
          return !best || distance < best.distance ? { item, distance } : best;
        }, null);
      if (candidate) {
        wilayaSelect.value = String(candidate.item.wilaya_code);
        fillCommunes();
        communeSelect.value = String(candidate.item.id);
        setStatus('تم اختيار أقرب بلدية. راجعها قبل إرسال الطلب.', 'success');
      }
    }
    button.disabled = false;
    button.textContent = 'تحديد موقعي تلقائيًا';
  }, () => {
    setStatus('لم نتمكن من تحديد موقعك. اختر الولاية والبلدية يدويًا.', 'error');
    button.disabled = false;
    button.textContent = 'تحديد موقعي تلقائيًا';
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

function validate() {
  for (const field of form.querySelectorAll('[required]')) {
    if (field.disabled || (field.closest('[hidden]'))) continue;
    field.setAttribute('aria-invalid', String(!field.checkValidity()));
  }
  if (!form.reportValidity()) return false;
  const phone = String(form.elements.phone.value).replace(/[\s.\-()]/g, '');
  if (!/^(?:\+213|0)[567]\d{8}$/.test(phone)) {
    form.elements.phone.setAttribute('aria-invalid', 'true');
    setStatus('أدخل رقم هاتف جزائري صحيحًا.', 'error');
    form.elements.phone.focus();
    return false;
  }
  return true;
}

async function submitOrder(event) {
  event.preventDefault();
  if (submitting || !validate()) return;
  const submit = byId('submit-order');
  const params = new URLSearchParams(window.location.search);
  const attribution = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (params.has(key)) attribution[key] = params.get(key).slice(0, 100);
  }
  const payload = {
    request_id: requestId,
    name: form.elements.name.value.trim(),
    phone: form.elements.phone.value.trim(),
    wilaya_code: Number(wilayaSelect.value),
    commune_id: Number(communeSelect.value),
    delivery_method: selectedDelivery(),
    quantity,
    website: form.elements.website.value,
    attribution
  };
  submitting = true;
  submit.disabled = true;
  submit.firstChild.textContent = 'جار إرسال الطلب... ';
  setStatus('');
  try {
    const response = await fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload), credentials: 'omit'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.message || 'تعذر إرسال الطلب الآن. حاول مرة أخرى.');
    setStatus(`وصل طلبك رقم ${result.reference}. سنتصل بك للتأكيد قبل التجهيز، والدفع عند الاستلام.`, 'success');
    form.reset();
    wilayaSelect.value = '';
    fillCommunes();
    quantity = 1;
    updateTotal();
    requestId = crypto.randomUUID();
  } catch (error) {
    setStatus(error.message || 'تعذر إرسال الطلب الآن. حاول مرة أخرى.', 'error');
  } finally {
    submitting = false;
    submit.disabled = false;
    submit.firstChild.textContent = 'تأكيد الطلب · الدفع عند الاستلام ';
  }
}

byId('year').textContent = new Date().getFullYear();
byId('increase').addEventListener('click', () => { quantity = Math.min(3, quantity + 1); updateTotal(); });
byId('decrease').addEventListener('click', () => { quantity = Math.max(1, quantity - 1); updateTotal(); });
wilayaSelect.addEventListener('change', fillCommunes);
form.querySelectorAll('input[name="delivery"]').forEach(input => input.addEventListener('change', updateTotal));
form.querySelectorAll('input,select').forEach(input => input.addEventListener('input', () => input.removeAttribute('aria-invalid')));
byId('detect-location').addEventListener('click', detectLocation);
form.addEventListener('submit', submitOrder);
setupGallery();
updateTotal();
loadLocations().catch(() => setStatus('تعذر تحميل قائمة الولايات. أعد تحميل الصفحة.', 'error'));
loadConfig().catch(() => {});

function setupReviews() {
  const track = byId('review-track');
  const slides = [...track.children];
  let active = 0;
  const update = () => {
    const center = track.getBoundingClientRect().left + track.clientWidth / 2;
    active = slides.reduce((best, slide, index) =>
      Math.abs(slide.getBoundingClientRect().left + slide.clientWidth / 2 - center) < Math.abs(slides[best].getBoundingClientRect().left + slides[best].clientWidth / 2 - center) ? index : best, 0);
    byId('review-position').textContent = `${String(active + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
    byId('review-prev').disabled = active === 0;
    byId('review-next').disabled = active === slides.length - 1;
  };
  byId('review-prev').addEventListener('click', () => slides[Math.max(0, active - 1)].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }));
  byId('review-next').addEventListener('click', () => slides[Math.min(slides.length - 1, active + 1)].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }));
  track.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}
setupReviews();
