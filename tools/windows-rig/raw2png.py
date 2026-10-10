#!/usr/bin/env python3
"""Convert PCSX-Redux takeScreenShot .raw dumps to PNG.

rig-reference.md has referenced a raw2png.py for a while but the actual file
lived in a wiped scratch dir — committed 2026-07-13. Handles the two formats
the rig produces: 16bpp 320x240 (menus/gameplay, 153600 bytes) and 24bpp
320x480 (FMV). Format is auto-detected from the file size unless overridden.

Usage: raw2png.py in.raw out.png [--bpp 16|24]
"""

import argparse

from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--bpp", type=int, choices=(16, 24))
    a = ap.parse_args()
    data = open(a.src, "rb").read()
    bpp = a.bpp or (16 if len(data) == 320 * 240 * 2 else 24)
    if bpp == 16:
        w, h = 320, 240
        img = Image.new("RGB", (w, h))
        px = img.load()
        for i in range(w * h):
            v = data[i * 2] | (data[i * 2 + 1] << 8)
            px[i % w, i // w] = ((v & 31) << 3, ((v >> 5) & 31) << 3, ((v >> 10) & 31) << 3)
    else:
        w, h = 320, 480
        img = Image.frombytes("RGB", (w, h), data[: w * h * 3])
    img.save(a.out)
    print(f"wrote {a.out} ({w}x{h} from {bpp}bpp)")


if __name__ == "__main__":
    main()
