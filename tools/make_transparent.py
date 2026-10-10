#!/usr/bin/env python3
"""Remove a flat chroma-key background from generated game artwork.

The default key is detected from the most common border pixel.  For sprite-sheet
redraws, ``--source-mask`` can additionally constrain the result to the alpha
silhouette of the authentic source image.

Examples:
    py tools/make_transparent.py gemini.png p002plyk-hd.png
    py tools/make_transparent.py gemini.png p002plyk-hd.png \
        --source-mask web/assets/sprites/p002plyk.png
"""
from __future__ import annotations

import argparse
import math
import sys
from collections import Counter
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("Pillow is required. Install it with: py -m pip install Pillow")


def pixel_data(image: Image.Image):
    """Use Pillow's current pixel iterator while retaining older-version support."""
    getter = getattr(image, "get_flattened_data", None)
    return getter() if getter is not None else image.getdata()


def parse_hex_color(value: str) -> tuple[int, int, int]:
    value = value.strip().removeprefix("#")
    if len(value) != 6:
        raise argparse.ArgumentTypeError("key color must be six hex digits, e.g. #00FF00")
    try:
        return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("key color must contain only hex digits") from exc


def border_pixels(image: Image.Image) -> list[tuple[int, int, int]]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width == 0 or height == 0:
        return []
    pixels = rgb.load()
    border = [pixels[x, 0] for x in range(width)]
    if height > 1:
        border.extend(pixels[x, height - 1] for x in range(width))
    if width > 1:
        border.extend(pixels[0, y] for y in range(1, height - 1))
        border.extend(pixels[width - 1, y] for y in range(1, height - 1))
    return border


def detect_key_color(image: Image.Image) -> tuple[int, int, int]:
    border = border_pixels(image)
    if not border:
        raise ValueError("cannot detect a key color from an empty image")
    return Counter(border).most_common(1)[0][0]


def chroma_alpha(
    image: Image.Image,
    key: tuple[int, int, int],
    *,
    transparent_distance: float,
    opaque_distance: float,
) -> Image.Image:
    """Build an alpha matte from RGB distance to the chroma-key color."""
    if transparent_distance < 0:
        raise ValueError("transparent distance cannot be negative")
    if opaque_distance <= transparent_distance:
        raise ValueError("opaque distance must be greater than transparent distance")

    rgb = image.convert("RGB")
    alpha = Image.new("L", rgb.size)
    output: list[int] = []
    span = opaque_distance - transparent_distance
    kr, kg, kb = key
    for red, green, blue in pixel_data(rgb):
        distance = math.sqrt(
            (red - kr) ** 2 + (green - kg) ** 2 + (blue - kb) ** 2
        )
        amount = (distance - transparent_distance) / span
        output.append(round(max(0.0, min(1.0, amount)) * 255))
    alpha.putdata(output)
    return alpha


def compressed_key_alpha(
    image: Image.Image,
    key: tuple[int, int, int],
    *,
    opaque_excess: float = 60,
    transparent_excess: float = 200,
) -> Image.Image | None:
    """Recognize a JPEG-compressed single-channel key independent of brightness.

    A nominal #00FF00 background may contain much darker greens after JPEG
    compression. RGB distance alone mistakes those blocks for foreground, while
    channel dominance still distinguishes them from muted green clothing.
    """
    dominant = max(range(3), key=key.__getitem__)
    ordered = sorted(key, reverse=True)
    if ordered[0] - ordered[1] < 128:
        return None
    if transparent_excess <= opaque_excess:
        raise ValueError("transparent excess must be greater than opaque excess")

    rgb = image.convert("RGB")
    alpha = Image.new("L", rgb.size)
    span = transparent_excess - opaque_excess
    output: list[int] = []
    for pixel in pixel_data(rgb):
        excess = pixel[dominant] - max(
            pixel[index] for index in range(3) if index != dominant
        )
        foreground = (transparent_excess - excess) / span
        output.append(round(max(0.0, min(1.0, foreground)) * 255))
    alpha.putdata(output)
    return alpha


def despill_edges(
    image: Image.Image, alpha: Image.Image, key: tuple[int, int, int]
) -> Image.Image:
    """Reduce the dominant key channel on partially transparent edge pixels."""
    rgba = image.convert("RGBA")
    channels = list(key)
    dominant = max(range(3), key=channels.__getitem__)
    if channels[dominant] - max(channels[(dominant + 1) % 3], channels[(dominant + 2) % 3]) < 64:
        return rgba

    output: list[tuple[int, int, int, int]] = []
    for pixel, alpha_value in zip(pixel_data(rgba), pixel_data(alpha)):
        color = list(pixel[:3])
        if 0 < alpha_value < 255:
            other_max = max(color[index] for index in range(3) if index != dominant)
            spill = max(0, color[dominant] - other_max)
            edge_strength = 1.0 - alpha_value / 255.0
            color[dominant] -= round(spill * edge_strength)
        output.append((*color, alpha_value))
    rgba.putdata(output)
    return rgba


def resized_source_alpha(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    if "A" not in source.getbands():
        raise ValueError("source mask image has no alpha channel")
    source_ratio = source.width / source.height
    output_ratio = size[0] / size[1]
    if not math.isclose(source_ratio, output_ratio, rel_tol=0.0, abs_tol=1e-6):
        raise ValueError(
            "source mask and generated image have different aspect ratios: "
            f"{source.size} vs {size}"
        )
    return source.getchannel("A").resize(size, Image.Resampling.LANCZOS)


def intersect_alpha(first: Image.Image, second: Image.Image) -> Image.Image:
    output = Image.new("L", first.size)
    output.putdata([min(a, b) for a, b in zip(pixel_data(first), pixel_data(second))])
    return output


def make_transparent(
    image: Image.Image,
    *,
    key: tuple[int, int, int] | None = None,
    transparent_distance: float = 12,
    opaque_distance: float = 90,
    source_mask: Image.Image | None = None,
    despill: bool = True,
    edge_contract: int = 0,
) -> tuple[Image.Image, tuple[int, int, int]]:
    resolved_key = key if key is not None else detect_key_color(image)
    alpha = chroma_alpha(
        image,
        resolved_key,
        transparent_distance=transparent_distance,
        opaque_distance=opaque_distance,
    )
    compressed_alpha = compressed_key_alpha(image, resolved_key)
    if compressed_alpha is not None:
        alpha = intersect_alpha(alpha, compressed_alpha)
    if edge_contract < 0:
        raise ValueError("edge contract cannot be negative")
    if edge_contract:
        alpha = alpha.filter(ImageFilter.MinFilter(edge_contract * 2 + 1))
    if source_mask is not None:
        alpha = intersect_alpha(alpha, resized_source_alpha(source_mask, image.size))
    result = despill_edges(image, alpha, resolved_key) if despill else image.convert("RGBA")
    result.putalpha(alpha)
    return result, resolved_key


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Remove a flat generated-image background and write an alpha PNG."
    )
    parser.add_argument("input", type=Path, help="Gemini/chroma-key input image")
    parser.add_argument("output", type=Path, help="output PNG path")
    parser.add_argument(
        "--key",
        type=parse_hex_color,
        help="explicit RRGGBB key color; default: most common border color",
    )
    parser.add_argument(
        "--transparent-distance",
        type=float,
        default=12,
        help="RGB distance considered completely transparent (default: 12)",
    )
    parser.add_argument(
        "--opaque-distance",
        type=float,
        default=90,
        help="RGB distance considered completely opaque (default: 90)",
    )
    parser.add_argument(
        "--source-mask",
        type=Path,
        help="optional authentic RGBA sprite whose alpha silhouette constrains output",
    )
    parser.add_argument(
        "--edge-contract",
        type=int,
        default=0,
        help="trim this many contaminated pixels from the alpha edge (default: 0)",
    )
    parser.add_argument("--no-despill", action="store_true", help="do not clean key-colored edge spill")
    parser.add_argument("--overwrite", action="store_true", help="allow replacing an existing output")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.input.is_file():
        raise FileNotFoundError(f"input image does not exist: {args.input}")
    if args.output.exists() and not args.overwrite:
        raise FileExistsError(
            f"output already exists: {args.output} (pass --overwrite to replace it)"
        )
    if args.output.suffix.lower() != ".png":
        raise ValueError("output must use the .png extension to preserve transparency")

    with Image.open(args.input) as image:
        image.load()
        source = None
        if args.source_mask:
            if not args.source_mask.is_file():
                raise FileNotFoundError(f"source mask does not exist: {args.source_mask}")
            with Image.open(args.source_mask) as source_image:
                source_image.load()
                source = source_image.copy()
        result, key = make_transparent(
            image,
            key=args.key,
            transparent_distance=args.transparent_distance,
            opaque_distance=args.opaque_distance,
            source_mask=source,
            despill=not args.no_despill,
            edge_contract=args.edge_contract,
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output, format="PNG", optimize=True)
    transparent = sum(value == 0 for value in pixel_data(result.getchannel("A")))
    total = result.width * result.height
    print(
        f"Wrote {args.output} ({result.width}x{result.height}, RGBA)\n"
        f"Key color: #{key[0]:02X}{key[1]:02X}{key[2]:02X}\n"
        f"Fully transparent: {transparent}/{total} pixels ({transparent / total:.1%})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
