// Uploading from the button or by dropping files on the page.

import { $ } from "./dom.js";
import { state } from "./state.js";
import { base } from "./format.js";
import { rawUrl } from "./api.js";
import { clearToast, showBar, flash } from "./toast.js";
import { askConfirm } from "./dialogs.js";
import { load } from "./browse.js";
import { existingKeys } from "./ops.js";

const uploadKey = (f) => state.prefix + f.name;

// note is appended to the final message; the drop handler uses it to say which
// folders it left out, since the one toast slot would otherwise overwrite it.
export async function uploadFiles(files, note = "") {
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
  // the files that did go up must show in the list however the run ends
  const halt = (msg) => {
    flash(msg + note, true);
    if (done) load();
  };
  const stop = () => {
    cancelled = true;
    if (cur) cur.abort();
    clearToast();
    halt(`已取消上传：完成 ${done}/${total}`);
  };
  const next = () => {
    if (cancelled) return;
    if (done >= total) {
      flash(`已上传 ${total} 个文件` + (unchecked ? ` · 其中 ${unchecked} 个未做同名检查` : "") + note);
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
        halt(`上传失败 ${file.name}（已完成 ${done}/${total}）: ${xhr.responseText || xhr.status}`);
      }
    };
    xhr.onerror = () => { if (!cancelled) halt(`上传失败 ${file.name}（已完成 ${done}/${total}）: 网络错误`); };
    xhr.send(file);
  };
  showBar(`上传 ${files[0].name} (1/${total})`, 0, stop);
  next();
}

export function initUpload() {
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
    // A dropped folder arrives as one unreadable File; uploading it ended in a bare
    // 网络错误. Folders are left out and named instead.
    const items = [...ev.dataTransfer.items].filter((it) => it.kind === "file");
    const files = [];
    const folders = [];
    for (const it of items) {
      const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
      const f = it.getAsFile();
      if (entry && entry.isDirectory) folders.push(entry.name);
      else if (f) files.push(f);
    }
    const note = folders.length ? ` · 已跳过文件夹 ${folders.join("、")}（暂不支持上传文件夹）` : "";
    if (files.length) uploadFiles(files, note);
    else if (folders.length) flash(note.replace(/^ · /, ""), true);
  });
}
