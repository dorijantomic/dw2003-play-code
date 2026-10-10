#!/usr/bin/env python3
"""Scratch: render all glyphs of the EXE UI font banks (kind1/kind3, bank
records at 0x8004dd74+k*0x18) from a RAM dump + VRAM dump. Glyph records are
11 bytes {page,u,v,clut_x,clut_y,w,h,dx,dy,adv,?}; basic table at bank+4
(char-4), extended (2-byte chars) at bank+8; texture base VRAM x=0x140 hw,
tpage_x = 320+page*64 hw; clut row = glyph[4], clut x hw = (320+glyph[3])&~15.
Derived from exe-decomp F0x800197a4/F0x8001a48c."""

import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ram = Path(sys.argv[1]).read_bytes()
vram = Path(sys.argv[2]).read_bytes()
OUT = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(".")


def r32(a):
    return struct.unpack_from("<I", ram, a & 0x1FFFFF)[0]


def vhw(x, y):
    return struct.unpack_from("<H", vram, (y * 1024 + x) * 2)[0]


def glyph_img(rec):
    page, u, v, cx, cy, w, h = rec[0], rec[1], rec[2], rec[3], rec[4], rec[5], rec[6]
    if w == 0 or h == 0 or page == 0xFF:
        return None
    base_x = 0x140 + (page << 6)  # halfwords
    clut_x = (0x140 + cx) >> 4 << 4
    pal = [vhw(clut_x + i, cy) for i in range(16)]
    rgba = [((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3,
             0 if p == 0 else 255) for p in pal]
    img = Image.new("RGBA", (w, h))
    for yy in range(h):
        for xx in range(w):
            t = u + xx
            half = vhw((base_x + (t >> 2)) & 0x3FF, (v + yy) & 0x1FF)
            img.putpixel((xx, yy), rgba[(half >> ((t % 4) * 4)) & 0xF])
    return img


def sheet(tbl_addr, count, label):
    cols = 16
    cw, chh = 40, 44
    rows = (count + cols - 1) // cols
    s = Image.new("RGBA", (cols * cw, rows * chh), (60, 60, 60, 255))
    dr = ImageDraw.Draw(s)
    for i in range(count):
        rec = ram[(tbl_addr + i * 11) & 0x1FFFFF:][:11]
        px, py = (i % cols) * cw, (i // cols) * chh + 10
        dr.text((px, py - 10), f"{i:02x}", fill=(255, 255, 0, 255))
        im = glyph_img(rec)
        if im:
            s.paste(im, (px, py))
    s.save(OUT / f"font_{label}.png")
    print(f"{label}: {count} glyphs at {tbl_addr:08x} -> font_{label}.png")


for k in (1, 2, 3):
    bank = 0x8004DD74 + k * 0x18
    basic, ext = r32(bank + 4), r32(bank + 8)
    n_ext = struct.unpack_from("<h", ram, (bank + 0x16) & 0x1FFFFF)[0]
    print(f"kind{k}: basic@{basic:08x} ext@{ext:08x} n_ext={n_ext}")
    sheet(basic, (ext - basic) // 11, f"k{k}_basic")
    if n_ext > 0:
        sheet(ext, n_ext, f"k{k}_ext")
