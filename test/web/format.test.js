import { test } from "node:test";
import assert from "node:assert/strict";
import { base, dirOf, ext, fmtSize, fmtTime } from "../../internal/web/static/js/format.js";

test("base and dirOf split a key at its last slash", () => {
  assert.equal(base("a/b/c.txt"), "c.txt");
  assert.equal(base("c.txt"), "c.txt");
  assert.equal(dirOf("a/b/c.txt"), "a/b/");
  assert.equal(dirOf("c.txt"), "");
});

test("ext reads the base name only", () => {
  assert.equal(ext("dir/Dockerfile"), "dockerfile");
  assert.equal(ext("v1.2/Makefile"), "makefile");
  assert.equal(ext("a/b.TXT"), "txt");
  assert.equal(ext(".gitignore"), "gitignore");
  assert.equal(ext("LICENSE"), "license");
  assert.equal(ext("a/archive.tar.gz"), "gz");
});

test("fmtSize", () => {
  assert.equal(fmtSize(0), "0 B");
  assert.equal(fmtSize(1023), "1023 B");
  assert.equal(fmtSize(1024), "1.0 KB");
  assert.equal(fmtSize(1536), "1.5 KB");
  assert.equal(fmtSize(5 * 1024 ** 3), "5.0 GB");
  assert.equal(fmtSize(3 * 1024 ** 5), "3072.0 TB");
});

test("fmtTime is a fixed-width local stamp", () => {
  assert.equal(fmtTime(new Date(2026, 10, 3, 1, 42, 9)), "2026-11-03 01:42");
  assert.equal(fmtTime("not a date"), "-");
});
