// In-app confirm and input dialogs, with focus kept inside.

import { $ } from "./dom.js";

const dialogStack = [];

// openDialog remembers what was focused so closing returns the user there, and
// keeps Tab inside the dialog. Escape is handled once, for the topmost dialog.
export function openDialog(elm, close) {
  const frame = { el: elm, close, prev: document.activeElement, trap: null };
  frame.trap = (ev) => { if (ev.key === "Tab") trapTab(ev, elm); };
  elm.addEventListener("keydown", frame.trap);
  elm.hidden = false;
  dialogStack.push(frame);
  return frame;
}

export function shutDialog(frame) {
  if (!frame) return;
  frame.el.hidden = true;
  frame.el.removeEventListener("keydown", frame.trap);
  const i = dialogStack.indexOf(frame);
  if (i >= 0) dialogStack.splice(i, 1);
  const prev = frame.prev;
  if (prev && prev.isConnected && typeof prev.focus === "function") prev.focus();
}

function trapTab(ev, root) {
  const items = [...root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter((e) => e.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
}

// askConfirm is an in-app confirmation: native confirm() can be silenced by the
// browser after repeated dialogs, which would let a delete run unconfirmed.
export function askConfirm(text, okLabel) {
  return new Promise((resolve) => {
    const dlg = $("#confirm");
    const ok = $("#cok");
    const cancel = $("#ccancel");
    $("#ctext").textContent = text;
    ok.textContent = okLabel || "删除";
    let frame;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      ok.onclick = cancel.onclick = dlg.onclick = null;
      shutDialog(frame);
      resolve(value);
    };
    frame = openDialog(dlg, () => finish(false));
    ok.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    dlg.onclick = (ev) => { if (ev.target === dlg) finish(false); };
    cancel.focus();
  });
}

// askInput replaces prompt() for the same reason, and keeps the look of the rest
// of the app instead of dropping into a native dialog. Resolves null on cancel.
export function askInput({ title, value = "", okLabel = "确定", placeholder = "", validate }) {
  return new Promise((resolve) => {
    const dlg = $("#ask");
    const form = $("#askform");
    const input = $("#askinput");
    const err = $("#askerr");
    $("#asktitle").textContent = title;
    $("#askok").textContent = okLabel;
    input.value = value;
    input.placeholder = placeholder;
    err.textContent = "";
    let frame;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      form.onsubmit = null;
      $("#askcancel").onclick = dlg.onclick = null;
      shutDialog(frame);
      resolve(result);
    };
    frame = openDialog(dlg, () => finish(null));
    form.onsubmit = (ev) => {
      ev.preventDefault();
      if (done) return;
      const v = input.value.trim();
      const problem = validate ? validate(v) : (v ? "" : "不能为空");
      if (problem) {
        err.textContent = problem;
        input.focus();
        return;
      }
      finish(v);
    };
    $("#askcancel").onclick = () => finish(null);
    dlg.onclick = (ev) => { if (ev.target === dlg) finish(null); };
    input.focus();
    input.select();
  });
}

export function initDialogs() {
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const top = dialogStack[dialogStack.length - 1];
    if (!top) return;
    ev.preventDefault();
    ev.stopPropagation();
    top.close();
  }, true);
}
