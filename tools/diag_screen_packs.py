#!/usr/bin/env python3
"""Scratch: decode every screen pack pair (<name>cs directory + <name>tm RLEN
atlases) under ~/ddw3/pack/dw2003/screen and render labeled contact sheets.
Format = FIELDCOM sprite directory; atlases side-by-side (u<256 -> atlas0,
else atlas1), CLUTs read from atlas0 bottom rows (verified for ststat)."""

import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SCREEN = Path.home() / "ddw3/pack/dw2003/screen"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")


def unrlen(blob: bytes) -> bytes:
    if blob[:4] != b"RLEN":
        raise ValueError(f"bad magic {blob[:4]!r}")
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


def hw(atlas: bytes, x: int, y: int) -> int:
    return struct.unpack_from("<H", atlas, ((y & 0xFF) * 64 + (x & 0x3F)) * 2)[0]


def decode_pair(cs_dir: Path, tm_dir: Path, label: str):
    frames_blob = (cs_dir / "0.bin").read_bytes()
    frames = [struct.unpack_from("<7H", frames_blob, i * 14)
              for i in range(len(frames_blob) // 14)]
    atlases = []
    for f in sorted(tm_dir.glob("*.bin"), key=lambda p: int(p.stem)):
        b = f.read_bytes()
        if len(b) >= 4 and b[:4] == b"RLEN":
            atlases.append(unrlen(b)[20:])
    if not atlases or not frames:
        print(f"{label}: skip (frames={len(frames)} atlases={len(atlases)})")
        return

    def cut(fi):
        u, v, w, h, cx, cy, fl = frames[fi]
        ai, ul = divmod(u, 256)
        if ai >= len(atlases):
            return None
        pal = [hw(atlases[0], cx + i, cy) for i in range(16)]
        rgba = [((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3,
                 0 if p == 0 else 255) for p in pal]
        img = Image.new("RGBA", (w, h))
        for yy in range(h):
            for xx in range(w):
                t = ul + xx
                half = hw(atlases[ai], t // 4, v + yy)
                img.putpixel((xx, yy), rgba[(half >> ((t % 4) * 4)) & 0xF])
        return img

    cols = 10
    cw, ch = 72, 124
    rows = (len(frames) + cols - 1) // cols
    s = Image.new("RGBA", (cols * cw, rows * ch), (40, 40, 40, 255))
    dr = ImageDraw.Draw(s)
    for i in range(len(frames)):
        im = cut(i)
        px, py = (i % cols) * cw + 2, (i // cols) * ch + 12
        dr.text((px, py - 11), str(i), fill=(255, 255, 0, 255))
        if im:
            s.paste(im, (px, py))
    s.save(OUT / f"pack_{label}.png")
    print(f"{label}: {len(frames)} frames, {len(atlases)} atlases -> pack_{label}.png")


for cs in sorted(SCREEN.glob("*cs")):
    name = cs.name[:-2]
    tm = SCREEN / f"{name}tm"
    if tm.is_dir():
        decode_pair(cs / "0", tm / "0", name)
