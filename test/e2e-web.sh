#!/bin/bash
# Web API end-to-end test. Needs any S3-compatible endpoint; defaults to a local moto/minio.
#   SCC_TEST_ENDPOINT=http://127.0.0.1:9000 ./test/e2e-web.sh
set -u
cd "$(dirname "$0")/.."
ENDPOINT=${SCC_TEST_ENDPOINT:-http://127.0.0.1:19000}
BIN=$(mktemp -d)/scc
T=$(mktemp -d)
PORT=$((18000 + RANDOM % 1000))
BASE=http://127.0.0.1:$PORT
B=web$RANDOM
export SCC_CONFIG="$T/config.yaml"
SRV=
trap 'kill $SRV 2>/dev/null; rm -rf "$T" "$(dirname "$BIN")"' EXIT

go build -o "$BIN" . || exit 1
if ! curl -s -o /dev/null --max-time 3 "$ENDPOINT"; then
  echo "no S3 endpoint at $ENDPOINT (start moto/minio or set SCC_TEST_ENDPOINT)" >&2
  exit 1
fi
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=$((fail+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post_json() { # url, json-file, method
  curl -s -o /dev/null -w '%{http_code}' -X "${3:-POST}" -H 'Content-Type: application/json' --data @"$2" "$1"
}

AK=${SCC_TEST_KEY:-testkey}
SK=${SCC_TEST_SECRET:-testsecret123}
"$BIN" accounts add local -endpoint "$ENDPOINT" -access-key "$AK" -secret-key "$SK" >/dev/null
"$BIN" web -addr "127.0.0.1:$PORT" > "$T/web.log" 2>&1 &
SRV=$!
for _ in $(seq 1 40); do code "$BASE/api/accounts" >/dev/null 2>&1 && break; sleep 0.25; done

printf '{"name":"%s"}' "$B" > "$T/bucket.json"
printf '{"name":"added","replace":true,"endpoint":"%s","access_key":"k","secret_key":"topsecret"}' "$ENDPOINT" > "$T/acct-replace.json"
printf '{"name":"bad name","access_key":"k","secret_key":"s"}' > "$T/acct-bad.json"
printf '{"name":"nokeys"}' > "$T/acct-nokeys.json"
printf '{"from_bucket":"%s","from_key":"docs/hello.txt","to_key":"docs/renamed.txt"}' "$B" > "$T/copy.json"

check "index served" "1" "$(curl -s "$BASE/" | grep -c 'id="rows"')"
check "app.js served" "200" "$(code "$BASE/static/app.js")"
check "accounts listed" "1" "$(curl -s "$BASE/api/accounts" | grep -c '"name":"local"')"

# adding an account from the web UI
printf '{"name":"added","endpoint":"%s","access_key":"k","secret_key":"topsecret","default_bucket":"%s"}' "$ENDPOINT" "$B" > "$T/acct.json"
check "add account" "201" "$(post_json "$BASE/api/accounts" "$T/acct.json")"
check "account listed" "1" "$(curl -s "$BASE/api/accounts" | grep -c '"name":"added"')"
check "secret never returned" "0" "$(curl -s "$BASE/api/accounts" | grep -c 'topsecret')"
check "duplicate account rejected" "409" "$(post_json "$BASE/api/accounts" "$T/acct.json")"
check "replace account" "201" "$(post_json "$BASE/api/accounts" "$T/acct-replace.json")"
check "invalid account name" "400" "$(post_json "$BASE/api/accounts" "$T/acct-bad.json")"
check "missing keys" "400" "$(post_json "$BASE/api/accounts" "$T/acct-nokeys.json")"
check "form post rejected" "415" "$(code -X POST -d 'name=x' "$BASE/api/accounts")"
check "create bucket" "204" "$(post_json "$BASE/api/b/local/buckets" "$T/bucket.json")"
check "buckets listed" "1" "$(curl -s "$BASE/api/b/local/buckets" | grep -c "\"$B\"")"

check "upload" "204" "$(printf 'hello web' | code -X PUT --data-binary @- -H 'Content-Type: text/plain' "$BASE/api/b/local/raw/$B/docs/hello.txt")"
check "list shows object" "1" "$(curl -s "$BASE/api/b/local/objects/$B?prefix=docs/" | grep -c '"Key":"docs/hello.txt"')"
check "preview body" "hello web" "$(curl -s "$BASE/api/b/local/raw/$B/docs/hello.txt")"
check "preview content-type" "text/plain" "$(curl -s -o /dev/null -w '%{content_type}' "$BASE/api/b/local/raw/$B/docs/hello.txt" | cut -d';' -f1)"
check "range request" "206" "$(code -H 'Range: bytes=0-4' "$BASE/api/b/local/raw/$B/docs/hello.txt")"
check "download disposition" "1" "$(curl -s -D- -o /dev/null "$BASE/api/b/local/raw/$B/docs/hello.txt?download=1" | grep -ci 'content-disposition: attachment')"

check "new folder" "204" "$(code -X PUT --data-binary '' "$BASE/api/b/local/raw/$B/sub/")"
check "folder listed as prefix" "1" "$(curl -s "$BASE/api/b/local/objects/$B" | grep -c '"sub/"')"

check "copy/rename" "204" "$(post_json "$BASE/api/b/local/copy" "$T/copy.json")"
check "renamed readable" "hello web" "$(curl -s "$BASE/api/b/local/raw/$B/docs/renamed.txt")"

check "delete object" "204" "$(code -X DELETE "$BASE/api/b/local/raw/$B/docs/renamed.txt")"
check "delete prefix" "204" "$(code -X DELETE "$BASE/api/b/local/raw/$B/docs/?recursive=1")"
check "prefix gone" "0" "$(curl -s "$BASE/api/b/local/objects/$B?prefix=docs/" | grep -c '"Key"')"

check "non-empty bucket is 409" "409" "$(code -X DELETE "$BASE/api/b/local/buckets/$B")"
code -X DELETE "$BASE/api/b/local/raw/$B/sub/?recursive=1" >/dev/null
check "delete bucket" "204" "$(code -X DELETE "$BASE/api/b/local/buckets/$B")"
check "missing object is 404" "404" "$(code "$BASE/api/b/local/raw/$B/nope.txt")"

kill $SRV 2>/dev/null; wait $SRV 2>/dev/null

# token auth
sed -i.bak 's/^token: .*/token: seekrit/' "$SCC_CONFIG"
"$BIN" web -addr "127.0.0.1:$PORT" > "$T/web2.log" 2>&1 &
SRV=$!
for _ in $(seq 1 40); do code "$BASE/" >/dev/null 2>&1 && break; sleep 0.25; done
check "token required" "401" "$(code "$BASE/api/accounts")"
check "token query accepted" "303" "$(code "$BASE/?token=seekrit")"
check "wrong token rejected" "401" "$(code -H 'Authorization: Bearer nope' "$BASE/api/accounts")"
check "bearer accepted" "200" "$(code -H 'Authorization: Bearer seekrit' "$BASE/api/accounts")"

echo "---"
[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "$fail FAILED"
[ "$fail" -eq 0 ]
