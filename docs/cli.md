# 命令行与配置

首页见 [README](../README.md)。

## 路径语法

三种写法，`//` 始终表示桶名：

| 路径 | 含义 |
| --- | --- |
| `acct:` | 账号默认桶的根目录（未设置默认桶时列出桶） |
| `acct:/dir/file` | 默认桶内的路径；未设置默认桶时为错误 |
| `acct://bucket/key` | 显式指定的桶，始终不受默认桶影响 |

`mb`、`rb` 和 `use` 始终要求使用 `acct://bucket` 形式，因此桶名不会被“默认桶”重定向。

## 命令

```
scc <command> [args]
```

| 命令 | 作用 |
| --- | --- |
| `accounts add <name> [flags]` | 添加或更新账号 |
| `accounts list` / `accounts rm <name>` | 列出账号 / 删除账号 |
| `use <acct>://bucket` | 把 `bucket` 设为该账号的默认桶（使用 `<acct>:` 清除） |
| `buckets <acct>` | 列桶，不受默认桶影响 |
| `ls <acct>:[/prefix]` / `<acct>://bucket[/prefix]` | 列桶、列目录，或列整个前缀 |
| `cat <acct>:/key` / `<acct>://bucket/key` | 把对象写到标准输出 |
| `cp [-r] <src> <dst>` | 本地与 S3 互拷，或 S3 之间拷贝 |
| `rm [-r] <acct>:/key` / `<acct>://bucket/key` | 删除一个对象，或删除某个前缀下的全部对象 |
| `mb` / `rb <acct>://bucket` | 创建桶 / 删除空桶（必须写桶名） |
| `web [-addr host:port]` | 启动网页界面 |
| `version` | 打印版本号（由发布构建注入） |

`accounts add` 的常用参数：`-endpoint`、`-region`、`-access-key`、`-secret-key`、`-default-bucket`、`-path-style`。

## 添加账号

填写自定义 `endpoint` 时会自动启用 path-style 寻址；AWS 不填 `endpoint`，使用虚拟主机寻址。

```bash
# 自建 MinIO / Ceph
scc accounts add minio \
  -endpoint http://127.0.0.1:9000 \
  -access-key minioadmin -secret-key minioadmin \
  -default-bucket data

# Cloudflare R2
scc accounts add r2 \
  -endpoint https://<account-id>.r2.cloudflarestorage.com \
  -access-key env:R2_ACCESS_KEY -secret-key env:R2_SECRET_KEY

# AWS S3
scc accounts add aws -region ap-northeast-1 \
  -access-key env:AWS_ACCESS_KEY_ID -secret-key env:AWS_SECRET_ACCESS_KEY
```

`accounts list` 不会输出 secret。`-access-key` / `-secret-key` 写成 `env:NAME` 即可从环境变量取值，避免把密钥写入配置文件。

## 示例

```bash
scc buckets minio                       # 列出所有桶
scc ls minio:/reports                   # 列出下一层
scc ls -r minio:/reports -n 20          # 递归列出，仅显示前 20 条
scc cat minio:/reports/q3.pdf > q3.pdf
scc cp ./q4.pdf minio:/reports/         # 上传文件
scc cp -r ./assets minio:/reports/      # 上传目录
scc cp -r minio:/reports/2025 ./reports-2025   # 下载一个前缀
scc cp minio:/a.txt minio://data/b.txt  # 服务端直接拷贝（显式桶）
scc rm -r minio:/tmp/                   # 删除一个前缀
```

> [!NOTE]
> `cp -r` 会将前缀的**内容**复制到目标目录（行为与 `aws s3 cp --recursive` 一致），因此上述示例会得到 `./reports-2025/<2025 下的 key>`。请使用明确的目录，除非确实希望复制到当前目录。

> [!TIP]
> 在终端中，`ls` 最多输出 100 条，并提示结果已截断；`-n 0` 可输出全部。通过管道或重定向输出时不会截断，脚本行为不受影响。选项也可写在路径之后，例如 `scc ls minio:/reports -n 20`。

## 配置

通过 `accounts` 命令添加的账号，实际存储在一个 YAML 配置文件中，如下所示。也可以直接修改配置文件添加账号。

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

| 字段 | 说明 |
| --- | --- |
| `listen` | 网页界面的监听地址，默认 `127.0.0.1:8080` |
| `token` | 共享密钥；非空时访问界面需先认证 |
| `name` | 账号名，即命令中的 `acct` |
| `endpoint` | S3 端点，AWS 可留空 |
| `region` | 区域，未指定时为 `us-east-1` |
| `access_key` / `secret_key` | 凭证，可写成 `env:NAME` |
| `path_style` | 是否使用 path-style 寻址，MinIO / Ceph 等网关需要为 `true` |
| `default_bucket` | 默认桶，使 `acct:/path` 可直接定位 |

配置文件优先级如下，取第一个存在的文件：

1. `$SCC_CONFIG`（完整文件路径）
2. `$XDG_CONFIG_HOME/scc/config.yaml`
3. `~/.config/scc/config.yaml` —— macOS 和 Linux 一致

`scc accounts list` 会输出当前实际使用的路径。任何字符串值均可写成 `env:NAME`，在使用时从环境变量读取。

> [!NOTE]
> 没有数据库，也没有常驻服务：配置文件是唯一的状态来源。`accounts add` 和网页表单修改的是同一个文件，CLI 与界面读取的也是同一个文件，因此不会出现状态不一致。
