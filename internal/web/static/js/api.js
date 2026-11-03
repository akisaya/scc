// fetch wrapper and the /raw URL builder.

import { state } from "./state.js";

export async function api(path, opts = {}) {
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
export const rawUrl = (key, download) =>
  `/api/b/${encodeURIComponent(state.acct)}/raw/${encodeURIComponent(state.bucket)}/${encKey(key)}` +
  (download ? "?download=1" : "");
