import { test } from "node:test";
import assert from "node:assert/strict";
import { explainErr } from "../../internal/web/static/js/errors.js";

test("explainErr names known S3 failures and leaves the rest alone", () => {
  assert.equal(explainErr("operation error S3: ListBuckets, SignatureDoesNotMatch"), "secret_key 不对，签名验不过");
  assert.equal(explainErr("dial tcp: connection refused"), "endpoint 拒绝了连接");
  assert.equal(explainErr("NoSuchBucket"), "桶不存在");
  assert.equal(explainErr("something new"), null);
});
