/* Set the theme before the first paint. Doing it in app.js means a light-mode
   visitor sees a dark frame while the script at the end of the body loads.
   A blocking script in <head> is still before paint; it lives in its own file
   so the page can ship a CSP without 'unsafe-inline'. */
(function () {
  var t = null;
  try { t = localStorage.getItem("scc-theme"); } catch (e) { /* private mode */ }
  if (!t) {
    t = window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.dataset.theme = t;
})();
