<div align="center">
  <img src="internal/web/static/logo.svg" width="64" alt="scc logo">

  # scc

  *`SCC(S3 Compatible Client)` 支持在浏览器或终端中浏览任何 S3 兼容存储*

  [![Go](https://img.shields.io/badge/Go-%3E%3D1.24-00add8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
  [![单文件部署](https://img.shields.io/badge/%E9%83%A8%E7%BD%B2-%E5%8D%95%E4%B8%AA%E4%BA%8C%E8%BF%9B%E5%88%B6-2ea043?style=flat-square)](#%E5%AE%89%E8%A3%85)
  [![无数据库](https://img.shields.io/badge/%E7%8A%B6%E6%80%81-%E9%85%8D%E7%BD%AE%E6%96%87%E4%BB%B6-6b7280?style=flat-square)](#%E9%85%8D%E7%BD%AE)

  [功能](#功能) • [安装](#安装) • [开始使用](#开始使用) • [路径语法](#路径语法) • [命令行](#命令行) • [配置](#配置) • [文档](#文档)
</div>

## 功能

- **统一实现，两种界面。** 网页与命令行共用同一操作层，目录列表、上传和删除的行为完全一致。
- **多账号支持。** 增删和切换账号无需重启服务；网页每次请求都会重新读取配置，修改后立即生效。
- **每个账号可设置默认桶。** `acct:/dir/file` 直接定位到默认桶内，常用路径更简洁。
- **浏览器内预览。** 图片、视频、音频、PDF、文本和代码可内联显示。

## 安装

**未安装 Go：** 从 [Releases](https://github.com/akisaya/scc/releases) 下载对应平台的预编译包（macOS / Linux / Windows，含 arm64），解压后将 `scc` 放入 `PATH`。

**已安装 [Go 1.24+](https://go.dev/dl/)：**

```bash
go install github.com/akisaya/scc@latest
# -> $(go env GOPATH)/bin/scc   (Windows: %USERPROFILE%\go\bin)
```

或者从源码构建：

```bash
git clone https://github.com/akisaya/scc && cd scc
go build .          # -> ./scc
```

## 开始使用

```bash
# 自定义 endpoint 会自动启用 path-style 寻址，适合自建 MinIO / Ceph
scc accounts add minio \
  -endpoint http://127.0.0.1:9000 \
  -access-key minioadmin -secret-key minioadmin \
  -default-bucket data

scc accounts list     # 不会输出 secret
scc ls minio:         # 默认桶根目录
scc web               # 网页界面
```

> [!TIP]
> 只需在 `-access-key` / `-secret-key` 中写成 `env:NAME`，即可避免把密钥写入配置文件，取值在使用时从环境变量读取。

更多账号添加方式见 [命令行说明](docs/cli.md#添加账号)。

## 路径语法

三种写法，`//` 始终表示桶名：

| 路径 | 含义 |
| --- | --- |
| `acct:` | 账号默认桶的根目录（未设置默认桶时列出桶） |
| `acct:/dir/file` | 默认桶内的路径；未设置默认桶时为错误 |
| `acct://bucket/key` | 显式指定的桶，始终不受默认桶影响 |

## 命令行

```
scc <command> [args]
```

| 命令 | 作用 |
| --- | --- |
| `accounts add <name> [flags]` | 添加或更新账号 |
| `accounts list` / `accounts rm <name>` | 列出账号 / 删除账号 |
| `use <acct>://bucket` | 把 `bucket` 设为该账号的默认桶（使用 `<acct>:` 清除） |
| `buckets <acct>` | 列桶，不受默认桶影响 |
| `ls <acct>:[/prefix]` / `<acct>://bucket[/prefix]` | 列桶或目录；加 `-r` 时递归列整个前缀 |
| `cat <acct>:/key` / `<acct>://bucket/key` | 把对象写到标准输出 |
| `cp [-r] <src> <dst>` | 本地与 S3 互拷，或 S3 之间拷贝 |
| `rm [-r] <acct>:/key` / `<acct>://bucket/key` | 删除一个对象，或删除某个前缀下的全部对象 |
| `mb` / `rb <acct>://bucket` | 创建桶 / 删除空桶（必须写桶名） |
| `web [-addr host:port]` | 启动网页界面 |
| `version` | 打印版本号（由发布构建注入） |

```bash
scc ls -r minio:/reports/ -n 20         # 递归列出前 20 条，输出完整 key
scc ls minio:/reports/ -n 0 |
  awk '$1 == "DIR" { n++ } END { print n + 0 }'  # 统计直接子目录数
scc ls -r minio:/reports/ -n 0 |
  awk 'END { print NR + 0 }'                     # 统计全部对象数
scc cp -r ./assets minio:/reports/      # 上传目录
scc cp -r minio:/reports/2025 ./out     # 下载一个前缀
scc rm -r minio:/tmp/                   # 删除一个前缀
```

> [!NOTE]
> 非递归 `ls` 把没有结尾 `/` 的路径当作目录，例如 `minio:/reports/cac` 会查询 `reports/cac/`，不会匹配到 `reports/cache/`。加 `-r` 时则把原始字符串直接作为 S3 `ListObjectsV2` 的 `Prefix`，且不设置 `Delimiter`。

> [!WARNING]
> 以 S3 为源的 `cp -r` 和 `rm -r` 也使用原始 S3 prefix；要操作一个目录时请保留结尾 `/`。`cat`、普通 `rm` 和非递归 `cp` 则要求完整 key。

完整示例、各命令的 prefix 语义、目录与完整 key 的区别、数量统计、`cp -r` 的复制语义与终端输出截断规则见 [命令行说明](docs/cli.md)。

## 配置

账号实际存储在 YAML 配置文件中，也可以直接编辑该文件：

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
```

配置文件按以下顺序取第一个存在的：`$SCC_CONFIG` → `$XDG_CONFIG_HOME/scc/config.yaml` → `~/.config/scc/config.yaml`。`scc accounts list` 会输出当前实际使用的路径。字段含义与 `env:` 语法见 [配置说明](docs/cli.md#配置)。

## 网页界面

`scc web` 通过同一监听端口提供界面与 JSON API：

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img src="docs/screenshot-light.png" alt="scc 网页界面：左侧是账号与桶，右侧是目录列表">
</picture>

- 侧栏列出账号和桶，点击 `＋ 添加账户` 可直接新增或更新账号。
- 目录浏览支持面包屑，当前路径写入 URL（`#/account/bucket/prefix`），刷新和前进/后退均可用。
- 上传支持按钮与拖拽并显示进度，另有新建文件夹、下载、重命名、删除和桶管理。
- 目录分页加载（每页 200 条），搜索框可过滤已加载项或按前缀直接跳转，列头点击循环切换排序。
- 全程可用键盘操作，支持多选批量下载/删除，窄屏（640px 以下）时侧栏收进抽屉。

> [!WARNING]
> 该服务持有 S3 凭证，默认仅绑定回环地址。如需暴露到其他网络接口，请先在配置中设置 `token`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [命令行说明](docs/cli.md) | 路径语义、全部命令与示例、配置字段、`env:` 语法 |
| [网页界面说明](docs/web.md) | 界面交互细节、安全提示、Web API |
| [开发说明](docs/development.md) | 目录结构、单元与端到端测试、mock 环境、CI、S3 兼容性、已知限制 |

## 限制

按单用户场景设计：不支持分片或断点续传上传、预签名分享链接、对象版本管理与跨账号拷贝；界面过滤只作用于已加载的项，大批量操作建议使用命令行。清空整个桶有意不提供单条命令，只能按前缀删除。
