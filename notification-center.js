(function () {
  "use strict";

  var TEXT = {
    ar: {
      open: "الإشعارات",
      title: "مركز الإشعارات",
      subtitle: "آخر تحديثات طلباتك وخدماتك",
      markAll: "تعليم الكل كمقروء",
      empty: "لا توجد إشعارات حتى الآن.",
      loading: "جاري تحميل الإشعارات…",
      retry: "تعذر تحميل الإشعارات. اضغط للمحاولة مجددًا.",
      close: "إغلاق",
      unread: "غير مقروء",
      now: "الآن",
      minute: "منذ دقيقة",
      minutes: "منذ {n} دقائق",
      hour: "منذ ساعة",
      hours: "منذ {n} ساعات",
      day: "منذ يوم",
      days: "منذ {n} أيام",
      fallbackTitle: "تحديث جديد من Strivio",
      fallbackBody: "يوجد تحديث جديد متعلق بطلبك أو خدمتك.",
    },
    fr: {
      open: "Notifications",
      title: "Centre de notifications",
      subtitle: "Les dernières mises à jour de vos commandes et services",
      markAll: "Tout marquer comme lu",
      empty: "Aucune notification pour le moment.",
      loading: "Chargement des notifications…",
      retry: "Impossible de charger les notifications. Cliquez pour réessayer.",
      close: "Fermer",
      unread: "Non lue",
      now: "À l’instant",
      minute: "Il y a une minute",
      minutes: "Il y a {n} min",
      hour: "Il y a une heure",
      hours: "Il y a {n} h",
      day: "Hier",
      days: "Il y a {n} jours",
      fallbackTitle: "Nouvelle mise à jour Strivio",
      fallbackBody: "Une nouvelle mise à jour concerne votre commande ou votre service.",
    },
    en: {
      open: "Notifications",
      title: "Notification center",
      subtitle: "The latest updates about your orders and services",
      markAll: "Mark all as read",
      empty: "No notifications yet.",
      loading: "Loading notifications…",
      retry: "Could not load notifications. Click to try again.",
      close: "Close",
      unread: "Unread",
      now: "Just now",
      minute: "A minute ago",
      minutes: "{n} minutes ago",
      hour: "An hour ago",
      hours: "{n} hours ago",
      day: "Yesterday",
      days: "{n} days ago",
      fallbackTitle: "New Strivio update",
      fallbackBody: "There is a new update about your order or service.",
    },
  };

  var state = {
    user: null,
    items: [],
    unread: 0,
    loading: false,
    failed: false,
    open: false,
    panel: null,
    channel: null,
    client: null,
    claimedFor: null,
    previousOverflow: "",
  };

  function language() {
    var value = localStorage.getItem("strivio_lang") || document.documentElement.lang || "ar";
    return value === "fr" || value === "en" ? value : "ar";
  }

  function tx() {
    return TEXT[language()] || TEXT.ar;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function pick(value) {
    if (!value || typeof value !== "object") return "";
    var lang = language();
    return String(value[lang] || value.ar || value.fr || value.en || "");
  }

  function relativeTime(value) {
    var c = tx(), timestamp = new Date(value).getTime();
    if (!timestamp) return "";
    var minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return c.now;
    if (minutes === 1) return c.minute;
    if (minutes < 60) return c.minutes.replace("{n}", String(minutes));
    var hours = Math.floor(minutes / 60);
    if (hours === 1) return c.hour;
    if (hours < 24) return c.hours.replace("{n}", String(hours));
    var days = Math.floor(hours / 24);
    if (days === 1) return c.day;
    if (days < 14) return c.days.replace("{n}", String(days));
    try {
      return new Intl.DateTimeFormat(language() === "ar" ? "ar-DZ" : language() === "fr" ? "fr-DZ" : "en-GB", {
        year: "numeric", month: "short", day: "2-digit"
      }).format(new Date(timestamp));
    } catch (_) {
      return String(value).slice(0, 10);
    }
  }

  function injectStyles() {
    if (document.getElementById("strivio-notification-styles")) return;
    var style = document.createElement("style");
    style.id = "strivio-notification-styles";
    style.textContent =
      ".snc-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:inherit}" +
      ".snc-root.snc-open{pointer-events:auto}.snc-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.72);opacity:0;transition:opacity .24s ease;backdrop-filter:blur(8px)}" +
      ".snc-open .snc-backdrop{opacity:1}.snc-panel{position:absolute;top:max(12px,env(safe-area-inset-top));right:12px;bottom:max(12px,env(safe-area-inset-bottom));width:min(430px,calc(100vw - 24px));display:flex;flex-direction:column;background:linear-gradient(155deg,#141414,#080808);border:1px solid #303030;border-radius:26px;box-shadow:0 28px 90px rgba(0,0,0,.72);overflow:hidden;opacity:0;transform:translateX(24px) scale(.985);transition:opacity .24s ease,transform .28s cubic-bezier(.2,.8,.2,1)}" +
      ".snc-open .snc-panel{opacity:1;transform:none}.snc-head{padding:22px 20px 17px;border-bottom:1px solid #292929;background:rgba(16,16,16,.92)}" +
      ".snc-head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:15px}.snc-title{margin:0;color:#fff;font-size:21px;font-weight:950;line-height:1.25}.snc-subtitle{margin:5px 0 0;color:#888;font-size:12px;line-height:1.55}.snc-close{width:42px;height:42px;flex:none;border:1px solid #333;border-radius:14px;background:#171717;color:#fff;cursor:pointer;font-size:20px;transition:transform .18s ease,border-color .18s ease,background .18s ease}.snc-close:hover{border-color:#39ff14}.snc-close:active{transform:scale(.91)}" +
      ".snc-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px}.snc-count{display:inline-flex;align-items:center;min-height:26px;padding:4px 10px;border-radius:999px;background:#11240e;border:1px solid #24551d;color:#39ff14;font-size:11px;font-weight:900}.snc-mark{border:0;background:transparent;color:#bdbdbd;font:inherit;font-size:11px;font-weight:800;cursor:pointer;padding:6px;transition:color .18s ease}.snc-mark:hover{color:#39ff14}.snc-mark:disabled{opacity:.35;cursor:default}" +
      ".snc-list{flex:1;min-height:0;overflow:auto;padding:12px;overscroll-behavior:contain}.snc-item{position:relative;width:100%;display:grid;grid-template-columns:12px minmax(0,1fr) 22px;gap:12px;align-items:start;margin:0 0 9px;padding:16px;text-align:inherit;color:#fff;background:#111;border:1px solid #292929;border-radius:18px;cursor:pointer;font:inherit;transition:transform .18s ease,border-color .18s ease,background .18s ease}.snc-item:hover{transform:translateY(-1px);border-color:#3d3d3d;background:#151515}.snc-item:active{transform:scale(.985)}.snc-item.snc-unread{background:linear-gradient(135deg,#10180f,#111);border-color:#285622}.snc-dot{width:9px;height:9px;margin-top:6px;border-radius:50%;background:#6d6d6d;box-shadow:0 0 0 4px rgba(255,255,255,.03)}.snc-success .snc-dot{background:#39ff14;box-shadow:0 0 12px rgba(57,255,20,.45)}.snc-warning .snc-dot{background:#f6c453}.snc-error .snc-dot{background:#ff6464}.snc-item-title{display:block;color:#f7f7f7;font-size:14px;font-weight:950;line-height:1.45}.snc-item-body{display:block;margin-top:5px;color:#9d9d9d;font-size:12px;line-height:1.65}.snc-item-time{display:block;margin-top:9px;color:#666;font-size:10px}.snc-arrow{margin-top:3px;color:#565656;font-size:18px}.snc-unread .snc-arrow{color:#39ff14}.snc-state{height:100%;min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:35px;color:#888;font-size:13px;line-height:1.7}.snc-state-icon{width:56px;height:56px;display:grid;place-items:center;margin-bottom:13px;border:1px solid #303030;border-radius:18px;background:#111;color:#39ff14;font-size:25px}.snc-retry{border:0;background:transparent;color:#aaa;font:inherit;cursor:pointer}.snc-retry:hover{color:#39ff14}" +
      "[data-notification-entry]{position:relative}[data-notification-trigger]{position:relative}[data-notification-badge]{position:absolute;top:-6px;right:-7px;min-width:18px;height:18px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;border:2px solid #080808;border-radius:999px;background:#39ff14;color:#050505;font-size:9px;font-weight:950;line-height:1;box-shadow:0 0 13px rgba(57,255,20,.4)}[dir=rtl] [data-notification-badge]{right:auto;left:-7px}" +
      "@media(max-width:640px){.snc-panel{top:max(8px,env(safe-area-inset-top));right:8px;bottom:max(8px,env(safe-area-inset-bottom));width:calc(100vw - 16px);border-radius:24px}.snc-head{padding:20px 17px 15px}.snc-list{padding:10px}.snc-item{padding:14px}}" +
      "@media(prefers-reduced-motion:reduce){.snc-backdrop,.snc-panel,.snc-item,.snc-close{transition:none!important}}";
    document.head.appendChild(style);
  }

  function ensurePanel() {
    if (state.panel && document.body.contains(state.panel)) return state.panel;
    injectStyles();
    var root = document.createElement("div");
    root.className = "snc-root";
    root.id = "strivio-notification-center";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      '<div class="snc-backdrop" data-notification-close></div>' +
      '<aside class="snc-panel" role="dialog" aria-modal="true" aria-labelledby="snc-title" tabindex="-1">' +
        '<header class="snc-head"><div class="snc-head-row"><div><h2 class="snc-title" id="snc-title"></h2><p class="snc-subtitle" data-snc-subtitle></p></div><button class="snc-close" type="button" data-notification-close aria-label="">×</button></div>' +
        '<div class="snc-tools"><span class="snc-count" data-snc-count></span><button class="snc-mark" type="button" data-notification-mark-all></button></div></header>' +
        '<div class="snc-list" data-notification-list></div>' +
      '</aside>';
    document.body.appendChild(root);
    state.panel = root;
    applyLanguage();
    return root;
  }

  function entries() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-notification-entry]"));
  }

  function applyEntries() {
    var c = tx(), signedIn = !!state.user;
    entries().forEach(function (entry) {
      entry.hidden = !signedIn;
      entry.classList.toggle("hidden", !signedIn);
    });
    document.querySelectorAll("[data-notification-trigger]").forEach(function (button) {
      button.setAttribute("aria-label", c.open);
      button.setAttribute("title", c.open);
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", state.open ? "true" : "false");
    });
    document.querySelectorAll("[data-notification-badge]").forEach(function (badge) {
      badge.textContent = state.unread > 99 ? "99+" : String(state.unread || "");
      badge.hidden = !signedIn || state.unread < 1;
      badge.classList.toggle("hidden", !signedIn || state.unread < 1);
    });
  }

  function applyLanguage() {
    var root = ensurePanel(), c = tx(), rtl = language() === "ar";
    root.querySelector("#snc-title").textContent = c.title;
    root.querySelector("[data-snc-subtitle]").textContent = c.subtitle;
    root.querySelector("[data-notification-mark-all]").textContent = c.markAll;
    root.querySelector("[data-notification-close].snc-close").setAttribute("aria-label", c.close);
    root.querySelector(".snc-panel").setAttribute("dir", rtl ? "rtl" : "ltr");
    render();
    applyEntries();
  }

  function render() {
    var root = state.panel || ensurePanel(), list = root.querySelector("[data-notification-list]"), c = tx();
    var count = root.querySelector("[data-snc-count]"), markAll = root.querySelector("[data-notification-mark-all]");
    count.textContent = state.unread ? state.unread + " · " + c.unread : "0";
    markAll.disabled = state.unread < 1 || state.loading;
    if (state.loading && !state.items.length) {
      list.innerHTML = '<div class="snc-state"><div class="snc-state-icon">↻</div>' + esc(c.loading) + "</div>";
      return;
    }
    if (state.failed && !state.items.length) {
      list.innerHTML = '<button class="snc-state snc-retry" type="button" data-notification-retry><span class="snc-state-icon">!</span>' + esc(c.retry) + "</button>";
      return;
    }
    if (!state.items.length) {
      list.innerHTML = '<div class="snc-state"><div class="snc-state-icon">✓</div>' + esc(c.empty) + "</div>";
      return;
    }
    list.innerHTML = state.items.map(function (item) {
      var unread = !item.read_at, severity = /^(success|warning|error)$/.test(item.severity) ? item.severity : "info";
      return '<button type="button" class="snc-item snc-' + severity + (unread ? " snc-unread" : "") + '" data-notification-id="' + esc(item.id) + '">' +
        '<span class="snc-dot" aria-hidden="true"></span><span><span class="snc-item-title">' + esc(pick(item.title_i18n) || c.fallbackTitle) + '</span><span class="snc-item-body">' + esc(pick(item.body_i18n) || c.fallbackBody) + '</span><span class="snc-item-time">' + esc(relativeTime(item.created_at)) + '</span></span><span class="snc-arrow" aria-hidden="true">›</span></button>';
    }).join("");
  }

  async function load() {
    if (!state.user || !state.client || state.loading) return;
    state.loading = true;
    state.failed = false;
    render();
    try {
      if (state.claimedFor !== state.user.id) {
        await state.client.rpc("claim_my_email_notifications");
        state.claimedFor = state.user.id;
      }
      var results = await Promise.all([
        state.client.rpc("get_my_notifications", { p_limit: 50, p_before: null }),
        state.client.rpc("get_unread_notification_count"),
      ]);
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      state.items = results[0].data || [];
      state.unread = Number(results[1].data || 0);
    } catch (_) {
      state.failed = true;
    } finally {
      state.loading = false;
      render();
      applyEntries();
    }
  }

  function unsubscribe() {
    if (state.channel && state.client) {
      try { state.client.removeChannel(state.channel); } catch (_) {}
    }
    state.channel = null;
  }

  function subscribe() {
    unsubscribe();
    if (!state.user || !state.client || typeof state.client.channel !== "function") return;
    state.channel = state.client.channel("strivio-notifications-" + state.user.id)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "user_notifications", filter: "user_id=eq." + state.user.id
      }, function () { load(); })
      .subscribe();
  }

  async function useSession(session) {
    var nextUser = session && session.user ? session.user : null;
    var changed = String(state.user && state.user.id || "") !== String(nextUser && nextUser.id || "");
    state.user = nextUser;
    if (!nextUser) {
      state.items = [];
      state.unread = 0;
      state.claimedFor = null;
      unsubscribe();
      close();
      applyEntries();
      return;
    }
    applyEntries();
    if (changed) subscribe();
    await load();
  }

  function open() {
    if (!state.user) return;
    var root = ensurePanel();
    applyLanguage();
    state.open = true;
    state.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.classList.add("snc-open");
    root.setAttribute("aria-hidden", "false");
    applyEntries();
    setTimeout(function () { root.querySelector(".snc-panel").focus(); }, 20);
    load();
  }

  function close() {
    if (!state.panel) return;
    state.open = false;
    state.panel.classList.remove("snc-open");
    state.panel.setAttribute("aria-hidden", "true");
    document.body.style.overflow = state.previousOverflow;
    applyEntries();
  }

  async function markRead(id, navigate) {
    var item = state.items.find(function (value) { return value.id === id; });
    if (!item || !state.client) return;
    if (!item.read_at) {
      item.read_at = new Date().toISOString();
      state.unread = Math.max(0, state.unread - 1);
      render();
      applyEntries();
      var result = await state.client.rpc("mark_notification_read", { p_notification_id: id });
      if (result.error) load();
    }
    if (navigate && /^\/(?!\/)/.test(String(item.action_url || ""))) window.location.href = item.action_url;
  }

  async function markAll() {
    if (!state.client || state.unread < 1) return;
    state.items.forEach(function (item) { if (!item.read_at) item.read_at = new Date().toISOString(); });
    state.unread = 0;
    render();
    applyEntries();
    var result = await state.client.rpc("mark_all_notifications_read");
    if (result.error) load();
  }

  function bindEvents() {
    document.addEventListener("click", function (event) {
      var trigger = event.target.closest && event.target.closest("[data-notification-trigger]");
      if (trigger) { event.preventDefault(); open(); return; }
      var closer = event.target.closest && event.target.closest("[data-notification-close]");
      if (closer) { event.preventDefault(); close(); return; }
      var item = event.target.closest && event.target.closest("[data-notification-id]");
      if (item) { event.preventDefault(); markRead(item.getAttribute("data-notification-id"), true); return; }
      if (event.target.closest && event.target.closest("[data-notification-mark-all]")) { event.preventDefault(); markAll(); return; }
      if (event.target.closest && event.target.closest("[data-notification-retry]")) { event.preventDefault(); load(); }
    });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && state.open) close(); });
    window.addEventListener("storage", function (event) { if (event.key === "strivio_lang") applyLanguage(); });
    window.addEventListener("strivio:language-changed", applyLanguage);
    new MutationObserver(function () { applyEntries(); }).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["lang", "dir"]
    });
  }

  async function waitForClient() {
    for (var i = 0; i < 120; i++) {
      if (window.supabaseClient && window.supabaseClient.auth) return window.supabaseClient;
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    return null;
  }

  async function init() {
    ensurePanel();
    bindEvents();
    applyEntries();
    state.client = await waitForClient();
    if (!state.client) return;
    var current = await state.client.auth.getSession();
    await useSession(current && current.data ? current.data.session : null);
    state.client.auth.onAuthStateChange(function (_event, session) {
      setTimeout(function () { useSession(session); }, 0);
    });
  }

  window.StrivioNotifications = {
    init: init,
    open: open,
    close: close,
    refresh: load,
    markAllRead: markAll,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
