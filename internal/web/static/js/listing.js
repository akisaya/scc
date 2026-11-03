// Display names, filtering and sorting of the loaded listing. No DOM.

import { state } from "./state.js";

// displayBase is the directory part of the current prefix. Names are shown
// relative to it, so jumping to a partial key ("many/shard_03") or to a file
// ("README") does not chop the matched names.
function displayBase() {
  const i = state.prefix.lastIndexOf("/");
  return i >= 0 ? state.prefix.slice(0, i + 1) : "";
}

export function displayName(key) {
  return key.slice(displayBase().length);
}

export function matches(text) {
  if (!state.filter) return true;
  return text.toLowerCase().includes(state.filter);
}

// Byte order, the same order S3 and `scc ls` use.
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function sortDirs() {
  const dirs = state.prefixes.slice();
  // Directories only have a name, so a size/date sort leaves them in the
  // server order (already name-ascending) rather than pretending to sort them.
  if (state.sort.col !== "name") return dirs;
  dirs.sort((a, b) => byKey(displayName(a), displayName(b)));
  if (state.sort.dir < 0) dirs.reverse();
  return dirs;
}

export function sortObjs() {
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
