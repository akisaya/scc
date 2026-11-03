// The table rows, the sort headers and the selection checkboxes.

import { $, el, ICON, icon } from "./dom.js";
import { state } from "./state.js";
import { base, fmtSize, fmtTime, fmtFull } from "./format.js";
import { rawUrl } from "./api.js";
import { displayName, matches, sortDirs, sortObjs } from "./listing.js";
import { paintActive } from "./sidebar.js";
import { openBucket, loadMore } from "./browse.js";
import { preview } from "./preview.js";
import { del, rename } from "./ops.js";

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

export function render() {
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

export function initTable() {
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
}
