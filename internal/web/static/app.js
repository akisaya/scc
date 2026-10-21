const $ = (s) => document.querySelector(s);
const state = { acct: null, bucket: null, prefix: "", accounts: [] };

const IMG = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];
const VIDEO = ["mp4", "webm", "mov", "m4v", "ogv"];
const AUDIO = ["mp3", "wav", "ogg", "flac", "m4a", "aac"];
const TEXT = ["txt", "md", "json", "js", "mjs", "ts", "css", "html", "xml", "yaml", "yml",
  "toml", "ini", "conf", "log", "csv", "tsv", "sh", "go", "py", "rs", "java", "c", "h",
  "sql", "env", "gitignore", "dockerfile", "makefile"];

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.text()).trim() || res.statusText);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

const encKey = (k) => k.split("/").map(encodeURIComponent).join("/");
const rawUrl = (key, download) =>
  `/api/b/${encodeURIComponent(state.acct)}/raw/${encodeURIComponent(state.bucket)}/${encKey(key)}` +
  (download ? "?download=1" : "");

function flash(msg, isErr) {
  const el = $("#progress");
  el.innerHTML = "";
  const line = document.createElement("div");
  line.textContent = msg;
  if (isErr) line.style.color = "var(--danger)";
  el.append(line);
  if (!isErr) setTimeout(() => { if (el.textContent === msg) el.innerHTML = ""; }, 3000);
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
    box.innerHTML = `<div class="hint">还没有账号，先运行：<br><code>scc accounts add ...</code></div>`;
    return;
  }
  for (const a of state.accounts) {
    const el = document.createElement("div");
    el.className = "acct";
    el.innerHTML = `<div class="acct-name">${a.name}</div>`;
    const list = document.createElement("div");
    el.append(list);
    box.append(el);
    let buckets = [];
    try {
      buckets = await api(`/api/b/${encodeURIComponent(a.name)}/buckets`);
    } catch (e) {
      list.innerHTML = `<div class="bucket" style="color:var(--danger)">${e.message}</div>`;
      continue;
    }
    for (const b of buckets) {
      const row = el("div", "bucket");
      row.dataset.acct = a.name;
      row.dataset.bucket = b;
      row.append(icon("▤"), el("span", "name", b));
      const x = el("button", "del", "×");
      x.title = "删除桶";
      x.onclick = async (ev) => {
        ev.stopPropagation();
        if (!confirm(`删除桶 ${b}？桶必须为空。`)) return;
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
      row.append(icon("▤"), el("span", "name", `${a.default_bucket} (默认)`));
      row.onclick = () => openBucket(a.name, a.default_bucket, "");
      list.append(row);
    }
    if (a.name === state.acct) $("#addbucket").hidden = false;
  }
  $("#addbucket").onclick = mkBucket;
}

function paintActive() {
  document.querySelectorAll(".bucket").forEach((el) => {
    el.classList.toggle("active", el.dataset.acct === state.acct && el.dataset.bucket === state.bucket);
  });
  $("#addbucket").hidden = !state.acct;
}

async function openBucket(acct, bucket, prefix) {
  state.acct = acct;
  state.bucket = bucket;
  state.prefix = prefix || "";
  paintActive();
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
}

async function load() {
  if (!state.acct || !state.bucket) return;
  crumbs();
  try {
    const data = await api(
      `/api/b/${encodeURIComponent(state.acct)}/objects/${encodeURIComponent(state.bucket)}?prefix=${encodeURIComponent(state.prefix)}`
    );
    render(data);
  } catch (e) {
    flash(e.message, true);
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(ch) { return el("span", "icon", ch); }

function render(data) {
  const rows = $("#rows");
  rows.innerHTML = "";
  const dirs = data.prefixes || [];
  const objs = data.objects || [];
  $("#empty").hidden = dirs.length + objs.length > 0;
  $("#empty").textContent = "空目录";

  for (const p of dirs) {
    const name = p.slice(state.prefix.length).replace(/\/$/, "");
    const tr = el("tr");
    const td = el("td", "name");
    td.append(icon("▸"), document.createTextNode(name + "/"));
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
    td.append(icon("·"), document.createTextNode(name));
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
  paintActive();
}

function preview(key) {
  const body = $("#mbody");
  body.innerHTML = "";
  $("#mtitle").textContent = key;
  $("#modal").hidden = false;
  const e = ext(key);
  const link = `<p><a href="${rawUrl(key, true)}">下载</a> · ${rawUrl(key)}</p>`;

  if (IMG.includes(e)) {
    const img = new Image();
    img.src = rawUrl(key);
    img.alt = key;
    body.append(img, html(link));
  } else if (VIDEO.includes(e)) {
    body.innerHTML = `<video src="${rawUrl(key)}" controls autoplay></video>${link}`;
  } else if (AUDIO.includes(e)) {
    body.innerHTML = `<audio src="${rawUrl(key)}" controls autoplay style="width:100%"></audio>${link}`;
  } else if (e === "pdf") {
    body.innerHTML = `<iframe src="${rawUrl(key)}"></iframe>${link}`;
  } else if (TEXT.includes(e) || e === "") {
    body.innerHTML = `<pre>加载中…</pre>`;
    fetch(rawUrl(key))
      .then((r) => r.text())
      .then((t) => {
        const cut = t.slice(0, 200000);
        body.innerHTML = `<pre></pre>${link}`;
        body.querySelector("pre").textContent = cut + (t.length > cut.length ? "\n\n… (已截断)" : "");
      })
      .catch((err) => {
        body.innerHTML = `<p style="color:var(--danger)"></p>${link}`;
        body.querySelector("p").textContent = err.message;
      });
  } else {
    body.innerHTML = `<p>无法预览此类型。</p>${link}`;
  }
}

function html(s) {
  const t = document.createElement("template");
  t.innerHTML = s.trim();
  return t.content;
}

async function del(key, isDir) {
  const label = isDir ? `目录 ${key} 及其全部内容` : key;
  if (!confirm(`删除 ${label}？`)) return;
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

function newFolder() {
  if (!state.acct || !state.bucket) return;
  const name = prompt("文件夹名称");
  if (!name) return;
  const key = state.prefix + name.replace(/^\/+|\/+$/g, "") + "/";
  api(rawUrl(key), { method: "PUT", body: "" })
    .then(() => { flash(`已创建 ${key}`); load(); })
    .catch((e) => flash(e.message, true));
}

function uploadFiles(files) {
  if (!state.acct || !state.bucket || !files.length) return;
  const total = files.length;
  let done = 0;
  const el = $("#progress");
  el.innerHTML = `<div class="bar"><i></i></div><div class="lab"></div>`;
  const bar = el.querySelector("i");
  const lab = el.querySelector(".lab");

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

async function mkBucket() {
  const name = prompt("新桶名称");
  if (!name) return;
  try {
    await api(`/api/b/${encodeURIComponent(state.acct)}/buckets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadAccounts();
    openBucket(state.acct, name, "");
  } catch (e) { flash(e.message, true); }
}

$("#refresh").onclick = load;
$("#newfolder").onclick = newFolder;
$("#upload").onchange = (ev) => {
  uploadFiles([...ev.target.files]);
  ev.target.value = "";
};
$("#mclose").onclick = () => { $("#modal").hidden = true; $("#mbody").innerHTML = ""; };
$("#modal").onclick = (ev) => { if (ev.target.id === "modal") $("#mclose").click(); };
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") $("#mclose").click(); });
document.addEventListener("dragover", (ev) => ev.preventDefault());
document.addEventListener("drop", (ev) => {
  ev.preventDefault();
  if (state.bucket) uploadFiles([...ev.dataTransfer.files]);
});

loadAccounts().then(() => {
  const a = state.accounts.find((x) => x.default_bucket) || state.accounts[0];
  if (a) {
    const b = a.default_bucket || (document.querySelector(`.bucket[data-acct="${a.name}"]`)?.dataset.bucket);
    if (b) openBucket(a.name, b, "");
  }
});
