#!/usr/bin/env bash
# make-tarball.sh <bundle dir> <version> <out dir> — the Linux download.
set -euo pipefail
BUNDLE="$1"; VERSION="$2"; OUT="$3"
mkdir -p "$OUT"
cat > "$BUNDLE/DW2003" <<'SH'
#!/bin/sh
# Start Digimon World 2003: opens your browser; the first run asks for your disc.
HERE="$(cd "$(dirname "$0")" && pwd)"
exec "$HERE/runtime/python/bin/python3" "$HERE/app/launcher/dw2003.py" "$@"
SH
chmod +x "$BUNDLE/DW2003"
cat > "$BUNDLE/README.txt" <<TXT
Digimon World 2003 — browser recreation ($VERSION)

Start:  ./DW2003     (or double-click it and choose "Run")

Your browser opens. The first time, choose your PAL/EU disc image (.bin or .iso);
the game is built from it on this computer (15-40 minutes, once). After that,
./DW2003 goes straight to the game. Keep the terminal open while playing.
TXT
tar -C "$(dirname "$BUNDLE")" -czf "$OUT/DW2003-linux-x64.tar.gz" "$(basename "$BUNDLE")"
ls -la "$OUT"
