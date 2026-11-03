// DOM helpers and the inline icon set.

export const $ = (s) => document.querySelector(s);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const ICON = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  file: "M7 3h6l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm6 0v5h4",
  bucket: "M4 7c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2Zm0 0v10c0 1.1 3.6 2 8 2s8-.9 8-2V7",
  download: "M12 4v11m0 0 4-4m-4 4-4-4M5 19h14",
  rename: "M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3Z",
  trash: "M4 7h16M9.5 7V4.8h5V7M6.5 7l.9 13h9.2l.9-13M10 11v5.5M14 11v5.5",
  warn: "M12 4.6 2.9 20h18.2L12 4.6Zm0 5.4v4.6m0 3.2v.1",
};

export function icon(path) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "ico");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}
