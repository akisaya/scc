// Entry point: wires every module, then opens the first location.

import { $ } from "./dom.js";
import { state } from "./state.js";
import { errCard } from "./errors.js";
import { initDialogs } from "./dialogs.js";
import { initTheme } from "./theme.js";
import { bucketLists, loadAccounts, initSidebar } from "./sidebar.js";
import { applyHash, openBucket, initBrowse } from "./browse.js";
import { initTable } from "./table.js";
import { initPreview } from "./preview.js";
import { initSelection } from "./selection.js";
import { initUpload } from "./upload.js";
import { initToolbar } from "./toolbar.js";

initTheme();
initDialogs();
initSidebar();
initBrowse();
initTable();
initPreview();
initSelection();
initUpload();
initToolbar();

window.addEventListener("popstate", applyHash);
window.addEventListener("hashchange", applyHash);

loadAccounts().then(async () => {
  if (applyHash()) return; // deep link wins
  const a = state.accounts.find((x) => x.default_bucket) || state.accounts[0];
  if (!a) return;
  if (a.default_bucket) {
    openBucket(a.name, a.default_bucket, "");
    return;
  }
  // no default: the first listed bucket, once that account's listing is in
  const buckets = await bucketLists.get(a.name);
  if (state.bucket || location.hash) return; // the user got somewhere meanwhile
  const empty = $("#empty");
  if (buckets && buckets.length) {
    openBucket(a.name, buckets[0], "");
  } else if (buckets) {
    empty.hidden = false;
    empty.textContent = `点 ${a.name} 右侧的 ＋ 新建桶，或从命令行运行 scc mb ${a.name}://bucket`;
  } else {
    // the sidebar already shows why the listing failed, with a retry
    empty.hidden = false;
    empty.textContent = `列不出 ${a.name} 的桶，原因见左侧`;
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
