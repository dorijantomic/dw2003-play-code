#!/usr/bin/env python3
"""Offline PCSX-Redux savestate parser: extract the TRUE VRAM (and RAM).

Redux `.sav` files written by `PCSX.createSaveState()` and GUI `.sstateN`
files are protobuf ("PCSX-Redux SaveState v4"); GUI states wrap that protobuf
in gzip:

  field 3 = memory msg { f1: RAM (8MB on this rig — expanded-RAM build),
                         f3: another 8MB bank, f4: 64KB scratch }
  field 5 = GPU msg    { f3: len 0x100000 = the full 1024x512x16bpp LINEAR
                         VRAM — both framebuffers AND every texture page/CLUT }

⚠️ THE TRAP this tool exists to prevent (2026-07-13, cost a whole ledger
correction): byte-SEARCHING the .sav for CLUT/texture patterns finds a RAM
staging copy and yields a phantom, mostly-empty "VRAM". Always parse the
protobuf and take GPU.f3. These .sav files also must NOT be loaded back into
the emulator (crashes this build) — they are offline artifacts only.

Usage:
  savestate_vram.py dump.sav out.png                     # full VRAM as 16bpp RGB
  savestate_vram.py dump.sav out.png --rect X,Y,W,H      # halfword-coord crop
  savestate_vram.py dump.sav out.png --page X,Y --clut CX,CY
      # 256x256 4bpp texpage at halfword base (X,Y), palette = the 16
      # halfwords at (CX,CY) (texpages are 64 halfwords = 256 texels wide)
  savestate_vram.py dump.sav out.bin --raw               # raw 1MB VRAM blob
  savestate_vram.py dump.sav out.bin --ram               # raw RAM blob (f3.f1)

Provenance: decoded 2026-07-13 (Ice Tolerance freeze session,
docs/research/ui/stgtrain-decoded-2026-07-11.md §2026-07-13f); the VRAM
layout there (trainee/props texpages at (768,0)/(832,0)/(896,0)/(960,0))
was read with exactly these code paths.
"""

import argparse
import gzip
import sys
from pathlib import Path

VRAM_W, VRAM_H = 1024, 512
VRAM_LEN = VRAM_W * VRAM_H * 2


def _varint(b, i):
    v = s = 0
    while True:
        x = b[i]
        i += 1
        v |= (x & 0x7F) << s
        s += 7
        if not x & 0x80:
            return v, i


def _fields(b, start, end):
    """Yield (field, wire, value_or_(off,len)) over one protobuf message."""
    i = start
    while i < end:
        tag, i = _varint(b, i)
        f, w = tag >> 3, tag & 7
        if w == 2:
            ln, i = _varint(b, i)
            yield f, w, (i, ln)
            i += ln
        elif w == 0:
            v, i = _varint(b, i)
            yield f, w, v
        elif w == 5:
            yield f, w, None
            i += 4
        elif w == 1:
            yield f, w, None
            i += 8
        else:
            raise ValueError(f"unsupported wire type {w} at {i:#x}")


def load(path):
    """Return (data, vram_offset, ram_offset_or_None). Offsets into `data`."""
    data = Path(path).read_bytes()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    if b"PCSX-Redux SaveState" not in data[:64]:
        raise ValueError("not a PCSX-Redux savestate (missing v4 magic)")
    vram = ram = None
    for f, w, v in _fields(data, 0, len(data)):
        if w != 2:
            continue
        off, ln = v
        if f == 5:  # GPU msg
            for f2, w2, v2 in _fields(data, off, off + ln):
                if w2 == 2 and f2 == 3 and v2[1] == VRAM_LEN:
                    vram = v2[0]
        elif f == 3:  # memory msg
            for f2, w2, v2 in _fields(data, off, off + ln):
                if w2 == 2 and f2 == 1:
                    ram = v2[0], v2[1]
    if vram is None:
        raise ValueError("no 1MB VRAM chunk in GPU message (field 5.3)")
    return data, vram, ram


def rgb15(v):
    return ((v & 31) << 3, ((v >> 5) & 31) << 3, ((v >> 10) & 31) << 3)


def render16(data, base, x0, y0, w, h):
    from PIL import Image

    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        row = base + ((y0 + y) * VRAM_W + x0) * 2
        for x in range(w):
            o = row + x * 2
            px[x, y] = rgb15(data[o] | (data[o + 1] << 8))
    return img


def render_page4(data, base, px_, py, cx, cy, bg=(72, 72, 88), transparent=False):
    """256x256 4bpp texpage at halfword (px_,py), CLUT row at (cx,cy)."""
    from PIL import Image

    pal = []
    for i in range(16):
        o = base + (cy * VRAM_W + cx + i) * 2
        pal.append(data[o] | (data[o + 1] << 8))
    img = Image.new("RGBA" if transparent else "RGB", (256, 256),
                    (0, 0, 0, 0) if transparent else bg)
    p = img.load()
    for y in range(256):
        row = base + ((py + y) * VRAM_W + px_) * 2
        for x in range(256):
            b = data[row + x // 2]
            v = b & 0xF if x % 2 == 0 else b >> 4
            if v and pal[v]:
                color = rgb15(pal[v])
                p[x, y] = (*color, 255) if transparent else color
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("sav")
    ap.add_argument("out")
    ap.add_argument("--rect", help="X,Y,W,H halfword-coord 16bpp crop")
    ap.add_argument("--page", help="X,Y halfword base of a 4bpp texpage")
    ap.add_argument("--clut", help="CX,CY halfword coords of the 16-entry CLUT row (with --page)")
    ap.add_argument("--transparent", action="store_true", help="make 4bpp palette index 0 transparent")
    ap.add_argument("--raw", action="store_true", help="write the raw 1MB VRAM blob")
    ap.add_argument("--ram", action="store_true", help="write the raw RAM blob instead")
    a = ap.parse_args()
    data, vram, ram = load(a.sav)
    if a.ram:
        if ram is None:
            sys.exit("no RAM chunk found")
        Path(a.out).write_bytes(data[ram[0] : ram[0] + ram[1]])
        print(f"wrote RAM {ram[1]:#x} bytes -> {a.out}")
        return
    if a.raw:
        Path(a.out).write_bytes(data[vram : vram + VRAM_LEN])
        print(f"wrote VRAM 1MB -> {a.out}")
        return
    if a.page:
        px_, py = map(int, a.page.split(","))
        cx, cy = map(int, (a.clut or "0,0").split(","))
        render_page4(data, vram, px_, py, cx, cy, transparent=a.transparent).save(a.out)
        print(f"wrote 4bpp texpage ({px_},{py}) clut ({cx},{cy}) -> {a.out}")
        return
    if a.rect:
        x0, y0, w, h = map(int, a.rect.split(","))
    else:
        x0 = y0 = 0
        w, h = VRAM_W, VRAM_H
    render16(data, vram, x0, y0, w, h).save(a.out)
    print(f"wrote 16bpp VRAM ({x0},{y0}) {w}x{h} -> {a.out}")


if __name__ == "__main__":
    main()
