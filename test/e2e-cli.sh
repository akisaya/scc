#!/bin/bash
# CLI end-to-end test. Needs any S3-compatible endpoint; defaults to a local moto/minio.
#   SCC_TEST_ENDPOINT=http://127.0.0.1:9000 ./test/e2e-cli.sh
set -u
cd "$(dirname "$0")/.."
ENDPOINT=${SCC_TEST_ENDPOINT:-http://127.0.0.1:19000}
BIN=$(mktemp -d)/scc
T=$(mktemp -d)
trap 'rm -rf "$T" "$(dirname "$BIN")"' EXIT
export SCC_CONFIG="$T/config.yaml"

go build -o "$BIN" . || exit 1
if ! curl -s -o /dev/null --max-time 3 "$ENDPOINT"; then
  echo "no S3 endpoint at $ENDPOINT (start moto/minio or set SCC_TEST_ENDPOINT)" >&2
  exit 1
fi
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=$((fail+1)); fi; }

AK=${SCC_TEST_KEY:-testkey}
SK=${SCC_TEST_SECRET:-testsecret123}
B=bucket$RANDOM

"$BIN" accounts add local -endpoint "$ENDPOINT" -access-key "$AK" -secret-key "$SK" -default-bucket "$B" >/dev/null || fail=$((fail+1))
check "accounts file is 0600" "600" "$(stat -f '%Lp' "$SCC_CONFIG" 2>/dev/null || stat -c '%a' "$SCC_CONFIG")"
check "accounts list" "1" "$("$BIN" accounts list | grep -c '^local')"

"$BIN" mb "local:/$B" || fail=$((fail+1))
check "buckets" "1" "$("$BIN" buckets local | grep -c "^$B$")"

echo "hello scc" > "$T/a.txt"
"$BIN" cp "$T/a.txt" "local:/$B/docs/a.txt" >/dev/null || fail=$((fail+1))
check "cat roundtrip" "hello scc" "$("$BIN" cat "local:/$B/docs/a.txt")"
check "ls lists object" "1" "$("$BIN" ls "local:/$B/docs/" | grep -c 'a.txt')"

"$BIN" cp "$T/a.txt" "local:/$B/docs/b.md" >/dev/null
"$BIN" cp "$T/a.txt" "local:/$B/docs/c.txt" >/dev/null
"$BIN" cp "local:/$B/docs/a.txt" "local:/$B/docs/copy.txt" >/dev/null || fail=$((fail+1))
check "s3 -> s3 copy" "hello scc" "$("$BIN" cat "local:/$B/docs/copy.txt")"

mkdir -p "$T/tree/sub"
echo one > "$T/tree/1.txt"
echo two > "$T/tree/sub/2.txt"
"$BIN" cp -r "$T/tree" "local:/$B/tree" >/dev/null || fail=$((fail+1))
check "recursive upload" "2" "$("$BIN" ls -r "local:/$B/tree" | grep -c '.txt')"
check "subdir listed as DIR" "1" "$("$BIN" ls "local:/$B/tree" | grep -c 'DIR.*sub/')"

mkdir -p "$T/out"
"$BIN" cp -r "local:/$B/tree" "$T/out" >/dev/null || fail=$((fail+1))
check "recursive download" "two" "$(cat "$T/out/sub/2.txt" 2>/dev/null)"

"$BIN" cp "local:/$B/docs/b.md" "$T/dl.md" >/dev/null || fail=$((fail+1))
check "single download" "hello scc" "$(cat "$T/dl.md")"

"$BIN" rm "local:/$B/docs/copy.txt" || fail=$((fail+1))
check "rm single" "0" "$("$BIN" ls "local:/$B/docs/" | grep -c 'copy.txt')"
"$BIN" rm -r "local:/$B/tree" >/dev/null || fail=$((fail+1))
check "rm -r prefix" "0" "$("$BIN" ls "local:/$B/" | grep -c 'tree/')"

"$BIN" rm -r "local:/$B/docs/" >/dev/null
"$BIN" rb "local:/$B" || fail=$((fail+1))
check "bucket removed" "0" "$("$BIN" buckets local | grep -c "^$B$")"

"$BIN" accounts rm local >/dev/null
check "accounts rm" "0" "$(grep -c 'name: local' "$SCC_CONFIG")"

echo "---"
[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "$fail FAILED"
[ "$fail" -eq 0 ]
