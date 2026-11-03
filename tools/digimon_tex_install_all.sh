#!/usr/bin/env bash
# Phase 2 of the overnight spaced-B batch: install every successful ~/digimon-atlas-B/<model>/ result into the game
# with tools/digimon_tex_install.py (it backs up the current texture to ~/hd-backup/digimon-tex-<date>/ first).
#   bash tools/digimon_tex_install_all.sh             install all (called once by digimon_tex_spaced_all.sh at its end)
#   bash tools/digimon_tex_install_all.sh --dry-run   list what it would do, change nothing
#   bash tools/digimon_tex_install_all.sh --restore-all   put back the ORIGINAL of every model in ~/digimon-atlas-B
#                                                      (the EARLIEST hd-backup copy = the page before any FIBO install)
# Per model, before installing: metrics.json source sha1 must be the original (the installed file when it was the
# source, or the hd-backup file), and after the backup step a ~/hd-backup copy with that sha1 must exist; else skip.
# Log: ~/digimon-atlas-B/install.log (time model installed|skipped|restored reason)
set -u
REPO="$HOME/dw2003-play-integration"
OUT="$HOME/digimon-atlas-B"
LOG="$OUT/install.log"
TEX="$REPO/web/assets-hd/battle/textures"
cd "$REPO" || exit 1
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
sha() { sha1sum "$1" | cut -d' ' -f1; }

DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; log() { echo "$*"; }; fi
if [ "${1:-}" = "--restore" ] || [ "${1:-}" = "--restore-all" ]; then
  log "restore-all start"
  for d in "$OUT"/m*/; do
    m=$(basename "$d")
    bak=$(ls -d "$HOME"/hd-backup/digimon-tex-*/ 2>/dev/null | sort | while read -r b; do [ -f "$b$m.png" ] && { echo "${b%/}"; break; }; done)
    if [ -z "$bak" ]; then log "$m restore-skipped no backup"; continue; fi
    if python3 tools/digimon_tex_install.py --restore "$m" --backup "$bak" >/dev/null 2>&1; then log "$m restored $bak"; else log "$m restore-failed $bak"; fi
  done
  log "restore-all end"
  exit 0
fi

log "install-all start"
today="$HOME/hd-backup/digimon-tex-$(date +%F)"
n_ok=0; n_skip=0
for d in "$OUT"/m*/; do
  m=$(basename "$d")
  res="$d${m}_spaced_result_1024.png"
  dst="$TEX/$m.png"
  if [ ! -f "$d/metrics.json" ] || [ ! -f "$res" ] || [ ! -f "$dst" ]; then log "$m skipped missing metrics/result/installed file"; n_skip=$((n_skip+1)); continue; fi
  read -r srcpath srcsha < <(python3 -c "import json;s=json.load(open('$d/metrics.json'))['src'];print(s['path'],s['sha1'])")
  cur=$(sha "$dst")
  if [ "$cur" = "$(sha "$res")" ]; then log "$m skipped already installed"; continue; fi
  case "$srcpath" in
    "$HOME"/hd-backup/*) ;;                                   # original from backup; installed file may be anything
    "$dst") [ "$cur" = "$srcsha" ] || { log "$m skipped installed file changed since the run (sha1 $cur != source $srcsha)"; n_skip=$((n_skip+1)); continue; } ;;
    *) log "$m skipped unexpected source $srcpath"; n_skip=$((n_skip+1)); continue ;;
  esac
  if [ $DRY = 1 ]; then
    okbak=$(for b in "$HOME"/hd-backup/digimon-tex-*/"$m".png; do [ -f "$b" ] && [ "$(sha "$b")" = "$srcsha" ] && { echo "$b"; break; }; done)
    [ -z "$okbak" ] && [ "$cur" = "$srcsha" ] && okbak="$today/$m.png (would be made)"
    if [ -n "$okbak" ]; then log "$m WOULD install $res; original backup $okbak"; n_ok=$((n_ok+1)); else log "$m WOULD skip: no original backup"; n_skip=$((n_skip+1)); fi
    continue
  fi
  mkdir -p "$today" && { [ -f "$today/$m.png" ] || cp "$dst" "$today/$m.png"; }
  okbak=$(for b in "$HOME"/hd-backup/digimon-tex-*/"$m".png; do [ -f "$b" ] && [ "$(sha "$b")" = "$srcsha" ] && { echo "$b"; break; }; done)
  if [ -z "$okbak" ]; then log "$m skipped no backup holding the original (sha1 $srcsha)"; n_skip=$((n_skip+1)); continue; fi
  if python3 tools/digimon_tex_install.py "$m" "$res" >/dev/null 2>"$OUT/.install_err"; then
    log "$m installed (original backed up at $okbak)"; n_ok=$((n_ok+1))
  else
    log "$m skipped install error: $(tail -1 "$OUT/.install_err" | cut -c1-200)"; n_skip=$((n_skip+1))
  fi
done
rm -f "$OUT/.install_err"
log "install-all end: $n_ok installed, $n_skip skipped"
