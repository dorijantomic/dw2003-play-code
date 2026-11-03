#!/usr/bin/env bash
# Install every finished V7 result (~/digimon-v7/<m>/<m>_V7.png) into the game with tools/digimon_tex_install.py.
#   bash tools/digimon_tex_v7_install_all.sh             install all
#   bash tools/digimon_tex_v7_install_all.sh --dry-run   list what it would do, change nothing
#   bash tools/digimon_tex_v7_install_all.sh --restore-all   put every V7 model back to the texture it had BEFORE this install
#                                                        (~/hd-backup/digimon-tex-before-v7/, the FIBO texture)
# BACKUP RULE (read from digimon_tex_install.py): it copies the current game texture into --backup only if no file of
# that name is there yet, and never touches other folders. The pre-FIBO originals live in
# ~/hd-backup/digimon-tex-2026-11-01/ (= install.py's default folder for today, so we NEVER use the default here).
# We pass --backup ~/hd-backup/digimon-tex-before-v7 (new folder, first copy kept). Install is refused if that folder
# would be one of the original folders. Re-running never overwrites a backup, so the FIBO copy stays safe.
# Per model skipped when the V7 png or the installed file is missing, or the V7 png is not square 1024/2048/4096.
# Log: ~/digimon-v7/install.log (time model installed|skipped|restored reason)
set -u
REPO="$HOME/dw2003-play-integration"
OUT="$HOME/digimon-v7"
LOG="$OUT/install.log"
TEX="$REPO/web/assets-hd/battle/textures"
BAK="$HOME/hd-backup/digimon-tex-before-v7"
case "$BAK" in *digimon-tex-2026-*|*model-textures-*) echo "backup folder is an original folder"; exit 1 ;; esac
cd "$REPO" || exit 1
mkdir -p "$OUT"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

if [ "${1:-}" = "--restore-all" ] || [ "${1:-}" = "--restore" ]; then
  log "restore-all start (from $BAK)"
  for d in "$OUT"/m*/; do
    m=$(basename "$d")
    if [ ! -f "$BAK/$m.png" ]; then log "$m restore-skipped no backup in $BAK"; continue; fi
    if python3 tools/digimon_tex_install.py --restore "$m" --backup "$BAK" >/dev/null 2>&1; then log "$m restored"; else log "$m restore-failed"; fi
  done
  log "restore-all end"
  exit 0
fi

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
log "install-all start dry=$DRY"
a=$(df -Pk "$HOME" | awk 'NR==2{print $4}')
if [ "${a:-0}" -lt $((3 * 1024 * 1024)) ]; then log "stop: WSL home under 3 GB"; exit 1; fi
n_ok=0; n_skip=0
for d in "$OUT"/m*/; do
  m=$(basename "$d")
  res="$d${m}_V7.png"
  dst="$TEX/$m.png"
  if [ ! -f "$res" ] || [ ! -f "$dst" ]; then log "$m skipped missing V7 result or installed file"; n_skip=$((n_skip+1)); continue; fi
  if [ "$(sha1sum < "$res")" = "$(sha1sum < "$dst")" ]; then log "$m skipped already installed"; continue; fi
  if [ $DRY = 1 ]; then echo "WOULD install $res -> $dst (backup $BAK/$m.png)"; n_ok=$((n_ok+1)); continue; fi
  mkdir -p "$BAK"
  [ -f "$BAK/$m.png" ] || cp "$dst" "$BAK/$m.png"
  if [ ! -f "$BAK/$m.png" ]; then log "$m skipped backup failed"; n_skip=$((n_skip+1)); continue; fi
  if python3 tools/digimon_tex_install.py "$m" "$res" --backup "$BAK" >/dev/null 2>"$OUT/.install_err"; then
    log "$m installed (previous texture backed up at $BAK/$m.png)"; n_ok=$((n_ok+1))
  else
    log "$m skipped install error: $(tail -1 "$OUT/.install_err" | cut -c1-200)"; n_skip=$((n_skip+1))
  fi
done
rm -f "$OUT/.install_err"
log "install-all end: $n_ok installed, $n_skip skipped"
