"""Re-stitch a stage map with its semi-transparent texels drawn SOLID.

Why this exists
---------------
A stage map tile is an 8-bit indexed picture. A palette entry that is black
with the transparency flag set means "opaque black" on the console: the field
draws every map-tile layer object as an opaque sprite and never turns semi-
transparency on, so the flag never reaches the hardware (decoded in
docs/research/field/map-tile-draw-semitransparency-2026-08-20.md).

ddw3's exporter cannot always tell those entries apart -- some carry stray low
bits, so they come out of the TIM as half alpha instead of opaque -- and
ddw3's stitcher then composites them at 50%. Two things go wrong in the flat
map we ship:

  * where such a texel landed on empty canvas it stays half transparent, so
    whatever is behind the map (the clear colour, a prop filling a cut-out)
    shows through at 50% instead of being hidden by solid black;
  * where it landed on top of an already-drawn texel it BLENDS, darkening that
    pixel by half, where the console would have covered it completely.

The second one cannot be repaired in the flat PNG -- the pixel is fully opaque
and looks like ordinary artwork -- which is why this re-stitches from the tiles
instead of patching the output.

This is a faithful copy of ~/ddw3/tools/stitch-map.py with one change: a texel
whose alpha is half is made opaque before it is composited. It stitches the map
BOTH ways and writes only the pixels that differ back into the shipped map, so
it neither depends on nor undoes any other repair the map has already had.

--verify proves the copy is faithful: stitched WITHOUT the change it must
reproduce, byte for byte, what ddw3's stitcher produced. Run it against a map
no other stage has rewritten yet (tools/repair_map_hairlines.py rewrites a few
pixels per stage), or read its count as "pixels some other repair changed".

Run:
  .venv/bin/python3 tools/restitch_map_stp.py --verify s300
  .venv/bin/python3 tools/restitch_map_stp.py --dry-run
  .venv/bin/python3 tools/restitch_map_stp.py s300 s211
"""

import os
import argparse
import sys
import tomllib
from pathlib import Path, PurePosixPath

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
MAPS = REPO / "web/assets/maps"

# A half-alpha texel: the TIM's 16-bit alpha is u16::MAX/2, which is 127 once
# the picture is read at 8 bits.
HALF = 127


def process_path(path: str, base: Path) -> Path:
    """~/ddw3's util.process_path: a leading / means the ddw3 root."""
    p = PurePosixPath(path)
    return DDW3.joinpath(*p.parts[1:]) if path.startswith("/") else base.joinpath(*p.parts)


def config_of(built: Path) -> Path:
    """A path under build/ names a .toml beside the source it is built from.
    Only the ddw3 tree's own build/ is dropped: the tree itself may live under
    a directory called build."""
    try:
        rel = built.relative_to(DDW3 / "build")
    except ValueError:
        return built.with_suffix(".toml")
    return (DDW3 / rel).with_suffix(".toml")


def parse_entry(entry: str):
    """One map entry -> (tile image path, layers), or (None, []) for an empty
    tile. Follows rlen wrappers exactly as ddw3's stitcher does."""
    if "map-tile/empty" in entry:
        return None, []
    return parse_tile(process_path(entry, DDW3))


def parse_tile(built: Path):
    cfg_path = config_of(built)
    cfg = tomllib.loads(cfg_path.read_text(encoding="utf-8"))
    if "src" in cfg:                                   # an rlen wrapper
        return parse_tile(process_path(cfg["src"], cfg_path.parent))
    tim_cfg_path = config_of(process_path(cfg["img"], cfg_path.parent))
    tim_cfg = tomllib.loads(tim_cfg_path.read_text(encoding="utf-8"))
    img = process_path(tim_cfg["img"]["path"], tim_cfg_path.parent)
    layers = [[(o["world_offset"], o["img_offset"], o["size"]) for o in layer["objs"]]
              for layer in cfg["layers"]]
    return img, layers


def solidify(tile: Image.Image) -> tuple[Image.Image, int]:
    """Make every half-alpha texel opaque. Returns the tile and how many."""
    alpha = tile.getchannel("A")
    n = alpha.histogram()[HALF]
    if n:
        tile.putalpha(alpha.point(lambda v: 255 if v == HALF else v))
    return tile, n


def stitch(stage: str, solid: bool, order: tuple | None = None):
    """Flatten one stage's map tiles.

    `order` picks the layer draw order; the default follows the config, which
    is what ddw3's stitcher does. tools/repair_map_layer_order.py passes the
    console's depth order instead."""
    cfg = tomllib.loads((DDW3 / f"map/dw2003/z_stage/{stage}pack.toml")
                        .read_text(encoding="utf-8"))
    w, h = cfg["width"], cfg["height"]
    out = Image.new("RGBA", (128 * w, 128 * h))
    texels = 0
    for idx, entry in enumerate(cfg["entries"]):
        img_path, layers = parse_entry(entry)
        if img_path is None:
            continue
        tile = Image.open(img_path).convert("RGBA")
        if solid:
            tile, n = solidify(tile)
            texels += n
        ox, oy = 128 * (idx % w), 128 * (idx // w)
        indices = range(len(layers)) if order is None else order
        for layer_index in indices:
            if layer_index >= len(layers):
                continue
            for world, off, size in layers[layer_index]:
                crop = tile.crop((off[0], off[1], off[0] + size[0], off[1] + size[1]))
                out.alpha_composite(crop, (ox + world[0], oy + world[1]))
    return out, texels


def affected_stages() -> list:
    """Every shipped base map that still holds a half-transparent pixel."""
    out = []
    for p in sorted(MAPS.glob("s*.png")):
        if p.stem.endswith("_fg"):
            continue
        if not (DDW3 / f"map/dw2003/z_stage/{p.stem}pack.toml").exists():
            continue
        hist = Image.open(p).convert("RGBA").getchannel("A").histogram()
        if sum(hist[1:255]):
            out.append(p.stem)
    return out


def differing(a: Image.Image, b: Image.Image) -> int:
    if a.size != b.size:
        return -1
    pa, pb = a.tobytes(), b.tobytes()
    return sum(1 for i in range(0, len(pa), 4) if pa[i:i + 4] != pb[i:i + 4])


def patch(shipped: Image.Image, faithful: Image.Image, solid: Image.Image):
    """Write into the shipped map every pixel the fix changes, and only those.

    Splits them so the report can separate the two failures: a pixel that was
    left half transparent, and a pixel the half-alpha texel blended into
    instead of covering."""
    if not (shipped.size == faithful.size == solid.size):
        raise SystemExit(f"size mismatch: shipped {shipped.size}, stitch {faithful.size}")
    dst, ref, src = shipped.load(), faithful.load(), solid.load()
    w, h = shipped.size
    was_half = covered = 0
    for y in range(h):
        for x in range(w):
            if ref[x, y] == src[x, y]:
                continue
            if 0 < ref[x, y][3] < 255:
                was_half += 1
            else:
                covered += 1
            dst[x, y] = src[x, y]
    return was_half, covered


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("stages", nargs="*", help="stage ids; default every affected map")
    ap.add_argument("--verify", action="store_true",
                    help="re-stitch WITHOUT the fix and require the shipped map back")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    stages = args.stages or affected_stages()
    if not stages:
        print("no stage still holds a half-transparent pixel")
        return 0

    bad = 0
    for stage in stages:
        shipped_path = MAPS / f"{stage}.png"
        shipped = Image.open(shipped_path).convert("RGBA")
        if args.verify:
            faithful, _ = stitch(stage, solid=False)
            n = differing(faithful, shipped)
            print(f"{stage}: faithful re-stitch differs from the shipped map in "
                  f"{n} pixel(s)" + ("  OK" if n == 0 else "  MISMATCH"))
            bad += n != 0
            continue

        faithful, _ = stitch(stage, solid=False)
        solid, texels = stitch(stage, solid=True)
        was_half, covered = patch(shipped, faithful, solid)
        print(f"{stage}: {texels} flagged texel(s) drawn solid -> "
              f"{was_half + covered} map pixel(s) change "
              f"({was_half} were half transparent, {covered} were darkened by a "
              f"blend that should have covered them)"
              + ("  [dry run]" if args.dry_run else ""))
        if not args.dry_run and (was_half or covered):
            shipped.save(shipped_path)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
