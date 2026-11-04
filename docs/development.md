# 开发说明

首页见 [README](../README.md)。

## 目录结构

```
main.go                  入口，错误输出
internal/cli/            命令解析与路径解析（默认桶逻辑在这里）
internal/config/         YAML 读写、校验、密钥环境变量替换
internal/s3x/            AWS SDK 客户端、列目录/读写/拷贝/删除、错误提示
internal/web/            HTTP API、请求日志、内嵌界面
internal/web/static/     index.html、style.css、theme.js；js/ 下是界面的 ES 模块，入口 main.js（无构建步骤）
test/web/                不碰 DOM 的前端模块的单测（node --test）
scripts/                 release-notes.sh：把 CHANGELOG 段落转成 Release 正文
test/                    针对真实 endpoint 的端到端脚本；test/mock/ 是本地 mock 与演示数据
```

## 测试

```bash
go test ./...
go vet ./...
node --test 'test/web/*.test.js'   # 前端单测，需要 Node 22+

# 端到端测试；支持任意 S3 兼容 endpoint（moto、MinIO 等）
SCC_TEST_ENDPOINT=http://127.0.0.1:9000 ./test/e2e-cli.sh
SCC_TEST_ENDPOINT=http://127.0.0.1:9000 SCC_TEST_KEY=... SCC_TEST_SECRET=... ./test/e2e-web.sh
```

端到端脚本会自动创建带随机后缀的桶，覆盖两种路径语义（有默认桶和无默认桶的账号），并在 endpoint 不可达时立即给出明确提示。

## 本地 mock 环境

没有现成 endpoint 时，`test/mock/up.sh` 会起一个本地 moto 并灌好演示数据（首次运行自动创建 venv 并安装 moto）：

```bash
./test/mock/up.sh                                  # http://127.0.0.1:19000，凭证 testkey / testsecret123
export SCC_CONFIG=$PWD/test/mock/.work/config.yaml # 演示专用配置，不碰 ~/.config/scc
scc ls mock:/ && scc web
```

演示数据覆盖图片 / 视频 / 音频 / PDF / 文本 / 无预览类型的预览分支、250 个对象的分页、深层目录、中文与特殊字符 key，以及用于 Range 测试的大文件。`--reset` 丢弃后重灌，`--server-only` 只起服务。

## CI 与发布

CI 会运行 `gofmt`、`go vet`、`go test -race`、前端模块的语法检查与单测，以及针对 S3 mock（`moto`）的两套端到端脚本。推送 `v0.1.0` 等 tag 时会构建 macOS / Linux / Windows 二进制并附加到 GitHub Release，同时使用 `CHANGELOG.md` 中对应段落作为发布说明。

## S3 兼容性

- **寻址方式。** 填写自定义 `endpoint` 时，`scc accounts add` 会自动启用 `path_style`；AWS 则关闭该选项。手动编写配置文件时需自行设置 `path_style: true`，MinIO、Ceph 等网关需要此配置。
- **校验和。** 仅在操作确实需要时计算 flexible checksum，符合 R2 和 B2 的预期行为。
- **Region。** 未指定时默认为 `us-east-1`；部分网关接受任意值，部分网关会拒绝错误的值。
- **预览** 通过服务端流式代理（支持 `Range`）实现，而非预签名 URL，因此私有桶无需配置 CORS，链接也不会过期。浏览器会当作文档渲染的类型（`html`、`svg`、`xml`）带 `sandbox` CSP 返回：可以查看，但其中的脚本不会执行，也不会带本服务的身份去调用 `/api/`。
- **上传** 使用单次 `PutObject`，受 S3 单对象 5 GB 上限约束。网页端会先将请求体写入临时文件，因为 SDK 需要一个可回退的 body 来计算哈希。
- **跨账号拷贝** 不受支持：`cp` 会直接报错，避免产生容易混淆的鉴权失败。

## 限制

按单用户场景设计。不支持分片或断点续传上传、预签名分享链接、对象版本管理。界面里的过滤只作用于已加载的项（跨目录搜索请用命令行），批量下载由浏览器逐个触发，文件多时可能被拦截；大批量操作建议使用命令行。不支持跨账号拷贝。清空整个桶有意不提供单条命令，只能按前缀删除，以避免误操作清空整个桶。
