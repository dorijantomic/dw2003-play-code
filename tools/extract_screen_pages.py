#!/usr/bin/env python3
"""Bake the animated wall-screen texture pages a stage's quad builder reads.

wstag780's screen-content driver (F0x800a72b0) walks per-screen sequence
tables and calls F0x800a6fbc, which builds 40 textured quads from the position
records at 0x800A8A50 and the texture-entry table at 0x800A8520. Each 0x10-byte
entry packs a GPU texpage word (page address + 4bpp mode + ABR) and a CLUT word
(cba: palette x/y). The pages themselves are the stage's MASK art (verified
byte-equal against the live VRAM dump for every palette this table uses), so
the screens are extractable from the disc like every other sprite.

This tool emits, for each distinct (texpage, clut) the table references:

    web/assets/effects/s<stage>_screens.png   stacked page images (RGBA)
    web/assets/data/s<stage>_screens.json     "${texpage}:${clut}" -> sheet rect

and the web renderer (web/effects.js drawNativeIntents) maps each captured
quad's page/CLUT pair to its rect and draws it with the quad's own affine
mapping. Fail-soft per table entry: an entry whose page/palette falls outside
the MASK VRAM region is skipped, never guessed.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import struct
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract_point_sprites as eps

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT_SHEETS = REPO / "web/assets/effects"
OUT_DATA = REPO / "web/assets/data"

# The quad-builder texture table, per stage (from the builder disassembly:
# `lui 0x800b; addiu -0x7ae0`). s780 is the only stage with a screen-content
# driver so far; add addresses as other stages are found.
TABLES = {780: 0x800A8520}
ENTRY_STRIDE = 0x10
MAX_ENTRIES = 256
# The MASK uploads at VRAM (320, 256), three 64-halfword columns wide, 256 rows
# tall. A texture page must lie inside that region to be cut from the disc.
MASK_X0, MASK_HW, MASK_Y0, MASK_ROWS = 320, 192, 256, 256


def texpage_xy(word: int) -> tuple[int, int, int, int]:
    """(page_x_hw, page_y, depth, abr) from a GPU texpage register word."""
    return (word & 0xF) * 64, ((word >> 4) & 1) * 256, (word >> 7) & 3, (word >> 5) & 3


def clut_xy(word: int) -> tuple[int, int]:
    """(palette_x_hw, palette_y) from a CLUT (cba) register word."""
    return (word & 0x3F) * 16, (word >> 6) & 0x1FF


def read_hw(atlas: "eps.MaskAtlas", hw: int, row: int) -> int | None:
    """Raw 16bpp halfword at VRAM (320+hw, 256+row)."""
    if hw < 0 or hw >= MASK_HW or row < 0 or row >= MASK_ROWS:
        return None
    col, lhw = hw // 64, hw % 64
    src = atlas.cols[col]
    if row * 128 + lhw * 2 + 2 > len(src):
        return None
    return struct.unpack_from("<H", src, row * 128 + lhw * 2)[0]


def bake_page(atlas: "eps.MaskAtlas", tpage: int, clut: int) -> Image.Image | None:
    px, py, depth, _abr = texpage_xy(tpage)
    cx, cy = clut_xy(clut)
    if depth != 0:
        return None  # only 4bpp pages appear in this table; never guess others
    width, height = 256, 256
    if px < MASK_X0 or px + 64 > MASK_X0 + MASK_HW or py != MASK_Y0:
        return None
    pal = [read_hw(atlas, cx + i - MASK_X0, cy - MASK_Y0) for i in range(16)]
    if any(p is None for p in pal):
        return None
    im = Image.new("RGBA", (width, height))
    for v in range(height):
        for u in range(width):
            hw = px + u // 4
            idx = read_hw(atlas, hw - MASK_X0, py - MASK_Y0 + v)
            if idx is None:
                continue
            c = pal[(idx >> (4 * (u % 4))) & 0xF]
            if c:
                im.putpixel((u, v), ((c & 31) << 3, ((c >> 5) & 31) << 3,
                                     ((c >> 10) & 31) << 3, 255))
    return im


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stage", type=int, default=780)
    ap.add_argument("--table", type=lambda s: int(s, 0), default=None)
    args = ap.parse_args()

    stage = args.stage
    table = args.table if args.table is not None else TABLES.get(stage)
    if table is None:
        print(f"stage {stage}: no quad-builder texture table known; nothing to do")
        return 0

    disc = eps.Disc(eps.DISC)
    path = eps.ASM / f"wstag{stage}.s"
    words = eps.ovs.load_words(path)
    buf = bytearray(max(words) + 4)
    for off, w in words.items():
        struct.pack_into("<I", buf, off, w)

    stores = eps.descriptor_stores(path)
    mask = sorted(set(stores.get(0x1C, [])))
    if not mask:
        print(f"stage {stage}: no MASK descriptor store", file=sys.stderr)
        return 0
    atlas = eps.MaskAtlas(disc.file(mask[0]))

    base = eps.WSTAG_BASE
    combos: dict[tuple[int, int], Image.Image] = {}
    skipped = 0
    for i in range(MAX_ENTRIES):
        off = table + i * ENTRY_STRIDE
        idx = off - base
        if idx < 0 or idx + ENTRY_STRIDE > len(buf):
            break
        e = buf[idx:idx + ENTRY_STRIDE]
        unk0, unk2, unk4, unk6, unk8, unkA, unkC, unkE = struct.unpack("<8H", e)
        if not any((unk0, unk2, unk4, unk6, unk8, unkA, unkC, unkE)):
            break
        clut = ((unkE << 6) | ((unkC >> 4) & 0x3F)) & 0xFFFF
        tpage = ((((unk2 & 0x100) << 16) >> 20)
                 | ((unk0 & 0x3FF) >> 6)
                 | ((unk2 & 0x200) * 4)) & 0xFFFF
        key = (tpage, clut)
        if key in combos:
            continue
        page = bake_page(atlas, tpage, clut)
        if page is None:
            skipped += 1
            print(f"  entry {i}: tpage={tpage:#06x} clut={clut:#06x} outside the MASK; skipped")
            continue
        combos[key] = page

    if not combos:
        print(f"stage {stage}: no bakeable screen pages", file=sys.stderr)
        return 0

    sheet = Image.new("RGBA", (256, 256 * len(combos)))
    rects: dict[str, dict] = {}
    y = 0
    for (tpage, clut), page in combos.items():
        sheet.paste(page, (0, y))
        px, py, depth, abr = texpage_xy(tpage)
        cx, cy = clut_xy(clut)
        rects[f"{tpage}:{clut}"] = {
            "x": 0, "y": y, "w": 256, "h": 256,
            "page": [px, py], "depth": depth, "abr": abr,
            "palette": [cx, cy],
        }
        y += 256

    OUT_SHEETS.mkdir(parents=True, exist_ok=True)
    OUT_DATA.mkdir(parents=True, exist_ok=True)
    png = OUT_SHEETS / f"s{stage}_screens.png"
    out = OUT_DATA / f"s{stage}_screens.json"
    sheet.save(png)
    out.write_text(json.dumps({"stage": f"s{stage}", "sheet": png.name,
                               "entry_table": hex(table), "combos": rects},
                              indent=1) + "\n")
    print(f"screen pages: {len(combos)} combos ({skipped} entries outside the MASK) "
          f"-> {png.name}, {out.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
