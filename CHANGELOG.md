# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Web UI redesigned: quieter surfaces, rounded controls, sticky table header,
  icon buttons, and a preview/toast treatment that matches the rest.
- Dark and light themes, following the system by default, with a sidebar toggle
  that remembers the choice.

### Fixed

- Per-row actions and the bucket delete button stay visible on touch devices,
  where hover never happens.

## [0.1.0-rc1] - 2026-10-21

First release candidate: one binary serving both a browser UI and a CLI, with
accounts in a local YAML file and no database. The CLI syntax may still change
before 0.1.0.

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
