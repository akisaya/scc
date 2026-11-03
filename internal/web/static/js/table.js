// The table rows, the sort headers and the selection checkboxes.

import { $, el, ICON, icon } from "./dom.js";
import { state } from "./state.js";
import { base, fmtSize, fmtTime, fmtFull } from "./format.js";
import { rawUrl } from "./api.js";
import { displayName, matches, sortDirs, sortObjs } from "./listing.js";
import { paintActive } from "./sidebar.js";
import { locLink, loadMore } from "./browse.js";
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

// Rebuilding the rows drops keyboard focus on the floor. focusBefore notes which
// row had it, so the same row (or the one now in its place) gets it back.
let lastWhere = "";

function focusBefore(rows) {
  const at = document.activeElement;
  const tr = rows.contains(at) ? at.closest("tr") : null;
  const rowsBefore = [...rows.querySelectorAll("tr[data-key]")];
  return { key: tr && tr.dataset.key, index: tr ? rowsBefore.indexOf(tr) : -1, had: !!tr };
}

function restoreFocus(rows, mark) {
  const where = `${state.acct}/${state.bucket}/${state.prefix}`;
  const moved = where !== lastWhere;
  lastWhere = where;
  if (!mark.had) return;
  const all = [...rows.querySelectorAll("tr[data-key]")];
  // a new directory starts from its first row; the same one keeps its place
  const tr = moved ? all[0]
    : all.find((r) => r.dataset.key === mark.key) || all[Math.min(mark.index, all.length - 1)];
  const target = tr && tr.querySelector(".name-link");
  if (target) target.focus();
}

export function render() {
  const rows = $("#rows");
  const mark = focusBefore(rows);
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
    tr.dataset.key = p;
    if (state.selected.has(p)) tr.className = "sel";
    tr.append(checkCell(p, tr));
    const td = el("td", "name");
    const link = locLink(state.acct, state.bucket, p, "name-link");
    link.append(icon(ICON.folder), el("span", "label", name + "/"));
    td.append(link);
    const act = el("td", "act");
    act.append(actionBtn(ICON.trash, "删除目录及其内容", () => del(p, true), true));
    tr.append(td, el("td", "num", "-"), el("td", "date", "-"), act);
    rows.append(tr);
  }

  for (const o of objs) {
    const name = displayName(o.Key);
    const tr = el("tr");
    tr.dataset.key = o.Key;
    if (state.selected.has(o.Key)) tr.className = "sel";
    tr.append(checkCell(o.Key, tr));
    const td = el("td", "name");
    const open = el("button", "name-link");
    open.type = "button";
    open.title = o.Key;
    open.append(icon(ICON.file), el("span", "label", name));
    open.onclick = () => preview(o.Key);
    td.append(open);
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
  restoreFocus(rows, mark);
}

// Arrow keys move between rows, Delete (or ⌘⌫) deletes the focused one through
// its own confirm. Only when focus is in a row, so the page keeps its scrolling.
function rowKeys(ev) {
  const tr = ev.target.closest && ev.target.closest("tr");
  if (!tr || !$("#rows").contains(tr)) return;
  const plain = !ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey;
  if (plain && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
    const links = [...$("#rows").querySelectorAll(".name-link")];
    const i = links.indexOf(tr.querySelector(".name-link"));
    const next = ev.key === "ArrowDown"
      ? links[i < 0 ? links.length : i + 1]
      : links[i < 0 ? links.length - 1 : i - 1];
    if (!next) return;
    ev.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest" });
  } else if ((plain && ev.key === "Delete") || (ev.metaKey && ev.key === "Backspace")) {
    if (ev.target.tagName === "INPUT" && ev.target.type !== "checkbox") return;
    const del = tr.querySelector(".row-act.danger");
    if (!del) return;
    ev.preventDefault();
    del.click();
  }
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
  $("#rows").addEventListener("keydown", rowKeys);
}
