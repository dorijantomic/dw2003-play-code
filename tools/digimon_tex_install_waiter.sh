#!/usr/bin/env bash
# Waits for the phase-1 runner (digimon_tex_spaced_all.sh, PID $1) to exit, then runs digimon_tex_install_all.sh ONCE,
# only when run.log ends with "end" right after a model line (a "stop:" line before "end" = stopped early = no install;
# no "end" = killed/crashed = no install). Logs to ~/digimon-atlas-B/install.log.
#   setsid nohup bash tools/digimon_tex_install_waiter.sh <runner pid> >/dev/null 2>&1 &
set -u
PID="$1"
OUT="$HOME/digimon-atlas-B"
LOG="$OUT/install.log"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
log "waiter: waiting for runner pid $PID"
while kill -0 "$PID" 2>/dev/null; do sleep 60; done
last=$(tail -1 "$OUT/run.log")
prev=$(tail -2 "$OUT/run.log" | head -1)
if [ "${last#* * }" != "end" ]; then log "waiter: NO install - runner exited without 'end' (killed or crashed): $last"; exit 0; fi
case "$prev" in
  *" stop: "*) log "waiter: NO install - run stopped early: ${prev#* * }"; exit 0 ;;
esac
log "waiter: phase 1 finished, running install-all"
bash "$HOME/dw2003-play-integration/tools/digimon_tex_install_all.sh"
log "waiter: done"
