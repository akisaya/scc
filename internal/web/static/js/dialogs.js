// In-app confirm and input dialogs, on native <dialog>.
//
// showModal() already inerts the page, keeps focus inside, puts the dialog in
// the top layer behind ::backdrop, closes on Escape and the back gesture, and
// returns focus to whatever opened it. None of that is rebuilt here.

import { $ } from "./dom.js";

// askConfirm is an in-app confirmation: native confirm() can be silenced by the
// browser after repeated dialogs, which would let a delete run unconfirmed.
// Resolves true only when the confirm button was used; Escape and the backdrop
// count as "no".
export function askConfirm(text, okLabel) {
  const dlg = $("#confirm");
  // one question at a time: showModal() on a dialog that is already open throws,
  // and stacking two deletes behind one box would answer the wrong one
  if (dlg.open) return Promise.resolve(false);
  const ok = $("#cok");
  const cancel = $("#ccancel");
  $("#ctext").textContent = text;
  ok.textContent = okLabel || "删除";
  return new Promise((resolve) => {
    let accepted = false;
    const done = () => {
      dlg.removeEventListener("close", done);
      ok.onclick = cancel.onclick = null;
      resolve(accepted);
    };
    dlg.addEventListener("close", done);
    ok.onclick = () => {
      accepted = true;
      dlg.close();
    };
    cancel.onclick = () => dlg.close();
    dlg.showModal();
  });
}

// askInput replaces prompt(): same look as the rest of the app instead of a
// native dialog. Resolves null on cancel.
export function askInput({ title, value = "", okLabel = "确定", placeholder = "", validate }) {
  const dlg = $("#ask");
  if (dlg.open) return Promise.resolve(null);
  const form = $("#askform");
  const input = $("#askinput");
  const err = $("#askerr");
  $("#asktitle").textContent = title;
  $("#askok").textContent = okLabel;
  input.value = value;
  input.placeholder = placeholder;
  err.textContent = "";
  input.removeAttribute("aria-invalid");
  return new Promise((resolve) => {
    let result = null;
    const done = () => {
      dlg.removeEventListener("close", done);
      form.onsubmit = input.oninput = $("#askcancel").onclick = null;
      resolve(result);
    };
    dlg.addEventListener("close", done);
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const v = input.value.trim();
      const problem = validate ? validate(v) : v ? "" : "不能为空";
      if (problem) {
        err.textContent = problem;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      result = v;
      dlg.close();
    };
    // the error goes away as soon as the user starts fixing it
    input.oninput = () => {
      if (!err.textContent) return;
      err.textContent = "";
      input.removeAttribute("aria-invalid");
    };
    $("#askcancel").onclick = () => dlg.close();
    dlg.showModal();
    input.select();
  });
}

// Safari has no closedby: the preview still closes on a backdrop click there.
// Test the pointer position, not event.target: the <dialog> is also the target
// for its own padding, so a target check would close on those clicks.
if (typeof HTMLDialogElement === "undefined" || !("closedBy" in HTMLDialogElement.prototype)) {
  const outside = (ev, dlg) => {
    const r = dlg.getBoundingClientRect();
    return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
  };
  for (const dlg of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dlg.addEventListener("pointerdown", (ev) => {
      pressedOutside = outside(ev, dlg);
    });
    // Require the press and the release outside, so a text selection that ends
    // on the backdrop does not dismiss.
    dlg.addEventListener("pointerup", (ev) => {
      if (pressedOutside && outside(ev, dlg)) dlg.close();
    });
  }
}
