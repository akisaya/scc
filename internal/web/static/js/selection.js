// Batch download and delete for the selected rows.

import { $ } from "./dom.js";
import { state } from "./state.js";
import { base } from "./format.js";
import { api, rawUrl } from "./api.js";
import { clearToast, showBar, flash } from "./toast.js";
import { askConfirm } from "./dialogs.js";
import { load } from "./browse.js";
import { render } from "./table.js";

export function initSelection() {
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
}
