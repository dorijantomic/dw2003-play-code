#!/bin/bash
# Keeps WSL alive and keeps the game server (8090) and the Fusion Lab helper (8791) running.
# Started hidden from Windows by C:\Users\dorij\start-game-servers.ps1 (wsl.exe stays attached = WSL never idles out).
# One copy only (flock). A port that already listens is left alone.
exec 9>/tmp/game_servers_keepalive.lock
flock -n 9 || exit 0
LOG=$HOME/game_servers_keepalive.log
listening() { ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$1\$"; }
start() { # port, command...
  local p=$1; shift
  if ! listening "$p"; then
    echo "$(date '+%F %T') start port $p: $*" >> "$LOG"
    setsid nohup "$@" >> "$LOG" 2>&1 < /dev/null &
  fi
}
while true; do
  start 8090 python3 $HOME/serve_game.py
  start 8791 python3 $HOME/dw2003-play-integration/tools/fusion_lab_server.py
  sleep 10
done
