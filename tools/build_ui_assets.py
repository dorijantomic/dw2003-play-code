#!/usr/bin/env python3
"""Decode DW2003 screen pack UI assets to PNG.

Decodes: cmnbgdtm (diamond tile bg), ttcommpk (talk/dialogue screen textures),
         stshoptm (shop bg), ststattm (status bg).
Outputs to: web/assets/ui/

Run from ~/ddw3-walker:
  ~/.local/bin/uv run --with pillow python tools/build_ui_assets.py

STRUCTURE NOTES (discovered 2026-06-13):
  cmnbgdtm — sub-pack 0 only; 0.bin = RLEN-compressed 15bpp TIM (64x256, no CLUT).
    No sub-pack 1 exists for this pack. The *tm pack carries pixel data directly.
    The paired *cs pack (cmnbgdcs) carries CLUT data for 4/8bpp packs; not needed here.

  ttcommpk — "Talk To" screen pack (dialogue box + character portrait). 10 sub-packs:
    sub-packs 0-2: tiny metadata (sprite def headers), not TIM.
    sub-pack 3: sprite tile definitions (95 entries, 10 bytes each), not TIM.
    sub-pack 4: 8bpp 128x256 TIM (2 CLUTs), main texture sheet with window chrome
                + character portrait tiles. CLUT0 is the primary palette.
    sub-pack 5: 8bpp 128x256 TIM (2 CLUTs), alternate texture sheet.
    sub-pack 6: 8bpp 128x256 TIM (1 CLUT), third texture sheet.
    sub-pack 7: 15bpp 64x256 TIM, mask/effect layer.
    sub-pack 8: sprite tile definitions (50 entries, same format as sub3).
    sub-pack 9: 15bpp 64x256 TIM (identical to sub7).
    → Use sub-pack 4 bin 0 for the primary texture (window chrome + portrait tiles).
    Key sprite tile regions in sub4 (pixel coords):
      Portrait tiles: (64,0) 64x64, (128,0) 64x64  [partially outside 128px]
      Top border: (80,64) 40x16
      Left border: (48,104) 8x24, (72,104) 8x24
      Frame corners: (8,120) 8x8, (16,120) 8x8
    Screen layout: portrait at top-left (0,0)-(64,64); dialogue box y=104-224.

  stshoptm — shop screen background.
    sub-pack 0 only; 0.bin = RLEN-compressed 15bpp TIM (64x256, no CLUT).
    1.bin is 0 bytes (ignore).

  ststattm — status screen background.
    sub-pack 0 only; 0.bin + 1.bin = two RLEN-compressed 15bpp TIMs (64x256 each).
    Composite both layers (0.bin base, 1.bin overlay).
"""
import os
import struct
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Run with: ~/.local/bin/uv run --with pillow python tools/build_ui_assets.py", file=sys.stderr)
    sys.exit(1)

REPO = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack" / "dw2003" / "screen"
OUT = REPO / "web" / "assets" / "ui"


def rlen_decompress(data: bytes) -> bytes:
    if data[:4] != b"RLEN":
        raise ValueError(f"Expected RLEN magic, got {data[:4]!r}")
    total_size = struct.unpack_from("<I", data, 4)[0]
    pos = 8
    out = bytearray()
    while len(out) < total_size:
        opcode = data[pos]; pos += 1
        if opcode < 0x80:
            out.extend(data[pos:pos + opcode]); pos += opcode
        else:
            count = opcode - 0x80
            byte = data[pos]; pos += 1
            out.extend(bytes([byte]) * count)
    return bytes(out)


def bgr555_to_rgba(color: int) -> tuple:
    stp = (color >> 15) & 1
    r = (color & 0x1F) << 3
    g = ((color >> 5) & 0x1F) << 3
    b = ((color >> 10) & 0x1F) << 3
    if stp == 1 and r == 0 and g == 0 and b == 0:
        return (0, 0, 0, 0)
    return (r, g, b, 255)


def parse_tim(data: bytes) -> Image.Image:
    pos = 0
    magic = struct.unpack_from("<I", data, pos)[0]; pos += 4
    if magic != 0x10:
        raise ValueError(f"TIM magic expected 0x10, got 0x{magic:08x}")
    flags = struct.unpack_from("<I", data, pos)[0]; pos += 4
    bpp_mode = flags & 0x7
    has_clut = bool(flags & 0x8)

    clut_colors = None
    if has_clut:
        clut_block_size = struct.unpack_from("<I", data, pos)[0]
        num_colors = struct.unpack_from("<H", data, pos + 8)[0]
        num_cluts = struct.unpack_from("<H", data, pos + 10)[0]
        raw_clut = data[pos + 12: pos + clut_block_size]
        pos += clut_block_size
        palette = []
        for i in range(num_colors):
            c = struct.unpack_from("<H", raw_clut, i * 2)[0]
            palette.append(bgr555_to_rgba(c))
        clut_colors = palette

    img_block_size = struct.unpack_from("<I", data, pos)[0]
    width_hw = struct.unpack_from("<H", data, pos + 8)[0]
    height = struct.unpack_from("<H", data, pos + 10)[0]
    pixel_data = data[pos + 12: pos + img_block_size]

    if bpp_mode == 1:  # 8bpp indexed
        pw = width_hw * 2
        img = Image.new("RGBA", (pw, height))
        px = img.load()
        for y in range(height):
            for x in range(pw):
                idx = pixel_data[y * pw + x]
                px[x, y] = clut_colors[idx] if clut_colors and idx < len(clut_colors) else (0, 0, 0, 255)
    elif bpp_mode == 2:  # 15bpp direct
        pw = width_hw
        img = Image.new("RGBA", (pw, height))
        px = img.load()
        for y in range(height):
            for x in range(pw):
                c = struct.unpack_from("<H", pixel_data, (y * pw + x) * 2)[0]
                px[x, y] = bgr555_to_rgba(c)
    elif bpp_mode == 0:  # 4bpp indexed
        pw = width_hw * 4
        img = Image.new("RGBA", (pw, height))
        px = img.load()
        for y in range(height):
            for x in range(pw):
                byte = pixel_data[y * (pw // 2) + x // 2]
                idx = byte & 0xF if x % 2 == 0 else (byte >> 4) & 0xF
                px[x, y] = clut_colors[idx] if clut_colors and idx < len(clut_colors) else (0, 0, 0, 255)
    else:
        raise ValueError(f"Unsupported bpp mode {bpp_mode}")
    return img


def decode_pack(pack_name: str, subpack: int, bin_indices: list, out_name: str):
    """Decode one or more TIM bins from a screen pack sub-pack and composite to PNG.

    pack_name: folder under ~/ddw3/pack/dw2003/screen/ (e.g. "cmnbgdtm")
    subpack:   sub-pack directory index (0 or 1)
    bin_indices: list of bin file indices to decode and composite
    out_name:  output filename under web/assets/ui/
    """
    src = DDW3 / pack_name / str(subpack)
    imgs = []
    for idx in bin_indices:
        p = src / f"{idx}.bin"
        if not p.exists() or p.stat().st_size == 0:
            print(f"  SKIP {p} (missing or empty — run LFS pull first)")
            return
        raw_bytes = p.read_bytes()
        # Check if it's a raw LFS pointer (text file)
        if raw_bytes[:7] == b"version":
            print(f"  SKIP {p} (LFS pointer — run: cd ~/ddw3 && git lfs pull --include=\"pack/dw2003/screen/{pack_name}/**\")")
            return
        raw = rlen_decompress(raw_bytes)
        imgs.append(parse_tim(raw))

    if not imgs:
        return

    # Composite all layers (align at top-left, last layer on top)
    w = max(i.width for i in imgs)
    h = max(i.height for i in imgs)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for img in imgs:
        canvas.alpha_composite(img, (0, 0))

    out_path = OUT / out_name
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    print(f"  Saved {out_path}  ({canvas.width}x{canvas.height} px)")


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # cmnbgdtm — diagonal diamond tile background (NOT the dialogue box).
    # Structure: sub-pack 0 only; 0.bin = RLEN-compressed 15bpp TIM (64x256, no CLUT).
    # No sub-pack 1 exists — the TIM is in sub-pack 0's 0.bin directly.
    # 1.bin is empty (0 bytes); ignore it.
    print("Decoding cmnbgdtm...")
    decode_pack("cmnbgdtm", 0, [0], "cmnbgd.png")

    # ttcommpk — "Talk To" screen: dialogue box + character portrait textures.
    # TIM data lives in sub-pack 4 (8bpp, 128x256, 2 CLUTs).
    # Sub-packs 0-3 and 8 are sprite-tile definition metadata (not TIM).
    # Sub-pack 4 is the main texture sheet; CLUT0 is the primary palette.
    # Contains all window chrome tile regions + portrait image tiles.
    print("Decoding ttcommpk...")
    decode_pack("ttcommpk", 4, [0], "ttcomm.png")

    # stshoptm — shop screen background texture.
    # sub-pack 0 only; 0.bin = RLEN-compressed 15bpp TIM (64x256, no CLUT).
    # 1.bin is 0 bytes (ignore).
    print("Decoding stshoptm...")
    decode_pack("stshoptm", 0, [0], "stshop.png")

    # ststattm — status screen background texture.
    # sub-pack 0 only; two 15bpp TIMs: 0.bin (base layer) + 1.bin (overlay).
    # Composite both layers together.
    # 2.bin is 0 bytes (ignore).
    print("Decoding ststattm...")
    decode_pack("ststattm", 0, [0, 1], "ststat.png")


if __name__ == "__main__":
    main()
