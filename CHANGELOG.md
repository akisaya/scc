# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The web UI is split into ES modules under `static/js/`, loaded from
  `main.js` with `<script type="module">`. There is still no build step and the
  CSP is unchanged. The modules that do not touch the DOM (formatting, the URL
  hash, sorting, error naming) have unit tests in `test/web/`, which CI runs
  with `node --test`.
- The page works from the keyboard. Buckets, breadcrumbs and directory names
  are links, file names are buttons, so Tab reaches all of them; ↑/↓ moves
  between rows and Delete or ⌘⌫ deletes the focused one after its confirm.
  Focus stays on the same row when the table redraws.
- Below 640px the sidebar is a drawer, and the breadcrumbs take a row of their
  own. A 172px sidebar column left the breadcrumbs no width at all on a phone.
- Progress and messages are separate toasts. A message no longer replaces a
  running upload's bar, and up to three messages stack.
- The preview steps to the previous or next file with ←/→ or the header arrows,
  following the filter and sort of the list on screen.
- Font sizes come from five tokens instead of nine values between 10.5px and
  15px, and the page edge is one `--gutter` value.

### Fixed

- A rename whose copy succeeded but whose delete failed says that both objects
  now exist, instead of showing only the delete's error.
- Below 860px the row buttons were invisible: hiding the date cells with
  `display: none` slid the action cell into the zero-width date column.

- An account without a default bucket opens its first bucket on load. Boot used
  to look for the bucket rows before their listing came back, and said to
  create a bucket.
- Text without an extension previews in any directory: `ext()` read the whole
  key, so `dir/Dockerfile` only previewed at the bucket root. `README` and
  `LICENSE` count as text.
- The text preview reads the first 200 KB with a `Range` request instead of
  downloading the whole object.
- A failed or cancelled upload refreshes the list, so the files that did go up
  show, and says how many finished. A dropped folder is skipped and named
  instead of failing with a bare 网络错误.
- A prefix jump survives a refresh: `#/acct/bucket/many/shard_03?` is the
  partial prefix, and links without the `?` still open the directory.

## [0.5.1] - 2026-11-03

An object key is untrusted input, so the preview dialog renders it as a node,
and `/raw` gives an uploaded document no script on this origin.

### Security

- The preview dialog no longer builds its markup from the object key. A key is
  chosen by whoever can write to the bucket, and a quote in the name closed the
  `title` attribute it sat in and added an event handler to the element. The
  media and PDF branches now create their node and set properties on it.
- The page is served with a `Content-Security-Policy` that allows no inline
  script, so a value that escapes into markup cannot bring a handler with it.
  The theme bootstrap moved to `static/theme.js` to allow this; it is still a
  blocking script in `<head>`, so it still runs before the first paint.
- `/raw` sends `X-Content-Type-Options: nosniff`, and the types a browser
  renders as a document (`html`, `xhtml`, `svg`, `xml`) also get
  `Content-Security-Policy: sandbox`. Opening an uploaded `.html` used to run its
  script on this origin, where it could read `/api/accounts` or delete objects.

### Fixed

- An upload can be cancelled from the progress toast. A stalled 5 GB `PutObject`
  used to leave reloading the page as the only way out.
- A selection hidden by the filter is reported as such — `已选 3 项 · 其中 2 项被
  过滤隐藏` — instead of reading as if all three were on screen, which is exactly
  when a batch delete was about to remove something unseen.
- The account form names a recognised failure in one line, like every other error
  surface, instead of printing the raw SDK text; that form is where a wrong
  endpoint or key is first typed.
- The table is not clickable while the next page loads. The rows stayed dimmed
  but kept their handlers, so a click landed on the directory being left.

## [0.5.0] - 2026-11-03

The web UI sorts, selects in bulk, and asks before it overwrites something it
could not see.

### Added

- Column headers sort by name, size and modification time. Name order matches
  `scc ls`: directories first, then key order within each group. Clicking the
  same header cycles ascending → descending → back to the default order.
- Every row has a checkbox, so batch download and batch delete no longer need
  one confirmation per file.
- `POST /api/b/{acct}/stat` reports which keys already exist. An upload or a
  rename into a partly loaded directory now warns before overwriting a key that
  is not on screen.

### Changed

- The filter box and the prefix jump box are one field: typing filters what is
  loaded, Enter navigates to the text as an S3 prefix.
- Per-row actions became icon buttons that appear on hover; rows are 38px
  instead of 44px; timestamps are absolute (`2026-11-03 01:42`) with the full
  stamp in a tooltip, so rows can be compared at a glance.
- The table uses a fixed layout, so the name column no longer caps out and
  leaves a gap on wide screens. Breadcrumbs scroll sideways to keep the current
  directory visible instead of cutting it off with an ellipsis.
- On narrow screens the refresh and new-folder buttons move into an overflow
  menu instead of disappearing.
- Renaming, creating a folder and creating a bucket use an in-app input dialog
  instead of the native `prompt()`, which browsers can suppress.

### Fixed

- The theme is applied before the first paint, so a light-mode visitor no
  longer sees a dark frame first.
- The add-account dialog was announced as "文件预览" to screen readers, and no
  dialog trapped focus; both are fixed.
- An error toast can be dismissed instead of sitting at the bottom of the
  screen until the next message.
- Breadcrumbs separate crumbs with a chevron instead of `/`. The first crumb is
  `acct/bucket`, so a slash between crumbs drew the same glyph with two
  different gaps (tight inside the crumb, spaced outside it) and read as a
  typo. When the path overflows, the left edge fades so it no longer opens on
  a separator with nothing in front of it.
- Sort arrows are CSS triangles instead of `↕`/`↑`/`↓`: the glyphs are drawn
  differently by each font and land as a slanted stroke at header size.
- A failed bucket listing is a card in the sidebar (cause, endpoint, 重试,
  查看错误信息) instead of the raw SDK string dropped into a 34px row, where it
  wrapped over the account name and the 添加账户 button. A failed directory
  listing gets the same card in the table area, so the page no longer goes
  blank while only a toast explains why, and the account list shows 读取桶列表…
  while the endpoint is probed. Recognised causes are named in Chinese in the
  toast instead of leading with the SDK's English hint.
- Opening 查看错误信息 no longer blows up the card. The card is a flex item in
  the table panel, so its width came from its content, and the raw SDK line is
  ~1900px on one line; the panel went with it and the card was pushed off the
  left edge of the window, half out of view. The panel now takes the width it
  is given and the card is sized inside it.
- The raw error text wraps instead of scrolling sideways, so the message is not
  cut at "operation error S3: ListBuck" with the rest hidden behind a scroll
  gesture. The box only scrolls vertically when it is longer than the space
  available, and its scrollbar is drawn (macOS hides overlay scrollbars until
  a scroll starts, which is what made the cut look like truncation).
- The table no longer blanks while the next page loads.
- Dragging files over the window shows a drop target instead of accepting the
  drop silently.

## [0.4.0] - 2026-11-03

Bucket paths now mark bucket names with `//`.

### Changed

- A bucket name is now always marked with a double slash: `acct://bucket/key`.
  A single slash (`acct:/dir/file`) is relative to the account's default bucket
  and is an error when no default is set. `acct:` still lists buckets, and
  `mb`, `rb` and `use` now take `acct://bucket`.

## [0.3.1] - 2026-10-30

The add-account dialog shows only what the form needs.

### Fixed

- The add-account dialog no longer shows the preview's 下载 / 新标签打开 / 关闭
  buttons or the last previewed file's size, which leaked in because both share
  one modal. 取消, Escape and a click outside still close it.

## [0.3.0] - 2026-10-22

Installing no longer requires the source tree.

### Added

- Each release ships `checksums.txt` with a SHA-256 for every archive.

### Changed

- Module path is `github.com/akisaya/scc` instead of `scc`, so
  `go install github.com/akisaya/scc@latest` works without cloning. Tags before
  0.3.0 declare `module scc` and cannot be fetched under the new path; 0.3.0 is
  the first release installable that way.

### Documentation

- README lists the prebuilt binaries attached to each release (macOS, Linux,
  Windows; amd64 and arm64) for people who would rather not install Go.

## [0.2.0] - 2026-10-21

Browsing large directories no longer dead-ends at one page.

### Added

- Directories load one page of 200 entries at a time with a `加载更多` row that
  shows how many are loaded. The listing API takes `limit` and `cursor` and
  returns `next_cursor`.
- A filter box narrows the loaded entries and reports how many matched, so a
  partial directory is never mistaken for a complete one.
- A separate jump box takes any S3 prefix and navigates there on Enter, which
  reaches deep prefixes without paging through everything above them.

### Changed

- The sidebar account name reads as a heading (12px/700, body colour) instead of
  a muted label.

### Fixed

- The jump box now finds a file whose name you typed in full: a listing used to
  drop an object whose key equalled the requested prefix, because that check was
  meant for zero-byte `dir/` placeholders.
- Names are shown relative to the directory part of the prefix, so jumping to a
  partial key (`README`) or a nested one (`many/shard_03`) no longer truncates
  the matched names.

## [0.1.0] - 2026-10-21

First stable release: one binary serving both a browser UI and a CLI, with
accounts in a local YAML file and no database. Same code as 0.1.0-rc1, which was
validated against a live S3-compatible endpoint; only the test and CI plumbing
changed since then.

### Added

- `scc web`: browser UI with account/bucket sidebar, breadcrumbs, previews for
  images, video/audio (with seeking), PDF and text, upload with progress (button
  or drag & drop), new folder, download, rename, delete, and bucket management.
- `scc ls`, `cat`, `cp`, `rm`, `mb`, `rb`, `buckets`, `accounts add|list|rm`,
  with `-r` for recursive copy, delete and listing.
- Accounts stored in `$SCC_CONFIG`, else `$XDG_CONFIG_HOME/scc/config.yaml`,
  else `~/.config/scc/config.yaml`, written with mode `0600`. Per-account
  `endpoint`, `region`, `path_style` and `default_bucket`; secrets may be
  `env:VAR` references so they stay out of the file.
- Default bucket semantics: `acct:` is the bucket root and `acct:/dir/file` is
  relative to it; `scc use acct:/bucket` switches it, `scc use acct:` clears it.
- `acct://bucket/key` names a bucket explicitly, so cross-bucket copies work
  even when a default bucket is configured.
- Web paths live in the URL (`#/account/bucket/prefix`), so refresh and
  back/forward keep their place; a listing is capped at 1000 keys with a hint.
- Optional shared `token` for the web UI, bound to `127.0.0.1` by default.
- S3 compatibility: path-style addressing for custom endpoints, flexible
  checksums limited to when an operation requires them (R2/B2), server-side
  streaming preview with Range support.
- Actionable hints for common failures (wrong secret, unknown access key, clock
  skew, permissions, non-empty bucket, missing bucket, TLS, unreachable host).
- Account name validation (letters, digits, `-`, `_`, `.`; max 64 characters).
- Tests: unit tests for config, target parsing, listing caps and error hints,
  plus `test/e2e-cli.sh` and `test/e2e-web.sh` against any S3 endpoint.
- Add or update accounts in the web UI (`＋ 添加账户`): name, endpoint, region,
  keys, path-style and optional default bucket. An existing name asks before
  overwriting, and the secret is never sent back to the browser.
- `ls` prints at most 100 entries on a terminal and tells you when it stopped;
  `-n N` changes the cap, `-n 0` prints everything. Piped output is uncapped.
- Every `/api/` request is logged with its status, so a browser-side failure can
  be checked against what actually reached the server.
- Flags may follow the path (`ls acct:/dir -n 5`), not only precede it.
- `scc version` / `scc --version` prints the version, which the release build
  stamps into the binary.
- CI (gofmt, vet, `-race` tests, a syntax check of the UI, and both end-to-end
  scripts against a MinIO container) plus a tag-driven release workflow that
  publishes macOS, Linux and Windows binaries with notes from this file.

### Changed

- Destructive actions (delete file, delete folder, delete bucket, overwrite on
  upload, overwrite on rename, replace account) confirm in an in-app dialog
  instead of `window.confirm`, which browsers silently suppress after a few
  dialogs. Cancel is focused by default.
- Web UI redesigned: quieter surfaces, rounded controls, sticky table header,
  icon buttons, and a preview/toast treatment that matches the rest.
- Preview modal puts the file's path, size and timestamp in the header next to a
  primary 下载 button and 新标签打开; unpreviewable types get a card explaining
  what to do instead of a raw API URL.
- Dark and light themes, following the system by default, with a sidebar toggle
  that remembers the choice.
- Dark theme uses a soft charcoal palette (#1e222a canvas, #262b34 surfaces)
  instead of near-black, with borders and muted text tuned for it.

### Fixed

- Per-row actions and the bucket delete button stay visible on touch devices,
  where hover never happens.
