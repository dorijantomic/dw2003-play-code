#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock="$root/.dw3-research/overlay-scan.lock"
lock_timeout="${DW3_OVERLAY_LOCK_TIMEOUT:-30}"
cpu="${DW3_OVERLAY_CPU:-0}"
uv="${DW3_OVERLAY_UV:-$HOME/.local/bin/uv}"
python="${DW3_OVERLAY_PYTHON:-$root/.venv/bin/python3}"

mkdir -p "$(dirname "$lock")"
exec 9>"$lock"
if ! flock -w "$lock_timeout" 9; then
  echo "OVERLAY LOCK TIMEOUT after ${lock_timeout}s" >&2
  exit 1
fi

exec taskset -c "$cpu" prlimit --as=4294967296 -- \
  "$uv" run --no-project --python "$python" --with capstone \
  python3 "$root/tools/overlay_scan.py" "$@"
