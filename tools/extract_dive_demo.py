#!/usr/bin/env python3
"""Extract the Digi-Egg dive-transition demo packs (SSUBDEMO / SDIGDEMO).

These two stage packs drive the full-screen animation played when the player
uses a Digi-Egg to leave the walkable field:

  ssubdemo  archive id 0x88c (2188)  Submarimon -> dive into water / seabed
  sdigdemo  archive id 0x88d (2189)  Digmon    -> burrow into a hole

Both use the sprite-directory + RLEN-atlas format already decoded for
FIELDCOM (docs/research/ui/fieldcom-sprite-directory-decoded-2026-07-02.md),
with the ddw3 pack extractor having split the file's sub-entries into
`0.bin` (the sprite directory) and `1.bin` (the texture container):

  0.bin  directory: { u32 frames_off; u32 ids_off; u32 clip_off[n_ids] }
         ids:   byte table at ids_off, 0xff-terminated; the true id count is
                bounded by (frames_off - 8) / 4.
         clip:  u16 layer_count; u16 clut_y_add; s16 semi (-1 = opaque, else
                ABR mode); layer_count x { u16 frame_idx; s16 dx; s16 dy },
                composited back-to-front.
         frame: 14B { u16 u, v, w, h, clut_x_off, clut_y_off, flags }
                flags bit0: 0 = 4bpp, 1 = 8bpp.

  1.bin  u32 offset table, null-terminated (count bounded by first_off/4).
         Each non-null offset points at an `RLEN`-compressed blob whose
         payload is a standard PS1 TIM. Every page here is a 64 halfword x
         256 row VRAM rect; pages are laid out left-to-right in table order,
         so the pack's atlas is 64*n_pages halfwords wide.

CLUT resolution (asserted, not guessed):
  * page 0 additionally carries a TIM CLUT block of 256 entries at dy=480.
    The atlas itself is resident at VRAM y=224, so VRAM row 480 is exactly
    atlas-local row 256 -- which is the clut_y_off every 8bpp frame carries.
    8bpp frames therefore palette from that block.
  * 4bpp frames carry clut_y_off 255 = the atlas's own bottom row, the same
    "CLUTs live in the atlas's bottom rows" convention as FIELDCOM, at
    halfword column clut_x_off.

Semi-transparency: as in FIELDCOM, ABE is per primitive (clip.semi != -1) but
the GPU blends per TEXEL -- only texels whose CLUT entry has the STP bit
(0x8000) set go through the blend. Every frame is therefore cut twice on one
shared sheet layout: an opaque sheet and a `_semi` sheet.

Output (web/assets/effects/dive/):
  ssubdemo.png / ssubdemo_semi.png
  sdigdemo.png / sdigdemo_semi.png
  dive_demo.json  -- per-id clips with sheet rects, layer dx/dy and semi.

Optional: --contact DIR writes a labelled contact sheet of every clip
composited on a 320x240 screen canvas, for eyeballing the artwork.
"""

import os
import argparse
import json
import struct
import sys
from pathlib import Path

from PIL import Image

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
STAGE_DIR = DDW3 / "pack/dw2003/field/stage"
REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "web/assets/effects/dive"

# {pack name: archive id} -- the two Digi-Egg field-exit demos.
PACKS = {"ssubdemo": 0x88C, "sdigdemo": 0x88D}

PAGE_W_HW = 64      # every TIM page in these packs is a 64hw x 256 VRAM rect
PAGE_H = 256
ATLAS_VRAM_Y = 224  # page origin row; makes the dy=480 CLUT block atlas row 256
CLUT8_ROW = 256     # clut_y_off used by 8bpp frames -> the TIM CLUT block
CLUT4_ROW = 255     # clut_y_off used by 4bpp frames -> atlas bottom row
SHEET_W = 256
SCREEN_W, SCREEN_H = 320, 240


def unrlen(blob: bytes) -> bytes:
    """RLEN RLE: op<0x80 = copy op literal bytes; op>=0x80 = repeat next byte op-0x80 times."""
    if blob[:4] != b"RLEN":
        raise ValueError(f"bad RLEN magic: {blob[:4]!r}")
    total = struct.unpack_from("<I", blob, 4)[0]
    out = bytearray()
    i = 8
    while len(out) < total:
        op = blob[i]
        i += 1
        if op < 0x80:
            out += blob[i : i + op]
            i += op
        else:
            out += bytes([blob[i]]) * (op - 0x80)
            i += 1
    if len(out) != total:
        raise ValueError(f"RLEN overrun: {len(out)} != {total}")
    return bytes(out)


def parse_tim(d: bytes) -> dict:
    """Parse a PS1 TIM. Returns {bpp_code, clut, clut_rect, w, h, pixels}."""
    magic, flags = struct.unpack_from("<II", d, 0)
    if magic != 0x10:
        raise ValueError(f"bad TIM magic {magic:#x}")
    if flags & ~0xF:
        raise ValueError(f"unexpected TIM flag bits {flags:#x}")
    p = 8
    clut = None
    clut_rect = None
    if flags & 8:
        bnum, dx, dy, w, h = struct.unpack_from("<IHHHH", d, p)
        clut = d[p + 12 : p + bnum]
        clut_rect = (dx, dy, w, h)
        if len(clut) != w * h * 2:
            raise ValueError(f"CLUT block size {len(clut)} != {w}x{h} halfwords")
        p += bnum
    bnum, dx, dy, w, h = struct.unpack_from("<IHHHH", d, p)
    pixels = d[p + 12 : p + bnum]
    if len(pixels) != w * h * 2:
        raise ValueError(f"image block size {len(pixels)} != {w}x{h} halfwords")
    if p + bnum != len(d):
        raise ValueError(f"trailing TIM bytes: {len(d) - (p + bnum)}")
    return {"bpp": flags & 3, "clut": clut, "clut_rect": clut_rect,
            "rect": (dx, dy, w, h), "pixels": pixels}


def load_atlas(pack: str) -> tuple:
    """Build the pack's VRAM atlas (halfword rows) and its 256-entry 8bpp CLUT.

    Returns (atlas bytes, width in halfwords, clut8 bytes, n_pages).
    """
    d = (STAGE_DIR / pack / "1.bin").read_bytes()
    first = struct.unpack_from("<I", d, 0)[0]
    if first == 0 or first % 4:
        raise ValueError(f"{pack}/1.bin: bad offset-table head {first:#x}")
    slots = struct.unpack_from(f"<{first // 4}I", d, 0)
    offs = []
    for o in slots:
        if o == 0:  # null terminator slot
            break
        offs.append(o)
    if not offs:
        raise ValueError(f"{pack}/1.bin: no texture pages")
    if any(o for o in slots[len(offs):]):
        raise ValueError(f"{pack}/1.bin: non-null offset after terminator: {slots}")

    pages = [parse_tim(unrlen(d[o:])) for o in offs]
    clut8 = None
    for pi, t in enumerate(pages):
        if t["rect"][2:] != (PAGE_W_HW, PAGE_H):
            raise ValueError(f"{pack} page {pi}: rect {t['rect']} is not 64x256")
        if t["clut"] is not None:
            if pi != 0:
                raise ValueError(f"{pack}: CLUT block on page {pi}, expected page 0")
            if t["bpp"] != 1:
                raise ValueError(f"{pack}: CLUT page bpp code {t['bpp']} != 1 (8bpp)")
            cdx, cdy, cw, ch = t["clut_rect"]
            if (cw, ch) != (256, 1):
                raise ValueError(f"{pack}: CLUT block {cw}x{ch}, expected 256x1")
            if cdy - ATLAS_VRAM_Y != CLUT8_ROW:
                raise ValueError(
                    f"{pack}: CLUT block at VRAM y={cdy}; atlas-local row "
                    f"{cdy - ATLAS_VRAM_Y} != {CLUT8_ROW}")
            clut8 = t["clut"]
        elif t["bpp"] != 2:
            raise ValueError(f"{pack} page {pi}: bpp code {t['bpp']} != 2 with no CLUT")
    if clut8 is None:
        raise ValueError(f"{pack}: no 8bpp CLUT block found")

    W = PAGE_W_HW * len(pages)
    atlas = bytearray(W * PAGE_H * 2)
    for pi, t in enumerate(pages):
        for y in range(PAGE_H):
            dst = (y * W + pi * PAGE_W_HW) * 2
            atlas[dst : dst + PAGE_W_HW * 2] = t["pixels"][y * PAGE_W_HW * 2 :
                                                           (y + 1) * PAGE_W_HW * 2]
    return bytes(atlas), W, clut8, len(pages)


def parse_directory(d: bytes) -> dict:
    """Parse the pack's sprite directory (0.bin) -> {id: clip}."""
    frames_off, ids_off = struct.unpack_from("<II", d, 0)
    if not (8 < frames_off <= ids_off <= len(d)):
        raise ValueError(f"bad directory offsets {frames_off:#x}/{ids_off:#x}")
    max_ids = (frames_off - 8) // 4
    n_frames = (ids_off - frames_off) // 14
    ids = []
    a = ids_off
    while d[a] != 0xFF and len(ids) < max_ids:
        ids.append(d[a])
        a += 1
    if len(ids) != max_ids:
        raise ValueError(f"id table has {len(ids)} ids, clip table holds {max_ids}")
    entries = {}
    for n, sid in enumerate(ids):
        clip_off = struct.unpack_from("<I", d, 8 + n * 4)[0]
        if not (ids_off <= clip_off < len(d)):
            raise ValueError(f"id {sid}: clip offset {clip_off:#x} out of range")
        count, clut_y_add = struct.unpack_from("<HH", d, clip_off)
        (semi,) = struct.unpack_from("<h", d, clip_off + 4)
        if count == 0 or clip_off + 6 + count * 6 > len(d):
            raise ValueError(f"id {sid}: bad layer count {count}")
        if not (-1 <= semi <= 3):
            raise ValueError(f"id {sid}: semi {semi} outside -1..3")
        layers = []
        for k in range(count):
            fi, dx, dy = struct.unpack_from("<Hhh", d, clip_off + 6 + k * 6)
            if fi >= n_frames:
                raise ValueError(f"id {sid}: frame index {fi} >= {n_frames}")
            u, v, w, h, cx, cy, flags = struct.unpack_from("<7H", d, frames_off + fi * 14)
            if flags & ~1:
                raise ValueError(f"frame {fi}: unexpected flag bits {flags:#x}")
            layers.append({"frame": fi, "dx": dx, "dy": dy, "u": u, "v": v,
                           "w": w, "h": h, "clut_x": cx, "clut_y": cy,
                           "flags": flags})
        entries[sid] = {"clut_y_add": clut_y_add, "semi": semi, "layers": layers}
    return entries


def atlas_hw(atlas: bytes, W: int, x: int, y: int) -> int:
    return struct.unpack_from("<H", atlas, (y * W + x) * 2)[0]


def rgba(p: int) -> tuple:
    return ((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3,
            0 if p == 0 else 255)


def cut_frame(atlas: bytes, W: int, clut8: bytes, lay: dict,
              clut_y_add: int, abe: bool) -> tuple:
    """Decode one frame into (opaque, semi) images sharing the frame rect.

    Whenever the owning clip has ABE=1 the GPU splits the primitive by each
    texel's CLUT STP bit (0x8000): STP texels are blended, the rest written
    straight. With ABE=0 the hardware ignores STP and `semi` stays empty.
    """
    w, h, u, v = lay["w"], lay["h"], lay["u"], lay["v"]
    if w == 0 or h == 0:
        raise ValueError(f"frame {lay['frame']}: degenerate size {w}x{h}")
    if v + h > PAGE_H:
        raise ValueError(f"frame {lay['frame']}: v+h={v + h} past atlas row {PAGE_H}")
    if lay["flags"] & 1:  # 8bpp -> external 256-entry CLUT block
        if lay["clut_y"] != CLUT8_ROW:
            raise ValueError(f"frame {lay['frame']}: 8bpp clut_y {lay['clut_y']} "
                             f"!= {CLUT8_ROW}")
        if clut_y_add:
            raise ValueError(f"frame {lay['frame']}: 8bpp clip has clut_y_add "
                             f"{clut_y_add}; row-cycling an external CLUT is undecoded")
        if lay["clut_x"] + 256 > 256:
            raise ValueError(f"frame {lay['frame']}: 8bpp clut_x {lay['clut_x']} "
                             f"overruns the 256-entry CLUT block")
        if u + w > W * 2:
            raise ValueError(f"frame {lay['frame']}: u+w={u + w} past 8bpp width {W * 2}")
        pal = [struct.unpack_from("<H", clut8, (lay["clut_x"] + i) * 2)[0]
               for i in range(256)]
        shift, mask, per_hw = 8, 0xFF, 2
    else:  # 4bpp -> 16 entries from the atlas's own bottom row
        row = (lay["clut_y"] + clut_y_add) & 0xFF
        if row != CLUT4_ROW:
            raise ValueError(f"frame {lay['frame']}: 4bpp CLUT row {row} != {CLUT4_ROW}")
        if lay["clut_x"] + 16 > W:
            raise ValueError(f"frame {lay['frame']}: 4bpp clut_x {lay['clut_x']} "
                             f"overruns atlas width {W}")
        if u + w > W * 4:
            raise ValueError(f"frame {lay['frame']}: u+w={u + w} past 4bpp width {W * 4}")
        pal = [atlas_hw(atlas, W, lay["clut_x"] + i, row) for i in range(16)]
        shift, mask, per_hw = 4, 0xF, 4
    colors = [rgba(p) for p in pal]
    stp = [abe and bool(p & 0x8000) for p in pal]
    img = Image.new("RGBA", (w, h))
    semi = Image.new("RGBA", (w, h))
    put, put_s = img.putpixel, semi.putpixel
    for yy in range(h):
        for xx in range(w):
            t = u + xx
            half = atlas_hw(atlas, W, t // per_hw, v + yy)
            idx = (half >> ((t % per_hw) * shift)) & mask
            (put_s if stp[idx] else put)((xx, yy), colors[idx])
    return img, semi


def build_sheet(entries: dict, atlas: bytes, W: int, clut8: bytes):
    """Cut every referenced frame once and shelf-pack into two aligned sheets."""
    frames, semis = {}, {}
    for e in entries.values():
        abe = e["semi"] >= 0
        for lay in e["layers"]:
            key = (lay["frame"], e["clut_y_add"], abe)
            if key not in frames:
                frames[key], semis[key] = cut_frame(
                    atlas, W, clut8, lay, e["clut_y_add"], abe)
    keys = sorted(frames, key=lambda k: (-frames[k].height, k))
    x = y = shelf_h = 0
    pos = {}
    for k in keys:
        im = frames[k]
        if im.width > SHEET_W:
            raise ValueError(f"frame {k} is {im.width}px wide, sheet is {SHEET_W}")
        if x + im.width > SHEET_W:
            x = 0
            y += shelf_h
            shelf_h = 0
        pos[k] = (x, y)
        x += im.width
        shelf_h = max(shelf_h, im.height)
    sheet = Image.new("RGBA", (SHEET_W, y + shelf_h))
    semi_sheet = Image.new("RGBA", (SHEET_W, y + shelf_h))
    for k, (px, py) in pos.items():
        sheet.paste(frames[k], (px, py))
        semi_sheet.paste(semis[k], (px, py))
    return sheet, semi_sheet, pos


def contact_sheet(packs: dict, out: Path) -> None:
    """Composite every clip on its own 320x240 screen canvas, tiled in a grid."""
    from PIL import ImageDraw

    for name, (entries, sheet, _semi, pos) in packs.items():
        cols = 4
        rows = (len(entries) + cols - 1) // cols
        cell_w, cell_h = SCREEN_W, SCREEN_H + 12
        page = Image.new("RGBA", (cols * cell_w, rows * cell_h), (24, 24, 32, 255))
        draw = ImageDraw.Draw(page)
        for i, (sid, e) in enumerate(sorted(entries.items())):
            ox = (i % cols) * cell_w
            oy = (i // cols) * cell_h + 12
            draw.rectangle([ox, oy, ox + SCREEN_W - 1, oy + SCREEN_H - 1],
                           outline=(70, 70, 90, 255))
            draw.text((ox + 3, oy - 11),
                      f"{name} id {sid} ({len(e['layers'])} layer"
                      f"{'s' if len(e['layers']) != 1 else ''}, semi={e['semi']})",
                      fill=(210, 210, 220, 255))
            for lay in e["layers"]:
                px, py = pos[(lay["frame"], e["clut_y_add"], e["semi"] >= 0)]
                cut = sheet.crop((px, py, px + lay["w"], py + lay["h"]))
                page.alpha_composite(cut, (ox + lay["dx"], oy + lay["dy"]))
        page = page.resize((page.width * 2, page.height * 2), Image.NEAREST)
        path = out / f"contact_{name}.png"
        page.save(path)
        print(f"dive_demo: contact sheet -> {path}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--contact", metavar="DIR",
                    help="also write a labelled contact sheet per pack here")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {}
    built = {}
    for name, arch_id in PACKS.items():
        entries = parse_directory((STAGE_DIR / name / "0.bin").read_bytes())
        atlas, W, clut8, n_pages = load_atlas(name)
        sheet, semi_sheet, pos = build_sheet(entries, atlas, W, clut8)
        sheet.save(OUT_DIR / f"{name}.png")
        semi_sheet.save(OUT_DIR / f"{name}_semi.png")
        built[name] = (entries, sheet, semi_sheet, pos)

        clips = {}
        for sid, e in sorted(entries.items()):
            layers = []
            for lay in e["layers"]:
                px, py = pos[(lay["frame"], e["clut_y_add"], e["semi"] >= 0)]
                layers.append({"x": px, "y": py, "w": lay["w"], "h": lay["h"],
                               "dx": lay["dx"], "dy": lay["dy"]})
            clips[str(sid)] = {"semi": e["semi"], "layers": layers}
        n_frames = len({(lay["frame"]) for e in entries.values() for lay in e["layers"]})
        manifest[name] = {
            "archiveId": arch_id,
            "sheet": f"{name}.png",
            "semiSheet": f"{name}_semi.png",
            "sheetW": sheet.width,
            "sheetH": sheet.height,
            "atlasPages": n_pages,
            "clips": clips,
        }
        blended = [s for s, e in entries.items() if e["semi"] >= 0]
        print(f"dive_demo: {name} id={arch_id:#x} {len(entries)} ids / {n_frames} frames"
              f" / {n_pages} atlas page(s) -> {sheet.width}x{sheet.height} sheet"
              f" ({len(blended)} blended clip(s))")

    (OUT_DIR / "dive_demo.json").write_text(json.dumps(manifest, indent=1))
    print(f"dive_demo: manifest -> {OUT_DIR / 'dive_demo.json'}")
    if args.contact:
        d = Path(args.contact)
        d.mkdir(parents=True, exist_ok=True)
        contact_sheet(built, d)
    return 0


if __name__ == "__main__":
    sys.exit(main())
