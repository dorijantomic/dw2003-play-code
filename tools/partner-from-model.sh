#!/usr/bin/env bash
# A new partner's field sprite straight from its battle model, timed like Patamon (the approved DemiDevimon look):
# idle = 9 frames over 3 wing beats, walk/run = 5 frames over 1 beat, stop = 6 frames; body held still so only
# wings, legs and tail move, Patamon's idle bob added. Output is disc-derived: do NOT commit web/extra_partners/.
#
#   tools/partner-from-model.sh <model> <charId> <beatStart> <beatLen> [height]
#   e.g. tools/partner-from-model.sh m217pdev x191demi 10 20 44
# beatStart/beatLen: one wing beat in model frames (read the wing bones' ch2 keys; DemiDevimon: 10, 20).
# IDLE_BEATS (default 3, Patamon's): beats the idle's 9 frames span. A model with no wing beat, only one slow
# loop, uses that loop as the beat and IDLE_BEATS=1 (Hagurumon: m122hagu x193hagu 10 61, IDLE_BEATS=1).
# Needs the web server: python3 -m http.server ${VERIFY_PORT:-8770} --directory web
set -euo pipefail
cd "$(dirname "$0")/.."
model="${1:?model}"; char="${2:?charId}"; s="${3:?beatStart}"; n="${4:?beatLen}"; h="${5:-44}"
w="captures/partner-from-model/$model"
mkdir -p "$w/idle" "$w/walk" "$w/stop" "$w/all"
r() { HOLD_ROOT=1 LOOP=$1 VERIFY_PORT="${VERIFY_PORT:-8770}" tools/run-playwright.sh tools/render_sprite_views.mjs "$model" "$2" "$3"; }
r "$s:$((s + ${IDLE_BEATS:-3} * n))" "$w/idle" 9
r "$s:$((s + n))" "$w/walk" 5
r "$s:$((s + n))" "$w/stop" 6
# one row per direction: idle 0-8, walk 9-13, stop 14-19
for part in idle:0 walk:9 stop:14; do
  for f in "$w/${part%%:*}"/*_*_*.png; do
    b=$(basename "$f" .png); k=${b##*_}; cp "$f" "$w/all/${b%_*}_$((k + ${part##*:})).png"
  done
done
python3 -I tools/sprite_views_sheet.py "$w/all"
python3 -I tools/make_partner_sprites.py "$w/all/sheet.png" "$char" --grid 20x5 --height "$h" --colors 32 \
  --duration 6,4,4,6,4 --clips "1=0-8@6^1/0/0/-2/-3/-1/-1/0/2;4=9-13@6/4/4/6/4;5=9-13@4/2/2/4/4;6=14-19@4/4/4/4/6/6"
