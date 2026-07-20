(function () {
  "use strict";

  var COPY = {
    ar: {
      guest: "دخول / تسجيل",
      member: "حسابي",
      notifications: "الإشعارات",
    },
    fr: {
      guest: "Connexion",
      member: "Mon compte",
      notifications: "Notifications",
    },
    en: {
      guest: "Login / Sign up",
      member: "My Account",
      notifications: "Notifications",
    },
  };

  var USER_ICON =
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>';
  var BELL_ICON =
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>';

  var signedIn = false;
  var started = false;
  var authBound = false;
  var refreshSequence = 0;

  function language(explicitLanguage) {
    var value =
      explicitLanguage ||
      localStorage.getItem("strivio_lang") ||
      document.documentElement.lang ||
      "ar";
    value = String(value).toLowerCase().split("-")[0];
    return COPY[value] ? value : "ar";
  }

  function accountHref(isSignedIn) {
    return isSignedIn ? "my-account" : "auth?next=my-account";
  }

  function ensureMobileAccount(header) {
    var hamburger = header && header.querySelector("#HB");
    if (!hamburger || !hamburger.parentElement) return null;

    var tools = hamburger.parentElement;
    tools.classList.add("site-mobile-tools");

    var entry = tools.querySelector("[data-account-entry-mobile]");
    if (!entry) {
      entry = document.createElement("a");
      entry.setAttribute("data-account-entry-mobile", "");
      entry.className = "site-account-entry";
      entry.innerHTML =
        USER_ICON + '<span class="site-visually-hidden" data-account-entry-label></span>';
      tools.insertBefore(entry, hamburger);
    }
    return entry;
  }

  function createNotificationEntry(placement) {
    var entry = document.createElement("span");
    entry.hidden = true;
    entry.setAttribute("data-notification-entry", "");
    entry.setAttribute("data-notification-placement", placement);
    entry.innerHTML =
      '<button type="button" class="site-notification-trigger" data-notification-trigger aria-haspopup="dialog" aria-expanded="false">' +
      BELL_ICON +
      '<span class="site-visually-hidden" data-notification-label></span>' +
      '<span data-notification-badge hidden>0</span>' +
      "</button>";
    return entry;
  }

  function ensureNotificationEntries(header, mobileAccount) {
    if (!header) return;

    var hamburger = header.querySelector("#HB");
    var mobileTools = hamburger && hamburger.parentElement;
    if (mobileTools && !mobileTools.querySelector('[data-notification-placement="mobile"]')) {
      var mobileEntry = createNotificationEntry("mobile");
      mobileTools.insertBefore(mobileEntry, mobileAccount || hamburger);
    }

    var desktopAccount = header.querySelector("#NTB");
    var desktopTools = desktopAccount && desktopAccount.parentElement;
    if (
      desktopTools &&
      !desktopTools.querySelector('[data-notification-placement="desktop"]')
    ) {
      desktopTools.insertBefore(createNotificationEntry("desktop"), desktopAccount);
    }
  }

  function ensureStructure() {
    var header = document.querySelector("#NAV");
    if (!header) return;

    var mobileAccount = ensureMobileAccount(header);
    ensureNotificationEntries(header, mobileAccount);

    header.querySelectorAll("#MTB").forEach(function (drawerEntry) {
      drawerEntry.hidden = true;
      drawerEntry.classList.add("site-account-drawer-entry");
      drawerEntry.setAttribute("aria-hidden", "true");
      drawerEntry.setAttribute("tabindex", "-1");
    });
  }

  function render(explicitLanguage) {
    ensureStructure();

    var lang = language(explicitLanguage);
    var text = signedIn ? COPY[lang].member : COPY[lang].guest;
    var href = accountHref(signedIn);

    document.querySelectorAll("#NTB,[data-account-entry-mobile],[data-account-entry]").forEach(
      function (entry) {
        entry.href = href;
        entry.target = "_self";
        entry.title = text;
        entry.setAttribute("aria-label", text);
        entry.setAttribute("data-signed-in", signedIn ? "true" : "false");

        var label = entry.querySelector("[data-account-entry-label]");
        if (label) label.textContent = text;
        else entry.textContent = text;
      },
    );

    document.querySelectorAll("[data-notification-trigger]").forEach(function (trigger) {
      trigger.title = COPY[lang].notifications;
      trigger.setAttribute("aria-label", COPY[lang].notifications);
      var label = trigger.querySelector("[data-notification-label]");
      if (label) label.textContent = COPY[lang].notifications;
    });
  }

  async function refresh(explicitLanguage) {
    var sequence = ++refreshSequence;
    var client = window.supabaseClient;

    if (client && client.auth && typeof client.auth.getSession === "function") {
      try {
        var result = await client.auth.getSession();
        if (sequence !== refreshSequence) return;
        signedIn = !!(result && result.data && result.data.session);
      } catch (_) {
        if (sequence !== refreshSequence) return;
        signedIn = false;
      }
    } else {
      signedIn = false;
    }

    render(explicitLanguage);
  }

  function bindAuth() {
    if (authBound) return;
    var client = window.supabaseClient;
    if (!client || !client.auth || typeof client.auth.onAuthStateChange !== "function") return;

    authBound = true;
    client.auth.onAuthStateChange(function (_event, session) {
      signedIn = !!session;
      render();
    });
  }

  function start() {
    if (started) return;
    started = true;
    ensureStructure();
    render();
    bindAuth();
    refresh();

    document.addEventListener("click", function (event) {
      var target = event.target;
      if (target && typeof target.closest === "function" && target.closest("[data-l],[data-lang]")) {
        window.setTimeout(function () {
          render();
        }, 0);
      }
    });

    window.addEventListener("strivio:languagechange", function (event) {
      render(event.detail && event.detail.lang);
    });

    window.addEventListener("storage", function (event) {
      if (event.key === "strivio_lang") render(event.newValue);
    });

    if (typeof window.MutationObserver === "function") {
      new window.MutationObserver(function () {
        render(document.documentElement.lang);
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"],
      });
    }
  }

  window.StrivioAccountEntry = {
    refresh: refresh,
    render: render,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
