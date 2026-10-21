# scc

A small S3-compatible file browser: one Go binary that serves a web UI and a CLI, with accounts stored in a local config file (no database).

## Build

```bash
go build .        # produces ./scc
```

## Accounts

Accounts live in `$SCC_CONFIG`, else `$XDG_CONFIG_HOME/scc/config.yaml`, else
`~/.config/scc/config.yaml` (same on macOS and Linux). The file is written with mode `0600`.

```bash
# MinIO / self-hosted (path-style is the default when -endpoint is set)
scc accounts add minio \
  -endpoint http://127.0.0.1:9000 \
  -access-key minioadmin -secret-key minioadmin \
  -default-bucket data

# Cloudflare R2
scc accounts add r2 \
  -endpoint https://<account-id>.r2.cloudflarestorage.com \
  -access-key env:R2_ACCESS_KEY -secret-key env:R2_SECRET_KEY

# AWS (no endpoint, virtual-host style)
scc accounts add aws -region ap-northeast-1 -access-key env:AWS_AK -secret-key env:AWS_SK

scc accounts list
scc accounts rm minio
```

Account names may contain letters, digits, `-`, `_` and `.` (max 64 characters);
they appear in CLI paths and in the web UI's URL.

`env:VAR` keeps secrets in your environment instead of the file.

```yaml
listen: 127.0.0.1:8080
token: ""            # optional shared secret for the web UI
accounts:
    - name: minio
      endpoint: http://127.0.0.1:9000
      region: us-east-1
      access_key: minioadmin
      secret_key: minioadmin
      path_style: true
      default_bucket: data
```

## CLI

Object paths are `<account>:/bucket/key`. When an account has a `default_bucket`,
`acct:` means that bucket's root and `acct:/sub/dir` means a folder inside it —
unless `sub` is itself a bucket, because an existing bucket always wins. If the
account isn't allowed to list buckets, name the bucket explicitly.

```bash
scc web [-addr 127.0.0.1:8080]     # browser UI
scc buckets minio                 # list buckets
scc ls minio:/data/docs           # one directory level
scc ls -r minio:/data/docs        # everything under a prefix
scc cat minio:/data/a.txt > a.txt
scc cp ./report.pdf minio:/data/  # upload a file
scc cp -r ./assets minio:/data/   # upload a directory
scc cp minio:/data/a.txt ./a.txt  # download
scc cp -r minio:/data/assets ./   # download a prefix
scc cp minio:/data/a.txt minio:/data/b.txt   # server-side copy
scc rm minio:/data/a.txt
scc rm -r minio:/data/tmp/
scc mb minio:/newbucket
scc rb minio:/newbucket
```

## Web

`scc web` opens at `http://127.0.0.1:8080`:

- account/bucket sidebar, directory browsing with breadcrumbs
- the current path lives in the URL (`#/account/bucket/prefix`), so refresh and back/forward work
- preview for images, video/audio (with seeking), PDF, and text/JSON/code
- upload (button or drag & drop, with progress), new folder, download, rename, delete
- create/delete buckets
- a folder lists at most 1000 entries; a hint tells you when there are more

Set `token` in the config (or append `?token=...` once) to require a shared secret.
The server binds to `127.0.0.1` by default because it holds your S3 credentials.

The web API is plain JSON and usable with curl:

```
GET    /api/accounts
GET    /api/b/{acct}/buckets
POST   /api/b/{acct}/buckets                 {"name": "..."}
DELETE /api/b/{acct}/buckets/{bucket}
GET    /api/b/{acct}/objects/{bucket}?prefix=dir/&recursive=1
GET    /api/b/{acct}/raw/{bucket}/{key}?download=1     (supports Range)
PUT    /api/b/{acct}/raw/{bucket}/{key}
DELETE /api/b/{acct}/raw/{bucket}/{key}[?recursive=1]
POST   /api/b/{acct}/copy                    {from_bucket, from_key, to_bucket, to_key}
```

## S3 compatibility notes

- `-path-style` is assumed for any custom endpoint; only real AWS uses virtual-host style.
- Flexible checksums are limited to when an operation requires them, which is what R2/B2 expect.
- Web uploads are buffered to a temp file before being sent, because the SDK needs to hash a rewindable body.
- Keys are listed with `Delimiter=/`, so huge buckets aren't fetched in full. The web UI
  caps a listing at 1000 entries (S3's page size) and says so; the CLI is uncapped.

## Tests

```bash
go test ./...

# end-to-end, against any S3-compatible endpoint (moto, MinIO, ...)
SCC_TEST_ENDPOINT=http://127.0.0.1:9000 ./test/e2e-cli.sh
SCC_TEST_ENDPOINT=http://127.0.0.1:9000 SCC_TEST_KEY=... SCC_TEST_SECRET=... ./test/e2e-web.sh
```

## Not included

Single user, no database, no sharing links, no multipart/resumable uploads, no object
versioning. The config file is the only state.
