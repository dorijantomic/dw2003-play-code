#!/usr/bin/env python3
"""Cut the s415 Deeper Crevice SCENERY SCROLL LAYER for the browser.

WHAT THE LAYER IS.  Stage s415's scene entry builds one stage object (registry id
0x32c, tick 0x800a6c8c) whose `state == 1` tick slides a repeating rock/tunnel
picture across the screen; on a first visit the picture moves up-and-right and
then eases to a stop, and on a revisit the same object is built but stays put.
The picture is the crevice's own scenery -- the rock wall with its pipes, rails
and struts that the platform (the fixed gondola the player stands on) travels
past -- drawn BEHIND the platform.  It is not a surface the player stands on.

THE PICTURE'S SOURCE.  The draw 0x800a6b04 hands the shared shape emitter
`F0x8001ed6c` two shape sets, packed ids 0x075E0002 and 0x075E0004: the stage's
own TMPK pack (S415TMPK, resource 0x75E) sub-entries 2 and 4, each a sprite
directory whose single shape id 0 lays 24 tiles of 64x128 into a 4-wide x 6-tall
grid (a 256x768 picture).  The frame records are the TMPK 14-byte frames
{u, v, w, h, clut_x, clut_y, flags}; every frame is 8bpp (flags == 1) and its
`clut_y` (256..261) picks one of the SIX palette rows the stage's background pack
carries.  The texels come from the stage's own background pack S415BG01
(resource 0x769), six 8bpp tiles of 128x256 staged side by side (a 768x256
atlas); the frames' `u` runs 0..704 and `v` 0..128, i.e. inside that atlas, and
the cut art reads as the crevice's rock wall with its pipes and supports -- the
same scenery the stage's `state == 0` band draws whole.  (The point-sprite MASK,
S415MASK, is only 384 px wide, so it cannot hold these frames -- that is why the
point-sprite extractor's mask is not the source here.)

Numbers that are the overlay's, not this tool's (all verified against
wstag415.s; `--check` re-derives the whole output):
  * the tile period 0x200 px across, 0x100 px down; sheet A at (x, y), sheet B
    at (x + 0x100, y), and each redrawn one period away so the pair wraps;
  * the vertical bias 0x100 on the object's Y;
  * the scroll speed 0x800 px/tick across / 0x400 up, decaying 0x10 per tick;
  * the wrap when x > 0x1FFFF (x -= 0x20000, y += 0x10000);
  * the cue 0x340003 and the story flag 0x4018 that gates visit vs revisit;
  * the configure sub 0x336 (822) that the arrival event fires to ease the slide.

Usage: tools/extract_scroll_layers.py [--check]
Output: web/assets/effects/scroll/s415.png (512x768 sheet, A left / B right)
        web/assets/data/scroll_layers.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import struct
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
ASM = Path(os.environ.get("DDW3_DIR") or Path(os.path.expanduser("~/ddw3"))) / "asm/dw2003/pro"
OUT_SHEET = REPO / "web/assets/effects/scroll/s415.png"
OUT_JSON = REPO / "web/assets/data/scroll_layers.json"

# The stage's own resources, from the descriptor + the draw (lba.rs: 0x75E =
# S415TMPK, 0x769 = S415BG01, 0x75F = S415MASK).
TMPK = 0x75E
BG01 = 0x769
SHAPE_MEMBERS = (2, 4)          # 0x075E0002 / 0x075E0004, the draw's two ids
TILE_W, TILE_H = 64, 128        # every frame is 64x128
GRID_W = 4                      # 4 tiles across (256 px = half the tile period)
GRID_H = 6                      # 6 tiles down (768 px = three tile periods)

# The runtime numbers, read out of wstag415.s (tick 0x800a6c8c, draw 0x800a6b04,
# scene entry 0x800a6efc, configure 0x800a6e88).  Named so the engine never
# carries a bare literal.
SPEED_X = 0x800
SPEED_Y = 0x400
DECAY = 0x10
WRAP_X = 0x1FFFF
WRAP_X_SUB = 0x20000
WRAP_Y_ADD = 0x10000
Y_BIAS = 0x100
PERIOD_X = 0x200
PERIOD_Y = 0x100
SOUND = "0x340003"              # the first decelerating tick's cue
GATE_FLAG = 0x4018              # story flag: set -> revisit (static)
CONFIGURE_SUB = 0x336           # 822: setClip(1), fires the ease
TICK = "0x800a6c8c"
ID_HEX = "0x32c"
ID = 812


def load_eps():
    """Reuse the repo's own TMPK/mask/pack readers (tools/extract_point_sprites.py)."""
    spec = importlib.util.spec_from_file_location(
        "extract_point_sprites", REPO / "tools/extract_point_sprites.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def raw_tim(blob: bytes):
    """(flags, clut, w_hw, h, pix) for an uncompressed TIM entry.

    S415BG01's entries are NOT RLEN-compressed; they start with the 0x10 TIM
    magic.  An 8bpp TIM's `w` is in 16-bit WORDS, so its pixel width is `w * 2`.
    """
    magic, flags = struct.unpack_from("<II", blob, 0)
    if magic != 0x10:
        raise ValueError(f"not a TIM (magic {magic:#x})")
    p = 8
    clut = None
    cw = ch = 0
    if flags & 8:
        blen, _cx, _cy, cw, ch = struct.unpack_from("<IHHHH", blob, p)
        clut = struct.unpack_from("<%dH" % (cw * ch), blob, p + 12)
        p += blen
    blen, _x, _y, w, h = struct.unpack_from("<IHHHH", blob, p)
    pix = blob[p + 12:p + 12 + w * h * 2]
    if len(pix) < w * h * 2:
        raise ValueError("TIM image data truncated")
    return flags, clut, w, h, pix


def bg_atlas(disc, eps):
    """The stage's background pack as one 8bpp atlas: six 128x256 tiles, and the
    256x6 CLUT the frames' `clut_y` indexes."""
    subs = [e for e in eps.pack_entries(disc.file(BG01)) if e]
    cols = []
    clut = None
    for e in subs:
        # S415BG01's entries carry a LYING split flag: sub 0 reports 4bpp and the
        # rest report 8bpp, but every entry's payload is exactly w*h*2 bytes, i.e.
        # 8bpp throughout (docs/research/field/s415-deeper-crevice-ride-decode.md,
        # "1.bin-5.bin carry a lying 16bpp flag").  Read them all as 8bpp.
        flags, c, w, h, pix = raw_tim(e)
        if c is not None:
            clut = c
        pxw = w * 2
        cols.append(Image.frombytes("L", (pxw, h), pix[:pxw * h]))
    if clut is None:
        raise SystemExit("S415BG01 has no CLUT block")
    atlas = Image.new("L", (sum(c.width for c in cols), 256))
    x = 0
    for c in cols:
        atlas.paste(c, (x, 0))
        x += c.width
    return atlas, clut


def psx555(v: int):
    return (((v) & 31) << 3, ((v >> 5) & 31) << 3, ((v >> 10) & 31) << 3)


def cut_sheet(disc, eps, atlas, clut, member: int):
    """One shape set -> its 256x768 RGBA picture, palette baked per tile."""
    directory = eps.parse_tmpk_directory(eps.pack_entries(disc.file(TMPK))[member])
    frames, ids, clips = directory
    if ids != [0]:
        raise SystemExit(f"member {member}: expected the single shape id 0, got {ids}")
    clip = clips[0]
    tiles = []
    for fi, dx, dy in clip["layers"]:
        u, v, w, h, _cx, cy, flags = frames[fi]
        if flags != 1:
            raise SystemExit(f"member {member} frame {fi}: not 8bpp ({flags:#x})")
        row = cy - 256
        pal = [psx555(clut[row * 256 + k]) for k in range(256)]
        src = atlas.crop((u, v, u + w, v + h))
        rgb = Image.new("RGBA", (w, h))
        px = rgb.load()
        sp = src.load()
        for yy in range(h):
            for xx in range(w):
                idx = sp[xx, yy]
                r, g, b = pal[idx]
                px[xx, yy] = (r, g, b, 255 if idx else 0)
        tiles.append((dx, dy, rgb))
    miny = min(t[1] for t in tiles)
    sheet = Image.new("RGBA", (GRID_W * TILE_W, GRID_H * TILE_H))
    for dx, dy, img in tiles:
        sheet.paste(img, (dx, dy - miny))
    return sheet


def build(disc, eps):
    atlas, clut = bg_atlas(disc, eps)
    a = cut_sheet(disc, eps, atlas, clut, 2)
    b = cut_sheet(disc, eps, atlas, clut, 4)
    combined = Image.new("RGBA", (a.width + b.width, max(a.height, b.height)))
    combined.paste(a, (0, 0))
    combined.paste(b, (a.width, 0))
    data = {
        "summary": {
            "generated_by": "tools/extract_scroll_layers.py",
            "stages": 1,
            "members": 1,
            "tile": [TILE_W, TILE_H],
            "grid": [GRID_W, GRID_H],
            "sheet": [combined.width, combined.height],
        },
        "stages": {
            "s415": {
                "812": {
                    "stage": "415",
                    "id": ID,
                    "idHex": ID_HEX,
                    "machine": "scroll-layer",
                    "tick": TICK,
                    "registryCtor": None,
                    # The registry record's draw word IS the configure handler
                    # (0x800a6e88, wstag415 file 0x10a8): it answers sub 0x336.
                    "draw": "0x800a6e88",
                    "scrollLayer": {
                        "flag": GATE_FLAG,
                        "configureSub": CONFIGURE_SUB,
                        "startX": 0,
                        "startY": 0,
                        "speedX": SPEED_X,
                        "speedY": SPEED_Y,
                        "decay": DECAY,
                        "wrapX": WRAP_X,
                        "wrapXSub": WRAP_X_SUB,
                        "wrapYAdd": WRAP_Y_ADD,
                        "yBias": Y_BIAS,
                        "periodX": PERIOD_X,
                        "periodY": PERIOD_Y,
                        "sound": SOUND,
                        "sheet": "scroll/s415.png",
                        # Per shape set: where its half of the strip is drawn when
                        # the object's x is at the draw's own x, and the wrap
                        # copy's x.
                        "sheets": [
                            {"member": 2, "drawX": 0, "wrapX": -PERIOD_X, "wrapY": PERIOD_Y},
                            {"member": 4, "drawX": 0x100, "wrapX": -0x100, "wrapY": PERIOD_Y},
                        ],
                    },
                }
            }
        },
    }
    return combined, data


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fail if the outputs are stale")
    args = ap.parse_args()

    eps = load_eps()
    disc = eps.Disc(eps.DISC)
    sheet, data = build(disc, eps)
    text = json.dumps(data, indent=1) + "\n"

    if args.check:
        ok = True
        try:
            if json.loads(OUT_JSON.read_text()) != data:
                print("extract_scroll_layers: scroll_layers.json is stale", file=sys.stderr)
                ok = False
        except OSError:
            print("extract_scroll_layers: scroll_layers.json missing", file=sys.stderr)
            ok = False
        try:
            have = Image.open(OUT_SHEET).convert("RGBA")
            if have.size != sheet.size or have.tobytes() != sheet.tobytes():
                print("extract_scroll_layers: s415.png sheet is stale", file=sys.stderr)
                ok = False
        except OSError:
            print("extract_scroll_layers: s415.png missing", file=sys.stderr)
            ok = False
        if not ok:
            return 1
        print("extract_scroll_layers: up to date")
        return 0

    OUT_SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_SHEET)
    OUT_JSON.write_text(text)
    print(f"scroll layers: wrote {OUT_SHEET.name} {sheet.width}x{sheet.height} "
          f"and {OUT_JSON.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
