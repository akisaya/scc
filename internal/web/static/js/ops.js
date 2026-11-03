// Single-object operations: delete, rename, new folder, new bucket.

import { $ } from "./dom.js";
import { state } from "./state.js";
import { base, dirOf } from "./format.js";
import { api, rawUrl } from "./api.js";
import { flash } from "./toast.js";
import { askConfirm, askInput } from "./dialogs.js";
import { loadAccounts } from "./sidebar.js";
import { openBucket, load } from "./browse.js";

// existingKeys asks the server which of these keys are already there. The local
// listing only covers the pages that have been loaded, so an upload into a
// 3000-key directory would otherwise overwrite silently.
export async function existingKeys(keys) {
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

export async function del(key, isDir) {
  const label = isDir ? `目录 ${key} 及其全部内容` : key;
  if (!(await askConfirm(`删除 ${label}？`))) return;
  try {
    await api(rawUrl(key) + (isDir ? "?recursive=1" : ""), { method: "DELETE" });
    flash(`已删除 ${key}`);
    load();
  } catch (e) { flash(e.message, true); }
}

export async function rename(key) {
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
  // S3 has no rename: it is a copy, then a delete of the original. If only the
  // copy went through there are now two objects, and the message has to say so.
  try {
    await api(`/api/b/${encodeURIComponent(state.acct)}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_bucket: state.bucket, from_key: key, to_bucket: state.bucket, to_key: to }),
    });
  } catch (e) {
    flash(e.message, true, `重命名失败：没能复制为 ${next}，原文件没动`);
    return;
  }
  try {
    await api(rawUrl(key), { method: "DELETE" });
    flash(`已重命名为 ${next}`);
  } catch (e) {
    flash(e.message, true, `已复制为 ${next}，但删除原文件 ${base(key)} 失败，现在两份都在`);
  }
  load();
}

export async function newFolder() {
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

export async function mkBucket(acct) {
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
