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
  cursor: "",
  filter: "",
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

function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem("scc-theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("scc-theme");
  const pick = () => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyTheme(saved || pick(), false);
  // keep following the system until the user chooses explicitly
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!localStorage.getItem("scc-theme")) applyTheme(pick(), false);
  });
  $("#theme").onclick = () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
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

function flash(msg, isErr) {
  const box = $("#progress");
  box.innerHTML = "";
  const [detail, ...rest] = String(msg).split("\n");
  const hint = rest.join(" ").trim();
  // an error can carry "long SDK text\none actionable sentence" from writeErr
  const line = el("div", null, isErr && hint ? hint : String(msg).trim());
  if (isErr) line.style.color = "var(--danger)";
  box.append(line);
  if (isErr && hint) {
    const raw = el("div", "lab", detail.length > 180 ? detail.slice(0, 180) + "…" : detail);
    raw.style.fontSize = "11.5px";
    box.append(raw);
  }
  if (!isErr) setTimeout(() => { if (box.textContent === String(msg).trim()) box.innerHTML = ""; }, 3000);
}

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

async function loadAccounts() {
  state.accounts = await api("/api/accounts");
  const box = $("#accounts");
  box.innerHTML = "";
  if (!state.accounts.length) {
    const hint = el("div", "hint");
    hint.append(el("div", null, "还没有账号。"));
    const b = el("button", null, "＋ 添加第一个账户");
    b.style.marginTop = "10px";
    b.onclick = openAccountForm;
    hint.append(b);
    box.append(hint);
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
    let buckets = [];
    try {
      buckets = await api(`/api/b/${encodeURIComponent(a.name)}/buckets`);
    } catch (e) {
      const warn = el("div", "bucket", e.message);
      warn.style.color = "var(--danger)";
      list.append(warn);
      continue;
    }
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
  if (acct !== state.acct || bucket !== state.bucket || (prefix || "") !== state.prefix) {
    state.filter = "";
    const box = $("#filter");
    if (box) box.value = "";
  }
  state.acct = acct;
  state.bucket = bucket;
  state.prefix = prefix || "";
  const jump = $("#jumpprefix");
  if (jump) jump.value = state.prefix;
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
    sep.textContent = "/";
    nav.append(sep);
    const a = document.createElement("a");
    a.textContent = part;
    const target = acc;
    a.onclick = () => openBucket(state.acct, state.bucket, target);
    nav.append(a);
  }
  const last = nav.lastElementChild;
  if (last && last.tagName === "A") last.classList.add("cur");
}

async function load() {
  if (!state.acct || !state.bucket) return;
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
  if (!append) {
    rows.innerHTML = `<tr><td colspan="4" class="loading">加载中…</td></tr>`;
    $("#empty").hidden = true;
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
    rows.innerHTML = "";
    flash(e.message, true);
  }
}

function loadMore() {
  if (state.cursor) fetchPage(true);
}

// matches applies the client-side filter. It only sees what has been loaded so
// far, which is why the count is shown next to the box.
function matches(text) {
  if (!state.filter) return true;
  return text.toLowerCase().includes(state.filter);
}

function render() {
  const rows = $("#rows");
  rows.innerHTML = "";

  const dirs = state.prefixes.filter((p) => matches(p.slice(state.prefix.length)));
  const objs = state.objects.filter((o) => matches(o.Key.slice(state.prefix.length)));
  state.objectKeys = new Set(state.objects.map((o) => o.Key));
  state.objectByKey = new Map(state.objects.map((o) => [o.Key, o]));

  const total = state.prefixes.length + state.objects.length;
  const shown = dirs.length + objs.length;
  $("#empty").hidden = shown > 0 || state.cursor !== "";
  $("#empty").textContent = state.filter
    ? `没有匹配项（只在已加载的 ${total} 项里搜索）`
    : state.prefix
      ? `前缀 ${state.prefix} 下没有内容，检查一下拼写`
      : "空目录";

  for (const p of dirs) {
    const name = p.slice(state.prefix.length).replace(/\/$/, "");
    const tr = el("tr");
    const td = el("td", "name");
    td.append(icon(ICON.folder), document.createTextNode(name + "/"));
    td.onclick = () => openBucket(state.acct, state.bucket, p);
    const act = el("td", "act");
    const rm = el("button", null, "删除");
    rm.onclick = () => del(p, true);
    act.append(rm);
    tr.append(td, el("td", "num", "-"), el("td", "date", "-"), act);
    rows.append(tr);
  }

  for (const o of objs) {
    const name = o.Key.slice(state.prefix.length);
    const tr = el("tr");
    const td = el("td", "name");
    td.append(icon(ICON.file), document.createTextNode(name));
    td.onclick = () => preview(o.Key);
    const act = el("td", "act");
    const dl = el("button", null, "下载");
    dl.onclick = () => { location.href = rawUrl(o.Key, true); };
    const mv = el("button", null, "重命名");
    mv.onclick = () => rename(o.Key);
    const rm = el("button", null, "删除");
    rm.onclick = () => del(o.Key, false);
    act.append(dl, mv, rm);
    tr.append(td, el("td", "num", fmtSize(o.Size)),
      el("td", "date", new Date(o.LastModified).toLocaleString()), act);
    rows.append(tr);
  }

  if (state.cursor || (state.filter && shown !== total)) {
    const tr = el("tr");
    tr.className = "more";
    const td = el("td", "more-cell");
    td.colSpan = 4;
    const info = el("span", "more-info", state.filter
      ? `匹配 ${shown} 项 · 已加载 ${total} 项`
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
}

function preview(key) {
  const obj = state.objectByKey.get(key);
  const body = $("#mbody");
  body.innerHTML = "";
  $("#mtitle").textContent = key;
  $("#mmeta").textContent = obj
    ? `${fmtSize(obj.Size)} · ${new Date(obj.LastModified).toLocaleString()}`
    : "";
  $("#mdownload").href = rawUrl(key, true);
  $("#mopen").href = rawUrl(key);
  $("#modal").hidden = false;

  const e = ext(key);
  if (IMG.includes(e)) {
    const img = new Image();
    img.src = rawUrl(key);
    img.alt = base(key);
    body.append(img);
  } else if (VIDEO.includes(e)) {
    body.innerHTML = `<video src="${rawUrl(key)}" controls autoplay playsinline></video>`;
  } else if (AUDIO.includes(e)) {
    body.innerHTML = `<audio src="${rawUrl(key)}" controls autoplay style="width:100%"></audio>`;
  } else if (e === "pdf") {
    body.innerHTML = `<iframe src="${rawUrl(key)}" title="${base(key)}"></iframe>`;
  } else if (TEXT.includes(e)) {
    body.innerHTML = `<pre>加载中…</pre>`;
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

// askConfirm is an in-app confirmation: native confirm() can be silenced by the
// browser after repeated dialogs, which would let a delete run unconfirmed.
function askConfirm(text, okLabel) {
  return new Promise((resolve) => {
    const dlg = $("#confirm");
    const ok = $("#cok");
    const cancel = $("#ccancel");
    $("#ctext").textContent = text;
    ok.textContent = okLabel || "删除";

    const finish = (value) => {
      dlg.hidden = true;
      ok.onclick = cancel.onclick = dlg.onclick = null;
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    // capture phase: keep Escape away from the preview modal behind us
    const onKey = (ev) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        finish(false);
      }
    };
    ok.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    dlg.onclick = (ev) => { if (ev.target === dlg) finish(false); };
    document.addEventListener("keydown", onKey, true);
    dlg.hidden = false;
    cancel.focus();
  });
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
  const next = prompt("新名称", base(key));
  if (!next || next === base(key)) return;
  const to = dirOf(key) + next;
  if (state.objectKeys.has(to) && !(await askConfirm(`${next} 已存在，覆盖？`, "覆盖"))) return;
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
          err.textContent = e2.message;
        }
      } else {
        err.textContent = e.message;
      }
      save.disabled = false;
    }
  };

  body.append(form);
  name.focus();
  $("#modal").hidden = false;
}

async function saveAccount(data) {
  await api("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

function newFolder() {
  if (!state.acct || !state.bucket) return;
  const name = prompt("文件夹名称");
  if (!name) return;
  const key = state.prefix + name.replace(/^\/+|\/+$/g, "") + "/";
  api(rawUrl(key), { method: "PUT", body: "" })
    .then(() => { flash(`已创建 ${key}`); load(); })
    .catch((e) => flash(e.message, true));
}

async function uploadFiles(files) {
  if (!state.acct || !state.bucket || !files.length) return;
  const key = (f) => state.prefix + f.name;
  const dupes = files.filter((f) => state.objectKeys.has(key(f))).map((f) => f.name);
  if (dupes.length && !(await askConfirm(`${dupes.join("、")} 已存在，覆盖？`, "覆盖"))) return;
  const total = files.length;
  let done = 0;
  const box = $("#progress");
  box.innerHTML = `<div class="bar"><i></i></div><div class="lab"></div>`;
  const bar = box.querySelector("i");
  const lab = box.querySelector(".lab");

  const next = () => {
    if (done >= total) {
      flash(`已上传 ${total} 个文件`);
      load();
      return;
    }
    const file = files[done];
    const key = state.prefix + file.name;
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", rawUrl(key));
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = ((done + ev.loaded / ev.total) / total) * 100;
        bar.style.width = pct.toFixed(1) + "%";
        lab.textContent = `上传 ${file.name} (${done + 1}/${total})`;
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        done++;
        next();
      } else {
        flash(`上传失败 ${file.name}: ${xhr.responseText || xhr.status}`, true);
      }
    };
    xhr.onerror = () => flash(`上传失败 ${file.name}: 网络错误`, true);
    xhr.send(file);
  };
  next();
}

async function mkBucket(acct) {
  const name = prompt(`在 ${acct} 新建桶，名称：`);
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

function closeModal() {
  $("#modal").hidden = true;
  $("#modal").querySelector(".box").classList.remove("narrow");
  $("#mbody").innerHTML = "";
}

// jumpToPrefix navigates by S3 prefix, so it reaches keys that are not loaded yet.
// The text is used as-is (minus a leading slash): "many/shard_03" is a valid
// prefix even though it is not a directory, and forcing a trailing slash would
// make it match nothing.
function jumpToPrefix(value) {
  if (!state.acct || !state.bucket) return;
  const typed = String(value).trim().replace(/^\/+/, "");
  if (typed === state.prefix) {
    load();
    return;
  }
  openBucket(state.acct, state.bucket, typed);
}

$("#jumpprefix").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  jumpToPrefix(ev.target.value);
});

$("#filter").oninput = (ev) => {
  state.filter = ev.target.value.trim().toLowerCase();
  if (state.acct && state.bucket) render();
};
$("#refresh").onclick = load;
$("#newfolder").onclick = newFolder;
$("#addaccount").onclick = openAccountForm;
$("#upload").onchange = (ev) => {
  uploadFiles([...ev.target.files]);
  ev.target.value = "";
};
$("#mclose").onclick = closeModal;
$("#modal").onclick = (ev) => { if (ev.target.id === "modal") closeModal(); };
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (!$("#confirm").hidden) return; // the confirmation dialog owns Escape
  closeModal();
});
document.addEventListener("dragover", (ev) => ev.preventDefault());
document.addEventListener("drop", (ev) => {
  ev.preventDefault();
  if (state.bucket) uploadFiles([...ev.dataTransfer.files]);
});

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
    $("#empty").textContent = `点 ${a.name} 右侧的 ＋ 新建桶，或从命令行运行 scc mb ${a.name}:/bucket`;
  }
});
