// Pure formatting: key parts, sizes, timestamps.

export const base = (k) => k.slice(k.lastIndexOf("/") + 1);
// The extension of the base name only: a dot in a directory ("v1.2/Makefile")
// is not an extension. A name with no dot ("Dockerfile") counts as its own
// extension, which is how TEXT lists those.
export const ext = (k) => {
  const name = base(k).toLowerCase();
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1) : name;
};
export const dirOf = (k) => k.slice(0, k.lastIndexOf("/") + 1);

export function fmtSize(n) {
  if (n < 1024) return n + " B";
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(1) + " " + u[i];
}

// One fixed-width stamp per row: 2026-11-03 01:42. Relative wording ("3 天前")
// made the column impossible to scan or compare; the tooltip keeps the full
// locale string with seconds for the rare case someone needs it.
const pad2 = (n) => (n < 10 ? "0" : "") + n;

export function fmtTime(t) {
  const d = new Date(t);
  if (isNaN(d.getTime())) return "-";
  return (
    d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes())
  );
}

export const fmtFull = (t) => {
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
};
