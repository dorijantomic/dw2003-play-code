#!/usr/bin/env python3
"""Scratch: cut all ststatcs frames from the ststattm RLEN atlases and tile
them into one labeled contact sheet, to verify the atlas/CLUT mapping by eye
against the savestate screenshots."""

import struct
import sys
from pathlib import Path

from PIL import Image

PACK = Path.home() / "ddw3/pack/dw2003/screen"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")


def unrlen(blob: bytes) -> bytes:
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
    return bytes(out)


atlases = [unrlen((PACK / f"ststattm/0/{n}.bin").read_bytes())[20:] for n in (0, 1)]
frames_blob = (PACK / "ststatcs/0/0.bin").read_bytes()
frames = [struct.unpack_from("<7H", frames_blob, i * 14) for i in range(len(frames_blob) // 14)]


def hw(atlas: bytes, x: int, y: int) -> int:
    return struct.unpack_from("<H", atlas, ((y & 0xFF) * 64 + x) * 2)[0]


def cut(fi: int, clut_atlas: int | None = None) -> Image.Image:
    u, v, w, h, cx, cy, fl = frames[fi]
    ai, ul = (0, u) if u < 256 else (1, u - 256)
    ca = atlases[clut_atlas if clut_atlas is not None else ai]
    pal = [hw(ca, cx + i, cy) for i in range(16)]
    rgba = [((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3,
             0 if p == 0 else 255) for p in pal]
    img = Image.new("RGBA", (w, h))
    for yy in range(h):
        for xx in range(w):
            t = ul + xx
            half = hw(atlases[ai], t // 4, v + yy)
            img.putpixel((xx, yy), rgba[(half >> ((t % 4) * 4)) & 0xF])
    return img


def sheet(name: str, clut_atlas: int | None):
    cols = 10
    cw, ch = 68, 120
    rows = (len(frames) + cols - 1) // cols
    s = Image.new("RGBA", (cols * cw, rows * ch), (40, 40, 40, 255))
    for i in range(len(frames)):
        im = cut(i, clut_atlas)
        s.paste(im, ((i % cols) * cw + 2, (i // cols) * ch + 2))
    s.save(OUT / name)
    print("wrote", OUT / name)


sheet("ststat_cut_ownatlas.png", None)   # CLUT from the frame's own atlas
sheet("ststat_cut_clut0.png", 0)         # CLUT always from atlas 0
sheet("ststat_cut_clut1.png", 1)         # CLUT always from atlas 1
