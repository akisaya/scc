// Opening a location, paging its listing, and the breadcrumbs.

import { $ } from "./dom.js";
import { state } from "./state.js";
import { api } from "./api.js";
import { stateHash, parseHash } from "./router.js";
import { explainErr, errCard } from "./errors.js";
import { loadAccounts, paintActive } from "./sidebar.js";
import { render } from "./table.js";

const PAGE_SIZE = 200;

let loadSeq = 0;

// dirError is the same card in the table area, so a failed listing does not
// leave a blank page. It names the directory rather than repeating the endpoint
// the sidebar is already showing.
function dirError(raw, retry) {
  const cause = explainErr(raw);
  return errCard({
    title: `读不出 ${state.acct}/${state.bucket}/`,
    sub: cause || String(raw).split("\n")[0].slice(0, 90),
    raw,
    retry,
  });
}

export function applyHash() {
  const h = parseHash();
  if (!h) return false;
  if (h.acct === state.acct && h.bucket === state.bucket && h.prefix === state.prefix) return true;
  openBucket(h.acct, h.bucket, h.prefix);
  return true;
}

export async function openBucket(acct, bucket, prefix) {
  const moved = acct !== state.acct || bucket !== state.bucket || (prefix || "") !== state.prefix;
  if (moved) {
    state.filter = "";
    const box = $("#q");
    if (box) box.value = "";
    $("#qclear").hidden = true;
  }
  state.acct = acct;
  state.bucket = bucket;
  state.prefix = prefix || "";
  state.selected.clear();
  paintActive();
  const hash = stateHash();
  if (location.hash !== hash) {
    history.pushState(null, "", hash);
  }
  await load();
}

function crumbs() {
  const nav = $("#crumbs");
  nav.innerHTML = "";
  const root = document.createElement("a");
  root.textContent = `${state.acct}/${state.bucket}`;
  root.onclick = () => openBucket(state.acct, state.bucket, "");
  nav.append(root);
  let acc = "";
  for (const part of state.prefix.split("/").filter(Boolean)) {
    acc += part + "/";
    const sep = document.createElement("span");
    sep.className = "sep";
    sep.setAttribute("aria-hidden", "true"); // drawn by CSS; the path is read from the links
    nav.append(sep);
    const a = document.createElement("a");
    a.textContent = part;
    const target = acc;
    a.onclick = () => openBucket(state.acct, state.bucket, target);
    nav.append(a);
  }
  const last = nav.lastElementChild;
  if (last && last.tagName === "A") last.classList.add("cur");
  // a deep path overflows: show its tail, which is the part being browsed
  nav.scrollLeft = nav.scrollWidth;
  nav.classList.toggle("fade-left", nav.scrollLeft > 2);
}

export async function load() {
  if (!state.acct || !state.bucket) return;
  state.selected.clear();
  crumbs();
  state.prefixes = [];
  state.objects = [];
  state.cursor = "";
  await fetchPage(false);
}

// fetchPage appends the next page to what is already on screen; the first page
// resets the accumulated rows through load().
async function fetchPage(append) {
  const seq = ++loadSeq;
  const rows = $("#rows");
  const wrap = $(".table-wrap");
  if (!append) {
    // keep the previous rows on screen while the new page arrives; blanking the
    // table makes every navigation flash for no reason
    if (!rows.children.length || rows.querySelector("td.loading")) {
      rows.innerHTML = `<tr><td colspan="5" class="loading">加载中…</td></tr>`;
    } else {
      wrap.classList.add("busy");
    }
    wrap.classList.remove("failed");
    const empty = $("#empty");
    empty.hidden = true;
    empty.className = "hint";
    empty.replaceChildren();
  }
  const params = new URLSearchParams({ prefix: state.prefix, limit: String(PAGE_SIZE) });
  if (append && state.cursor) params.set("cursor", state.cursor);
  try {
    const data = await api(
      `/api/b/${encodeURIComponent(state.acct)}/objects/${encodeURIComponent(state.bucket)}?${params}`
    );
    if (seq !== loadSeq) return; // a newer navigation already took over
    state.prefixes = append ? state.prefixes.concat(data.prefixes || []) : data.prefixes || [];
    state.objects = append ? state.objects.concat(data.objects || []) : data.objects || [];
    state.cursor = data.next_cursor || "";
    render();
  } catch (e) {
    if (seq !== loadSeq) return;
    wrap.classList.remove("busy");
    wrap.classList.add("failed");
    rows.innerHTML = "";
    // the inline card replaces the toast here: it stays put, and it can be retried
    const box = $("#empty");
    box.hidden = false;
    box.className = "hint load-error";
    box.replaceChildren(dirError(e.message, () => {
      // the sidebar may be showing the same outage; retry it too
      loadAccounts().catch(() => {});
      load();
    }));
  }
}

export function loadMore() {
  if (state.cursor) fetchPage(true);
}

export function initBrowse() {
  // the crumbs are rebuilt on every navigation but the element itself is reused,
  // so the scroll listener is bound once here rather than inside crumbs()
  $("#crumbs").addEventListener("scroll", (ev) => {
    ev.currentTarget.classList.toggle("fade-left", ev.currentTarget.scrollLeft > 2);
  });
}
