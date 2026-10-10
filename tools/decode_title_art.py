#!/usr/bin/env python3
"""Decode the DW2003 USA title logo from RLEN-compressed TIM assets.

Source assets (read-only):
  ~/ddw3/pack/dw2003/screen/tlogousa/1/0.bin  -- RLEN-compressed 8bpp TIM (128x256, 256-color CLUT)
  ~/ddw3/pack/dw2003/screen/tlogousa/1/1.bin  -- RLEN-compressed 15bpp TIM (64x256)

Output:
  web/assets/title_logo.png  (composite of both layers, alpha-masked)

Run from ~/ddw3-walker:
  ~/.local/bin/uv run --with pillow python tools/decode_title_art.py

This is Option C (best-effort composite): the 8bpp layer is the main logo
texture; the 15bpp layer is overlaid (non-black pixels override).
The black background is made transparent. The two images are aligned to their
VRAM origins (both at VRAM 0,0) and composited.

Documented as approximate (sub-pack 0 compositing metadata not decoded).
"""

import os
import struct
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("PIL not available; run with: ~/.local/bin/uv run --with pillow python tools/decode_title_art.py", file=sys.stderr)
    sys.exit(1)


REPO = Path(__file__).parent.parent
ASSET_SRC = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack" / "dw2003" / "screen" / "tlogousa" / "1"
OUT_PATH = REPO / "web" / "assets" / "title_logo.png"


def rlen_decompress(data: bytes) -> bytes:
    """Decompress RLEN-encoded data.

    Format:
      magic: b"RLEN" (4 bytes)
      total_size: u32 LE
      then loop while output < total_size:
        opcode = read_u8()
        if opcode < 0x80:  # literal run
          copy opcode bytes from input to output
        else:              # repeat run
          byte = read_u8()
          write (opcode - 0x80) copies of byte
    """
    if data[:4] != b"RLEN":
        raise ValueError(f"Expected RLEN magic, got {data[:4]!r}")
    total_size = struct.unpack_from("<I", data, 4)[0]
    pos = 8
    out = bytearray()
    while len(out) < total_size:
        opcode = data[pos]; pos += 1
        if opcode < 0x80:
            # literal run: copy opcode bytes
            out.extend(data[pos:pos + opcode])
            pos += opcode
        else:
            # repeat run: (opcode - 0x80) copies of next byte
            count = opcode - 0x80
            byte = data[pos]; pos += 1
            out.extend(bytes([byte]) * count)
    return bytes(out)


def bgr555_to_rgba(color: int, stp_transparent: bool = True) -> tuple:
    """Convert PS1 BGR555 color to RGBA.

    Bit layout: bit15=STP, bits10-14=B, bits5-9=G, bits0-4=R
    STP=1 with R=G=B=0 → transparent black (treat as transparent).
    STP=0 with R=G=B=0 → opaque black.
    color=0x0000 → opaque black (no STP, no RGB).
    """
    stp = (color >> 15) & 1
    r = (color & 0x1F) << 3
    g = ((color >> 5) & 0x1F) << 3
    b = ((color >> 10) & 0x1F) << 3
    # STP=1 + black → transparent (used as background/padding color)
    if stp_transparent and stp == 1 and r == 0 and g == 0 and b == 0:
        return (0, 0, 0, 0)
    return (r, g, b, 255)


def parse_tim(data: bytes) -> Image.Image:
    """Parse a PS1 TIM file and return an RGBA PIL Image.

    TIM header:
      u32 magic = 0x10
      u32 flags  (bits 0-2 = bpp mode: 0=4bpp,1=8bpp,2=15bpp; bit 3=hasCLUT)

    CLUT block (if hasCLUT):
      u32 block_size  (includes this 12-byte header)
      u16 dx, dy      (VRAM destination)
      u16 num_colors
      u16 num_cluts
      u8  clut_data[block_size - 12]  (u16 BGR555 per color)

    Image block:
      u32 block_size
      u16 dx, dy      (VRAM destination in halfwords)
      u16 width_hw    (width in 16-bit halfwords; for 8bpp: pixel_width = width_hw*2)
      u16 height      (in pixels)
      u8  pixel_data[block_size - 12]
    """
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
        clut_dx, clut_dy = struct.unpack_from("<HH", data, pos + 4)
        num_colors = struct.unpack_from("<H", data, pos + 8)[0]
        num_cluts = struct.unpack_from("<H", data, pos + 10)[0]
        clut_data_start = pos + 12
        clut_data_end = pos + clut_block_size
        pos += clut_block_size

        # Parse all CLUTs; we'll use the first one for display
        raw_clut = data[clut_data_start:clut_data_end]
        cluts = []
        offset = 0
        for _ in range(num_cluts):
            palette = []
            for _ in range(num_colors):
                c = struct.unpack_from("<H", raw_clut, offset)[0]; offset += 2
                palette.append(bgr555_to_rgba(c))
            cluts.append(palette)
        clut_colors = cluts[0] if cluts else []

    # Image block
    img_block_size = struct.unpack_from("<I", data, pos)[0]
    img_dx, img_dy = struct.unpack_from("<HH", data, pos + 4)
    width_hw = struct.unpack_from("<H", data, pos + 8)[0]
    height = struct.unpack_from("<H", data, pos + 10)[0]
    pixel_data = data[pos + 12 : pos + img_block_size]

    if bpp_mode == 1:  # 8bpp indexed
        pixel_width = width_hw * 2
        img = Image.new("RGBA", (pixel_width, height))
        pixels = img.load()
        for y in range(height):
            for x in range(pixel_width):
                idx = pixel_data[y * pixel_width + x]
                if clut_colors and idx < len(clut_colors):
                    pixels[x, y] = clut_colors[idx]
                else:
                    pixels[x, y] = (0, 0, 0, 255)

    elif bpp_mode == 2:  # 15bpp direct
        pixel_width = width_hw  # each halfword is one pixel
        img = Image.new("RGBA", (pixel_width, height))
        pixels = img.load()
        for y in range(height):
            for x in range(pixel_width):
                offset = (y * pixel_width + x) * 2
                c = struct.unpack_from("<H", pixel_data, offset)[0]
                # For 15bpp direct, treat STP=0 and all-zero as black (opaque)
                # transparent black heuristic: pure black pixels → transparent
                r = (c & 0x1F) << 3
                g = ((c >> 5) & 0x1F) << 3
                b = ((c >> 10) & 0x1F) << 3
                stp = (c >> 15) & 1
                if stp == 1 and r == 0 and g == 0 and b == 0:
                    pixels[x, y] = (0, 0, 0, 0)
                else:
                    pixels[x, y] = (r, g, b, 255)

    else:
        raise ValueError(f"Unsupported bpp mode {bpp_mode}")

    return img


def autocrop_transparent(img: Image.Image) -> Image.Image:
    """Crop away fully-transparent edges."""
    bbox = img.getbbox()
    if bbox:
        return img.crop(bbox)
    return img


def make_black_transparent(img: Image.Image, threshold: int = 20) -> Image.Image:
    """Make near-black pixels transparent."""
    data = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = data[x, y]
            if a > 0 and r < threshold and g < threshold and b < threshold:
                data[x, y] = (0, 0, 0, 0)
    return img


def decode_and_composite() -> Image.Image:
    """Decode both TIM files and composite them into one RGBA image."""
    bin0 = ASSET_SRC / "0.bin"
    bin1 = ASSET_SRC / "1.bin"

    for p in [bin0, bin1]:
        if not p.exists():
            raise FileNotFoundError(f"Asset not found: {p}\nRun: cd ~/ddw3 && git lfs pull --include='pack/dw2003/screen/tlogousa/**'")

    raw0 = rlen_decompress(bin0.read_bytes())
    raw1 = rlen_decompress(bin1.read_bytes())

    # Layer 0: 8bpp indexed (128×256) — main logo texture
    layer0 = parse_tim(raw0)

    # Layer 1: 15bpp direct (64×256) — highlight/shadow layer
    layer1 = parse_tim(raw1)

    # Make pure black transparent in both layers
    layer0 = make_black_transparent(layer0, threshold=8)
    layer1 = make_black_transparent(layer1, threshold=8)

    # Both are at VRAM origin (0,0); composite onto a canvas sized to hold both.
    # Layer 0 is 128 wide, layer 1 is 64 wide. They share the same VRAM space,
    # so they overlap. Paste layer0 first, then layer1 on top.
    w = max(layer0.width, layer1.width)
    h = max(layer0.height, layer1.height)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(layer0, (0, 0), layer0)
    canvas.alpha_composite(layer1, (0, 0))

    # Autocrop to content
    canvas = autocrop_transparent(canvas)
    if canvas.size == (0, 0):
        # Fallback: return layer0 uncropped if everything cropped away
        return layer0

    return canvas


def main(out_path: Path = OUT_PATH) -> Image.Image:
    """Decode title logo and write PNG. Returns the image."""
    img = decode_and_composite()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    print(f"Saved {out_path}  ({img.width}×{img.height} px)")
    return img


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Decode DW2003 tlogousa title art to PNG")
    parser.add_argument("--out", default=str(OUT_PATH), help="Output PNG path")
    args = parser.parse_args()
    main(Path(args.out))
