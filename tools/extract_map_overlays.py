"""
Builds per-stage FOREGROUND overlay PNGs from the map-tile layer data.

The game's map tiles are 3-layered (ddw3 `map-tile` configs: `Config{img,
layers[]}`, each layer = objs of {world_offset, img_offset, size}). Layer 0 is
the 128x128 ground art; layer 1 is the foreground drawn OVER sprites (pipes,
poles, canopies, lamp posts — stored in the tile TIM at img_offset.x >= 128).
Layer 2 is NOT over-sprites (verified 2026-07-04 on s200 = ground pavement
patches, s276 = a whole interior scene block that hid the player). It draws
BEHIND the ground — depth 11 against the ground's 7, confirmed at the console
2026-08-21 — so it stays flattened in the base map, UNDER layer 0;
tools/repair_map_layer_order.py puts it there. ddw3's stitch-map.py flattens
every layer into web/assets/maps/sNNN.png, which is why the player used to draw on top of the
s350 pipes. This tool re-walks the same tile configs and composites ONLY
layer 1 onto a transparent map-sized canvas:

  web/assets/maps/sNNN_fg.png            (only when a stage has any fg pixels)
  web/assets/data/map_overlays.json      {stageId: true} index for the renderer

See docs/todo/2026-07-04-map-foreground-overlay-layer.md and
docs/research/field/map-foreground-overlay (research doc) for the decode.

Run: uv run --with pillow python tools/extract_map_overlays.py         (all)
     uv run --with pillow python tools/extract_map_overlays.py s350    (some)
"""

import os
import json
import sys
import tomllib
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from restitch_map_stp import solidify  # noqa: E402

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
MAP_TOML_DIR = DDW3 / "map/dw2003/z_stage"
TILE_CFG_DIR = DDW3 / "map-tile/dw2003/z_stage"
TILE_PNG_DIR = DDW3 / "tim/dw2003/z_stage"
ROOT = Path(__file__).resolve().parent.parent
OUT_MAPS = ROOT / "web/assets/maps"
OUT_INDEX = ROOT / "web/assets/data/map_overlays.json"


def stage_overlay(stage):
    """Compose the layer>=1 overlay for one stage. Returns (Image, objCount)
    or (None, 0) when the stage has no foreground objects."""
    map_toml = MAP_TOML_DIR / f"{stage}pack.toml"
    if not map_toml.exists():
        return None, 0
    cfg = tomllib.loads(map_toml.read_text())
    gw, gh = cfg["width"], cfg["height"]
    canvas = None
    count = 0
    for idx, entry in enumerate(cfg["entries"]):
        # rlen-wrapped and direct entries both resolve to the same map-tile
        # config; "map-tile/empty.bin" entries have none (skip).
        tile_toml = TILE_CFG_DIR / f"{stage}pack" / f"{idx}.toml"
        if not tile_toml.exists():
            continue
        tile_cfg = tomllib.loads(tile_toml.read_text())
        fg_objs = [o for layer in tile_cfg["layers"][1:2]
                   for o in layer.get("objs", [])]
        if not fg_objs:
            continue
        tile_png = TILE_PNG_DIR / f"{stage}pack" / f"{idx}.png"
        if not tile_png.exists():
            print(f"  {stage} tile {idx}: config has fg objs but png missing")
            continue
        if canvas is None:
            canvas = Image.new("RGBA", (gw * 128, gh * 128))
        tx, ty = (idx % gw) * 128, (idx // gw) * 128
        # A texel flagged semi-transparent is drawn SOLID on the console: the
        # field emits every map-tile layer object as an opaque sprite (see
        # docs/research/field/map-tile-draw-semitransparency-2026-08-20.md).
        # It matters more here than in the base map, because this layer draws
        # OVER the player -- left at half alpha the player shows through it.
        tile_img, _ = solidify(Image.open(tile_png).convert("RGBA"))
        for o in fg_objs:
            ox, oy = o["img_offset"]
            w, h = o["size"]
            piece = tile_img.crop((ox, oy, ox + w, oy + h))
            canvas.alpha_composite(piece, (tx + o["world_offset"][0],
                                           ty + o["world_offset"][1]))
            count += 1
    if canvas is not None and not canvas.getbbox():
        return None, 0  # objs existed but were fully transparent
    return canvas, count


def main():
    manifest = json.loads((ROOT / "web/assets/manifest.json").read_text())
    wanted = {s if s.startswith("s") else f"s{s}" for s in sys.argv[1:]}
    index = json.loads(OUT_INDEX.read_text()) if OUT_INDEX.exists() else {}
    done = objs = 0
    for m in manifest["maps"]:
        sid = m["id"]
        if wanted and sid not in wanted:
            continue
        img, n = stage_overlay(sid)
        out = OUT_MAPS / f"{sid}_fg.png"
        if img is None:
            index.pop(sid, None)
            out.unlink(missing_ok=True)
            continue
        img.save(out, optimize=True)
        index[sid] = True
        done += 1
        objs += n
    OUT_INDEX.parent.mkdir(parents=True, exist_ok=True)
    OUT_INDEX.write_text(json.dumps(dict(sorted(index.items())), indent=0))
    print(f"wrote {done} foreground overlays ({objs} layer>=1 objects); "
          f"index: {OUT_INDEX.name} ({len(index)} stages)")


if __name__ == "__main__":
    main()
