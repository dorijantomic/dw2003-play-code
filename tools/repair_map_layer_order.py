"""Draw a stage's map-tile layer 2 BEHIND the ground, the way the console does.

Why this exists
---------------
The field's map draw passes one ordering-table depth per map-tile layer, taken
from the table at 0x8009702c: layer 0 draws at 7, layer 1 at 3 and layer 2 at
11 (decoded in docs/research/field/map-tile-draw-semitransparency-2026-08-20.md
section 5, frontier WORLD-Q008). Lower is nearer the camera, so the console
paints layer 2 first, then the ground, then the foreground.

ddw3's stitcher paints the layers in config order instead -- 0, then 1, then 2
-- so layer 2 lands on TOP of everything. On most stages that is invisible,
because layer 2 fills the holes the ground leaves and the two never meet. On 14
stages they do meet, and there the shipped map shows flat blocks of colour lying
over finished artwork: a grey-blue rectangle over the treetops of Kicking
Forest, an olive band across the roof of East Station. Confirmed against the
running original 2026-08-21: those blocks are not there.

This re-stitches each affected stage both ways and writes back only the pixels
that differ, so it neither depends on nor undoes any other repair the map has
already had. Run it after tools/restitch_map_stp.py -- it stitches with that
repair applied, so a pixel it moves carries the solid colour, not a blended one
-- and before tools/repair_map_hairlines.py, which rewrites the seams last.

Run:
  .venv/bin/python3 tools/repair_map_layer_order.py --dry-run
  .venv/bin/python3 tools/repair_map_layer_order.py s400 s410
  .venv/bin/python3 tools/repair_map_layer_order.py --verify
"""

import argparse
import sys
import tomllib
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from restitch_map_stp import DDW3, MAPS, config_of, parse_entry, stitch  # noqa: E402

# Far to near: layer 2 at depth 11, the ground at 7, the foreground at 3.
DEPTH_ORDER = (2, 0, 1)


def has_layer2(stage: str) -> bool:
    """True when any of the stage's map cells declares a layer-2 object."""
    pack = DDW3 / f"map/dw2003/z_stage/{stage}pack.toml"
    if not pack.exists():
        return False
    cfg = tomllib.loads(pack.read_text(encoding="utf-8"))
    for entry in cfg["entries"]:
        img_path, layers = parse_entry(entry)
        if img_path is None:
            continue
        if len(layers) > 2 and layers[2]:
            return True
    return False


def candidate_stages() -> list:
    """Only a stage with layer-2 art can change; the rest cannot."""
    out = []
    for p in sorted(MAPS.glob("s*.png")):
        if p.stem.endswith("_fg"):
            continue
        if has_layer2(p.stem):
            out.append(p.stem)
    return out


def classify(shipped_order: Image.Image, depth_order: Image.Image,
             ground: Image.Image, foreground: Image.Image):
    """Split the differing pixels by what layer 2 was covering.

    A pixel layer 2 covered on the GROUND is one a player sees wrongly today.
    A pixel it covered on the FOREGROUND is repaired at runtime anyway, because
    the foreground overlay is drawn again over everything."""
    a, b = shipped_order.load(), depth_order.load()
    g, f = ground.getchannel("A").load(), foreground.getchannel("A").load()
    w, h = shipped_order.size
    over_ground = over_foreground = other = 0
    changed = []
    for y in range(h):
        for x in range(w):
            if a[x, y] == b[x, y]:
                continue
            changed.append((x, y))
            if f[x, y]:
                over_foreground += 1
            elif g[x, y]:
                over_ground += 1
            else:
                other += 1
    return changed, over_ground, over_foreground, other


def layer_alpha(stage: str, layer: int) -> Image.Image:
    """One layer alone, for asking what a changed pixel was covering."""
    return stitch(stage, solid=False, order=(layer,))[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("stages", nargs="*", help="stage ids; default every stage with layer-2 art")
    ap.add_argument("--verify", action="store_true",
                    help="check the shipped maps already carry the depth order; exit 1 if not")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    stages = args.stages or candidate_stages()
    total = 0
    touched = 0
    outstanding = 0
    for stage in stages:
        shipped_path = MAPS / f"{stage}.png"
        if not shipped_path.exists():
            print(f"{stage}: no shipped map")
            continue
        before, _ = stitch(stage, solid=True)
        after, _ = stitch(stage, solid=True, order=DEPTH_ORDER)
        ground = layer_alpha(stage, 0)
        foreground = layer_alpha(stage, 1)
        changed, over_ground, over_fg, other = classify(before, after, ground, foreground)
        if not changed:
            continue
        touched += 1
        total += len(changed)
        print(f"{stage}: {len(changed)} pixel(s) move behind the ground "
              f"({over_ground} were layer 2 covering GROUND art -- visible to a player; "
              f"{over_fg} were covering foreground art -- the overlay redraws those; "
              f"{other} covered nothing)"
              + ("  [dry run]" if args.dry_run or args.verify else ""))
        shipped = Image.open(shipped_path).convert("RGBA")
        if shipped.size != after.size:
            raise SystemExit(f"{stage}: size mismatch shipped {shipped.size} stitch {after.size}")
        dst, src = shipped.load(), after.load()
        if args.verify:
            # Not "do the two stitches differ" -- they always do. The question is
            # whether the SHIPPED map already carries the depth-ordered pixel.
            stale = sum(1 for x, y in changed if dst[x, y] != src[x, y])
            outstanding += stale
            print(f"    {stale} of those still hold the old order in the shipped map"
                  + ("  MISMATCH" if stale else "  OK"))
            continue
        if args.dry_run:
            continue
        for x, y in changed:
            dst[x, y] = src[x, y]
        shipped.save(shipped_path)
    print(f"{touched} stage(s), {total} pixel(s)")
    if args.verify:
        print(f"{outstanding} pixel(s) still hold the old order")
        return 1 if outstanding else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
