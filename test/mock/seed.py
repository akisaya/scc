#!/usr/bin/env python3
"""往本地 S3 mock 里灌一套数据，覆盖 scc 网页界面的每个分支。

    python3 test/mock/seed.py --endpoint http://127.0.0.1:19000
    python3 test/mock/seed.py --endpoint http://127.0.0.1:19000 --reset

覆盖点：图片 / 视频 / 音频 / PDF / 文本 / 无预览类型的预览分支，分页
（一页 200 条）、深层目录、中文与特殊字符 key、大文件的 Range 请求、
空桶、空"文件夹"、以及超过 200 KB 的文本（前端截断）。

只依赖 boto3（随 moto[server] 一起装在 venv 里），moto 和 MinIO 都能用。
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

BUCKETS = ["demo", "photos", "paging", "archive"]
WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".work")

# 找不到可写的临时目录时，Python 会退回到当前工作目录做探测，并在那里留下
# 4 字节的 "blat" 探测文件——跑一次就在仓库根目录撒一堆随机名文件。
# 把临时目录钉死在 .work 下，既不会污染仓库，也不依赖 /tmp 是否可写。
_TMP = os.path.join(WORK, "tmp")
os.makedirs(_TMP, exist_ok=True)
tempfile.tempdir = _TMP


# ---------- 媒体文件：有 ffmpeg 就生成真能播放的内容 ----------

def ffmpeg(out, *args):
    """用 ffmpeg 生成一个媒体文件，失败时返回 None。"""
    if not shutil.which("ffmpeg"):
        return None
    cmd = ["ffmpeg", "-y", "-loglevel", "error", *args, out]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, OSError):
        return None
    return out


def media_dir():
    d = os.path.join(WORK, "media")
    os.makedirs(d, exist_ok=True)
    return d


def make_media():
    """返回 {名字: 路径}；ffmpeg 不可用时缺少的项会在上传时跳过。"""
    d = media_dir()
    p = lambda n: os.path.join(d, n)
    made = {}

    jpg = ffmpeg(p("photo.jpg"), "-f", "lavfi", "-i",
                 "gradients=s=800x600:d=1", "-frames:v", "1")
    if jpg:
        made["photo.jpg"] = jpg

    gif = ffmpeg(p("anim.gif"), "-f", "lavfi", "-i",
                 "testsrc=size=220x160:rate=12", "-t", "2")
    if gif:
        made["anim.gif"] = gif

    mp4 = ffmpeg(p("clip.mp4"), "-f", "lavfi", "-i",
                 "testsrc=size=640x360:rate=25", "-f", "lavfi", "-i",
                 "sine=frequency=440:duration=7", "-t", "7",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                 "-c:v", "libx264", "-c:a", "aac", "-shortest")
    if mp4:
        made["clip.mp4"] = mp4

    mp3 = ffmpeg(p("tone.mp3"), "-f", "lavfi", "-i",
                 "sine=frequency=440:duration=5", "-q:a", "9")
    if mp3:
        made["tone.mp3"] = mp3

    return made


# ---------- 纯 Python 生成的二进制 ----------

def tiny_png():
    """1x1 红色 PNG。"""
    import base64
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
        "z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )


def minimal_pdf(title):
    """带正确 xref 的最小合法 PDF，浏览器内置阅读器能正常渲染。"""
    content = f"BT /F1 22 Tf 60 760 Td ({title}) Tj ET".encode()
    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]"
        b"/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
        b"<</Length " + str(len(content)).encode() + b">>stream\n"
        + content + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<</Size {len(objs) + 1}/Root 1 0 R>>\n"
            f"startxref\n{xref}\n%%EOF\n").encode()
    return bytes(out)


def zip_stub():
    """一个空 zip：能被识别为压缩包，界面上走"无法预览"分支。"""
    return (b"PK\x05\x06" + b"\x00" * 18)


# ---------- 内容清单 ----------

def readme():
    return """# 演示数据

这个桶由 `test/mock/seed.py` 生成，用来覆盖 scc 的每条界面路径。

## 有什么
- 图片、视频、音频、PDF —— 预览弹窗的四种内联渲染
- 文本与代码 —— 走 `fetch` + `<pre>`，超过 200 KB 会截断
- `data/sample.zip` —— 无预览类型的兜底卡片
- `深层/一级/二级/三级/` —— 面包屑与"跳到前缀"
- `paging` 桶 —— 250 个对象，触发底部的「加载更多」
- `archive` 桶 —— 空桶

## 重新灌数据
```bash
./test/mock/up.sh --reset
```
"""


def orders_csv():
    rows = ["id,customer,amount,currency,created_at"]
    for i in range(1, 41):
        rows.append(f"{i:04d},客户{i:02d},{i * 37 % 900 + 100}.00,CNY,"
                    f"2026-0{i % 9 + 1}-1{i % 9} 10:0{i % 6}:00")
    return "\n".join(rows) + "\n"


def demo_files(media):
    """demo 桶：[(key, bytes, content_type|None)]"""
    files = [
        ("README.md", readme().encode(), "text/markdown; charset=utf-8"),
        ("notes.txt", "第一行\n第二行\n带中文的纯文本文件\n".encode(),
         "text/plain; charset=utf-8"),
        ("config/app.json",
         b'{\n  "name": "scc",\n  "debug": false,\n  "limit": 200\n}\n',
         "application/json"),
        ("src/main.go",
         b'package main\n\nimport "fmt"\n\n'
         b'func main() {\n\tfmt.Println("hello scc")\n}\n',
         "text/plain"),
        ("src/util.py",
         b"def add(a, b):\n    return a + b\n\n\nprint(add(1, 2))\n",
         "text/plain"),
        ("web/index.html",
         b"<!doctype html>\n<title>demo</title>\n<h1>hello</h1>\n",
         "text/html; charset=utf-8"),
        ("web/style.css", b"body { font-family: sans-serif; }\n", "text/css"),
        ("images/pixel.png", tiny_png(), "image/png"),
        ("images/logo.svg",
         b'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">'
         b'<rect width="120" height="120" rx="24" fill="#00add8"/>'
         b'<circle cx="60" cy="60" r="26" fill="#fff"/></svg>',
         "image/svg+xml"),
        ("docs/report.pdf", minimal_pdf("scc mock report"), "application/pdf"),
        ("data/orders.csv", orders_csv().encode(), "text/csv; charset=utf-8"),
        ("data/sample.zip", zip_stub(), "application/zip"),
        # 8 MiB：拖动进度条时走 Range 请求，不是一次性读完
        ("data/big.bin", bytes(8 * 1024 * 1024), "application/octet-stream"),
        # 超过前端的 200000 字符上限，预览里会出现 "… (已截断)"
        ("logs/huge.log",
         ("".join(f"2026-11-03 00:00:{i % 60:02d} request handled\n"
                  for i in range(6000))).encode(),
         "text/plain; charset=utf-8"),
        # 深层目录：面包屑与"跳到前缀"
        ("深层/一级/二级/三级/leaf.txt", "到底了\n".encode(),
         "text/plain; charset=utf-8"),
        # 特殊字符：Content-Disposition 的 filename*=UTF-8'' 编码
        ("特殊字符/带 空格.txt", "空格\n".encode(), "text/plain; charset=utf-8"),
        ("特殊字符/plus+amp&hash#.txt", "符号\n".encode(),
         "text/plain; charset=utf-8"),
        ("特殊字符/中文名.txt", "中文\n".encode(), "text/plain; charset=utf-8"),
        # S3 没有真正的目录，空目录靠 0 字节占位对象表达
        ("空文件夹/", b"", "application/x-directory"),
    ]

    for key, ct in [("images/photo.jpg", "image/jpeg"),
                    ("images/anim.gif", "image/gif"),
                    ("media/clip.mp4", "video/mp4"),
                    ("media/tone.mp3", "audio/mpeg")]:
        name = key.split("/")[-1]
        if name in media:
            with open(media[name], "rb") as f:
                files.append((key, f.read(), ct))
        else:
            print(f"  skip {key} (需要 ffmpeg 生成)", file=sys.stderr)

    return files


# ---------- 灌数据 ----------

def drop_bucket(s3, name):
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=name):
            keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if keys:
                s3.delete_objects(Bucket=name, Delete={"Objects": keys})
        s3.delete_bucket(Bucket=name)
        print(f"  dropped {name}")
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("NoSuchBucket", "404"):
            return
        raise


def ensure_bucket(s3, name):
    try:
        s3.create_bucket(Bucket=name)
    except ClientError as e:
        if e.response["Error"]["Code"] not in (
                "BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
            raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", required=True)
    ap.add_argument("--access-key", default="testkey")
    ap.add_argument("--secret-key", default="testsecret123")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--reset", action="store_true",
                    help="先删掉种子桶再灌（只影响下面这几个桶）")
    args = ap.parse_args()

    s3 = boto3.client(
        "s3",
        endpoint_url=args.endpoint,
        aws_access_key_id=args.access_key,
        aws_secret_access_key=args.secret_key,
        region_name=args.region,
        config=Config(s3={"addressing_style": "path"}),
    )

    try:
        s3.list_buckets()
    except Exception as e:  # noqa: BLE001 - 连接失败要给出人话
        sys.exit(f"无法连接 {args.endpoint}：{e}")

    if args.reset:
        print("reset:")
        for b in BUCKETS:
            drop_bucket(s3, b)

    print("creating buckets:")
    for b in BUCKETS:
        ensure_bucket(s3, b)
        print(f"  {b}")

    media = make_media()
    if not media:
        print("warning: ffmpeg not found, 图片/视频/音频样本会被跳过",
              file=sys.stderr)

    def put(bucket, key, data, ctype):
        kw = {"Bucket": bucket, "Key": key, "Body": data}
        if ctype:
            kw["ContentType"] = ctype
        s3.put_object(**kw)

    print("demo:")
    files = demo_files(media)
    for key, data, ct in files:
        put("demo", key, data, ct)
    print(f"  {len(files)} objects")

    print("photos:")
    photo_keys = [("images/photo.jpg", "image/jpeg"),
                  ("png/pixel.png", "image/png"),
                  ("svg/logo.svg", "image/svg+xml")]
    n = 0
    for key, ct in photo_keys:
        name = key.split("/")[-1]
        if name in media:
            with open(media[name], "rb") as f:
                put("photos", key, f.read(), ct)
            n += 1
        elif name == "pixel.png":
            put("photos", key, tiny_png(), ct)
            n += 1
        elif name == "logo.svg":
            put("photos", key, b'<svg xmlns="http://www.w3.org/2000/svg" '
                               b'width="40" height="40"><circle cx="20" cy="20" '
                               b'r="18" fill="#00add8"/></svg>', ct)
            n += 1
    print(f"  {n} objects")

    # 网页每页 200 条，「加载更多」需要第二页才出现
    print("paging:")
    for i in range(250):
        put("paging", f"items/item-{i:03d}.txt",
            f"第 {i} 个对象\n".encode(), "text/plain; charset=utf-8")
    for i in range(12):
        put("paging", f"nested/deep/item-{i:02d}.txt", b"nested\n",
            "text/plain; charset=utf-8")
    print("  262 objects")

    print("archive: 空桶")
    print("\ndone. 共 4 个桶。")


if __name__ == "__main__":
    main()
