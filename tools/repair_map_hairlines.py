"""Close the one-pixel hairlines baked into the stitched base maps.

A stage map is one flat picture, so a pixel that is not fully opaque blends with
whatever the frame was cleared to — black. Where the stitcher left a single
transparent column or row (a join between two tile quads), the player sees a
dark line along the join, and it shimmers as the camera moves under it.

It also closes a half-transparent line, but in the shipped build it never sees
one: tools/restitch_map_stp.py runs first and makes every flagged texel opaque
black, which is what the console draws (docs/research/field/map-tile-draw-
semitransparency-2026-08-20.md). That is deliberate — the decoded colour beats
this tool's guess at one — so a one-pixel flagged line stays black.

This closes such a line by taking the colour of its two fully-opaque neighbours
and writing it back at full alpha. It only touches a line that is exactly one
pixel wide, has opaque pixels on both sides, and runs at least --min-run pixels,
so a deliberate transparent cut-out (which a prop fills) and a deliberate
semi-transparent area (which is wider than one pixel) are both left alone.

Census the damage first with tools/audit_map_hairlines.py.

Run: .venv/bin/python3 tools/repair_map_hairlines.py [--min-run 8] [--dry-run]
     .venv/bin/python3 tools/repair_map_hairlines.py s210 s285   (some stages)
"""

import argparse
import glob
import os

from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("stages", nargs="*", help="stage ids; default every base map")
ap.add_argument("--min-run", type=int, default=8)
ap.add_argument("--dry-run", action="store_true")
args = ap.parse_args()
MIN = args.min_run


def runs(px, w, h, axis):
    """Every 1-px-wide, >=MIN-long line of not-fully-opaque pixels whose two
    neighbours across the line are both fully opaque. Yields (i, j0, length)."""
    outer, inner = (w, h) if axis == "v" else (h, w)
    for i in range(1, outer - 1):
        start, run = 0, 0
        for j in range(inner + 1):
            hit = False
            if j < inner:
                cur = px[i, j] if axis == "v" else px[j, i]
                lo = px[i - 1, j] if axis == "v" else px[j, i - 1]
                hi = px[i + 1, j] if axis == "v" else px[j, i + 1]
                hit = cur[3] < 255 and lo[3] == 255 and hi[3] == 255
            if hit:
                if run == 0:
                    start = j
                run += 1
            else:
                if run >= MIN:
                    yield i, start, run
                run = 0


def repair(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    read = im.copy().load()          # decisions come from the ORIGINAL picture
    write = im.load()                # so a vertical fix cannot feed a horizontal one
    fixed = 0
    for axis in ("v", "h"):
        for i, j0, n in runs(read, w, h, axis):
            for j in range(j0, j0 + n):
                if axis == "v":
                    lo, hi = read[i - 1, j], read[i + 1, j]
                    write[i, j] = ((lo[0] + hi[0]) // 2, (lo[1] + hi[1]) // 2, (lo[2] + hi[2]) // 2, 255)
                else:
                    lo, hi = read[j, i - 1], read[j, i + 1]
                    write[j, i] = ((lo[0] + hi[0]) // 2, (lo[1] + hi[1]) // 2, (lo[2] + hi[2]) // 2, 255)
            fixed += 1
    return im, fixed


targets = ([f"web/assets/maps/{s}.png" for s in args.stages] if args.stages
           else [p for p in sorted(glob.glob("web/assets/maps/*.png"))
                 if not os.path.basename(p)[:-4].endswith("_fg")])

total_lines = total_stages = 0
for path in targets:
    im, fixed = repair(path)
    if not fixed:
        continue
    total_stages += 1
    total_lines += fixed
    print(f"{os.path.basename(path)[:-4]}: closed {fixed} hairline(s)"
          + (" (dry run)" if args.dry_run else ""))
    if not args.dry_run:
        im.save(path)
print(f"{total_lines} hairlines closed across {total_stages} stages"
      + (" (dry run — nothing written)" if args.dry_run else ""))
