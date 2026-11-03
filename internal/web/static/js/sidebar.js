// Accounts and their buckets in the sidebar.

import { $, el, ICON, icon } from "./dom.js";
import { state } from "./state.js";
import { api } from "./api.js";
import { explainErr, errCard } from "./errors.js";
import { flash } from "./toast.js";
import { askConfirm } from "./dialogs.js";
import { load, locLink } from "./browse.js";
import { mkBucket } from "./ops.js";

// bucketLists holds each account's in-flight bucket listing, so boot can wait for
// the one it needs without holding the sidebar back for the slow ones.
export const bucketLists = new Map();

export async function loadAccounts() {
  state.accounts = await api("/api/accounts");
  bucketLists.clear();
  const box = $("#accounts");
  box.innerHTML = "";
  if (!state.accounts.length) {
    // the dashed 添加账户 button below is the action; a second one here was noise
    const hint = el("div", "hint empty-accounts",
      "还没有账号。用下面的「添加账户」填 endpoint 与密钥，这里会立刻出现桶列表。");
    box.append(hint);
    $("#empty").hidden = false;
    $("#empty").textContent = "左侧还没有账号，添加之后即可浏览桶和目录。";
    return;
  }
  for (const a of state.accounts) {
    const block = el("div", "acct");
    const head = el("div", "acct-head");
    head.append(el("div", "acct-name", a.name));
    const add = el("button", "acct-add", "＋");
    add.type = "button";
    add.title = `在 ${a.name} 新建桶`;
    add.setAttribute("aria-label", add.title);
    add.onclick = () => mkBucket(a.name);
    head.append(add);
    block.append(head);
    const list = el("div");
    block.append(list);
    box.append(block);
    // not awaited: a slow endpoint should not keep the next account off screen
    bucketLists.set(a.name, loadBuckets(a, list));
  }
}

// loadBuckets fills one account's bucket list. The block is already on screen
// while the endpoint is probed, which can take seconds when it is unreachable:
// the SDK retries three times before it gives up. Resolves to the bucket names,
// or null when the listing failed.
async function loadBuckets(a, list) {
  list.replaceChildren(el("div", "acct-note", "读取桶列表…"));
  let buckets;
  try {
    buckets = await api(`/api/b/${encodeURIComponent(a.name)}/buckets`);
  } catch (e) {
    list.replaceChildren(listError(a, e.message, () => {
      loadBuckets(a, list);
      // the table may be showing the same outage; retry it in the same click
      if (state.acct === a.name && $(".table-wrap").classList.contains("failed")) load();
    }));
    return null;
  }
  list.replaceChildren();
  for (const b of buckets) {
    const row = bucketRow(a.name, b, b);
    const x = el("button", "del", "×");
    x.type = "button";
    x.title = "删除桶";
    x.setAttribute("aria-label", `删除桶 ${b}`);
    x.onclick = async () => {
      if (!(await askConfirm(`删除桶 ${b}？桶必须为空，且这个操作无法撤销。`, "删除桶"))) return;
      try {
        await api(`/api/b/${encodeURIComponent(a.name)}/buckets/${encodeURIComponent(b)}`, { method: "DELETE" });
        loadAccounts();
      } catch (e) { flash(e.message, true); }
    };
    row.append(x);
    list.append(row);
  }
  // A default bucket missing from the listing is either scoped credentials that
  // cannot list buckets, or a bucket that is gone; only opening it can tell.
  // It gets the same data attributes so it highlights like any other row.
  if (a.default_bucket && !buckets.includes(a.default_bucket)) {
    const row = bucketRow(a.name, a.default_bucket, `${a.default_bucket} (默认)`);
    row.title = "默认桶，不在桶列表里";
    list.append(row);
  }
  // a deep link may have opened this bucket before its row existed
  paintActive();
  return buckets;
}

// listError fills the sidebar slot for one account. The raw SDK text used to be
// dropped into a 34px .bucket row, where it wrapped over the account name, the
// theme button and the 添加账户 button.
function listError(a, raw, retry) {
  return errCard({ title: explainErr(raw) || "列不出桶", sub: a.endpoint, raw, retry });
}

// Below this width the sidebar is a drawer over the page instead of a column:
// at 375px a fixed 172px column left the breadcrumbs no width at all.
const drawerMode = matchMedia("(max-width: 640px)");

function setDrawer(open, refocus) {
  const toggle = $("#navtoggle");
  document.body.classList.toggle("drawer-open", open);
  $("#scrim").hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "关闭账户与桶" : "打开账户与桶");
  if (open) ($("#sidebar .bucket.active .bucket-link") || $("#sidebar .bucket-link") || $("#addaccount")).focus();
  else if (refocus) toggle.focus();
}

export function initSidebar() {
  const isOpen = () => document.body.classList.contains("drawer-open");
  $("#navtoggle").onclick = () => setDrawer(!isOpen(), true);
  $("#scrim").onclick = () => setDrawer(false, true);
  // choosing a bucket or opening the account form is done with the drawer
  $("#sidebar").addEventListener("click", (ev) => {
    if (isOpen() && ev.target.closest(".bucket-link, #addaccount")) setDrawer(false, false);
  });
  // dialogs take Escape first (capture phase), so this only sees the rest
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isOpen()) setDrawer(false, true);
  });
  drawerMode.addEventListener("change", () => { if (!drawerMode.matches) setDrawer(false, false); });
}

// bucketRow is one sidebar entry: a link to the bucket root, so it can be reached
// with Tab and opened in a new tab, with room for a delete button beside it.
function bucketRow(acct, bucket, label) {
  const row = el("div", "bucket");
  row.dataset.acct = acct;
  row.dataset.bucket = bucket;
  const link = locLink(acct, bucket, "", "bucket-link");
  link.append(icon(ICON.bucket), el("span", "name", label));
  row.append(link);
  return row;
}

export function paintActive() {
  document.querySelectorAll(".bucket").forEach((b) => {
    const on = b.dataset.acct === state.acct && b.dataset.bucket === state.bucket;
    b.classList.toggle("active", on);
    const link = b.querySelector(".bucket-link");
    if (on) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}
