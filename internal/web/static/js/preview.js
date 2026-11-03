// The preview dialog.

import { $, el, ICON, icon } from "./dom.js";
import { state } from "./state.js";
import { base, ext, fmtSize, fmtFull } from "./format.js";
import { rawUrl } from "./api.js";
import { openDialog, shutDialog } from "./dialogs.js";

const IMG = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];
const VIDEO = ["mp4", "webm", "mov", "m4v", "ogv"];
const AUDIO = ["mp3", "wav", "ogg", "flac", "m4a", "aac"];
const TEXT = ["txt", "md", "json", "js", "mjs", "ts", "css", "html", "xml", "yaml", "yml",
  "toml", "ini", "conf", "log", "csv", "tsv", "sh", "go", "py", "rs", "java", "c", "h",
  "sql", "env", "gitignore", "dockerfile", "makefile", "readme", "license"];
// how much of a text object the preview reads; the rest stays on the server
const TEXT_PREVIEW_BYTES = 200000;

let modalFrame = null;

export function openModal() {
  if (!modalFrame) modalFrame = openDialog($("#modal"), closeModal);
}

export function closeModal() {
  if ($("#modal").hidden) return;
  shutDialog(modalFrame);
  modalFrame = null;
  $("#modal").querySelector(".box").classList.remove("narrow");
  $("#modal .head-actions").hidden = false;
  $("#mbody").innerHTML = "";
}

// The files the preview steps through: the ones on screen, in screen order, so
// the filter and the sort carry over. Directories cannot be previewed.
const siblings = () => state.visible.filter((k) => !k.endsWith("/"));
let current = "";
let seq = 0;

function step(by) {
  const list = siblings();
  const next = list[list.indexOf(current) + by];
  if (next) preview(next, true);
}

function paintPager() {
  const list = siblings();
  const i = list.indexOf(current);
  $("#mpager").hidden = list.length < 2 || i < 0;
  $("#mprev").disabled = i <= 0;
  $("#mnext").disabled = i < 0 || i >= list.length - 1;
  $("#mpos").textContent = `${i + 1} / ${list.length}`;
}

// stepping keeps focus where it is (on ← / → or the arrow key's target);
// opening from the table moves it into the dialog
export function preview(key, stepping) {
  const obj = state.objectByKey.get(key);
  const body = $("#mbody");
  const mine = ++seq;
  current = key;
  body.innerHTML = "";
  $("#mtitle").textContent = key;
  $("#mmeta").textContent = obj
    ? `${fmtSize(obj.Size)} · ${fmtFull(obj.LastModified)}`
    : "";
  $("#mdownload").href = rawUrl(key, true);
  $("#mopen").href = rawUrl(key);
  $("#modal .head-actions").hidden = false;
  $("#modal").querySelector(".box").classList.remove("narrow");
  paintPager();
  openModal();
  if (!stepping || !$("#modal").contains(document.activeElement)) $("#mclose").focus();

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
    // Only the head is fetched: a 2 GB log used to download in full just to show
    // its first 200 KB. No Range when the object is small or its size unknown,
    // since S3 answers a Range on an empty object with InvalidRange.
    const big = obj && obj.Size > TEXT_PREVIEW_BYTES;
    const opts = big ? { headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } } : {};
    fetch(rawUrl(key), opts)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (mine !== seq) return; // the user stepped on before this arrived
        const cut = t.slice(0, TEXT_PREVIEW_BYTES);
        const more = big || t.length > cut.length;
        const note = more ? `\n\n… (已截断，只显示前 ${fmtSize(TEXT_PREVIEW_BYTES)}；完整内容请下载)` : "";
        body.replaceChildren(el("pre", null, cut + note));
      })
      .catch((err) => { if (mine === seq) body.replaceChildren(el("div", "err", `读取失败：${err.message}`)); });
  } else {
    body.append(noPreview(key, obj));
  }
}

export function initPreview() {
  $("#mprev").onclick = () => step(-1);
  $("#mnext").onclick = () => step(1);
  $("#modal").addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
    // the account form shares this dialog; media and fields use the arrows themselves
    if ($("#modal .head-actions").hidden) return;
    if (ev.target.closest("input, textarea, select, video, audio")) return;
    ev.preventDefault();
    step(ev.key === "ArrowLeft" ? -1 : 1);
  });
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
