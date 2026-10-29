import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, Boxes, Check, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Command, CreditCard, DoorOpen, Eye, EyeOff, Filter, LayoutDashboard,
  LockKeyhole, LogOut, Menu, MoreHorizontal, PackageCheck, PackageSearch, Search,
  Settings2, ShieldCheck, ShoppingBag, Sparkles, Truck, Users, X,
} from 'lucide-react';
import { supabase, supabaseReady } from '../supabase.js';

const STATUS = {
  new: ['New', 'blue'], confirmed: ['Confirmed', 'purple'], preparing: ['Preparing', 'amber'],
  shipped: ['Shipped', 'slate'], delivered: ['Delivered', 'green'], cancelled: ['Cancelled', 'red'],
};
const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'products', label: 'Products', icon: Boxes },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];
const formatMoney = (amount = 0) => `${Number(amount).toLocaleString('en-US')} DZD`;
const dateText = (date) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(date));

function StatusBadge({ status }) {
  const [label, color] = STATUS[status] || [status, 'slate'];
  return <span className={`status-badge status-${color}`}><i />{label}</span>;
}

function AuthScreen({ onAuthenticated }) {
  const [phase, setPhase] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const requireFactor = async (user) => {
    const { data: member, error: memberError } = await supabase.from('glow_admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (memberError || !member) {
      await supabase.auth.signOut();
      throw new Error('This account is not authorized for Glow Store administration.');
    }
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance.currentLevel === 'aal2') {
      onAuthenticated();
      return;
    }
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verified = factors.totp.find((factor) => factor.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setPhase('verify');
      return;
    }
    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Glow Store Admin' });
    if (enrollError) throw enrollError;
    setFactorId(enrolled.id);
    setManualSecret(enrolled.totp.secret);
    setQrUrl(URL.createObjectURL(new Blob([enrolled.totp.qr_code], { type: 'image/svg+xml' })));
    setPhase('enroll');
  };

  useEffect(() => () => { if (qrUrl) URL.revokeObjectURL(qrUrl); }, [qrUrl]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (phase === 'login') {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        await requireFactor(data.user);
      } else {
        const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
        if (verifyError) throw verifyError;
        onAuthenticated();
      }
    } catch (caught) {
      setError(phase === 'login' ? 'Sign-in failed. Check your credentials or administrator access.' : 'That code could not be verified. Try the latest six-digit code.');
    } finally { setBusy(false); }
  };

  if (!supabaseReady) return <div className="auth-page"><div className="auth-card"><Logo /><h1>Connect your store</h1><p>Add the Supabase project URL and publishable key to the local environment before signing in.</p><code>VITE_SUPABASE_URL<br />VITE_SUPABASE_PUBLISHABLE_KEY</code></div></div>;

  return <div className="auth-page">
    <div className="auth-art"><span className="art-caption">GLOW STORE · PRIVATE ADMIN</span><div className="art-monogram">G<span>·</span></div><p>Thoughtful beauty.<br />A store in good order.</p><small>Orders · stock · delivery</small><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /></div>
    <section className="auth-main"><div className="auth-main-top"><Logo /><span><LockKeyhole size={14} /> Secure workspace</span></div>
      <div className="auth-form-wrap"><div className="auth-mark"><ShieldCheck size={20} /></div>
        <p className="eyebrow">{phase === 'login' ? 'ADMIN ACCESS' : 'TWO-STEP VERIFICATION'}</p>
        <h1>{phase === 'login' ? 'Welcome back.' : phase === 'enroll' ? 'Protect your account.' : 'One last check.'}</h1>
        <p className="auth-description">{phase === 'login' ? 'Sign in with the invited admin account to manage Glow Store.' : phase === 'enroll' ? 'Scan this code in an authenticator app, or enter the setup key, then verify the six-digit code.' : 'Enter the current code from your authenticator app.'}</p>
        {phase === 'enroll' && <div className="mfa-setup">{qrUrl && <img className="mfa-qr" src={qrUrl} alt="Authenticator setup QR code" />}<div><span className="field-caption">MANUAL SETUP KEY</span><code className="secret-code">{manualSecret}</code></div></div>}
        <form className="auth-form" onSubmit={submit}>
          {phase === 'login' ? <><label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label></>
            : <label>Authenticator code<input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} required /></label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? 'Verifying…' : phase === 'login' ? 'Continue securely' : 'Verify and continue'}<ChevronRight size={17} /></button>
        </form>
        <div className="auth-assurance"><BadgeCheck size={15} /><span>Protected by Supabase Auth, database permissions and MFA.</span></div>
      </div><footer className="auth-foot"><span>© {new Date().getFullYear()} Glow Store</span><span>Private admin · v1.0</span></footer>
    </section>
  </div>;
}

function Logo({ small = false }) {
  return <a className={`admin-logo ${small ? 'admin-logo-small' : ''}`} href="#admin"><span className="logo-symbol">g</span><span>glow<span className="logo-dot">.</span><small>STORE ADMIN</small></span></a>;
}

function SessionMfaPrompt({ factorId, onVerified }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
    setBusy(false);
    if (verifyError) setError('That code could not be verified. Try the latest six-digit code.'); else onVerified();
  };
  return <div className="auth-page"><section className="auth-main"><div className="auth-main-top"><Logo /><span><LockKeyhole size={14} /> Session verification</span></div><div className="auth-form-wrap"><div className="auth-mark"><ShieldCheck size={20} /></div><p className="eyebrow">TWO-STEP VERIFICATION</p><h1>Confirm it’s you.</h1><p className="auth-description">This session needs a fresh authenticator check before private store data can load.</p><form className="auth-form" onSubmit={submit}><label>Authenticator code<input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value)} required /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Verifying…' : 'Verify and continue'}<ChevronRight size={17} /></button></form></div></section></div>;
}

function AdminApp() {
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [accessReady, setAccessReady] = useState(false);
  const [requiredFactor, setRequiredFactor] = useState('');
  const [activePage, setActivePage] = useState('overview');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderFilter, setOrderFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) { setAuthChecked(true); return undefined; }
    let mounted = true;
    const checkInitial = async () => {
      const { data: { session: current } } = await supabase.auth.getSession();
      if (!mounted || !current) { if (mounted) setAuthChecked(true); return; }
      const { data: member } = await supabase.from('glow_admins').select('user_id').eq('user_id', current.user.id).maybeSingle();
      if (!member) { await supabase.auth.signOut(); if (mounted) setAuthChecked(true); return; }
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (mounted) {
        setSession(current); setAccessReady(level?.currentLevel === 'aal2');
        if (level?.currentLevel !== 'aal2') {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const verified = factors?.totp?.find((factor) => factor.status === 'verified');
          if (mounted && verified) setRequiredFactor(verified.id);
          else if (mounted) await supabase.auth.signOut();
        }
        setAuthChecked(true);
      }
    };
    checkInitial();
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT') { setSession(null); setAccessReady(false); setRequiredFactor(''); }
      if (event === 'TOKEN_REFRESHED' && next) {
        setSession(next); setAccessReady(false);
        queueMicrotask(async () => {
          const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (!mounted) return;
          if (level?.currentLevel === 'aal2') { setAccessReady(true); setRequiredFactor(''); return; }
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const verified = factors?.totp?.find((factor) => factor.status === 'verified');
          if (mounted && verified) setRequiredFactor(verified.id);
        });
      }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  const loadData = useCallback(async () => {
    if (!session) return;
    setLoading(true); setMessage('');
    const [ordersResult, productsResult, settingsResult] = await Promise.all([
      supabase.from('glow_orders').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('glow_products').select('id,name_en,item_price_dzd,included_in_bundle,is_active').order('id'),
      supabase.from('glow_store_settings').select('bundle_price_dzd,delivery_home_dzd,delivery_office_dzd').eq('id', true).single(),
    ]);
    const errors = [ordersResult.error, productsResult.error, settingsResult.error].filter(Boolean);
    if (errors.length) setMessage(errors[0].message.includes('relation') || errors[0].code === 'PGRST205' ? 'Database setup is not applied yet. Apply the migration in supabase/migrations to enable the workspace.' : 'Some records could not be loaded. Check your admin session and database policies.');
    setOrders(ordersResult.data || []);
    setProducts(productsResult.data || []);
    setSettings(settingsResult.data || null);
    setLoading(false);
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);

  const todayOrders = useMemo(() => orders.filter((order) => new Date(order.created_at).toDateString() === new Date().toDateString()), [orders]);
  const newOrders = useMemo(() => orders.filter((order) => order.status === 'new'), [orders]);
  const revenue = useMemo(() => orders.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + Number(order.bundle_price_dzd), 0), [orders]);
  const filteredOrders = useMemo(() => orders.filter((order) => (orderFilter === 'all' || order.status === orderFilter)
    && `${order.order_number} ${order.first_name} ${order.last_name} ${order.phone}`.toLowerCase().includes(query.trim().toLowerCase())), [orders, orderFilter, query]);

  const updateStatus = async (order, status) => {
    setSaving(true); setMessage('');
    const { error } = await supabase.rpc('set_glow_order_status', { p_order_id: order.id, p_status: status });
    if (error) setMessage('Status was not changed. Refresh your MFA session and try again.');
    else { setSelectedOrder({ ...order, status }); await loadData(); }
    setSaving(false);
  };

  const saveProduct = async (product, changes) => {
    setSaving(true); setMessage('');
    const { error } = await supabase.from('glow_products').update(changes).eq('id', product.id);
    setSaving(false);
    if (error) setMessage('Could not save product changes. Check MFA and retry.'); else { setMessage('Product settings saved.'); await loadData(); }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setMessage('');
    const { error } = await supabase.from('glow_store_settings').update({
      bundle_price_dzd: Number(form.get('bundle')), delivery_home_dzd: Number(form.get('home')),
      delivery_office_dzd: Number(form.get('office')),
    }).eq('id', true);
    setSaving(false);
    if (error) setMessage('Settings were not saved. Check that your MFA session is active.'); else { setMessage('Store settings saved.'); await loadData(); }
  };

  if (!authChecked) return <div className="loading-screen"><span className="loading-ring" />Checking secure session…</div>;
  if (!session) return <AuthScreen onAuthenticated={() => supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAccessReady(true); })} />;
  if (!accessReady) return requiredFactor
    ? <SessionMfaPrompt factorId={requiredFactor} onVerified={() => { setAccessReady(true); setRequiredFactor(''); }} />
    : <div className="loading-screen"><span className="loading-ring" />Verifying administrator access…</div>;

  return <div className="admin-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Logo /><button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <div className="store-switcher"><span className="store-avatar">G</span><span><strong>Glow Store</strong><small>Beauty · Algeria</small></span><ChevronDown size={15} /></div>
      <span className="nav-caption">WORKSPACE</span>
      <nav className="admin-nav" aria-label="Admin navigation">{NAV.map(({ id, label, icon: Icon }) => <button key={id} className={activePage === id ? 'nav-active' : ''} onClick={() => { setActivePage(id); setMobileNav(false); }}><Icon size={18} /><span>{label}</span>{id === 'orders' && newOrders.length > 0 && <i className="nav-count">{newOrders.length}</i>}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-support"><div className="support-icon"><CircleHelp size={17} /></div><strong>Need a hand?</strong><span>Keep your store details up to date for every order.</span><button onClick={() => setActivePage('settings')}>Open settings <ArrowUpRight size={14} /></button></div>
      <div className="profile-card"><span className="profile-avatar">{session.user.email?.[0]?.toUpperCase() || 'A'}</span><span className="profile-info"><strong>{session.user.email?.split('@')[0]}</strong><small>Store administrator</small></span><button className="icon-button" onClick={() => supabase.auth.signOut()} aria-label="Sign out"><LogOut size={17} /></button></div>
    </aside>
    {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation overlay" />}
    <main className="admin-main">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumb"><span>Glow Store</span><ChevronRight size={15} /><strong>{NAV.find((item) => item.id === activePage)?.label}</strong></div><div className="topbar-actions"><span className="live-pill"><i /> Store live</span><span className="topbar-date">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span><button className="topbar-avatar" title={session.user.email}>{session.user.email?.[0]?.toUpperCase()}</button></div></header>
      <div className="page-content">
        {message && <div className={`notice ${message.includes('not ') || message.includes('could not') || message.includes('not applied') ? 'notice-error' : ''}`} role="status"><span>{message}</span><button onClick={() => setMessage('')} aria-label="Dismiss"><X size={16} /></button></div>}
        {loading && <div className="content-loading"><span className="loading-ring" />Loading store data…</div>}
        {!loading && activePage === 'overview' && <Overview orders={orders} todayOrders={todayOrders} newOrders={newOrders} revenue={revenue} setPage={setActivePage} setOrder={setSelectedOrder} />}
        {!loading && activePage === 'orders' && <OrdersPage orders={filteredOrders} total={orders.length} filter={orderFilter} setFilter={setOrderFilter} query={query} setQuery={setQuery} onSelect={setSelectedOrder} />}
        {!loading && activePage === 'products' && <ProductsPage products={products} saving={saving} onSave={saveProduct} />}
        {!loading && activePage === 'settings' && <SettingsPage settings={settings} saving={saving} onSave={saveSettings} />}
      </div>
      {selectedOrder && <OrderDrawer order={selectedOrder} onClose={() => setSelectedOrder(null)} onStatus={updateStatus} saving={saving} />}
    </main>
  </div>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function MetricCard({ label, value, note, icon: Icon, tone, delta }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><i className={`metric-icon metric-${tone}`}><Icon size={18} /></i></div><strong className="metric-value">{value}</strong><div className="metric-note"><span className="metric-delta"><ArrowUpRight size={13} />{delta}</span>{note}</div></article>;
}

function Overview({ orders, todayOrders, newOrders, revenue, setPage, setOrder }) {
  const latest = orders.slice(0, 5);
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(now); date.setDate(now.getDate() - 6 + index); return date; });
  const activity = days.map((date) => ({ label: new Intl.DateTimeFormat('en', { weekday: 'narrow' }).format(date), count: orders.filter((order) => new Date(order.created_at).toDateString() === date.toDateString()).length }));
  const maxActivity = Math.max(1, ...activity.map((day) => day.count));
  return <>
    <PageHeading eyebrow={`${new Intl.DateTimeFormat('en', { weekday: 'long' }).format(now).toUpperCase()} · STORE OVERVIEW`} title="Good to have you back." description="Here’s what’s happening with your Glow Store today." action={<button className="outline-button" onClick={() => setPage('orders')}><PackageSearch size={16} />View all orders</button>} />
    <section className="metrics-grid"><MetricCard label="Total orders" value={orders.length.toLocaleString()} note="all time" icon={ShoppingBag} tone="pink" delta={`${todayOrders.length} today`} /><MetricCard label="Needs attention" value={newOrders.length.toLocaleString()} note="new orders to review" icon={Clock3} tone="amber" delta={newOrders.length ? 'Action needed' : 'All clear'} /><MetricCard label="Gross sales" value={formatMoney(revenue)} note="excluding cancelled orders" icon={CreditCard} tone="green" delta="Lifetime" /><MetricCard label="Orders today" value={todayOrders.length.toLocaleString()} note="since midnight" icon={Truck} tone="blue" delta="Today" /></section>
    <div className="overview-grid"><section className="panel chart-panel"><div className="panel-header"><div><h2>Order activity</h2><p>New orders placed over the last seven days.</p></div><span className="select-small">Last 7 days</span></div><div className="chart-summary"><strong>{activity.reduce((sum, day) => sum + day.count, 0)}</strong><span>orders this week</span><span className="chart-change"><ArrowUpRight size={14} />Live data</span></div><div className="bar-chart" aria-label="Order count for each of the last seven days">{activity.map((item, index) => <div className="bar-column" key={`${item.label}-${index}`} title={`${item.count} orders`}><div className="bar-track"><span className={index === activity.length - 1 ? 'bar-highlight' : ''} style={{ height: `${item.count ? Math.max(10, (item.count / maxActivity) * 100) : 4}%` }} /></div><small>{item.label}</small></div>)}</div><p className="chart-footnote"><Sparkles size={14} />Counts reflect customer orders saved in Supabase.</p></section>
      <section className="panel attention-panel"><div className="panel-header"><div><h2>Order queue</h2><p>Stay on top of what needs attention.</p></div><button className="text-button" onClick={() => setPage('orders')}>View queue <ChevronRight size={15} /></button></div><div className="queue-stat"><span className="queue-icon"><PackageCheck size={18} /></span><div><strong>{newOrders.length} new</strong><small>Orders waiting for review</small></div><span className="queue-dot" /></div><div className="queue-rule" /><div className="queue-steps">{[['Confirm orders', 'Review customer details'], ['Prepare the pack', 'Pick the three selected shades'], ['Hand off to delivery', 'Update the order when shipped']].map(([title, note], index) => <div className="queue-step" key={title}><span className={`step-number ${index === 0 && newOrders.length ? 'step-current' : ''}`}>{index + 1}</span><span><strong>{title}</strong><small>{note}</small></span></div>)}</div></section></div>
    <section className="panel recent-panel"><div className="panel-header"><div><h2>Recent orders</h2><p>The latest activity across your store.</p></div><button className="text-button" onClick={() => setPage('orders')}>All orders <ChevronRight size={15} /></button></div><OrdersTable orders={latest} onSelect={setOrder} compact /></section>
  </>;
}

function OrdersPage({ orders, total, filter, setFilter, query, setQuery, onSelect }) {
  const filters = [['all', 'All orders'], ['new', 'New'], ['confirmed', 'Confirmed'], ['preparing', 'Preparing'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
  return <><PageHeading eyebrow="SALES & FULFILMENT" title="Orders" description="Review customer details, confirm the chosen shades and track delivery." action={<span className="order-total-badge"><span />{total} total</span>} />
    <section className="panel orders-panel"><div className="orders-toolbar"><div className="filter-tabs" role="tablist" aria-label="Filter orders">{filters.map(([value, label]) => <button role="tab" aria-selected={filter === value} className={filter === value ? 'filter-active' : ''} key={value} onClick={() => setFilter(value)}>{label}{value === 'new' && orders.filter((order) => order.status === 'new').length > 0 && <i />}</button>)}</div><div className="table-tools"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search orders…" /><kbd>⌘ K</kbd></label><button className="icon-button filter-button" aria-label="Filter orders"><Filter size={17} /></button></div></div>
      <OrdersTable orders={orders} onSelect={onSelect} />{orders.length === 0 && <div className="empty-state"><span><ShoppingBag size={21} /></span><strong>No orders found</strong><p>Try another search or filter. New customer orders will show up here.</p></div>}
      <div className="table-footer"><span>Showing <strong>{orders.length}</strong> of <strong>{total}</strong> orders</span><div><button disabled>Previous</button><span>1</span><button disabled>Next</button></div></div>
    </section></>;
}

function OrdersTable({ orders, onSelect, compact = false }) {
  return <div className="table-scroll"><table className="orders-table"><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>PRODUCTS</th><th>DELIVERY</th><th>TOTAL</th><th>STATUS</th><th>{compact ? '' : 'PLACED'}</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id} onClick={() => onSelect(order)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onSelect(order); }}><td><button className="order-number" onClick={(event) => { event.stopPropagation(); onSelect(order); }}>{order.order_number}</button></td><td><span className="customer-cell"><i>{order.first_name?.[0]?.toUpperCase()}{order.last_name?.[0]?.toUpperCase()}</i><span><strong>{order.first_name} {order.last_name}</strong><small>{order.phone}</small></span></span></td><td><span className="product-pills"><i>F</i><i>P</i><i>L</i><small>3 items</small></span></td><td><span className="delivery-cell">{order.delivery_method === 'home' ? 'Home delivery' : 'Pickup office'}</span></td><td><strong className="money-cell">{formatMoney(order.total_dzd)}</strong></td><td><StatusBadge status={order.status} /></td>{!compact && <td><span className="date-cell">{dateText(order.created_at)}</span></td>}</tr>)}</tbody></table></div>;
}

function ProductsPage({ products, saving, onSave }) {
  return <><PageHeading eyebrow="CATALOG MANAGEMENT" title="Products" description="Keep the offer, individual prices and availability accurate." action={<span className="secure-label"><ShieldCheck size={15} />Changes require MFA</span>} />
    <div className="product-admin-grid">{products.map((product) => <ProductAdminCard product={product} saving={saving} onSave={onSave} key={product.id} />)}</div>
    <div className="info-strip"><span><CircleHelp size={18} /></span><p><strong>Bundle pricing stays server-calculated.</strong> Customers choose these shades, but the database validates each one and calculates the final order total itself.</p></div>
  </>;
}

function ProductAdminCard({ product, saving, onSave }) {
  const [unitPrice, setUnitPrice] = useState(product.item_price_dzd ?? '');
  const [active, setActive] = useState(product.is_active);
  useEffect(() => { setUnitPrice(product.item_price_dzd ?? ''); setActive(product.is_active); }, [product]);
  const initials = { foundation: 'FD', powder: 'MP', lipstick: 'LC' }[product.id] || 'GS';
  return <article className="product-admin-card"><div className={`product-art product-art-${product.id}`}><span>{initials}</span><i className="product-glow" /></div><div className="product-admin-content"><div className="product-admin-top"><div><span className="product-type">{product.id === 'lipstick' ? 'GIFT ITEM' : 'BUNDLE ITEM'}</span><h2>{product.name_en}</h2></div><span className={`availability-pill ${active ? 'is-available' : 'is-paused'}`}><i />{active ? 'Available' : 'Hidden'}</span></div><div className="product-admin-meta"><span>Included in the 3-piece offer</span><strong>{product.included_in_bundle ? 'Yes' : 'No'}</strong></div><label className="field-admin">Individual price <small>Optional for future single-product orders</small><span className="money-input"><input type="number" min="0" max="10000000" step="50" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="Not set" /><span>DZD</span></span></label><div className="product-admin-actions"><label className="toggle-control"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span /><small>Visible in store</small></label><button className="small-save" disabled={saving} onClick={() => onSave(product, { item_price_dzd: unitPrice === '' ? null : Number(unitPrice), is_active: active })}>{saving ? 'Saving…' : 'Save changes'}</button></div></div></article>;
}

function SettingsPage({ settings, saving, onSave }) {
  return <><PageHeading eyebrow="STORE PREFERENCES" title="Settings" description="Pricing and delivery values used by the customer checkout." action={<span className="secure-label"><ShieldCheck size={15} />Admin only · MFA protected</span>} />
    <div className="settings-layout"><form className="panel settings-form" onSubmit={onSave}><div className="settings-title"><span className="settings-icon"><CreditCard size={19} /></span><div><h2>Offer & delivery</h2><p>These amounts are read from Supabase. The database uses the saved values when it stores each order.</p></div></div><label className="settings-field"><span>Bundle price <small>Foundation + powder + free lipstick</small></span><span className="money-input"><input name="bundle" type="number" min="0" max="10000000" step="50" defaultValue={settings?.bundle_price_dzd ?? 3200} required /><span>DZD</span></span></label><div className="settings-divider" /><label className="settings-field"><span>Home delivery <small>Flat courier price currently configured in the project</small></span><span className="money-input"><input name="home" type="number" min="0" max="1000000" step="50" defaultValue={settings?.delivery_home_dzd ?? 600} required /><span>DZD</span></span></label><label className="settings-field"><span>Pickup office <small>Flat courier price currently configured in the project</small></span><span className="money-input"><input name="office" type="number" min="0" max="1000000" step="50" defaultValue={settings?.delivery_office_dzd ?? 400} required /><span>DZD</span></span></label><button className="primary-button settings-save" disabled={saving}>{saving ? 'Saving settings…' : 'Save settings'}<Check size={16} /></button></form>
      <aside className="settings-side"><section className="panel security-panel"><div className="security-symbol"><ShieldCheck size={22} /></div><span className="eyebrow">ACCOUNT SECURITY</span><h2>Built around your access.</h2><p>Only invited admin accounts can enter. Every private order read and admin change requires an active authenticator check.</p><ul><li><Check size={15} />No public sign-up</li><li><Check size={15} />Database row policies</li><li><Check size={15} />Authenticator verification</li></ul></section><div className="settings-help"><span><CircleHelp size={16} /></span><p>New administrator access is provisioned in the Supabase dashboard. Store admins cannot invite themselves.</p></div></aside>
    </div></>;
}

function OrderDrawer({ order, onClose, onStatus, saving }) {
  const [copyLabel, setCopyLabel] = useState('Copy phone');
  return <div className="drawer-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="order-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div className="drawer-head"><div><span className="eyebrow">ORDER DETAILS</span><h2 id="drawer-title">{order.order_number}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close order details"><X size={19} /></button></div>
    <div className="drawer-scroll"><div className="drawer-status-row"><StatusBadge status={order.status} /><span>Placed {dateText(order.created_at)}</span></div><div className="drawer-section"><h3>Customer</h3><div className="drawer-person"><i>{order.first_name?.[0]}{order.last_name?.[0]}</i><span><strong>{order.first_name} {order.last_name}</strong><small>Glow Store customer</small></span></div><div className="drawer-contact"><a href={`tel:${order.phone}`}>{order.phone}</a><button onClick={async () => { await navigator.clipboard.writeText(order.phone); setCopyLabel('Copied'); setTimeout(() => setCopyLabel('Copy phone'), 1400); }}>{copyLabel}</button></div></div>
      <div className="drawer-section"><h3>Selected products</h3><div className="shade-order-row"><i className="swatch-foundation" /><span><strong>Derma foundation</strong><small>Shade {order.foundation_shade}</small></span><span>Included</span></div><div className="shade-order-row"><i className="swatch-powder" /><span><strong>Matte powder</strong><small>Shade {order.powder_shade}</small></span><span>Included</span></div><div className="shade-order-row"><i className="swatch-lipstick" /><span><strong>Lipstick crayon</strong><small>Shade {order.lipstick_shade}</small></span><span>Free gift</span></div></div>
      <div className="drawer-section"><h3>Delivery</h3><div className="delivery-address"><Truck size={17} /><span><strong>{order.delivery_method === 'home' ? 'Home delivery' : 'Pickup office'}</strong><small>{order.wilaya_code} · Commune #{order.commune_id}</small>{order.address && <small>{order.address}</small>}</span></div></div>
      <div className="drawer-section"><h3>Order summary</h3><div className="summary-line"><span>3-piece bundle</span><strong>{formatMoney(order.bundle_price_dzd)}</strong></div><div className="summary-line"><span>Delivery</span><strong>{formatMoney(order.delivery_fee_dzd)}</strong></div><div className="summary-line summary-total"><span>Total</span><strong>{formatMoney(order.total_dzd)}</strong></div></div>
      <div className="drawer-section status-change"><h3>Update status</h3><div className="select-wrap"><select aria-label="Update order status" value={order.status} onChange={(event) => onStatus(order, event.target.value)} disabled={saving}>{Object.entries(STATUS).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={15} /></div><small>Changes are recorded in the admin audit history.</small></div>
    </div></aside></div>;
}

export default AdminApp;
