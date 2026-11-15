/* Set the theme before the first paint. Doing it in app.js means a light-mode
   visitor sees a dark frame while the script at the end of the body loads.
   A blocking script in <head> is still before paint; it lives in its own file
   so the page can ship a CSP without 'unsafe-inline'.
   Only the saved override is read here; the policy that writes it lives in
   js/theme.js. */
(function () {
  var t = null;
  try { t = localStorage.getItem("scc-theme"); } catch (e) { /* private mode */ }
  if (t !== "light" && t !== "dark") {
    t = window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.dataset.theme = t;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === "dark" ? "#1e222a" : "#f6f8fb";
})();
