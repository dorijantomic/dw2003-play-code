#!/usr/bin/env bash
# Reference sheets of a battle model from the field sprite's five directions, its idle loop, on green:
# hand a row (or the sheet) to an image generator and ask for it redrawn as pixel art.
#
#   tools/sprite-views.sh <model> [outdir] [frames]
#   e.g. tools/sprite-views.sh m217pdev            -> captures/sprite-views/m217pdev/sheet.png + row_*.png
# Models are the folders under web/assets/battle/models/ (the Model list in web/model-viewer.html).
# Needs the web server: python3 -m http.server ${VERIFY_PORT:-8770} --directory web
# Camera: ZOOM (fraction of the viewer's fitted distance, default 0.6), PITCH (radians, default 0.3),
# FRONT (angle that sees the face, default 0), LOOP=start:end (frames, default: found from the model).
set -euo pipefail
cd "$(dirname "$0")/.."
model="${1:?usage: tools/sprite-views.sh <model> [outdir] [frames]}"
out="${2:-captures/sprite-views/$model}"
frames="${3:-8}"
mkdir -p "$out"
VERIFY_PORT="${VERIFY_PORT:-8770}" tools/run-playwright.sh tools/render_sprite_views.mjs "$model" "$out" "$frames"
python3 -I tools/sprite_views_sheet.py "$out"
