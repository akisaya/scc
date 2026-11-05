# 命令行与配置

首页见 [README](../README.md)。本文说明账号配置、路径语法、命令行为和大批量操作脚本。

## 文档导航

- [账号管理](#账号管理)：添加、查看和删除账号。
- [路径、key 与 prefix](#路径key-与-prefix)：理解单斜杠、双斜杠、默认桶和 S3 prefix。
- [命令总览](#命令总览)：全部命令及参数。
- [命令说明](#命令说明)：`ls`、`cp`、`rm`、`cat` 等命令的具体行为。
- [配置](#配置)：配置文件位置、字段和 `env:` 凭证。

## 账号管理

### 添加账号

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

常用参数：`-endpoint`、`-region`、`-access-key`、`-secret-key`、`-default-bucket`、`-path-style`。

`-access-key` / `-secret-key` 可以写成 `env:NAME`，`scc` 会在使用时从环境变量读取，避免把密钥写入配置文件。

```bash
scc accounts list          # 列出账号；不会输出 secret
scc accounts rm <name>     # 删除账号
```

`accounts list` 还会显示当前实际读取的配置文件路径。

## 路径、key 与 prefix

### 路径语法

账号和桶由路径前缀指定，`//` 始终表示桶名：

| 路径 | 含义 |
| --- | --- |
| `acct:` | 账号默认桶的根目录；未设置默认桶时列出桶 |
| `acct:/dir/file` | 默认桶内的路径；未设置默认桶时为错误 |
| `acct://bucket/key` | 显式指定桶，始终不受默认桶影响 |

`buckets` 使用账号名。`mb`、`rb` 和 `use` 必须使用 `acct://bucket`，避免桶名被默认桶重定向。

### 默认桶

为账号设置默认桶后，可以用单斜杠路径省略桶名：

```bash
scc use minio://reports
scc ls minio:/2025/         # 实际读取 reports 桶中的 2025/
scc ls minio://data/logs/   # 仍然可以显式读取 data 桶

scc use minio:              # 清除默认桶
```

### key、目录与原始 prefix

- **key** 是对象的完整名称，例如 `reports/2025/q3.pdf`。
- **目录前缀**通常以 `/` 结尾，例如 `reports/2025/`。
- **原始 prefix** 是任意字符串，例如 `reports/202`。S3 返回所有以这些字符开头的 key。

S3 没有传统文件夹。列表中的 `DIR` 是 `scc` 根据 `Delimiter=/` 从对象 key 推导出的公共前缀。

`-r`、不带 `-r` 的 `ls` 以及精确对象操作使用不同的路径规则，具体见各命令说明。

## 命令总览

```text
scc <command> [args]
```

| 命令 | 作用 |
| --- | --- |
| `accounts add <name> [flags]` | 添加或更新账号 |
| `accounts list` / `accounts rm <name>` | 列出账号 / 删除账号 |
| `use <acct>://bucket` | 设置默认桶；`use <acct>:` 清除默认桶 |
| `buckets <acct>` | 列出账号下的桶，不受默认桶影响 |
| `ls <acct>:[/prefix]` / `<acct>://bucket[/prefix]` | 列目录；加 `-r` 时列出原始 prefix 下的全部对象 |
| `cat <acct>:/key` / `<acct>://bucket/key` | 把一个对象写到标准输出 |
| `cp [-r] <src> <dst>` | 本地与 S3 互拷，或 S3 之间拷贝 |
| `rm [-r] <acct>:/key` / `<acct>://bucket/key` | 删除一个对象，或删除原始 prefix 下的全部对象 |
| `mb` / `rb <acct>://bucket` | 创建桶 / 删除空桶 |
| `web [-addr host:port]` | 启动网页界面 |
| `version` | 打印版本号；发布构建会注入版本信息 |

## 命令说明

### `ls`：列目录与完整 key

不带 `-r` 时，`ls` 使用目录模式：显示当前目录下的直接文件，以及下一级目录，不列出下一级目录中的对象。输出名称相对于当前目录：

```bash
scc ls minio:/reports/
```

```text
DIR    models/
DIR    weights/
12 MB  2026-11-05 10:20  README.md
```

若完整 key 是 `reports/models/run.bin`，在当前目录 `reports/` 下列出时只显示 `models/`。

目录模式会把没有结尾 `/` 的路径当作目录并自动补 `/`。因此它要求目录名完整，不做模糊匹配：

```bash
# 实际查询 reports/cac/，通常没有结果
scc ls minio:/reports/cac

# 目录名完整时正常列出
scc ls minio:/reports/cache/

# 列出父目录可以看到准确名称
scc ls minio:/reports/
```

如果不知道完整目录名，先列父目录。输出中的 `DIR cache/` 给出准确名称。

加 `-r` 后，路径会原样作为 S3 `ListObjectsV2` 的 `Prefix`，并且不设置 `Delimiter`。返回所有 key 以该字符串开头的对象，可以跨越多层目录，输出保留完整 key：

```bash
scc ls -r minio:/reports/ -n 0
```

```text
reports/models/run.bin
reports/weights/model.bin
reports/README.md
```

`-r` 不会自动补 `/`。S3 prefix 按字符开头匹配，所以 `reports/cache` 也可能匹配 `reports/cache-old/`。要限定为一个目录，应显式写成 `reports/cache/`。

在终端中，`ls` 最多输出 100 条并提示截断；`-n 0` 输出全部。通过管道或重定向输出时不会截断。选项可以写在路径前后：

```bash
scc ls minio:/reports -n 20
scc ls -n 20 minio:/reports
```

### 统计数量

S3 没有传统目录，对象数量通常就是文件数量。递归统计 prefix 下的全部对象：

```bash
set -o pipefail
scc ls -r minio:/reports/ -n 0 |
awk 'END { print NR + 0 }'
```

`awk` 使用 `NR` 统计 `ls` 输出的对象行；没有对象时仍输出 `0`。`set -o pipefail` 让 `scc` 列举失败时整条管道也返回失败，避免把错误误报为 `0`。

如果存储中存在以 `/` 结尾的目录占位对象，而只想统计非目录对象：

```bash
set -o pipefail
scc ls -r minio:/reports/ -n 0 |
awk 'substr($0, length($0)) != "/" { n++ } END { print n + 0 }'
```

统计 prefix **直接下一层**的目录数量时，不要加 `-r`，只计算 `DIR` 行：

```bash
set -o pipefail
scc ls minio:/reports/ -n 0 |
awk '$1 == "DIR" { n++ } END { print n + 0 }'
```

这条命令只统计 `reports/` 的直接子目录，不会把更深层目录重复计算，也不会把当前层文件计算在内。

### `cp`：复制

```bash
# 上传文件
scc cp ./q4.pdf minio:/reports/

# 上传目录内容
scc cp -r ./assets minio:/reports/

# 下载一个 prefix
scc cp -r minio:/reports/2025/ ./downloads/reports-2025

# 同账号服务端复制
scc cp minio:/a.txt minio://data/b.txt
```

普通 `cp` 只操作一个精确对象或本地文件。目标为 S3 路径且 key 为空或以 `/` 结尾时，会把源文件 basename 拼到目标路径；本地目标是已有目录或以路径分隔符结尾时也一样。例如 `scc cp minio:/reports/q4.pdf ./downloads/` 会写成 `downloads/q4.pdf`。

以 S3 为源时，`cp -r` 把给定的源路径原样作为 S3 prefix，不设置 `Delimiter`，也不会自动补 `/`：

```bash
scc cp -r minio:/reports/cache/ ./cache
```

每个对象 key 会先机械地移除源 prefix，再拼到目标路径。使用部分 prefix 会得到不直观的相对路径：`reports/cac` 可以匹配 `reports/cache/kernel.cu`，但剩余部分是 `he/kernel.cu`。复制目录时应写出完整目录和结尾 `/`。

`cp -r` 复制的是 prefix 的**内容**，行为与 `aws s3 cp --recursive` 一致。例如：

```bash
scc cp -r minio:/reports/2025/ ./out
```

会得到 `./out/<reports/2025/ 内的相对 key>`。上传本地目录时不会查询 S3 prefix；`scc` 遍历本地文件系统，并把文件写到目标 S3 路径下。

跨账号复制不受支持，需要先下载再上传。

### `rm`：删除

普通 `rm` 精确删除一个对象 key：

```bash
scc rm minio:/reports/q3.pdf
```

`rm -r` 把给定路径原样作为 S3 prefix，删除所有以这些字符开头的对象：

```bash
# 会匹配 reports/、reports-old/、reports2/ 等全部同前缀对象
scc rm -r minio:/reports

# 只删除 reports/ 目录下的对象
scc rm -r minio:/reports/
```

`rm -r` 不会自动补 `/`。删除目录时应保留结尾 `/`。为避免误删整个桶，`rm -r` 不接受空前缀。

### `cat`：读取对象

`cat` 精确读取一个完整 key，并把内容写到标准输出：

```bash
scc cat minio:/reports/q3.pdf > q3.pdf
```

`cat` 不支持 prefix、目录或 `-r`；路径必须对应一个完整对象 key。

## 桶与网页界面

```bash
scc buckets minio                    # 列桶
scc mb minio://new-bucket            # 创建桶
scc rb minio://empty-bucket          # 删除空桶
scc web -addr 127.0.0.1:8080         # 启动网页界面
```

`mb` 和 `rb` 始终要求显式写出 `acct://bucket`。网页界面的监听地址和认证设置见[配置](#配置)。

## 配置

通过 `accounts` 命令添加的账号保存在 YAML 配置文件中。也可以直接修改该文件。

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
| `token` | 共享密钥；非空时访问网页需先认证 |
| `name` | 账号名，即命令中的 `acct` |
| `endpoint` | S3 端点；AWS 可留空 |
| `region` | 区域；未指定时为 `us-east-1` |
| `access_key` / `secret_key` | 凭证，可写成 `env:NAME` |
| `path_style` | 是否使用 path-style 寻址；MinIO、Ceph 等网关通常需要 `true` |
| `default_bucket` | 默认桶，使 `acct:/path` 可以直接定位 |

配置文件按以下顺序取第一个存在的文件：

1. `$SCC_CONFIG`：完整文件路径。
2. `$XDG_CONFIG_HOME/scc/config.yaml`
3. `~/.config/scc/config.yaml`；macOS 和 Linux 一致。

`scc accounts list` 会输出当前实际使用的路径。任何字符串值都可以写成 `env:NAME`，使用时从环境变量读取。

> [!NOTE]
> 没有数据库，也没有常驻服务：配置文件是唯一状态来源。`accounts add` 和网页表单修改同一个文件，CLI 与网页读取的也是同一个文件，因此不会出现状态不一致。
