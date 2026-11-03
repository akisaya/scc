// The dark/light toggle.

import { $ } from "./dom.js";

// The theme is already on <html> by the time this file runs (static/theme.js does
// it before first paint); this only wires the toggle and follows the system.
function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem("scc-theme", theme); } catch (e) { /* ignore */ }
  }
}

export function initTheme() {
  const saved = (() => {
    try { return localStorage.getItem("scc-theme"); } catch (e) { return null; }
  })();
  const pick = () => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyTheme(document.documentElement.dataset.theme || saved || pick(), false);
  // keep following the system until the user chooses explicitly
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    let chosen = null;
    try { chosen = localStorage.getItem("scc-theme"); } catch (e) { /* ignore */ }
    if (!chosen) applyTheme(pick(), false);
  });
  $("#theme").onclick = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next, true);
  };
}
