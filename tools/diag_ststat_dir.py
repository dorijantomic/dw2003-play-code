#!/usr/bin/env python3
"""Scratch: dump the ststatcs sprite directory (split pack files) + render the
ststattm RLEN atlases raw, to pin the frame->atlas/CLUT mapping before writing
the committed extractor. Format = FIELDCOM sprite directory (see
docs/research/ui/fieldcom-sprite-directory-decoded-2026-07-02.md)."""

import struct
import sys
from pathlib import Path

from PIL import Image

PACK = Path.home() / "ddw3/pack/dw2003/screen"
CS = PACK / "ststatcs/0"
TM = PACK / "ststattm/0"
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


def main() -> int:
    frames_blob = (CS / "0.bin").read_bytes()
    n_frames = len(frames_blob) // 14
    frames = [struct.unpack_from("<7H", frames_blob, i * 14) for i in range(n_frames)]
    print(f"frames: {n_frames}")
    for i, f in enumerate(frames):
        u, v, w, h, cx, cy, fl = f
        print(f"  f{i:02d}: u={u:3d} v={v:3d} {w:3d}x{h:3d} clut=({cx},{cy}) flags={fl:#x}")

    ids = (CS / "1.bin").read_bytes()
    print(f"\nids ({len(ids)}B): {ids.hex(' ')}")

    for n in range(2, 63):
        d = (CS / f"{n}.bin").read_bytes()
        count, cya = struct.unpack_from("<HH", d, 0)
        (semi,) = struct.unpack_from("<h", d, 4)
        layers = [struct.unpack_from("<Hhh", d, 6 + k * 6) for k in range(count)]
        extra = len(d) - (6 + count * 6)
        print(f"clip{n - 2:02d} ({len(d)}B): count={count} clut_y_add={cya} semi={semi} "
              f"layers={layers} extra={extra}")

    for name in ("0", "1"):
        raw = unrlen((TM / f"{name}.bin").read_bytes())
        print(f"\natlas {name}: decompressed {len(raw)}B, header: {raw[:20].hex(' ')}")
        pix = raw[20:]
        # render as raw 16bpp 64hw x 256 (shows CLUT rows + garbled-looking 4bpp data)
        img = Image.new("RGB", (64, 256))
        for y in range(256):
            for x in range(64):
                p = struct.unpack_from("<H", pix, (y * 64 + x) * 2)[0]
                img.putpixel((x, y), ((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3))
        img.resize((256, 1024), Image.NEAREST).save(OUT / f"ststattm_raw16_{name}.png")
        # and as 4bpp indexed grayscale (structure check)
        img4 = Image.new("L", (256, 256))
        for y in range(256):
            for x in range(256):
                half = struct.unpack_from("<H", pix, (y * 64 + x // 4) * 2)[0]
                img4.putpixel((x, y), (((half >> ((x % 4) * 4)) & 0xF) * 17))
        img4.save(OUT / f"ststattm_4bpp_{name}.png")
    print(f"\nwrote atlas previews to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
