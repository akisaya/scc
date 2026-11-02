#!/bin/bash
# 启动本地 S3 mock（moto）并灌入一套演示数据。
#
#   ./test/mock/up.sh                  # 127.0.0.1:19000
#   PORT=9000 ./test/mock/up.sh        # 换端口
#   ./test/mock/up.sh --reset          # 丢弃已有数据后重灌
#   ./test/mock/up.sh --server-only    # 只起服务，不灌数据
#
# 数据是内存态，moto 进程重启就没了；重灌只需再跑一次本脚本。
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)

HOST=${HOST:-127.0.0.1}
PORT=${PORT:-19000}
VENV=${VENV:-$ROOT/test/mock/.venv}
WORK=$ROOT/test/mock/.work
LOG=$WORK/moto.log
CONFIG=$WORK/config.yaml
ENDPOINT=http://$HOST:$PORT
AK=${SCC_TEST_KEY:-testkey}
SK=${SCC_TEST_SECRET:-testsecret123}

seed=1
reset=0
for arg in "$@"; do
  case $arg in
    --server-only) seed=0 ;;
    --reset) reset=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$WORK"

# moto 是纯 Python 包，装在项目内的 venv 里，不碰系统环境。
# CI 用的也是 moto，本地和流水线因此行为一致。
if [ ! -x "$VENV/bin/moto_server" ]; then
  echo "installing moto into $VENV (first run only)"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --disable-pip-version-check "moto[server]"
fi

if curl -fsS -o /dev/null --max-time 1 "$ENDPOINT/"; then
  echo "S3 mock already listening on $ENDPOINT"
  if [ "$reset" = 1 ]; then
    echo "--reset needs a fresh process; stop the running moto_server first" >&2
    exit 1
  fi
else
  : > "$LOG"
  # 临时文件统一落在 .work 下：不往系统 /tmp 写，也不让 Python 在找不到可写
  # 临时目录时退回当前目录探测（那会在仓库根目录撒下随机名的 "blat" 文件）。
  mkdir -p "$WORK/tmp"
  export TMPDIR=$WORK/tmp
  # moto 默认只把 ~5MB 以内的对象放内存，更大的会落到临时文件。调大缓冲后
  # 大对象全程在内存里，省掉磁盘往返，也不依赖 TMPDIR 是否可写。
  export MOTO_S3_DEFAULT_KEY_BUFFER_SIZE=${MOTO_S3_DEFAULT_KEY_BUFFER_SIZE:-134217728}
  # stdout/stderr 落到文件，避免混进后续脚本输出
  "$VENV/bin/moto_server" -H "$HOST" -p "$PORT" >> "$LOG" 2>&1 &
  echo "$!" > "$WORK/moto.pid"
  for _ in $(seq 1 40); do
    if curl -fsS -o /dev/null --max-time 1 "$ENDPOINT/"; then break; fi
    sleep 0.25
  done
  if ! curl -fsS -o /dev/null --max-time 1 "$ENDPOINT/"; then
    echo "the S3 mock did not start; see $LOG" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  echo "S3 mock listening on $ENDPOINT"
fi

if [ "$seed" = 1 ]; then
  args=(--endpoint "$ENDPOINT" --access-key "$AK" --secret-key "$SK")
  [ "$reset" = 1 ] && args+=(--reset)
  "$VENV/bin/python" test/mock/seed.py "${args[@]}"
fi

# 独立的配置文件，避免演示账号写进 ~/.config/scc/config.yaml
cat > "$CONFIG" <<EOF
listen: 127.0.0.1:8080
accounts:
    - name: mock
      endpoint: $ENDPOINT
      region: us-east-1
      access_key: $AK
      secret_key: $SK
      path_style: true
      default_bucket: demo
EOF

cat <<EOF

----------------------------------------------------------------
export SCC_CONFIG=$CONFIG
scc ls mock:/          # 演示数据
scc buckets mock       # demo / photos / paging / archive
scc web                # 网页界面 http://127.0.0.1:8080

停掉 mock:  kill \$(cat $WORK/moto.pid)
----------------------------------------------------------------
EOF
