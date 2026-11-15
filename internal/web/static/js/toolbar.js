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
      // An IME uses Enter to confirm a candidate. Jumping on it would treat the
      // pinyin typed so far as a prefix. Safari reports the confirming Enter
      // with isComposing already false, hence the keyCode 229 fallback.
      if (ev.isComposing || ev.keyCode === 229) return;
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

  // The narrow-screen overflow menu. As a popover the browser already closes it
  // on Escape, on a click outside and when focus leaves, and keeps the trigger's
  // aria-expanded in sync; only "opened from the keyboard enters the menu" is
  // left, and that is a focus move.
  const moreBtn = $("#more");
  const moreMenu = $("#moremenu");
  const canPopover = Object.hasOwn(HTMLElement.prototype, "popover");
  let openedByKeyboard = false;
  const expanded = (open) => moreBtn.setAttribute("aria-expanded", String(open));

  moreBtn.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") openedByKeyboard = true;
  });

  const closeMenu = (refocus) => {
    openedByKeyboard = false;
    if (canPopover) {
      if (moreMenu.matches(":popover-open")) moreMenu.hidePopover();
      return;
    }
    moreMenu.hidden = true;
    expanded(false);
    if (refocus) moreBtn.focus();
  };

  if (canPopover) {
    moreMenu.addEventListener("toggle", (ev) => {
      const open = ev.newState === "open";
      expanded(open);
      if (!open) {
        openedByKeyboard = false;
        return;
      }
      if (openedByKeyboard) moreMenu.querySelector("button").focus();
    });
  } else {
    // Safari 16 has no popover: drop the attribute so the CSS can position it as
    // an ordinary dropdown, and rebuild the dismissal the browser would give us.
    moreMenu.removeAttribute("popover");
    moreMenu.hidden = true;
    expanded(false);
    moreBtn.onclick = () => {
      if (!moreMenu.hidden) return closeMenu(false);
      moreMenu.hidden = false;
      expanded(true);
      if (openedByKeyboard) moreMenu.querySelector("button").focus();
    };
    document.addEventListener("click", (ev) => {
      if (moreMenu.hidden || moreMenu.contains(ev.target) || ev.target === moreBtn) return;
      closeMenu(false);
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !moreMenu.hidden) closeMenu(true);
    });
  }

  moreMenu.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      closeMenu(false);
      if (b.dataset.act === "refresh") load();
      else newFolder();
    };
  });
  // above 860px the trigger is display:none: an open menu left behind would
  // have nothing to hang from
  const narrow = matchMedia("(max-width: 860px)");
  narrow.addEventListener("change", () => {
    if (!narrow.matches) closeMenu(false);
  });
}
