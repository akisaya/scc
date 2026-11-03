import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state } from "../../internal/web/static/js/state.js";
import { stateHash, parseHash } from "../../internal/web/static/js/router.js";

beforeEach(() => {
  globalThis.location = { hash: "" };
});

const at = (prefix) => Object.assign(state, { acct: "mock", bucket: "models", prefix });

test("every prefix survives a trip through the hash", () => {
  for (const p of ["", "a/", "a/b/", "many/shard_03", "x", "a b/中文/", "q?x/"]) {
    at(p);
    location.hash = stateHash();
    assert.deepEqual(parseHash(), { acct: "mock", bucket: "models", prefix: p }, location.hash);
  }
});

test("a partial prefix is marked, a directory is not", () => {
  at("a/b/");
  assert.equal(stateHash(), "#/mock/models/a/b");
  at("many/shard_03");
  assert.equal(stateHash(), "#/mock/models/many/shard_03?");
  at("");
  assert.equal(stateHash(), "#/mock/models/");
});

test("links written before the partial marker still open a directory", () => {
  location.hash = "#/mock/models/a/b";
  assert.equal(parseHash().prefix, "a/b/");
});

test("a hash that is not a location parses to null", () => {
  for (const h of ["", "#", "#/", "#/mock", "#/mock/models/%E0"]) {
    location.hash = h;
    assert.equal(parseHash(), null, h);
  }
});
