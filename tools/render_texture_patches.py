#!/usr/bin/env python3
"""Show and audit what an smdldata animated-texture patch actually depicts.

A pool entry (claim `smdldata-pool-slot-is-the-per-model-animated-texture-patch-list-2026-08-18`)
gives a destination rectangle on the fighter's texture strip and three source
rectangles to blit into it. The code proves the geometry and the timing; it says
nothing about the picture. This resolves the pictures from the model's own raw
4bpp page and renders them, so the content can be looked at rather than guessed.

Coordinates in the record are in VRAM 16-bit units against a 64 x 256 strip; the
baked page is 256 x 256 texels at 4bpp, so one unit is exactly four texels and
`texel_x = vram_x * 4`, `texel_y = vram_y`.

All four rectangles are resolved through the palette that covers the DESTINATION,
because a VRAM copy moves raw indices and the copied pixels are displayed through
whatever CLUT the destination's faces use. Baking each rectangle through its own
covering palette would be wrong, and the spare source regions are usually covered
by no face at all.

    # look at one model's patches (destination, then variants 0, 1, 2)
    .venv/bin/python3 tools/render_texture_patches.py m003agum --out /tmp/agumon.png

    # measure the variant relationship over every model that has a patch
    .venv/bin/python3 tools/render_texture_patches.py --audit
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_clut_texture import (H, W, is_mesh_bin, load_page,  # noqa: E402
                               palette, rasterize, walk_faces)

REPO = Path(__file__).resolve().parent.parent
PACK = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack/dw2003/fight/model"
PLACEMENT = REPO / "web/assets/battle/model_placement.json"
UNITS_PER_VRAM_X = 4


def model_folders() -> dict[str, str]:
    """Model number -> pack folder, the same numeric prefix the record key uses."""
    found: dict[str, str] = {}
    for name in sorted(os.listdir(PACK)):
        if name.endswith(".toml") or not name.startswith("m") or not name[1:4].isdigit():
            continue
        found.setdefault(str(int(name[1:4])), name)
    return found


def texel_indices(folder: Path) -> list[int]:
    page = load_page(str(folder))
    out: list[int] = []
    for byte in page[:W * H // 2]:
        out.append(byte & 0xF)
        out.append(byte >> 4)
    return out


def covering_palettes(folder: Path):
    """(texel -> palette key, palette key -> 16 RGBA), from the model's own faces."""
    page = load_page(str(folder))
    pals: dict[tuple[int, int], list] = {}
    texel_pal: dict[tuple[int, int], tuple[int, int]] = {}
    for path in sorted(glob.glob(str(folder) + "/*.bin"),
                       key=lambda x: int(os.path.splitext(os.path.basename(x))[0])):
        data = open(path, "rb").read()
        if not is_mesh_bin(data):
            continue
        head = struct.unpack_from("<6I", data, 0)
        count = struct.unpack_from("<I", data, 0x18)[0]
        if count == 0 or count > 10000:
            continue
        for pal, tri in walk_faces(data, head[2], len(data) - head[2], count):
            if pal not in pals:
                pals[pal] = palette(page, pal[0], pal[1])
            for texel in rasterize(tri):
                texel_pal[texel] = pal
    return texel_pal, pals


def rect_indices(idx: list[int], vx: int, vy: int, vw: int, vh: int) -> list[int]:
    x0 = vx * UNITS_PER_VRAM_X
    return [idx[(vy + y) * W + x0 + x] for y in range(vh) for x in range(vw * UNITS_PER_VRAM_X)]


def render(name: str, out: Path, scale: int = 6) -> None:
    from PIL import Image

    key = str(int(name[1:4]))
    row = json.loads(PLACEMENT.read_text())["models"].get(key)
    if not row or not row["texture_anim"]:
        raise SystemExit(f"{name}: no animated texture patch")
    folder = PACK / name
    idx = texel_indices(folder)
    texel_pal, pals = covering_palettes(folder)

    def crop(pal, vx, vy, vw, vh):
        img = Image.new("RGBA", (vw * UNITS_PER_VRAM_X, vh))
        px = img.load()
        for y in range(vh):
            for x in range(vw * UNITS_PER_VRAM_X):
                px[x, y] = pal[idx[(vy + y) * W + vx * UNITS_PER_VRAM_X + x]]
        return img

    tiles = []
    for entry in row["texture_anim"]:
        dx, dy = entry["dst"]
        ew, eh = entry["size"]
        votes = collections.Counter(
            texel_pal[(x, y)]
            for y in range(dy, dy + eh)
            for x in range(dx * UNITS_PER_VRAM_X, (dx + ew) * UNITS_PER_VRAM_X)
            if (x, y) in texel_pal)
        pal = pals[votes.most_common(1)[0][0]] if votes else next(iter(pals.values()))
        tiles.append([crop(pal, dx, dy, ew, eh)]
                     + [crop(pal, sx, sy, ew, eh) for sx, sy in entry["src"]])

    cell_w = max(t.width for r in tiles for t in r) * scale
    cell_h = max(t.height for r in tiles for t in r) * scale
    sheet = Image.new("RGBA", (cell_w * 4 + 30, (cell_h + 8) * len(tiles)), (40, 40, 48, 255))
    for r, row_tiles in enumerate(tiles):
        for c, tile in enumerate(row_tiles):
            sheet.paste(tile.resize((tile.width * scale, tile.height * scale), Image.NEAREST),
                        (c * (cell_w + 10), r * (cell_h + 8)))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"{out}: {len(tiles)} patch(es), destination then variants 0, 1, 2")


def audit() -> None:
    """Two population facts the pictures should satisfy if the reading is right."""
    models = json.loads(PLACEMENT.read_text())["models"]
    folders = model_folders()
    blink, cycle, unreadable = [], [], 0
    for key, row in models.items():
        if not row["texture_anim"]:
            continue
        folder = folders.get(key)
        if not folder:
            unreadable += 1
            continue
        try:
            idx = texel_indices(PACK / folder)
        except SystemExit:
            unreadable += 1
            continue
        for entry in row["texture_anim"]:
            dx, dy = entry["dst"]
            ew, eh = entry["size"]
            dst = rect_indices(idx, dx, dy, ew, eh)
            var = [rect_indices(idx, sx, sy, ew, eh) for sx, sy in entry["src"]]
            size = len(dst)

            def diff(a, b):
                return sum(1 for i, j in zip(a, b) if i != j) / size

            record = (folder, diff(dst, var[0]), diff(var[0], var[1]), diff(var[0], var[2]))
            (blink if entry["slot"] < 2 else cycle).append(record)

    for tag, rows in (("slots 0/1 (blink timer)", blink), ("slots 2+ (free cycle)", cycle)):
        if not rows:
            continue
        rest = sum(1 for r in rows if r[1] == 0)
        closer = sum(1 for r in rows if r[2] < r[3] - 1e-9)
        tied = sum(1 for r in rows if abs(r[2] - r[3]) < 1e-9)
        print(f"{tag}: n={len(rows)}  destination == variant 0: {rest} "
              f"({100 * rest / len(rows):.0f}%)  variant 1 nearer variant 0 than variant 2 is: "
              f"{closer} ({100 * closer / len(rows):.0f}%), tied {tied}, "
              f"inverted {len(rows) - closer - tied}")
    print(f"models with no readable pack: {unreadable}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", nargs="?", help="pack folder name, e.g. m003agum")
    parser.add_argument("--out", type=Path, default=Path("/tmp/texture-patches.png"))
    parser.add_argument("--audit", action="store_true")
    args = parser.parse_args()
    if args.audit or not args.model:
        audit()
    else:
        render(args.model, args.out)


if __name__ == "__main__":
    main()
