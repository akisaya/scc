// The search box, the toolbar buttons and the narrow-screen menu.

import { $ } from "./dom.js";
import { state } from "./state.js";
import { openBucket, load } from "./browse.js";
import { render } from "./table.js";
import { closeModal } from "./preview.js";
import { newFolder } from "./ops.js";
import { openAccountForm } from "./accountform.js";
import { uploadFiles } from "./upload.js";

// One box, two behaviours: typing filters what is loaded, Enter treats the text
// as an S3 prefix and navigates there (which reaches keys that never loaded).
function jumpToPrefix(value) {
  if (!state.acct || !state.bucket) return;
  const typed = String(value).trim().replace(/^\/+/, "");
  if (!typed) return;
  if (typed === state.prefix) {
    load();
    return;
  }
  openBucket(state.acct, state.bucket, typed);
}

export function initToolbar() {
  const q = $("#q");
  q.oninput = () => {
    state.filter = q.value.trim().toLowerCase();
    $("#qclear").hidden = !q.value;
    if (state.acct && state.bucket) render();
  };
  q.onkeydown = (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      jumpToPrefix(q.value);
    } else if (ev.key === "Escape" && q.value) {
      ev.stopPropagation();
      q.value = "";
      state.filter = "";
      $("#qclear").hidden = true;
      if (state.acct && state.bucket) render();
    }
  };
  $("#qclear").onclick = () => {
    q.value = "";
    state.filter = "";
    $("#qclear").hidden = true;
    if (state.acct && state.bucket) render();
    q.focus();
  };

  $("#refresh").onclick = () => load();
  $("#newfolder").onclick = () => newFolder();
  $("#addaccount").onclick = openAccountForm;
  $("#upload").onchange = (ev) => {
    uploadFiles([...ev.target.files]);
    ev.target.value = "";
  };
  $("#mclose").onclick = closeModal;
  $("#modal").onclick = (ev) => { if (ev.target.id === "modal") closeModal(); };

  // the narrow-screen overflow menu: same actions, one entry point
  const moreBtn = $("#more");
  const moreMenu = $("#moremenu");
  function closeMenu() {
    moreMenu.hidden = true;
    moreBtn.setAttribute("aria-expanded", "false");
  }
  moreBtn.onclick = (ev) => {
    ev.stopPropagation();
    moreMenu.hidden = !moreMenu.hidden;
    moreBtn.setAttribute("aria-expanded", String(!moreMenu.hidden));
    if (!moreMenu.hidden) moreMenu.querySelector("button").focus();
  };
  moreMenu.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      closeMenu();
      if (b.dataset.act === "refresh") load();
      else newFolder();
    };
  });
  document.addEventListener("click", (ev) => {
    if (!moreMenu.hidden && !moreMenu.contains(ev.target) && ev.target !== moreBtn) closeMenu();
  });
}
