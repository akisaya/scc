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

`ls`、`get`、`rm` 和以 S3 为源的 `cp` 共用路径规则：默认优先选择精确文件，没有同名文件时补 `/` 选择目录；`-p` 使用原始 prefix；`-r` 控制是否展开所有目录层级。

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
| `ls [-p] [-r] <acct>:[/path]` / `<acct>://bucket[/path]` | 列文件或目录；`-p` 按原始 prefix 匹配，`-r` 展开所有层级 |
| `cat <acct>:/key` / `<acct>://bucket/key` | 把一个对象写到标准输出 |
| `cp [-p] [-r] [--skip-existing] <src> <dst>` | 本地与 S3 互拷，或 S3 之间拷贝；可跳过已有目标 |
| `get [-p] [-r] [--skip-existing] <src> [dst]` | 下载到本地；省略目标时使用当前目录 |
| `put [-r] [--skip-existing] <src> <dst>` | 上传本地文件或目录内容到 S3 |
| `rm [-p] [-r] [--dry-run] <S3-path>` | 删除文件或目录；可按前缀匹配并预览 |
| `mb` / `rb <acct>://bucket` | 创建桶 / 删除空桶 |
| `web [-addr host:port]` | 启动网页界面 |
| `version` | 打印版本号；发布构建会注入版本信息 |
| `help [command]` / `<command> --help` | 显示命令用法、参数和示例 |

```bash
scc help get
scc rm --help
scc help accounts add
```

查看帮助不需要读取配置或连接 S3，成功时退出码为 `0`。参数后的 `--` 表示后面的内容按路径参数处理，不再识别选项。

## 命令说明

### `ls`：列文件与目录

不带 `-p` 且路径没有结尾 `/` 时，`ls` 优先匹配完整对象 key。存在同名文件就只列出该文件的大小、修改时间和文件名，带 `-r` 也不会列出名字以它开头的其他对象：

```bash
scc ls minio:/abc.txt
scc ls minio:/reports/README.md
```

没有同名文件时，`ls` 自动补 `/` 并列目录。路径以 `/` 结尾时始终列目录。不带 `-r` 时显示当前目录下的直接文件，以及下一级目录，不列出下一级目录中的对象。输出名称相对于当前目录：

```bash
scc ls minio:/reports/
```

```text
DIR    models/
DIR    weights/
12 MB  2026-11-05 10:20  README.md
```

若完整 key 是 `reports/models/run.bin`，在当前目录 `reports/` 下列出时只显示 `models/`。

S3 可以同时存在 `abc.txt` 文件和 `abc.txt/` 目录。`scc ls minio:/abc.txt` 列文件，`scc ls minio:/abc.txt/` 列目录内容。

目录模式要求目录名完整，不做模糊匹配：

```bash
# 没有 reports/cac 文件时查询 reports/cac/，通常没有结果
scc ls minio:/reports/cac

# 目录名完整时正常列出
scc ls minio:/reports/cache/

# 列出父目录可以看到准确名称
scc ls minio:/reports/
```

如果不知道完整目录名，先列父目录。输出中的 `DIR cache/` 给出准确名称。

文件匹配使用 S3 列表接口，无需读取对象内容的权限。省略结尾 `/` 的目录查询会多一次用于判断同名文件的列表请求；显式保留 `/` 可以直接列目录。

`-r` 只控制遍历深度：文件仍然只列该文件，目录则列所有层级的对象，输出保留完整 key。`reports/cache` 和 `reports/cache/` 在没有同名文件时都只列 `reports/cache/` 内的对象：

```bash
scc ls -r minio:/reports/ -n 0
```

```text
reports/models/run.bin
reports/weights/model.bin
reports/README.md
```

显式加 `-p` 后，输入原样作为 S3 `ListObjectsV2` 的 `Prefix`，不补 `/`，也不优先选择同名文件。不带 `-r` 时设置 `Delimiter=/`，更深的匹配对象由 S3 归并成最近一层目录；加 `-r` 时不设置 `Delimiter`，直接列出所有匹配对象：

```bash
scc ls -p minio:/reports/cac          # 可以看到 DIR cache/、DIR cache-old/
scc ls -p -r minio:/reports/cac       # 列出两个目录内的全部匹配对象
scc ls -p minio:/reports/README      # 文件仍显示 README.md，而不是 .md
```

非递归 prefix 模式的名称相对于 prefix 的父目录；递归模式保留完整 key。以 `reports/cache` 为例，四种组合对应：

| 选项 | S3 `Prefix`（默认模式假设没有同名文件） | S3 `Delimiter` |
| --- | --- | --- |
| 无 | `reports/cache/` | `/` |
| `-r` | `reports/cache/` | 不设置 |
| `-p` | `reports/cache` | `/` |
| `-p -r` | `reports/cache` | 不设置 |

旧版 `ls -r` 的任意前缀匹配需要改为 `ls -p -r`。prefix 匹配与 `-n` 的输出数量限制相互独立。

在终端中，`ls` 最多输出 100 条并提示截断；`-n 0` 输出全部。通过管道或重定向输出时不会截断。选项可以写在路径前后：

```bash
scc ls minio:/reports -n 20
scc ls -n 20 minio:/reports
```

普通路径不存在时明确报错并返回非零退出码。真正的空目录（包含仅有 `/` 占位对象的目录）正常返回，在 stderr 提示 `empty directory`；prefix 没有匹配对象时正常返回，在 stderr 提示 `no objects match prefix`。这些提示不写入 stdout，数量统计仍只计算对象行。

### 统计数量

S3 没有传统目录，对象数量通常就是文件数量。递归统计指定目录下的全部对象：

```bash
set -o pipefail
scc ls -r minio:/reports/ -n 0 |
awk 'END { print NR + 0 }'
```

`awk` 使用 `NR` 统计 `ls` 输出的对象行；没有对象时仍输出 `0`。`set -o pipefail` 让 `scc` 列举失败时整条管道也返回失败，避免把错误误报为 `0`。

按任意 prefix 统计时，使用 `scc ls -p -r minio:/reports/202 -n 0` 再接同样的 `awk`。

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

# 下载指定目录的内容
scc cp -r minio:/reports/2025/ ./downloads/reports-2025

# 同账号服务端复制
scc cp minio:/a.txt minio://data/b.txt
```

普通 `cp` 只操作一个精确对象或本地文件，给目录源需要加 `-r`。完整文件源带 `-r` 时仍只复制该文件。目标为 S3 路径且 key 为空或以 `/` 结尾时，会把源文件 basename 拼到目标路径；本地目标是已有目录或以路径分隔符结尾时也一样。例如 `scc cp minio:/reports/q4.pdf ./downloads/` 会写成 `downloads/q4.pdf`。

以 S3 为源时，`cp` 和 `ls` 使用同样的文件、目录识别规则。`cp -r` 自动给目录源补 `/`，不会匹配到同前缀的其他目录：

```bash
scc cp -r minio:/reports/cache ./cache  # 只复制 reports/cache/ 内的内容
```

`cp -r` 复制的是目录的**内容**，源路径末尾的 `/` 不改变是否包含源目录名。例如：

```bash
scc cp -r minio:/reports/2025/ ./out
```

会得到 `./out/<reports/2025/ 内的相对 key>`。上传本地目录时不会查询 S3 prefix；`scc` 遍历本地文件系统，并把文件写到目标 S3 路径下。

需要按原始 S3 prefix 匹配源对象时，显式加 `-p`。`cp -p` 只复制直接匹配到的对象，子目录需要加 `-r` 才展开。目标按目录处理，对象名称相对于 prefix 的父目录保留完整路径：

```bash
scc cp -p minio:/reports/README ./out/  # reports/README.md -> out/README.md
scc cp -p -r minio:/reports/cac ./out/  # reports/cache/a.txt -> out/cache/a.txt
                                      # reports/cache-old/b.txt -> out/cache-old/b.txt
scc cp -p -r minio:/reports/cac minio:/backup/
                                      # 同样得到 backup/cache/a.txt 等 key
```

旧版 `cp -r` 的原始 prefix 匹配需要显式加 `-p`；prefix 模式按父目录保留名称，避免把部分文件名裁掉。`-p` 仅接受 S3 源，本地源请使用普通 `cp` 或 `cp -r`。目录复制跳过以 `/` 结尾的占位对象。

S3 可以同时存在同名文件与目录，本地文件系统不能。prefix 下载遇到 `abc.txt` 与 `abc.txt/child.txt` 这样的路径冲突时，会在下载前报错。

跨账号复制不受支持，需要先下载再上传。

### `get`：下载到本地

```bash
scc get minio:/reports/q4.pdf                   # 保存为当前目录的 q4.pdf
scc get minio:/reports/q4.pdf ./downloads/      # 保存为 downloads/q4.pdf
scc get minio:/reports/q4.pdf ./renamed.pdf     # 指定本地文件名
scc get -r minio:/reports/2025 ./out            # 下载目录内容到 out/
scc get -p minio:/reports/README ./out          # 下载直接匹配的文件
scc get -p -r minio:/reports/202 ./out          # 下载所有层级的前缀匹配对象
```

`get` 复用 `cp` 的 S3 到本地下载逻辑，源必须是 S3 路径，目标必须是本地路径；省略目标时使用当前目录 `.`。文件、目录、`-p`、`-r`、目标命名及下载前路径冲突检查都与 `cp` 相同，选项可以写在路径前后。普通下载使用源文件名，给目录源需要加 `-r`；递归下载复制目录内容。

### `put`：上传到 S3

```bash
scc put ./abc.txt minio:/docs/                 # 保存为 docs/abc.txt
scc put ./abc.txt minio:/renamed.txt           # 指定目标 key
scc put -r ./assets minio:/backup              # 上传目录内容到 backup/
scc put -r --skip-existing ./assets minio:/backup/
```

`put` 复用 `cp` 的本地到 S3 上传逻辑，源必须是本地路径，目标必须是 S3 路径。目录源需要 `-r`，递归上传复制目录内容；单文件源带 `-r` 时仍只上传该文件。目标 key 为空或以 `/` 结尾时保留源文件名。支持 `--skip-existing`、进度、传输摘要，以及 `put --help` 和 `scc help put`。选项可以写在路径前后。

### 传输进度与覆盖

`get`、`put` 和 `cp` 在终端中显示当前文件、完成数量、已传输大小、百分比和速度。S3 内的服务端复制只显示文件数量和当前对象，不推测字节进度。动态进度写入 stderr，通过管道或重定向 stdout 时自动关闭。

结束时在 stderr 汇报成功文件数、总大小和跳过数量，例如 `downloaded 12 file(s), 8.2M; skipped 3`；成功的源和目标映射仍写入 stdout。prefix 仅匹配到子目录而没有直接文件时，会提示使用 `-r`。

本地下载先写入目标目录中的临时文件，完整接收、检查长度并关闭文件后再替换最终文件；失败时保留已有目标并清理临时文件。替换已有普通文件时保留它的权限，新文件默认仅当前用户可读写。

默认允许覆盖已有目标。`--skip-existing` 在传输前检查目标，已有文件或对象会被跳过，并计入跳过数量。下载、上传和 S3 内复制均支持这个选项：

```bash
scc get -r --skip-existing minio:/reports ./out
scc cp -r --skip-existing ./assets minio:/assets/
scc cp -r --skip-existing minio:/reports minio:/backup/
```

### `rm`：删除

普通 `rm` 优先选择精确文件；目录源需要 `-r`。带 `-r` 的精确文件仍然只删除该文件：

```bash
scc rm minio:/reports/q3.pdf
```

`rm -r` 自动为目录补 `/`，只删除指定目录内的对象和占位对象。文件与目录同名时，用结尾 `/` 明确选择目录：

```bash
# 只删除 reports/ 内的对象，不会匹配 reports-old/
scc rm -r minio:/reports

# 先查看实际选择的对象，不执行删除
scc rm -r --dry-run minio:/reports

# 只有显式 -p 才匹配 reports/、reports-old/、reports2/ 等全部同前缀对象
scc rm -p -r --dry-run minio:/reports
```

`rm -p` 只删除直接匹配的对象，`rm -p -r` 删除所有层级的匹配对象。`--dry-run` 与实际删除共用对象选择逻辑，会列出每个完整路径，并汇报对象数和总大小；预览不会发送删除请求。旧版原始前缀删除需要改用 `-p -r`。所有模式都拒绝空前缀删除整个桶。

删除请求每批最多 1000 个对象。部分失败时返回非零退出码，报告已成功删除的数量及失败对象；普通路径不存在时明确报错，prefix 无匹配时正常返回并提示。

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
