<div align="center">
  <img src="docs/logo.svg" width="84" alt="scc logo">

  # scc

  *一个小巧的 S3 兼容文件浏览器 —— 一个二进制，网页界面和命令行都有了*

  [![Go](https://img.shields.io/badge/Go-%3E%3D1.24-00add8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
  [![单文件部署](https://img.shields.io/badge/%E9%83%A8%E7%BD%B2-%E5%8D%95%E4%B8%AA%E4%BA%8C%E8%BF%9B%E5%88%B6-2ea043?style=flat-square)](#%E5%AE%89%E8%A3%85)
  [![无数据库](https://img.shields.io/badge/%E7%8A%B6%E6%80%81-%E9%85%8D%E7%BD%AE%E6%96%87%E4%BB%B6-6b7280?style=flat-square)](#%E9%85%8D%E7%BD%AE)

  [功能](#功能) • [安装](#安装) • [快速开始](#快速开始) • [命令行](#命令行) • [路径语法](#路径语法) • [网页界面](#网页界面) • [配置](#配置) • [开发](#开发)

  **中文** | [English](README.en.md)
</div>

`scc` 可以在浏览器或终端里浏览任何 S3 兼容存储 —— MinIO、Ceph RGW、Cloudflare R2、Backblaze B2、AWS S3 —— 而且两端走的是同一套实现。多个账号的凭证存在一个本地 YAML 文件里，所以除了二进制本身没有别的东西需要部署：没有服务端状态，没有数据库，加一个账号就是一行命令。

```bash
go build .                              # 产出 ./scc
./scc accounts add minio -endpoint http://127.0.0.1:9000 \
  -access-key minioadmin -secret-key minioadmin -default-bucket data
./scc web                               # http://127.0.0.1:8080
```

> [!TIP]
> 不想把密钥写进配置文件，就用环境变量：`-access-key env:MINIO_KEY -secret-key env:MINIO_SECRET`。

## 功能

- **一套实现，两个前端。** 网页和命令行共用同一个操作层，列目录、上传、删除的行为完全一致。
- **多账号。** 增删切换账号不用改 JSON、不用重启；网页每次请求都会重新读配置，改完立刻生效。
- **每个账号一个默认桶。** `acct:/dir/file` 直接落在默认桶里，日常路径更短。用 `scc use` 切换，用 `acct://bucket/key` 显式指定桶。
- **浏览器里直接预览。** 图片、视频/音频（可拖进度条）、PDF、文本和代码内联显示，其他类型一键下载。
- **破坏性操作都要二次确认。** 删除文件、目录、桶，以及上传或重命名时的覆盖，都会弹出应用内确认框。
- **错误说人话。** 常见 S3 故障（密钥错、AK 不存在、时钟偏移、权限不足、桶非空、TLS、连不上）会多打一行可执行的 `hint:`，而不是甩一整段 SDK 原文。
- **深色 / 浅色主题。** 默认跟随系统，手动切换后会记住选择。

## 安装

需要 [Go 1.24+](https://go.dev/dl/)。仓库没有构建步骤，不依赖 npm，也没有生成代码。

```bash
git clone <this-repo> scc && cd scc
go build .          # -> ./scc
# 或者
go install .        # -> $(go env GOPATH)/bin/scc
```

## 快速开始

添加一个账号，然后开始浏览：

```bash
# 自建 MinIO / Ceph：填了自定义 endpoint 会自动启用 path-style 寻址
scc accounts add minio \
  -endpoint http://127.0.0.1:9000 \
  -access-key minioadmin -secret-key minioadmin \
  -default-bucket data

# Cloudflare R2
scc accounts add r2 \
  -endpoint https://<account-id>.r2.cloudflarestorage.com \
  -access-key env:R2_ACCESS_KEY -secret-key env:R2_SECRET_KEY

# AWS：不填 endpoint，使用虚拟主机寻址
scc accounts add aws -region ap-northeast-1 \
  -access-key env:AWS_ACCESS_KEY_ID -secret-key env:AWS_SECRET_ACCESS_KEY

scc accounts list     # 永远不会打印 secret
scc ls minio:         # 默认桶的根目录
```

对象路径形如 `minio:/data/reports/q3.pdf`。账号名有校验：只能包含字母、数字、`-`、`_`、`.`，最长 64 字符 —— 因为它会出现在路径和 URL 里。

## 命令行

```
scc <command> [args]
```

| 命令 | 作用 |
| --- | --- |
| `accounts add <name> [flags]` | 添加或更新账号 |
| `accounts list` / `accounts rm <name>` | 列出账号 / 删除账号 |
| `use <acct>:/bucket` | 把 `bucket` 设为该账号的默认桶（省略桶名即清除） |
| `buckets <acct>` | 列桶，不受默认桶影响 |
| `ls <acct>:[/bucket[/prefix]] [-r] [-n N]` | 列桶、列目录，或列整个前缀 |
| `cat <acct>:/bucket/key` | 把对象写到标准输出 |
| `cp [-r] <src> <dst>` | 本地与 S3 互拷，或 S3 之间拷贝 |
| `rm [-r] <acct>:/bucket/key` | 删除一个对象，或删除某个前缀下的全部对象 |
| `mb` / `rb <acct>:/bucket` | 创建桶 / 删除空桶（必须写桶名） |
| `web [-addr host:port]` | 启动网页界面 |
| `version` | 打印版本号（由发布构建注入） |

来一轮实际操作：

```bash
scc buckets minio                       # 有哪些桶
scc ls minio:/reports                   # 看一层
scc ls -r minio:/reports -n 20          # 看下面全部，只显示前 20 条
scc cat minio:/reports/q3.pdf > q3.pdf
scc cp ./q4.pdf minio:/reports/         # 上传文件
scc cp -r ./assets minio:/reports/      # 上传目录
scc cp -r minio:/reports/2025 ./reports-2025   # 下载一个前缀
scc cp minio:/a.txt minio:/b.txt        # 服务端直接拷贝
scc rm -r minio:/tmp/                   # 删除一个前缀
```

> [!NOTE]
> `cp -r` 是把前缀的**内容**铺进目标目录（和 `aws s3 cp --recursive` 一致），所以上面的例子会得到 `./reports-2025/<2025 下的 key>`。除非确实想放进当前目录，否则请给一个明确的目录。

> [!TIP]
> `ls` 在终端里最多打印 100 条，并告诉你被截断了；`-n 0` 可以打印全部。输出被管道或重定向时不会截断，脚本行为不受影响。选项也可以写在路径后面 —— `scc ls minio:/reports -n 20` 一样有效。

## 路径语法

三种写法，没有猜测成分：

| 路径 | 含义 |
| --- | --- |
| `acct:` | 账号默认桶的根目录（未设置默认桶时退化为列桶） |
| `acct:/dir/file` | 默认桶内的路径。没有默认桶时，第一段**就是**桶名 |
| `acct://bucket/key` | 永远是某个桶，无论有没有配置默认桶 |

> [!NOTE]
> 一旦设了默认桶，`acct:/reports/` 就是里面的一个目录，永远不会被当成名为 `reports` 的桶。要换默认桶用 `scc use acct:/other`；要在同一条命令里访问另一个桶，用双斜杠形式，例如 `scc cp acct:/a.txt acct://archive/a.txt`。

`mb` 和 `rb` 始终要求写出桶名，所以创建桶永远不会被"默认桶"重定向到别处。

## 网页界面

`scc web` 用同一个监听端口提供界面和 JSON API（默认 `127.0.0.1:8080`，或配置里的 `listen`）：

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img src="docs/screenshot-light.png" alt="scc 网页界面：左侧是账号与桶，右侧是目录列表">
</picture>

- 侧栏列出账号与桶，点 `＋ 添加账户` 可以直接新增或更新账号。
- 目录浏览带面包屑；当前路径写进 URL（`#/account/bucket/prefix`），刷新和前进后退都正常。
- 上传支持按钮或拖拽并显示进度，另有新建文件夹、下载、重命名、删除、建桶删桶。
- 预览弹窗显示路径、大小和修改时间，并提供 `下载` 与 `新标签打开`。
- 一个目录最多列出 1000 条（S3 单页），超出会明确提示。
- 每个 `/api/` 请求都会带状态码和耗时记入日志，浏览器端失败和服务端失败因此很容易区分。

> [!WARNING]
> 这个服务掌握着你的 S3 凭证，所以默认只绑回环地址。如果要暴露到其他网卡，请先在配置里设 `token`：之后界面需要 `?token=...` 访问一次（会写入 cookie），或使用 `Authorization: Bearer <token>`。这里没有按用户划分的权限 —— token 只是一个共享密钥。

## 配置

纯 YAML，写入权限为 `0600`：

```yaml
listen: 127.0.0.1:8080
token: ""
accounts:
    - name: minio
      endpoint: http://127.0.0.1:9000
      region: us-east-1
      access_key: minioadmin
      secret_key: minioadmin
      path_style: true
      default_bucket: data
    - name: r2
      endpoint: https://<account-id>.r2.cloudflarestorage.com
      region: auto
      access_key: env:R2_ACCESS_KEY
      secret_key: env:R2_SECRET_KEY
      path_style: true
```

文件位置，按顺序取第一个命中：

1. `$SCC_CONFIG`（完整文件路径）
2. `$XDG_CONFIG_HOME/scc/config.yaml`
3. `~/.config/scc/config.yaml` —— macOS 和 Linux 一致

`scc accounts list` 会打印当前实际使用的路径。任何字符串值都可以写成 `env:NAME`，在使用时从环境变量取。

> [!NOTE]
> 没有数据库，也没有常驻服务：配置文件是唯一的状态。`accounts add` 和网页表单改的是同一个文件，CLI 与界面读的也是同一个文件，所以两者不会不一致。

## Web API

界面就是这些接口的薄客户端，所以界面上能做的事都可以脚本来做：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/accounts` | 账号列表（不含 secret） |
| `POST` | `/api/accounts` | 添加或更新（`replace: true` 表示覆盖） |
| `GET` | `/api/b/{acct}/buckets` | 列桶 |
| `POST` | `/api/b/{acct}/buckets` | 创建桶（`{"name": "..."}`） |
| `DELETE` | `/api/b/{acct}/buckets/{bucket}` | 删除空桶 |
| `GET` | `/api/b/{acct}/objects/{bucket}?prefix=&recursive=` | 列一层或列前缀 |
| `GET` | `/api/b/{acct}/raw/{bucket}/{key}` | 流式读取对象（支持 `Range`、`?download=1`） |
| `PUT` | `/api/b/{acct}/raw/{bucket}/{key}` | 上传 |
| `DELETE` | `/api/b/{acct}/raw/{bucket}/{key}` | 删除（`?recursive=1` 删前缀） |
| `POST` | `/api/b/{acct}/copy` | 服务端拷贝 `{from_bucket, from_key, to_bucket, to_key}` |

POST 必须带 `Content-Type: application/json`，这同时也挡住了跨站表单提交。

## S3 兼容性

- **寻址方式。** `scc accounts add` 在填写自定义 `endpoint` 时会自动打开 `path_style`，AWS 则关闭。手写配置文件需要自己写 `path_style: true` —— MinIO、Ceph 这类网关需要它。
- **校验和。** 只在操作确实要求时才计算 flexible checksum，这正是 R2 和 B2 期望的行为。
- **Region。** 不填就是 `us-east-1`；有的网关接受任意值，有的会拒绝错误的值。
- **预览** 走服务端流式代理（支持 `Range`）而不是预签名 URL，所以私有桶不需要配 CORS，链接也不会过期。
- **上传** 是单次 `PutObject`，受 S3 单对象 5 GB 上限约束。网页端会先把请求体落到临时文件，因为 SDK 需要一个可回退的 body 来算哈希。
- **跨账号拷贝** 不支持：`cp` 会直接报错，而不是抛出一个让人困惑的鉴权失败。

## 开发

```
main.go                  入口，错误输出
internal/cli/            命令解析与路径解析（默认桶逻辑在这里）
internal/config/         YAML 读写、校验、密钥环境变量替换
internal/s3x/            AWS SDK 客户端、列目录/读写/拷贝/删除、错误提示
internal/web/            HTTP API、请求日志、内嵌界面
internal/web/static/     index.html、app.js、style.css（无构建步骤）
scripts/                 release-notes.sh：把 CHANGELOG 段落转成 Release 正文
test/                    针对真实 endpoint 的端到端脚本
```

```bash
go test ./...
go vet ./...

# 端到端；任何 S3 兼容 endpoint 都行（moto、MinIO 等）
SCC_TEST_ENDPOINT=http://127.0.0.1:9000 ./test/e2e-cli.sh
SCC_TEST_ENDPOINT=http://127.0.0.1:9000 SCC_TEST_KEY=... SCC_TEST_SECRET=... ./test/e2e-web.sh
```

端到端脚本会自己创建带随机后缀的桶，同时覆盖两种路径语义（有默认桶的账号和没有的账号），并在 endpoint 不可达时立刻给出明确提示。

CI 会跑 `gofmt`、`go vet`、`go test -race`、`app.js` 语法检查，以及针对 MinIO 容器的两套端到端脚本。推送 `v0.1.0` 这类 tag 会构建 macOS / Linux / Windows 二进制，挂到 GitHub Release 上，并用 `CHANGELOG.md` 里对应的段落作为发布说明。

## 限制

按单用户设计。没有分片或断点续传上传，没有预签名分享链接，没有对象版本管理，界面里没有搜索和排序，也不支持跨账号拷贝。界面一次只列一页（1000 个 key），批量操作请用命令行。
