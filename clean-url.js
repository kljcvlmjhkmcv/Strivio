(function () {
  var path = window.location.pathname;
  if (!path.endsWith(".html")) return;
  var cleanPath = path.replace(/\.html$/, "") || "/";
  window.history.replaceState(
    null,
    "",
    cleanPath + window.location.search + window.location.hash,
  );
})();
