const $ = (s) => document.querySelector(s);
const PAGE_SIZE = 200;
const state = {
  acct: null,
  bucket: null,
  prefix: "",
  accounts: [],
  objectKeys: new Set(),
  objectByKey: new Map(),
  prefixes: [],
  objects: [],
  visible: [],
  cursor: "",
  filter: "",
  // col === "" means the untouched server order (S3 key order), which is the
  // default view; see the header click cycle below.
  sort: { col: "", dir: 1 },
  selected: new Set(),
};
let loadSeq = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const ICON = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  file: "M7 3h6l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm6 0v5h4",
  bucket: "M4 7c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2Zm0 0v10c0 1.1 3.6 2 8 2s8-.9 8-2V7",
  download: "M12 4v11m0 0 4-4m-4 4-4-4M5 19h14",
  rename: "M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3Z",
  trash: "M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 13h9.2l.9-13M10 11v5.5M14 11v5.5",
  warn: "M12 4.6 2.9 20h18.2L12 4.6Zm0 5.4v4.6m0 3.2v.1",
};

function icon(path) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "ico");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

/* ---------- theme ---------- */

// The theme is already on <html> by the time this file runs (static/theme.js does
// it before first paint); this only wires the toggle and follows the system.
function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem("scc-theme", theme); } catch (e) { /* ignore */ }
  }
}

function initTheme() {
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

initTheme();

const IMG = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];
const VIDEO = ["mp4", "webm", "mov", "m4v", "ogv"];
const AUDIO = ["mp3", "wav", "ogg", "flac", "m4a", "aac"];
const TEXT = ["txt", "md", "json", "js", "mjs", "ts", "css", "html", "xml", "yaml", "yml",
  "toml", "ini", "conf", "log", "csv", "tsv", "sh", "go", "py", "rs", "java", "c", "h",
  "sql", "env", "gitignore", "dockerfile", "makefile"];

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    // the browser only says "Failed to fetch" for connection-level failures
    throw new Error("连不上 scc web：终端里的服务可能已经停止或重启。确认它还在运行，然后刷新页面重试。");
  }
  if (!res.ok) {
    const msg = (await res.text()).trim() || res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

const encKey = (k) => k.split("/").map(encodeURIComponent).join("/");
const rawUrl = (key, download) =>
  `/api/b/${encodeURIComponent(state.acct)}/raw/${encodeURIComponent(state.bucket)}/${encKey(key)}` +
  (download ? "?download=1" : "");

/* ---------- toast ---------- */

function clearToast() {
  const box = $("#progress");
  box.innerHTML = "";
  delete box.dataset.msg;
}

// showBar renders the upload-style progress line into the toast slot. onCancel
// is only passed by the upload loop; it turns the bar into something the user
// can stop, which a single-object PUT otherwise is not.
function showBar(label, pct, onCancel) {
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

function flash(msg, isErr) {
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

/* ---------- dialogs ---------- */

const dialogStack = [];

// openDialog remembers what was focused so closing returns the user there, and
// keeps Tab inside the dialog. Escape is handled once, for the topmost dialog.
function openDialog(elm, close) {
  const frame = { el: elm, close, prev: document.activeElement, trap: null };
  frame.trap = (ev) => { if (ev.key === "Tab") trapTab(ev, elm); };
  elm.addEventListener("keydown", frame.trap);
  elm.hidden = false;
  dialogStack.push(frame);
  return frame;
}

function shutDialog(frame) {
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
function askConfirm(text, okLabel) {
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
function askInput({ title, value = "", okLabel = "确定", placeholder = "", validate }) {
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

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const top = dialogStack[dialogStack.length - 1];
  if (!top) return;
  ev.preventDefault();
  ev.stopPropagation();
  top.close();
}, true);

/* ---------- formatting ---------- */

const ext = (k) => (k.split(".").pop() || "").toLowerCase();
const base = (k) => k.slice(k.lastIndexOf("/") + 1);
const dirOf = (k) => k.slice(0, k.lastIndexOf("/") + 1);

function fmtSize(n) {
  if (n < 1024) return n + " B";
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(1) + " " + u[i];
}

// One fixed-width stamp per row: 2026-11-03 01:42. Relative wording ("3 天前")
// made the column impossible to scan or compare; the tooltip keeps the full
// locale string with seconds for the rare case someone needs it.
const pad2 = (n) => (n < 10 ? "0" : "") + n;

function fmtTime(t) {
  const d = new Date(t);
  if (isNaN(d.getTime())) return "-";
  return (
    d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes())
  );
}

const fmtFull = (t) => {
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
};

/* ---------- accounts ---------- */

async function loadAccounts() {
  state.accounts = await api("/api/accounts");
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
    add.title = `在 ${a.name} 新建桶`;
    add.onclick = () => mkBucket(a.name);
    head.append(add);
    block.append(head);
    const list = el("div");
    block.append(list);
    box.append(block);
    // not awaited: a slow endpoint should not keep the next account off screen
    loadBuckets(a, list);
  }
}

// loadBuckets fills one account's bucket list. The block is already on screen
// while the endpoint is probed, which can take seconds when it is unreachable:
// the SDK retries three times before it gives up.
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
    return;
  }
  list.replaceChildren();
  for (const b of buckets) {
    const row = el("div", "bucket");
    row.dataset.acct = a.name;
    row.dataset.bucket = b;
    row.append(icon(ICON.bucket), el("span", "name", b));
    const x = el("button", "del", "×");
    x.title = "删除桶";
    x.onclick = async (ev) => {
      ev.stopPropagation();
      if (!(await askConfirm(`删除桶 ${b}？桶必须为空，且这个操作无法撤销。`, "删除桶"))) return;
      try {
        await api(`/api/b/${encodeURIComponent(a.name)}/buckets/${encodeURIComponent(b)}`, { method: "DELETE" });
        loadAccounts();
      } catch (e) { flash(e.message, true); }
    };
    row.append(x);
    row.onclick = () => openBucket(a.name, b, "");
    list.append(row);
  }
  if (a.default_bucket && !buckets.includes(a.default_bucket)) {
    const row = el("div", "bucket");
    row.append(icon(ICON.bucket), el("span", "name", `${a.default_bucket} (默认)`));
    row.onclick = () => openBucket(a.name, a.default_bucket, "");
    list.append(row);
  }
}

// explainErr names the cause in one line. It returns null for anything it does
// not recognise so the caller can fall back to the server's own hint.
function explainErr(raw) {
  const t = String(raw).toLowerCase();
  if (t.includes("connection refused")) return "endpoint 拒绝了连接";
  if (t.includes("no such host")) return "解析不到 endpoint 域名";
  if (t.includes("timeout") || t.includes("deadline")) return "endpoint 没有响应";
  if (t.includes("x509") || t.includes("certificate")) return "endpoint 的证书不受信任";
  if (t.includes("signaturedoesnotmatch")) return "secret_key 不对，签名验不过";
  if (t.includes("invalidaccesskeyid")) return "endpoint 上没有这个 access_key";
  if (t.includes("accessdenied")) return "凭据没有权限";
  if (t.includes("bucketnotempty")) return "桶不是空的";
  if (t.includes("nosuchbucket")) return "桶不存在";
  return null;
}

// errCard is the one error layout: a headline, the thing it applies to, a retry
// and the raw text folded away. It is used by the sidebar and by the table.
function errCard({ title, sub, raw, retry }) {
  const box = el("div", "err-card");
  const head = el("div", "head");
  head.append(icon(ICON.warn), el("span", null, title));
  box.append(head);
  if (sub) box.append(el("div", "sub", sub));

  const acts = el("div", "acts");
  const again = el("button", "retry", "重试");
  again.onclick = retry;
  acts.append(again);
  box.append(acts);

  const more = document.createElement("details");
  more.append(el("summary", null, "查看错误信息"));
  more.append(el("pre", null, String(raw)));
  box.append(more);
  return box;
}

const endpointOf = (name) => (state.accounts.find((a) => a.name === name) || {}).endpoint || "";

// listError fills the sidebar slot for one account. The raw SDK text used to be
// dropped into a 34px .bucket row, where it wrapped over the account name, the
// theme button and the 添加账户 button.
function listError(a, raw, retry) {
  return errCard({ title: explainErr(raw) || "列不出桶", sub: a.endpoint, raw, retry });
}

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

function paintActive() {
  document.querySelectorAll(".bucket").forEach((b) => {
    b.classList.toggle("active", b.dataset.acct === state.acct && b.dataset.bucket === state.bucket);
  });
}

// The current location lives in the URL hash, so refresh and back/forward work.
function stateHash() {
  const segs = [state.acct, state.bucket];
  const parts = state.prefix.split("/").filter(Boolean);
  return "#/" + [...segs, ...parts].map(encodeURIComponent).join("/") + (parts.length ? "" : "/");
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) return null;
  const segs = raw.split("/").filter(Boolean).map(decodeURIComponent);
  if (segs.length < 2) return null;
  const [acct, bucket, ...rest] = segs;
  return { acct, bucket, prefix: rest.length ? rest.join("/") + "/" : "" };
}

function applyHash() {
  const h = parseHash();
  if (!h) return false;
  if (h.acct === state.acct && h.bucket === state.bucket && h.prefix === state.prefix) return true;
  openBucket(h.acct, h.bucket, h.prefix);
  return true;
}

async function openBucket(acct, bucket, prefix) {
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

// the crumbs are rebuilt on every navigation but the element itself is reused,
// so the scroll listener is bound once here rather than inside crumbs()
$("#crumbs").addEventListener("scroll", (ev) => {
  ev.currentTarget.classList.toggle("fade-left", ev.currentTarget.scrollLeft > 2);
});

async function load() {
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

function loadMore() {
  if (state.cursor) fetchPage(true);
}

// displayBase is the directory part of the current prefix. Names are shown
// relative to it, so jumping to a partial key ("many/shard_03") or to a file
// ("README") does not chop the matched names.
function displayBase() {
  const i = state.prefix.lastIndexOf("/");
  return i >= 0 ? state.prefix.slice(0, i + 1) : "";
}

function displayName(key) {
  return key.slice(displayBase().length);
}

function matches(text) {
  if (!state.filter) return true;
  return text.toLowerCase().includes(state.filter);
}

/* ---------- sorting ---------- */

// Byte order, the same order S3 and `scc ls` use.
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function sortDirs() {
  const dirs = state.prefixes.slice();
  // Directories only have a name, so a size/date sort leaves them in the
  // server order (already name-ascending) rather than pretending to sort them.
  if (state.sort.col !== "name") return dirs;
  dirs.sort((a, b) => byKey(displayName(a), displayName(b)));
  if (state.sort.dir < 0) dirs.reverse();
  return dirs;
}

function sortObjs() {
  const { col, dir } = state.sort;
  const objs = state.objects.slice();
  if (!col) return objs;
  objs.sort((a, b) => {
    let r = 0;
    if (col === "size") r = a.Size - b.Size;
    else if (col === "date") r = new Date(a.LastModified) - new Date(b.LastModified);
    if (r === 0) r = byKey(a.Key, b.Key);
    return r * dir;
  });
  return objs;
}

function paintSort() {
  document.querySelectorAll(".sort").forEach((b) => {
    const on = !!state.sort.col && b.dataset.col === state.sort.col;
    const desc = on && state.sort.dir < 0;
    b.classList.toggle("on", on);
    b.classList.toggle("desc", desc);
    b.title = !on ? "升序排序" : desc ? "恢复默认顺序" : "降序排序";
    const th = b.closest("th");
    if (th) {
      if (!on) th.removeAttribute("aria-sort");
      else th.setAttribute("aria-sort", desc ? "descending" : "ascending");
    }
  });
}

// Three-state cycle per column: asc → desc → back to the default order, so a
// click never traps the table in a sort the user cannot undo.
document.querySelectorAll(".sort").forEach((b) => {
  b.onclick = () => {
    const col = b.dataset.col;
    const s = state.sort;
    if (s.col !== col) state.sort = { col, dir: 1 };
    else if (s.dir > 0) state.sort = { col, dir: -1 };
    else state.sort = { col: "", dir: 1 };
    paintSort();
    if (state.acct && state.bucket) render();
  };
});
paintSort();

/* ---------- rows ---------- */

function actionBtn(path, label, onClick, danger) {
  const b = el("button", "row-act" + (danger ? " danger" : ""));
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.append(icon(path));
  b.onclick = (ev) => {
    ev.stopPropagation();
    onClick();
  };
  return b;
}

function checkCell(key, tr) {
  const td = el("td", "check");
  const cb = el("input");
  cb.type = "checkbox";
  cb.className = "row-check";
  cb.checked = state.selected.has(key);
  cb.setAttribute("aria-label", `选择 ${base(key) || key}`);
  cb.onclick = (ev) => ev.stopPropagation();
  cb.onchange = () => {
    if (cb.checked) state.selected.add(key);
    else state.selected.delete(key);
    tr.classList.toggle("sel", cb.checked);
    syncSel();
  };
  td.append(cb);
  return td;
}

function syncSel() {
  const boxes = [...document.querySelectorAll("#rows .row-check")];
  const on = boxes.filter((b) => b.checked).length;
  const all = $("#checkall");
  all.checked = boxes.length > 0 && on === boxes.length;
  all.indeterminate = on > 0 && on < boxes.length;
  all.disabled = boxes.length === 0;
  $("#selbar").hidden = state.selected.size === 0;
  // A filter hides rows without touching the selection, and the batch buttons act
  // on the whole selection. Say so, instead of letting 已选 3 项 mean "one on screen".
  const visible = new Set(state.visible);
  const hidden = [...state.selected].filter((k) => !visible.has(k)).length;
  $("#selcount").textContent = `已选 ${state.selected.size} 项` +
    (hidden ? ` · 其中 ${hidden} 项被过滤隐藏` : "");
}

function render() {
  const rows = $("#rows");
  rows.innerHTML = "";
  $(".table-wrap").classList.remove("busy");

  const dirs = sortDirs().filter((p) => matches(displayName(p)));
  const objs = sortObjs().filter((o) => matches(displayName(o.Key)));
  state.objectKeys = new Set(state.objects.map((o) => o.Key));
  state.objectByKey = new Map(state.objects.map((o) => [o.Key, o]));

  const total = state.prefixes.length + state.objects.length;
  const shown = dirs.length + objs.length;
  state.visible = [...dirs, ...objs.map((o) => o.Key)];
  $("#empty").hidden = shown > 0;
  $("#empty").textContent = state.filter
    ? `没有匹配项（只在已加载的 ${total} 项里查找）`
    : state.prefix
      ? `前缀 ${state.prefix} 下没有内容，检查一下拼写`
      : "空目录";

  for (const p of dirs) {
    const name = displayName(p).replace(/\/$/, "");
    const tr = el("tr");
    if (state.selected.has(p)) tr.className = "sel";
    tr.append(checkCell(p, tr));
    const td = el("td", "name");
    td.append(icon(ICON.folder), document.createTextNode(name + "/"));
    td.onclick = () => openBucket(state.acct, state.bucket, p);
    const act = el("td", "act");
    act.append(actionBtn(ICON.trash, "删除目录及其内容", () => del(p, true), true));
    tr.append(td, el("td", "num", "-"), el("td", "date", "-"), act);
    rows.append(tr);
  }

  for (const o of objs) {
    const name = displayName(o.Key);
    const tr = el("tr");
    if (state.selected.has(o.Key)) tr.className = "sel";
    tr.append(checkCell(o.Key, tr));
    const td = el("td", "name");
    td.append(icon(ICON.file), document.createTextNode(name));
    td.title = o.Key;
    td.onclick = () => preview(o.Key);
    const date = el("td", "date", fmtTime(o.LastModified));
    date.title = fmtFull(o.LastModified);
    const act = el("td", "act");
    act.append(
      actionBtn(ICON.download, "下载", () => { location.href = rawUrl(o.Key, true); }),
      actionBtn(ICON.rename, "重命名", () => rename(o.Key)),
      actionBtn(ICON.trash, "删除", () => del(o.Key, false), true)
    );
    tr.append(td, el("td", "num", fmtSize(o.Size)), date, act);
    rows.append(tr);
  }

  if (state.cursor || state.filter) {
    const tr = el("tr");
    tr.className = "more";
    const td = el("td", "more-cell");
    td.colSpan = 5;
    const info = el("span", "more-info", state.filter
      ? `匹配 ${shown} 项 · 仅在已加载的 ${total} 项里查找`
      : `已加载 ${total} 项`);
    td.append(info);
    if (state.cursor) {
      const b = el("button", null, "加载更多");
      b.onclick = loadMore;
      td.append(b);
    }
    tr.append(td);
    rows.append(tr);
  }

  paintActive();
  syncSel();
}

/* ---------- selection actions ---------- */

$("#checkall").onchange = (ev) => {
  if (!state.acct || !state.bucket) return;
  const on = ev.target.checked;
  for (const key of state.visible) {
    if (on) state.selected.add(key);
    else state.selected.delete(key);
  }
  render();
};

$("#selclear").onclick = () => {
  state.selected.clear();
  render();
};

$("#seldownload").onclick = () => {
  const files = [...state.selected].filter((k) => !k.endsWith("/"));
  if (!files.length) {
    flash("目录不能直接下载；进入目录后再选择里面的文件", true);
    return;
  }
  if (files.length > 1) {
    flash(`开始下载 ${files.length} 个文件；浏览器可能会询问是否允许下载多个文件`);
  }
  // browsers throttle parallel downloads, so they are spaced out
  files.forEach((k, i) => {
    setTimeout(() => {
      const a = document.createElement("a");
      a.href = rawUrl(k, true);
      a.download = base(k);
      document.body.append(a);
      a.click();
      a.remove();
    }, i * 250);
  });
};

$("#seldelete").onclick = async () => {
  const keys = [...state.selected];
  if (!keys.length) return;
  const dirs = keys.filter((k) => k.endsWith("/")).length;
  const label = `删除已选的 ${keys.length} 项${dirs ? `（其中 ${dirs} 个目录会被递归删除）` : ""}？`;
  if (!(await askConfirm(label + "\n这个操作无法撤销。", "删除"))) return;
  let ok = 0;
  let fail = 0;
  let firstErr = "";
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    showBar(`删除 ${i + 1}/${keys.length}`, ((i + 1) / keys.length) * 100);
    try {
      await api(rawUrl(k) + (k.endsWith("/") ? "?recursive=1" : ""), { method: "DELETE" });
      ok++;
    } catch (e) {
      fail++;
      firstErr = firstErr || e.message;
    }
  }
  clearToast();
  if (fail) flash(`已删除 ${ok} 项，${fail} 项失败\n${firstErr}`, true);
  else flash(`已删除 ${ok} 项`);
  state.selected.clear();
  load();
};

/* ---------- preview ---------- */

let modalFrame = null;

function openModal() {
  if (!modalFrame) modalFrame = openDialog($("#modal"), closeModal);
}

function closeModal() {
  if ($("#modal").hidden) return;
  shutDialog(modalFrame);
  modalFrame = null;
  $("#modal").querySelector(".box").classList.remove("narrow");
  $("#modal .head-actions").hidden = false;
  $("#mbody").innerHTML = "";
}

function preview(key) {
  const obj = state.objectByKey.get(key);
  const body = $("#mbody");
  body.innerHTML = "";
  $("#mtitle").textContent = key;
  $("#mmeta").textContent = obj
    ? `${fmtSize(obj.Size)} · ${fmtFull(obj.LastModified)}`
    : "";
  $("#mdownload").href = rawUrl(key, true);
  $("#mopen").href = rawUrl(key);
  $("#modal .head-actions").hidden = false;
  $("#modal").querySelector(".box").classList.remove("narrow");
  openModal();
  $("#mclose").focus();

  const e = ext(key);
  if (IMG.includes(e)) {
    const img = new Image();
    img.src = rawUrl(key);
    img.alt = base(key);
    body.append(img);
  } else if (VIDEO.includes(e) || AUDIO.includes(e)) {
    // Built node by node, never by string: the key belongs to whoever can write
    // to the bucket, so a quote in the name would otherwise close the attribute
    // it sits in and turn the rest into markup.
    const media = document.createElement(VIDEO.includes(e) ? "video" : "audio");
    media.src = rawUrl(key);
    media.controls = true;
    media.autoplay = true;
    if (media.tagName === "VIDEO") media.playsInline = true;
    body.append(media);
  } else if (e === "pdf") {
    const frame = document.createElement("iframe");
    frame.src = rawUrl(key);
    frame.title = base(key);
    body.append(frame);
  } else if (TEXT.includes(e)) {
    body.append(el("pre", null, "加载中…"));
    fetch(rawUrl(key))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        const cut = t.slice(0, 200000);
        const pre = el("pre", null, cut + (t.length > cut.length ? "\n\n… (已截断)" : ""));
        body.replaceChildren(pre);
      })
      .catch((err) => body.replaceChildren(el("div", "err", `读取失败：${err.message}`)));
  } else {
    body.append(noPreview(key, obj));
  }
}

// noPreview is the card shown for types the browser cannot render.
function noPreview(key, obj) {
  const box = el("div", "no-preview");
  box.append(icon(ICON.file));
  box.append(el("strong", null, "这个类型无法在浏览器里预览"));
  const bits = [base(key)];
  if (obj) bits.push(fmtSize(obj.Size));
  box.append(el("div", "meta", bits.join(" · ")));
  box.append(el("div", "meta", "用上方「下载」保存到本地，或「新标签打开」直接取原始内容"));
  return box;
}

/* ---------- operations ---------- */

// existingKeys asks the server which of these keys are already there. The local
// listing only covers the pages that have been loaded, so an upload into a
// 3000-key directory would otherwise overwrite silently.
async function existingKeys(keys) {
  const list = keys.filter(Boolean).slice(0, 200);
  if (!list.length) return new Set();
  try {
    const r = await api(`/api/b/${encodeURIComponent(state.acct)}/stat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket: state.bucket, keys: list }),
    });
    return new Set(r.existing || []);
  } catch {
    return new Set(); // a failed probe must not block the operation
  }
}

async function del(key, isDir) {
  const label = isDir ? `目录 ${key} 及其全部内容` : key;
  if (!(await askConfirm(`删除 ${label}？`))) return;
  try {
    await api(rawUrl(key) + (isDir ? "?recursive=1" : ""), { method: "DELETE" });
    flash(`已删除 ${key}`);
    load();
  } catch (e) { flash(e.message, true); }
}

async function rename(key) {
  const next = await askInput({
    title: `重命名 ${base(key)}`,
    value: base(key),
    okLabel: "重命名",
    validate: (v) => (v ? "" : "名称不能为空"),
  });
  if (!next || next === base(key)) return;
  const to = dirOf(key) + next;
  const known = state.objectKeys.has(to) ? new Set([to]) : await existingKeys([to]);
  if (known.has(to) && !(await askConfirm(`${next} 已存在，覆盖？`, "覆盖"))) return;
  try {
    await api(`/api/b/${encodeURIComponent(state.acct)}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_bucket: state.bucket, from_key: key, to_bucket: state.bucket, to_key: to }),
    });
    await api(rawUrl(key), { method: "DELETE" });
    flash(`已重命名为 ${next}`);
    load();
  } catch (e) { flash(e.message, true); }
}

function field(labelText, input, hint) {
  const l = el("label");
  l.append(el("span", null, labelText), input);
  if (hint) {
    const h = el("span", "field-hint", hint);
    h.style.color = "var(--muted)";
    h.style.opacity = ".8";
    l.append(h);
  }
  return l;
}

function textInput(id, placeholder, value) {
  const i = el("input");
  i.id = id;
  i.type = "text";
  i.placeholder = placeholder || "";
  i.value = value || "";
  i.autocomplete = "off";
  i.spellcheck = false;
  return i;
}

function openAccountForm() {
  $("#mtitle").textContent = "添加账户";
  $("#mmeta").textContent = "";
  // download / open / close belong to the preview; the form has its own 取消
  $("#modal .head-actions").hidden = true;
  $("#modal").querySelector(".box").classList.add("narrow");
  const body = $("#mbody");
  body.innerHTML = "";

  const form = el("form", "account-form");
  const name = textInput("f-name", "minio");
  const endpoint = textInput("f-endpoint", "http://127.0.0.1:9000（留空表示 AWS）");
  const region = textInput("f-region", "us-east-1", "us-east-1");
  const access = textInput("f-access", "access key id");
  const secret = el("input");
  secret.id = "f-secret";
  secret.type = "password";
  secret.placeholder = "secret access key";
  secret.autocomplete = "new-password";
  const bucket = textInput("f-bucket", "可选，填了之后 acct: 直接进这个桶");
  const pathRow = el("label", "row");
  const path = el("input");
  path.type = "checkbox";
  path.id = "f-path";
  pathRow.append(path, el("span", null, "path-style 寻址（自建服务通常需要，AWS 不要勾）"));

  const err = el("div", "form-err");
  const actions = el("div", "form-actions");
  const cancel = el("button", "ghost", "取消");
  cancel.type = "button";
  cancel.onclick = closeModal;
  const save = el("button", "btn-primary", "保存");
  save.type = "submit";
  actions.append(cancel, save);

  form.append(
    field("名称", name),
    field("Endpoint", endpoint),
    field("Region", region),
    field("Access Key", access),
    field("Secret Key", secret),
    field("默认桶", bucket),
    pathRow,
    err,
    actions
  );

  // AWS has no custom endpoint and must not use path-style addressing
  const syncPath = () => {
    const custom = endpoint.value.trim() !== "";
    path.disabled = !custom;
    path.checked = custom;
  };
  endpoint.addEventListener("input", syncPath);
  syncPath();

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    err.textContent = "";
    save.disabled = true;
    const data = {
      name: name.value.trim(),
      endpoint: endpoint.value.trim(),
      region: region.value.trim(),
      access_key: access.value.trim(),
      secret_key: secret.value,
      path_style: path.checked,
      default_bucket: bucket.value.trim(),
    };
    try {
      await saveAccount(data);
      closeModal();
      await loadAccounts();
      if (data.default_bucket) openBucket(data.name, data.default_bucket, "");
      flash(`已添加账户 ${data.name}`);
    } catch (e) {
      if (e.status === 409 && await askConfirm(`账户 ${data.name} 已存在，用新配置覆盖它？`, "覆盖")) {
        try {
          await saveAccount({ ...data, replace: true });
          closeModal();
          await loadAccounts();
          if (data.default_bucket) openBucket(data.name, data.default_bucket, "");
          flash(`已更新账户 ${data.name}`);
          return;
        } catch (e2) {
          err.textContent = explainErr(e2.message) || e2.message;
        }
      } else {
        // the same one-liner the toasts use: this form is where a wrong endpoint
        // or key is first typed, so it is the last place to show raw SDK text
        err.textContent = explainErr(e.message) || e.message;
      }
      save.disabled = false;
    }
  };

  body.append(form);
  openModal();
  name.focus();
}

async function saveAccount(data) {
  await api("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

async function newFolder() {
  if (!state.acct || !state.bucket) return;
  const name = await askInput({
    title: "新建文件夹",
    placeholder: "文件夹名称",
    okLabel: "创建",
    validate: (v) => {
      if (!v) return "名称不能为空";
      if (v.includes("/")) return "名称不能包含 /";
      // folders only show up as prefixes: an empty folder has no objects at all
      const created = state.prefix + v + "/";
      if (state.prefixes.includes(created) || state.objectKeys.has(created)) return "这个文件夹已经存在";
      return "";
    },
  });
  if (!name) return;
  const key = state.prefix + name + "/";
  api(rawUrl(key), { method: "PUT", body: "" })
    .then(() => { flash(`已创建 ${key}`); load(); })
    .catch((e) => flash(e.message, true));
}

const uploadKey = (f) => state.prefix + f.name;

async function uploadFiles(files) {
  if (!state.acct || !state.bucket || !files.length) return;
  const targets = files.map(uploadKey);
  const loaded = targets.filter((k) => state.objectKeys.has(k));
  const unknown = targets.filter((k) => !state.objectKeys.has(k));
  const probe = unknown.slice(0, 200);
  const unchecked = unknown.length - probe.length;
  const remote = await existingKeys(probe);
  const dupes = [...new Set([...loaded, ...remote])].map((k) => base(k));
  if (dupes.length && !(await askConfirm(`${dupes.join("、")} 已存在，覆盖？`, "覆盖"))) return;

  const total = files.length;
  let done = 0;
  let cancelled = false;
  let cur = null;
  const stop = () => {
    cancelled = true;
    if (cur) cur.abort();
    clearToast();
    flash(`已取消上传：完成 ${done}/${total}`, true);
  };
  const next = () => {
    if (cancelled) return;
    if (done >= total) {
      flash(`已上传 ${total} 个文件` + (unchecked ? ` · 其中 ${unchecked} 个未做同名检查` : ""));
      load();
      return;
    }
    const file = files[done];
    const xhr = new XMLHttpRequest();
    cur = xhr;
    xhr.open("PUT", rawUrl(uploadKey(file)));
    xhr.upload.onprogress = (ev) => {
      if (cancelled || !ev.lengthComputable) return;
      const pct = ((done + ev.loaded / ev.total) / total) * 100;
      showBar(`上传 ${file.name} (${done + 1}/${total})`, pct, stop);
    };
    xhr.onload = () => {
      if (cancelled) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        done++;
        next();
      } else {
        flash(`上传失败 ${file.name}: ${xhr.responseText || xhr.status}`, true);
      }
    };
    xhr.onerror = () => { if (!cancelled) flash(`上传失败 ${file.name}: 网络错误`, true); };
    xhr.send(file);
  };
  showBar(`上传 ${files[0].name} (1/${total})`, 0, stop);
  next();
}

async function mkBucket(acct) {
  const name = await askInput({
    title: `在 ${acct} 新建桶`,
    placeholder: "小写字母、数字、点、连字符",
    okLabel: "创建",
    validate: (v) => {
      if (!v) return "名称不能为空";
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(v)) {
        return "桶名只能用小写字母、数字、点、连字符，长度 3–63，且首尾不能是符号";
      }
      return "";
    },
  });
  if (!name) return;
  try {
    await api(`/api/b/${encodeURIComponent(acct)}/buckets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadAccounts();
    openBucket(acct, name, "");
  } catch (e) { flash(e.message, true); }
}

/* ---------- search ---------- */

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

/* ---------- toolbar ---------- */

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

/* ---------- drag and drop ---------- */

const dropzone = $("#dropzone");
let dragDepth = 0;
const dragFiles = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");

document.addEventListener("dragenter", (ev) => {
  if (!state.bucket || !dragFiles(ev)) return;
  ev.preventDefault();
  dragDepth++;
  $("#dzprefix").textContent = state.prefix || `${state.acct}/${state.bucket}`;
  dropzone.hidden = false;
});
document.addEventListener("dragover", (ev) => {
  if (!dragFiles(ev)) return;
  ev.preventDefault();
});
document.addEventListener("dragleave", (ev) => {
  // depth counting, not a types check: some browsers drop dataTransfer.types on
  // the leave event, which would leave the overlay stuck on screen
  if (dragDepth === 0) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.hidden = true;
});
document.addEventListener("drop", (ev) => {
  ev.preventDefault();
  dragDepth = 0;
  dropzone.hidden = true;
  if (!dragFiles(ev) || !state.bucket) return;
  const files = [...ev.dataTransfer.files];
  if (files.length) uploadFiles(files);
});

/* ---------- boot ---------- */

window.addEventListener("popstate", applyHash);
window.addEventListener("hashchange", applyHash);

loadAccounts().then(() => {
  if (applyHash()) return; // deep link wins
  const a = state.accounts.find((x) => x.default_bucket) || state.accounts[0];
  if (!a) return;
  const b = a.default_bucket || (document.querySelector(`.bucket[data-acct="${a.name}"]`)?.dataset.bucket);
  if (b) {
    openBucket(a.name, b, "");
  } else {
    $("#empty").hidden = false;
    $("#empty").textContent = `点 ${a.name} 右侧的 ＋ 新建桶，或从命令行运行 scc mb ${a.name}://bucket`;
  }
}).catch((e) => {
  // without the account list the page has nothing to show; say why instead of
  // leaving an empty shell behind
  $(".table-wrap").classList.add("failed");
  const box = $("#empty");
  box.hidden = false;
  box.className = "hint load-error";
  box.replaceChildren(errCard({
    title: "读不到账号列表",
    sub: String(e.message).split("\n")[0],
    raw: e.message,
    retry: () => location.reload(),
  }));
});
