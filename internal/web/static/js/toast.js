// The bottom toast: progress bar and one-line messages.

import { $, el } from "./dom.js";
import { explainErr } from "./errors.js";

export function clearToast() {
  const box = $("#progress");
  box.innerHTML = "";
  delete box.dataset.msg;
}

// showBar renders the upload-style progress line into the toast slot. onCancel
// is only passed by the upload loop; it turns the bar into something the user
// can stop, which a single-object PUT otherwise is not.
export function showBar(label, pct, onCancel) {
  const box = $("#progress");
  if (!box.querySelector(".bar")) {
    box.innerHTML = `<div class="bar"><i></i></div><div class="lab"></div>`;
  }
  box.dataset.msg = "busy";
  box.querySelector("i").style.width = pct.toFixed(1) + "%";
  box.querySelector(".lab").textContent = label;
  const cancel = box.querySelector(".toast-cancel");
  if (onCancel && !cancel) {
    const b = el("button", "toast-cancel", "取消");
    b.type = "button";
    b.onclick = onCancel;
    box.append(b);
  } else if (!onCancel && cancel) {
    cancel.remove();
  }
}

export function flash(msg, isErr) {
  const box = $("#progress");
  const text = String(msg);
  box.innerHTML = "";
  box.dataset.msg = text;
  const [detail, ...rest] = text.split("\n");
  const hint = rest.join(" ").trim();
  // an error can carry "long SDK text\none actionable sentence" from writeErr.
  // The sentence is English and CLI-flavoured, so a recognised cause is named in
  // Chinese first and the raw text stays underneath.
  const known = isErr ? explainErr(text) : null;
  const line = el("div", null, known || (isErr && hint ? hint : text.trim()));
  if (isErr) line.style.color = "var(--danger)";
  box.append(line);
  if (isErr && hint) {
    const raw = el("div", "lab", detail.length > 180 ? detail.slice(0, 180) + "…" : detail);
    raw.style.fontSize = "11.5px";
    box.append(raw);
  }
  const close = el("button", "toast-close", "×");
  close.type = "button";
  close.title = "关闭";
  close.setAttribute("aria-label", "关闭提示");
  close.onclick = clearToast;
  box.append(close);
  // errors stay until dismissed: they usually need to be read or copied
  if (!isErr) setTimeout(() => { if (box.dataset.msg === text) clearToast(); }, 3000);
}
