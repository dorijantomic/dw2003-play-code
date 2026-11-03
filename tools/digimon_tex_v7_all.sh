#!/usr/bin/env bash
# Batch: V7 texture for every Digimon battle texture, one model and one FIBO at a time.
# V7 = tools/digimon_tex_views.py (anime prompt, auto7 views) -> tools/digimon_tex_v7_compose.py (sweep.py config #7).
# Writes ONLY to ~/digimon-v7/<m>/ (<m>_V7.png, metrics.json, joined png) and ~/digimon-v7/.views. Never installs, never
# touches web/assets-hd, never commits, never installs packages.
#   bash tools/digimon_tex_v7_all.sh [model ...]      (WSL; start detached, see DW2003-INDEX.md)
#   stop cleanly after the current model:  touch ~/digimon-v7/STOP
# Source (original, pre-FIBO) = ~/hd-backup/digimon-tex-2026-11-01/<m>.png. Done = ~/digimon-v7/<m>/<m>_V7.png exists.
# Existing results (m213wgre m212manm m003agum) were seeded by hand from ~/digimon-quest/cpu/<m>_V_7.png (and measured again).
# Disk guard: stop when C:, L: or WSL home < 3 GB.  Log: ~/digimon-v7/run.log (time model ok|fail secs ...)
set -u
REPO="$HOME/dw2003-play-integration"
OUT="$HOME/digimon-v7"
VIEWS="$OUT/.views"
LOG="$OUT/run.log"
SRCDIR="$HOME/hd-backup/digimon-tex-2026-11-01"
WORK=/mnt/l/fibo/work
COMFY=/mnt/l/fibo/ComfyUI
MIN_KB=$((3 * 1024 * 1024))
PER_MODEL_TIMEOUT=2400
export PATH="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -1):$PATH"
mkdir -p "$OUT" "$VIEWS"
cd "$REPO" || exit 1
rm -f "${OUT:?}/STOP"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
comfy_kill() { python3 -c "import sys; sys.path.insert(0,'tools'); import digimon_tex_views as d; d.comfy('kill')" >/dev/null 2>&1; }
clean_tmp() {
  local k="${1:?}"
  rm -f "${WORK:?}"/cond/"${k}"_*.pt "${WORK:?}"/lat/"${k}"_*.pt "${COMFY:?}"/input/dtv_"${k}"_*.png
  rm -rf "${COMFY:?}/output/texviews/${k}" "${WORK:?}/${k}" "${VIEWS:?}/${k}/views/render"
}
if [ $# -gt 0 ]; then
  MODELS="$*"
else
  MODELS=$(python3 - <<'PY'
import json, os
W = os.path.expanduser("~/dw2003-play-integration/web")
mm = set(json.load(open(f"{W}/assets/battle/model_map.json")).values())
d = f"{W}/assets-hd/battle/textures"
print(" ".join(sorted(f[:-4] for f in os.listdir(d) if f.startswith("m") and f.endswith(".png") and f[:-4] in mm)))
PY
)
fi
set -- $MODELS
log "start: $# models queued"
for m in "$@"; do
  [ -f "$OUT/$m/${m}_V7.png" ] && continue
  if [ -f "$OUT/STOP" ]; then log "stop: STOP file found"; break; fi
  low=""
  for p in /mnt/c /mnt/l "$HOME"; do
    a=$(df -Pk "$p" | awk 'NR==2{print $4}')
    [ "${a:-0}" -lt "$MIN_KB" ] && low="$low $p=$((a / 1024))MB"
  done
  if [ -n "$low" ]; then log "stop: disk under 3 GB:$low"; break; fi
  src="$SRCDIR/$m.png"
  if [ ! -f "$src" ]; then log "$m fail 0 no original in $SRCDIR"; continue; fi
  clean_tmp "$m"
  t0=$(date +%s)
  joined="$VIEWS/$m/views/joined/$m.png"
  rc=0
  if [ ! -f "$joined" ]; then
    timeout "$PER_MODEL_TIMEOUT" python3 tools/digimon_tex_views.py "$m" --out "$VIEWS" --hd-src "$src" > "$OUT/.last_$m.txt" 2>&1; rc=$?
  fi
  if [ $rc -eq 0 ] && [ -f "$joined" ]; then
    mkdir -p "$OUT/.tmp_$m"
    python3 tools/digimon_tex_v7_compose.py "$m" "$joined" "$src" "$OUT/.tmp_$m/${m}_V7.png" > "$OUT/.tmp_$m/metrics.json" 2>> "$OUT/.last_$m.txt"; rc=$?
  elif [ $rc -eq 0 ]; then
    rc=1
  fi
  secs=$(( $(date +%s) - t0 ))
  if [ $rc -eq 0 ] && [ -s "$OUT/.tmp_$m/metrics.json" ]; then
    cp "$joined" "$OUT/.tmp_$m/${m}_joined.png"
    rm -rf "${OUT:?}/${m:?}"; mv "$OUT/.tmp_$m" "$OUT/$m"
    log "$m ok $secs $(tr -d '\n' < "$OUT/$m/metrics.json" | cut -c1-300)"
    rm -f "$OUT/.last_$m.txt"
  else
    reason=$(grep -v '^\s*$' "$OUT/.last_$m.txt" 2>/dev/null | tail -1 | cut -c1-200)
    log "$m fail $secs rc=$rc $reason"
    mkdir -p "$OUT/.fail"; mv "$OUT/.last_$m.txt" "$OUT/.fail/$m.txt" 2>/dev/null
    rm -rf "${OUT:?}/.tmp_${m:?}"
    comfy_kill
  fi
  clean_tmp "$m"
done
comfy_kill
log "end"
