import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state } from "../../internal/web/static/js/state.js";
import { displayName, matches, sortDirs, sortObjs } from "../../internal/web/static/js/listing.js";

const obj = (Key, Size, LastModified) => ({ Key, Size, LastModified });

beforeEach(() => {
  Object.assign(state, {
    prefix: "d/",
    filter: "",
    sort: { col: "", dir: 1 },
    prefixes: ["d/b/", "d/a/", "d/C/"],
    objects: [
      obj("d/z.txt", 10, "2026-01-02T00:00:00Z"),
      obj("d/a.txt", 30, "2026-01-01T00:00:00Z"),
      obj("d/m.txt", 10, "2026-01-03T00:00:00Z"),
    ],
  });
});

const keys = () => sortObjs().map((o) => o.Key);

test("names are shown relative to the directory part of the prefix", () => {
  assert.equal(displayName("d/a.txt"), "a.txt");
  state.prefix = "d/shard_0"; // a partial prefix keeps its directory
  assert.equal(displayName("d/shard_03"), "shard_03");
});

test("the filter is a case-insensitive substring match", () => {
  state.filter = "txt";
  assert.ok(matches("A.TXT"));
  assert.ok(!matches("a.md"));
});

test("no sort column keeps the server order", () => {
  assert.deepEqual(keys(), ["d/z.txt", "d/a.txt", "d/m.txt"]);
  assert.deepEqual(sortDirs(), ["d/b/", "d/a/", "d/C/"]);
});

test("a size sort breaks ties by key, in both directions", () => {
  state.sort = { col: "size", dir: 1 };
  assert.deepEqual(keys(), ["d/m.txt", "d/z.txt", "d/a.txt"]);
  state.sort = { col: "size", dir: -1 };
  assert.deepEqual(keys(), ["d/a.txt", "d/z.txt", "d/m.txt"]);
});

test("a date sort orders by LastModified", () => {
  state.sort = { col: "date", dir: 1 };
  assert.deepEqual(keys(), ["d/a.txt", "d/z.txt", "d/m.txt"]);
});

test("directories sort by name in byte order, like scc ls", () => {
  state.sort = { col: "name", dir: 1 };
  assert.deepEqual(sortDirs(), ["d/C/", "d/a/", "d/b/"]);
  state.sort = { col: "size", dir: 1 }; // directories have no size
  assert.deepEqual(sortDirs(), ["d/b/", "d/a/", "d/C/"]);
});
