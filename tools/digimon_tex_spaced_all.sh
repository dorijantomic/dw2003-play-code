#!/usr/bin/env bash
# Overnight batch: tools/digimon_tex_spaced.py <model> --prompt B on every Digimon battle texture, one model and one FIBO
# at a time. Writes ONLY to ~/digimon-atlas-B/<model>/ (FIBO sheet(s), <model>_spaced_result_<N>.png, packing_map.json,
# prompt.json, metrics.json). Never installs, never touches web/assets-hd, never commits.
#   bash tools/digimon_tex_spaced_all.sh            (run in WSL; start detached, see DW2003-INDEX.md)
#   stop cleanly after the current model:  touch ~/digimon-atlas-B/STOP
# Models = every web/assets-hd/battle/textures/m*.png named in web/assets/battle/model_map.json (all Digimon battle
# models). Source per model = the script's own rule (earliest ~/hd-backup/digimon-tex-*/<model>.png, else assets-hd).
# Done = ~/digimon-atlas-B/<model>/metrics.json exists (resume-safe). Disk guard: stop when C:, L: or WSL home < 3 GB.
# Log: ~/digimon-atlas-B/run.log  (time model ok|fail secs sharp_orig->sharp clusters [reason])
set -u
REPO="$HOME/dw2003-play-integration"
OUT="$HOME/digimon-atlas-B"
STAGE="$OUT/.stage"
LOG="$OUT/run.log"
WORK=/mnt/l/fibo/work
COMFY=/mnt/l/fibo/ComfyUI
MIN_KB=$((3 * 1024 * 1024))
PER_MODEL_TIMEOUT=2400
export PATH="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -1):$PATH"
mkdir -p "$OUT"
cd "$REPO" || exit 1
rm -f "$OUT/STOP"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

comfy_kill() { python3 -c "import sys; sys.path.insert(0,'tools'); import digimon_tex_views as d; d.comfy('kill')" >/dev/null 2>&1; }

clean_tmp() {   # this model's temp files only
  local w="$1-spaced-B"
  rm -f "$WORK"/cond/"${w}"_*.pt "$WORK"/lat/"${w}"_*.pt "$COMFY"/input/dtv_"${w}"_*.png
  rm -rf "$COMFY/output/texviews/$w" "$WORK/$w" "$STAGE/$1-atlas"
}

MODELS=$(python3 - <<'EOF'
import json, os
W = os.path.expanduser("~/dw2003-play-integration/web")
mm = set(json.load(open(f"{W}/assets/battle/model_map.json")).values())
d = f"{W}/assets-hd/battle/textures"
print(" ".join(sorted(f[:-4] for f in os.listdir(d) if f.startswith("m") and f.endswith(".png") and f[:-4] in mm)))
EOF
)
set -- $MODELS
log "start: $# models queued"

for m in "$@"; do
  [ -f "$OUT/$m/metrics.json" ] && continue
  if [ -f "$OUT/STOP" ]; then log "stop: STOP file found"; break; fi
  low=""
  for p in /mnt/c /mnt/l "$HOME"; do
    a=$(df -Pk "$p" | awk 'NR==2{print $4}')
    [ "${a:-0}" -lt "$MIN_KB" ] && low="$low $p=$((a / 1024))MB"
  done
  if [ -n "$low" ]; then log "stop: disk under 3 GB:$low"; break; fi
  clean_tmp "$m"
  t0=$(date +%s)
  timeout "$PER_MODEL_TIMEOUT" python3 tools/digimon_tex_spaced.py "$m" --prompt B --out "$STAGE" > "$OUT/.last_$m.txt" 2>&1
  rc=$?
  secs=$(( $(date +%s) - t0 ))
  d="$STAGE/$m-atlas/spaced-B"
  if [ $rc -eq 0 ] && [ -f "$d/metrics.json" ]; then
    tmp="$OUT/.tmp_$m"
    rm -rf "$tmp"; mkdir -p "$tmp"
    cp "$d"/${m}_spaced_sheet*_fibo_*.png "$d"/${m}_spaced_result_*.png "$d/packing_map.json" "$d/prompt.json" "$d/metrics.json" "$tmp/"
    rm -rf "$OUT/$m"; mv "$tmp" "$OUT/$m"
    stats=$(python3 -c "import json;M=json.load(open('$OUT/$m/metrics.json'));print(f\"{M.get('sharp_orig')}->{M.get('sharp')} {M.get('clusters')}\")")
    log "$m ok $secs $stats"
    rm -f "$OUT/.last_$m.txt"
  else
    reason=$(grep -v '^\s*$' "$OUT/.last_$m.txt" | tail -1 | cut -c1-200)
    log "$m fail $secs - - rc=$rc $reason"
    mkdir -p "$OUT/.fail"; mv "$OUT/.last_$m.txt" "$OUT/.fail/$m.txt"
    comfy_kill
  fi
  clean_tmp "$m"
done
comfy_kill
rm -rf "$STAGE"
log "end"
