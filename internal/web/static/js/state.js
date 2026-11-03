// The one mutable object every view reads: where we are and what is loaded.

export const state = {
  acct: null,
  bucket: null,
  prefix: "",
  accounts: [],
  objectKeys: new Set(),
  objectByKey: new Map(),
  prefixes: [],
  objects: [],
  visible: [],
  cursor: "",
  filter: "",
  // col === "" means the untouched server order (S3 key order), which is the
  // default view; see the header click cycle in table.js.
  sort: { col: "", dir: 1 },
  selected: new Set(),
};
