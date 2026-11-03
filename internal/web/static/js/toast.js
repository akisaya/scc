// The toasts: one progress card for uploads and batch deletes, and a short stack
// of messages above it.

import { $, el } from "./dom.js";
import { explainErr } from "./errors.js";

// three is enough to see what just happened; older ones are dropped first
const MAX_MSGS = 3;
const SUCCESS_MS = 3000;

export function hideBar() {
  const bar = $("#progress");
  bar.hidden = true;
  bar.querySelector(".toast-cancel").hidden = true;
}

// showBar fills the progress card. onCancel is only passed by the upload loop;
// it turns the bar into something the user can stop, which a single-object PUT
// otherwise is not.
export function showBar(label, pct, onCancel) {
  const bar = $("#progress");
  bar.hidden = false;
  bar.querySelector("i").style.width = pct.toFixed(1) + "%";
  bar.querySelector(".lab").textContent = label;
  const cancel = bar.querySelector(".toast-cancel");
  cancel.hidden = !onCancel;
  cancel.onclick = onCancel || null;
}

// flash adds a message. title, when given, is the headline and msg goes under
// it: rename uses that to say which half of a copy-then-delete failed.
export function flash(msg, isErr, title) {
  const box = $("#msgs");
  const text = String(msg);
  // the same message again restarts its timer instead of stacking a copy
  const same = [...box.children].find((t) => t.dataset.msg === text && t.classList.contains("err") === !!isErr);
  if (same) same.remove();

  const card = el("div", "toast" + (isErr ? " err" : ""));
  card.dataset.msg = text;
  if (isErr) card.setAttribute("role", "alert");
  const [detail, ...rest] = text.split("\n");
  const hint = rest.join(" ").trim();
  // an error can carry "long SDK text\none actionable sentence" from writeErr.
  // The sentence is English and CLI-flavoured, so a recognised cause is named in
  // Chinese first and the raw text stays underneath.
  const known = isErr ? explainErr(text) : null;
  const head = title || known || (isErr && hint ? hint : text.trim());
  card.append(el("div", "line", head));
  const sub = title ? (known || text.trim()) : isErr && hint ? detail : "";
  if (sub) card.append(el("div", "raw", sub.length > 180 ? sub.slice(0, 180) + "…" : sub));

  const close = el("button", "toast-close", "×");
  close.type = "button";
  close.title = "关闭";
  close.setAttribute("aria-label", "关闭提示");
  close.onclick = () => card.remove();
  card.append(close);

  box.append(card);
  while (box.children.length > MAX_MSGS) box.firstElementChild.remove();
  // errors stay until dismissed: they usually need to be read or copied
  if (!isErr) setTimeout(() => card.remove(), SUCCESS_MS);
}
