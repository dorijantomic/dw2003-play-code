#!/usr/bin/env python3
"""Paint each model's animated-texture patch variants into its baked texture page.

`bake_clut_texture.py` resolves a texel through the palette of the face that covers
it, so texels no face covers come out transparent. The spare rectangles that hold a
Digimon's blink frames are exactly that: nothing on the model samples them, because
the game copies them over the eye at run time. The baked page therefore ships with
the eye variants missing, and nothing can animate.

This restores them. For every entry of every record's animated-texture list (claim
`smdldata-pool-slot-is-the-per-model-animated-texture-patch-list-2026-08-18`) it
finds the CLUT the DESTINATION rectangle was baked with -- the majority CLUT of the
faces covering it, resolved through the same face walk the baker itself uses, so the
two cannot drift -- and paints the three source rectangles with it. That is the
palette the copied pixels are displayed through on hardware, since a VRAM copy moves
raw indices and the destination's faces supply the CLUT.

The destination rectangle is deliberately left alone: the game caches the last
variant as 0 and only re-blits on a change, so the page as authored is what a player
sees until the first blink.

    .venv/bin/python3 tools/bake_texture_patches.py            # every model
    .venv/bin/python3 tools/bake_texture_patches.py m003agum   # just one
    .venv/bin/python3 tools/bake_texture_patches.py --verify    # check, change nothing

`--verify` re-reads the shipped pages and fails if any source rectangle is still
blank, which is the state the renderer cannot animate out of. A full write pass runs
that same check on its own result, so the `texture_patches` build stage fails rather
than reporting OK over pages the renderer cannot animate.
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_clut_texture import W  # noqa: E402
from render_texture_patches import (PACK, PLACEMENT, UNITS_PER_VRAM_X,  # noqa: E402
                                    covering_palettes, model_folders, texel_indices)

REPO = Path(__file__).resolve().parent.parent
TEX_DIR = REPO / "web/assets/battle/textures"
def find_palette(texel_pal, pals, vx: int, vy: int, vw: int, vh: int):
    """The CLUT of the faces covering the destination, by majority."""
    votes = collections.Counter(
        texel_pal[(x, y)]
        for y in range(vy, vy + vh)
        for x in range(vx * UNITS_PER_VRAM_X, (vx + vw) * UNITS_PER_VRAM_X)
        if (x, y) in texel_pal)
    return pals[votes.most_common(1)[0][0]] if votes else None


def patch_model(folder: str, entries: list[dict]) -> tuple[int, int]:
    from PIL import Image

    png = TEX_DIR / f"{folder}.png"
    if not png.exists():
        return 0, len(entries)
    idx = texel_indices(PACK / folder)
    texel_pal, pals = covering_palettes(PACK / folder)
    img = Image.open(png).convert("RGBA")
    px = img.load()
    done = skipped = 0
    for entry in entries:
        dx, dy = entry["dst"]
        vw, vh = entry["size"]
        pal = find_palette(texel_pal, pals, dx, dy, vw, vh)
        if pal is None:
            skipped += 1
            continue
        for sx, sy in entry["src"]:
            for y in range(vh):
                for x in range(vw * UNITS_PER_VRAM_X):
                    tx, ty = sx * UNITS_PER_VRAM_X + x, sy + y
                    px[tx, ty] = pal[idx[ty * W + tx]]
        done += 1
    if done:
        img.save(png)
    return done, skipped


def verify() -> int:
    """Every source rectangle of every shipped page must hold pixels."""
    from PIL import Image

    models = json.loads(PLACEMENT.read_text())["models"]
    folders = model_folders()
    blank, checked = [], 0
    for key, row in sorted(models.items(), key=lambda kv: int(kv[0])):
        folder = folders.get(key)
        png = TEX_DIR / f"{folder}.png" if folder else None
        if not row["texture_anim"] or not png or not png.exists():
            continue
        img = Image.open(png).convert("RGBA")
        px = img.load()
        scale = img.width // W
        for entry in row["texture_anim"]:
            vw, vh = entry["size"]
            for variant, (sx, sy) in enumerate(entry["src"]):
                checked += 1
                opaque = sum(
                    1
                    for y in range(vh * scale)
                    for x in range(vw * UNITS_PER_VRAM_X * scale)
                    if px[sx * UNITS_PER_VRAM_X * scale + x, sy * scale + y][3])
                if opaque == 0:
                    blank.append(f"{folder} slot {entry['slot']} variant {variant}")
    print(f"verified {checked} source rectangles; {len(blank)} blank")
    for name in blank[:10]:
        print(f"  blank: {name}")
    return 1 if blank else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("models", nargs="*", help="pack folder names; default is all")
    parser.add_argument("--verify", action="store_true",
                        help="check the shipped pages instead of writing them")
    args = parser.parse_args()
    if args.verify:
        raise SystemExit(verify())

    models = json.loads(PLACEMENT.read_text())["models"]
    folders = model_folders()
    wanted = set(args.models)
    painted = entries = skipped = missing = 0
    for key, row in sorted(models.items(), key=lambda kv: int(kv[0])):
        folder = folders.get(key)
        if not row["texture_anim"] or not folder or (wanted and folder not in wanted):
            continue
        try:
            done, miss = patch_model(folder, row["texture_anim"])
        except SystemExit:
            missing += 1
            continue
        entries += done
        skipped += miss
        painted += 1 if done else 0
    print(f"{TEX_DIR}: painted {entries} patch(es) into {painted} texture page(s); "
          f"{skipped} without a resolvable palette, {missing} without a readable pack")
    if not wanted:
        # A full pass that painted nothing means the pages this stage edits are not
        # there yet -- run the model build first. Say so instead of reporting success.
        if painted == 0:
            raise SystemExit(f"{TEX_DIR}: no texture page was painted; "
                             "build the fight_models stage first")
        # The pages are only useful to the renderer if every source rectangle holds
        # pixels, so the write pass checks its own result before it reports OK.
        raise SystemExit(verify())


if __name__ == "__main__":
    main()
