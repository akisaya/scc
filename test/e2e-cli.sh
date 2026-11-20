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
"$BIN" accounts add plain -endpoint "$ENDPOINT" -access-key "$AK" -secret-key "$SK" >/dev/null || fail=$((fail+1))
check "accounts file is 0600" "1" "$(find "$SCC_CONFIG" -maxdepth 0 -perm 600 | wc -l | tr -d ' ')"
check "accounts list" "2" "$("$BIN" accounts list | grep -cE '^(local|plain)')"

"$BIN" mb "local://$B" || fail=$((fail+1))
check "buckets" "1" "$("$BIN" buckets local | grep -c "^$B$")"
check "no default bucket lists buckets" "1" "$("$BIN" ls plain: | grep -c "^DIR.*$B/")"

echo "hello scc" > "$T/a.txt"
"$BIN" cp "$T/a.txt" "local:/docs/a.txt" >/dev/null || fail=$((fail+1))
check "cat inside default bucket" "hello scc" "$("$BIN" cat "local:/docs/a.txt")"
check "ls lists object" "1" "$("$BIN" ls "local:/docs/" | grep -c 'a.txt')"
check "ls exact file in default bucket" "1" "$("$BIN" ls "local:/docs/a.txt" | grep -c 'a.txt$')"
check "ls exact file prints basename" "0" "$("$BIN" ls "local:/docs/a.txt" | grep -c 'docs/a.txt')"
check "ls directory without trailing slash" "1" "$("$BIN" ls "local:/docs" | grep -c 'a.txt$')"
check "ls prints names relative to the directory" "0" "$("$BIN" ls "local:/docs/" | grep -c 'docs/a.txt')"
check "ls -r keeps full keys" "1" "$("$BIN" ls -r "local:/docs/" | grep -c 'docs/a.txt')"

# the same key reached through an account without a default bucket
check "explicit bucket form" "hello scc" "$("$BIN" cat "plain://$B/docs/a.txt")"
check "ls exact file with explicit bucket" "1" "$("$BIN" ls "plain://$B/docs/a.txt" | grep -c 'a.txt$')"
check "single slash requires a default bucket" "1" \
  "$("$BIN" ls "plain:/docs/" 2>&1 | grep -c 'no default bucket')"

# a default bucket makes the first segment a folder, never a bucket
"$BIN" cp "$T/a.txt" "local:/$B/literal.txt" >/dev/null
check "bucket name is just a folder" "1" "$("$BIN" ls "local:/" | grep -c "DIR.*$B/")"
"$BIN" rm "local:/$B/literal.txt" >/dev/null

B2=bucket2$RANDOM
"$BIN" mb "local://$B2" >/dev/null || fail=$((fail+1))
check "mb still names a bucket" "1" "$("$BIN" buckets local | grep -c "^$B2$")"
# acct://bucket/key reaches another bucket while a default is set
"$BIN" cp "$T/a.txt" "local://$B2/cross.txt" >/dev/null || fail=$((fail+1))
check "explicit bucket reachable despite the default" "hello scc" "$("$BIN" cat "local://$B2/cross.txt")"
check "explicit form leaves the default alone" "hello scc" "$("$BIN" cat "local:/docs/a.txt")"
"$BIN" rm "local://$B2/cross.txt" >/dev/null
"$BIN" use "local://$B2" >/dev/null
"$BIN" cp "$T/a.txt" "local:/only-here.txt" >/dev/null
check "paths follow the switched default" "hello scc" "$("$BIN" cat "local:/only-here.txt")"
"$BIN" rm "local:/only-here.txt" >/dev/null
"$BIN" rb "local://$B2" >/dev/null || fail=$((fail+1))
"$BIN" use "local://$B" >/dev/null
check "use restores the default" "hello scc" "$("$BIN" cat "local:/docs/a.txt")"

"$BIN" cp "$T/a.txt" "local:/docs/b.md" >/dev/null
"$BIN" cp "$T/a.txt" "local:/docs/c.txt" >/dev/null
"$BIN" cp "local:/docs/a.txt" "local:/docs/copy.txt" >/dev/null || fail=$((fail+1))
check "s3 -> s3 copy" "hello scc" "$("$BIN" cat "local:/docs/copy.txt")"
check "ls -n caps the output" "2" "$("$BIN" ls "local:/docs/" -n 2 | wc -l | tr -d ' ')"
check "ls -n 0 shows everything" "4" "$("$BIN" ls "local:/docs/" -n 0 | wc -l | tr -d ' ')"

mkdir -p "$T/tree/sub"
echo one > "$T/tree/1.txt"
echo two > "$T/tree/sub/2.txt"
"$BIN" cp -r "$T/tree" "local:/tree" >/dev/null || fail=$((fail+1))
check "recursive upload" "2" "$("$BIN" ls -r "local:/tree" | grep -c '.txt')"
check "subdir listed as DIR" "1" "$("$BIN" ls "local:/tree" | grep -c 'DIR.*sub/')"

"$BIN" put "$T/a.txt" local:/put/renamed.txt >/dev/null || fail=$((fail+1))
check "put uploads renamed file" "hello scc" "$("$BIN" cat local:/put/renamed.txt)"
echo "new contents" > "$T/put-new.txt"
"$BIN" put --skip-existing "$T/put-new.txt" local:/put/renamed.txt >/dev/null || fail=$((fail+1))
check "put skip-existing preserves remote object" "hello scc" "$("$BIN" cat local:/put/renamed.txt)"
"$BIN" put "$T/tree" local:/put/tree -r >/dev/null || fail=$((fail+1))
check "put uploads directory contents" "two" "$("$BIN" cat local:/put/tree/sub/2.txt)"
check "put directory omits source directory name" "one" "$("$BIN" cat local:/put/tree/1.txt)"
check "put help" "1" "$("$BIN" put --help | grep -c 'usage: scc put')"
"$BIN" rm -r local:/put >/dev/null || fail=$((fail+1))

mkdir -p "$T/out"
"$BIN" cp -r "local:/tree" "$T/out" >/dev/null || fail=$((fail+1))
check "recursive download" "two" "$(cat "$T/out/sub/2.txt" 2>/dev/null)"

# Path selection and recursion are independent; raw prefix matching is explicit.
for key in abc.txt abc.txt.bak abc.txt/child.txt docs/a.txt docs/sub/b.txt docs-old/c.txt; do
  "$BIN" cp "$T/a.txt" "local:/semantics/$key" >/dev/null || fail=$((fail+1))
done
check "ls -r selects an exact file" "1" "$("$BIN" ls -r local:/semantics/abc.txt | wc -l | tr -d ' ')"
check "ls -r respects directory boundaries" "2" "$("$BIN" ls -r local:/semantics/docs | wc -l | tr -d ' ')"
check "ls -p retains the full filename" "1" "$("$BIN" ls -p local:/semantics/abc | grep -c 'abc.txt.bak$')"
check "ls -p groups matching directories" "2" "$("$BIN" ls -p local:/semantics/doc | grep -c '^DIR')"
check "ls -p -r expands all matches" "3" "$("$BIN" ls -p -r local:/semantics/doc | wc -l | tr -d ' ')"

"$BIN" get local:/semantics/abc.txt "$T/get-renamed.txt" >/dev/null || fail=$((fail+1))
check "get downloads a renamed file" "hello scc" "$(cat "$T/get-renamed.txt" 2>/dev/null)"
(cd "$T" && "$BIN" get local:/semantics/abc.txt >/dev/null) || fail=$((fail+1))
check "get defaults to the current directory" "hello scc" "$(cat "$T/abc.txt" 2>/dev/null)"
echo "keep existing" > "$T/abc.txt"
(cd "$T" && "$BIN" get --skip-existing local:/semantics/abc.txt >/dev/null) || fail=$((fail+1))
check "get skip-existing preserves local data" "keep existing" "$(cat "$T/abc.txt")"
"$BIN" get local:/semantics/docs "$T/get-dir" -r >/dev/null || fail=$((fail+1))
check "get downloads nested directory contents" "hello scc" "$(cat "$T/get-dir/sub/b.txt" 2>/dev/null)"
check "get directory excludes sibling prefixes" "2" "$(find "$T/get-dir" -type f | wc -l | tr -d ' ')"
"$BIN" get -p local:/semantics/abc "$T/get-files" >/dev/null || fail=$((fail+1))
check "get -p downloads only direct files" "2" "$(find "$T/get-files" -type f | wc -l | tr -d ' ')"
"$BIN" get -p -r local:/semantics/doc "$T/get-prefix" >/dev/null || fail=$((fail+1))
check "get prefix retains directory names" "hello scc" "$(cat "$T/get-prefix/docs-old/c.txt" 2>/dev/null)"
check "get rejects an S3 destination" "1" \
  "$("$BIN" get local:/semantics/abc.txt local:/semantics/not-local.txt 2>&1 | grep -c 'destination must be a local path')"

"$BIN" cp -r local:/semantics/abc.txt "$T/single-with-r.txt" >/dev/null || fail=$((fail+1))
check "cp -r selects an exact file" "hello scc" "$(cat "$T/single-with-r.txt" 2>/dev/null)"
"$BIN" cp -r local:/semantics/docs "$T/dir-copy" >/dev/null || fail=$((fail+1))
check "cp -r copies directory contents" "hello scc" "$(cat "$T/dir-copy/sub/b.txt" 2>/dev/null)"
check "cp -r excludes sibling prefixes" "2" "$(find "$T/dir-copy" -type f | wc -l | tr -d ' ')"
"$BIN" cp -p local:/semantics/abc "$T/prefix-files" >/dev/null || fail=$((fail+1))
check "cp -p copies only direct files" "2" "$(find "$T/prefix-files" -type f | wc -l | tr -d ' ')"
"$BIN" cp -p -r local:/semantics/doc "$T/prefix-copy" >/dev/null || fail=$((fail+1))
check "cp prefix keeps directory names" "hello scc" "$(cat "$T/prefix-copy/docs-old/c.txt" 2>/dev/null)"
check "cp prefix expands nested objects" "hello scc" "$(cat "$T/prefix-copy/docs/sub/b.txt" 2>/dev/null)"

"$BIN" cp -r local:/semantics/docs local:/semantics/copied-dir/ >/dev/null || fail=$((fail+1))
check "S3 directory copy respects boundaries" "2" "$("$BIN" ls -r local:/semantics/copied-dir | wc -l | tr -d ' ')"
"$BIN" cp -p -r local:/semantics/doc local:/semantics/copied-prefix/ >/dev/null || fail=$((fail+1))
check "S3 prefix copy retains names" "hello scc" "$("$BIN" cat local:/semantics/copied-prefix/docs-old/c.txt)"
mkdir -p "$T/conflict"
check "prefix download reports local conflicts" "1" \
  "$("$BIN" cp -p -r local:/semantics/abc "$T/conflict" 2>&1 | grep -c 'file/directory conflict')"
check "conflict checked before downloading" "0" "$(find "$T/conflict" -type f | wc -l | tr -d ' ')"
check "get help" "1" "$("$BIN" get --help | grep -c 'usage: scc get')"
check "nested account help" "1" "$("$BIN" help accounts add | grep -c 'usage: scc accounts add')"
check "rm preview exact directory" "2" "$("$BIN" rm -r --dry-run local:/semantics/docs | grep -c '^would delete')"
check "rm preview leaves data intact" "hello scc" "$("$BIN" cat local:/semantics/docs/a.txt)"
"$BIN" rm -r local:/semantics/docs >/dev/null || fail=$((fail+1))
check "rm directory excludes sibling prefixes" "hello scc" "$("$BIN" cat local:/semantics/docs-old/c.txt)"
check "rm raw prefix preview" "1" "$("$BIN" rm -p -r --dry-run local:/semantics/doc | grep -c '^would delete')"
check "missing path returns clear error" "1" "$("$BIN" ls local:/semantics/missing 2>&1 | grep -c 'does not exist')"
"$BIN" rm -r local:/semantics/ >/dev/null || fail=$((fail+1))

"$BIN" cp "local:/docs/b.md" "$T/dl.md" >/dev/null || fail=$((fail+1))
check "single download" "hello scc" "$(cat "$T/dl.md")"

"$BIN" rm "local:/docs/copy.txt" || fail=$((fail+1))
check "rm single" "0" "$("$BIN" ls "local:/docs/" | grep -c 'copy.txt')"
"$BIN" rm -r "local:/tree/" >/dev/null || fail=$((fail+1))
check "rm -r prefix" "0" "$("$BIN" ls "local:/" | grep -c 'tree/')"

"$BIN" rm -r "local:/docs/" >/dev/null
"$BIN" rb "local://$B" || fail=$((fail+1))
check "bucket removed" "0" "$("$BIN" buckets local | grep -c "^$B$")"

"$BIN" accounts rm local >/dev/null
check "accounts rm" "0" "$(grep -c 'name: local' "$SCC_CONFIG")"

echo "---"
[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "$fail FAILED"
[ "$fail" -eq 0 ]
