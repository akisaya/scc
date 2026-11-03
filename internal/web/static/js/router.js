// The location in the URL hash: #/acct/bucket/prefix.

import { state } from "./state.js";

// The current location lives in the URL hash, so refresh and back/forward work.
// A directory is written without its trailing slash (#/acct/bucket/a/b). A
// partial prefix from the search box ("many/shard_03") gets a trailing "?",
// otherwise a refresh would reopen it as the directory many/shard_03/. Keys can
// never produce a bare "?": encodeURIComponent escapes it inside a segment.
export function stateHash() {
  const segs = [state.acct, state.bucket];
  const parts = state.prefix.split("/").filter(Boolean);
  const partial = state.prefix !== "" && !state.prefix.endsWith("/");
  return "#/" + [...segs, ...parts].map(encodeURIComponent).join("/") +
    (parts.length ? "" : "/") + (partial ? "?" : "");
}

export function parseHash() {
  let raw = location.hash.replace(/^#\/?/, "");
  const partial = raw.endsWith("?");
  if (partial) raw = raw.slice(0, -1);
  if (!raw) return null;
  let segs;
  try {
    segs = raw.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null; // a hand-edited hash with a broken %-escape
  }
  if (segs.length < 2) return null;
  const [acct, bucket, ...rest] = segs;
  const prefix = rest.length ? rest.join("/") + (partial ? "" : "/") : "";
  return { acct, bucket, prefix };
}
