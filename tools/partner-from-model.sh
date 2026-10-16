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
# WALK_SPIN=<frame>: walking is one forward roll in the pose of that frame (Kunemon's rolling attack:
# ZOOM=0.8 WALK_SPIN=720 IDLE_BEATS=1 IDLE_BOB=0 tools/partner-from-model.sh m032kune x192kune 10 61 30).
# IDLE_BOB: the idle's pixel bob per frame (default Patamon's hover); 0 = a crawler: no bob, and every direction
# (and each roll frame) stood on the ground line.
# Needs the web server: python3 -m http.server ${VERIFY_PORT:-8770} --directory web
set -euo pipefail
cd "$(dirname "$0")/.."
model="${1:?model}"; char="${2:?charId}"; s="${3:?beatStart}"; n="${4:?beatLen}"; h="${5:-44}"
w="captures/partner-from-model/$model"
mkdir -p "$w/idle" "$w/walk" "$w/stop" "$w/all"
r() { HOLD_ROOT=1 LOOP=$1 VERIFY_PORT="${VERIFY_PORT:-8770}" tools/run-playwright.sh tools/render_sprite_views.mjs "$model" "$2" "$3"; }
r "$s:$((s + ${IDLE_BEATS:-3} * n))" "$w/idle" 9
if [ -n "${WALK_SPIN:-}" ]; then
  # walking is a roll (WALK_SPIN = a frame holding the curled pose); stopping settles back into the idle
  SPIN="$WALK_SPIN" r "$s:$((s + n))" "$w/walk" 5
  r "$s:$((s + n))" "$w/stop" 6
  # the root is not the curled body's centre, so the ball swings around it: put every roll picture's centre
  # where the idle body is, standing on the idle's ground line, so it rolls in place
  python3 -I - "$w" <<'EOF'
import glob, os, sys
import numpy as np
from PIL import Image
w = sys.argv[1]
def box(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    ys, xs = np.nonzero(~((a[..., 1] > 200) & (a[..., 0] < 80) & (a[..., 2] < 80)))
    return xs.min(), ys.min(), xs.max(), ys.max()
for idle in sorted(glob.glob(f"{w}/idle/*_1.png")):
    d = os.path.basename(idle)[:-len("_1.png")]
    x0, _, x1, y1 = box(idle)
    for f in sorted(glob.glob(f"{w}/walk/{d}_*.png")):
        bx0, _, bx1, by1 = box(f)
        im = Image.open(f).convert("RGB")
        out = Image.new("RGB", im.size, (0, 255, 0))
        out.paste(im, (round((x0 + x1 - bx0 - bx1) / 2), y1 - by1))
        out.save(f)
EOF
else
  r "$s:$((s + n))" "$w/walk" 5
  r "$s:$((s + n))" "$w/stop" 6
fi
# one row per direction: idle 0-8, walk 9-13, stop 14-19
for part in idle:0 walk:9 stop:14; do
  for f in "$w/${part%%:*}"/*_*_*.png; do
    b=$(basename "$f" .png); k=${b##*_}; cp "$f" "$w/all/${b%_*}_$((k + ${part##*:})).png"
  done
done
python3 -I tools/sprite_views_sheet.py "$w/all"
ground=()
if [ "${IDLE_BOB:-}" = 0 ]; then ground=(--ground); [ -n "${WALK_SPIN:-}" ] && ground+=(--ground-each 9-13); fi
python3 -I tools/make_partner_sprites.py "$w/all/sheet.png" "$char" --grid 20x5 --height "$h" --colors 32 "${ground[@]}" \
  --duration 6,4,4,6,4 --clips "1=0-8@6^${IDLE_BOB:-1/0/0/-2/-3/-1/-1/0/2};4=9-13@6/4/4/6/4;5=9-13@4/2/2/4/4;6=14-19@4/4/4/4/6/6"
