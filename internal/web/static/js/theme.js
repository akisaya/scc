// The dark/light toggle.
//
// Three states, two buttons' worth of UI: no stored value means "follow the
// system", a stored "light" or "dark" pins one scheme. Toggling stores the
// scheme only when it differs from what the OS asks for, so toggling back to the
// system's own choice (say, at night) hands control back to the system instead
// of invisibly pinning the scheme forever.

import { $ } from "./dom.js";

const KEY = "scc-theme";
const mq = matchMedia("(prefers-color-scheme: light)");
const system = () => (mq.matches ? "light" : "dark");

function saved() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch (e) {
    return null;
  }
}

const rendered = () => saved() || system();

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#1e222a" : "#f6f8fb";
  // name the action, not the state: the label says what the button will do
  const next = theme === "dark" ? "浅色" : "深色";
  const btn = $("#theme");
  btn.title = `切换到${next}`;
  btn.setAttribute("aria-label", `切换到${next}`);
}

export function initTheme() {
  // static/theme.js already put the resolved theme on <html> before paint
  const now = document.documentElement.dataset.theme;
  apply(now === "light" ? "light" : "dark");
  // keep following the system while the user has not pinned a scheme
  mq.addEventListener("change", () => {
    if (!saved()) apply(system());
  });
  // another tab may have pinned one
  window.addEventListener("storage", (ev) => {
    if (ev.key === KEY) apply(rendered());
  });
  $("#theme").onclick = () => {
    const target = rendered() === "dark" ? "light" : "dark";
    try {
      if (target === system()) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, target);
    } catch (e) { /* private mode: the page still switches for this session */ }
    apply(target);
  };
}
