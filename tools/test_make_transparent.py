"""Tests for the generated-art chroma-key transparency helper."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

import make_transparent as mt


class KeyDetectionTests(unittest.TestCase):
    def test_detects_most_common_border_color(self):
        image = Image.new("RGB", (5, 5), (0, 255, 0))
        image.putpixel((2, 2), (200, 10, 20))
        self.assertEqual(mt.detect_key_color(image), (0, 255, 0))

    def test_parse_hex_color(self):
        self.assertEqual(mt.parse_hex_color("#00FF7f"), (0, 255, 127))


class TransparencyTests(unittest.TestCase):
    def test_removes_key_and_keeps_subject(self):
        image = Image.new("RGB", (3, 3), (0, 255, 0))
        image.putpixel((1, 1), (255, 0, 0))
        result, key = mt.make_transparent(image)
        self.assertEqual(key, (0, 255, 0))
        self.assertEqual(result.mode, "RGBA")
        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertEqual(result.getpixel((1, 1))[3], 255)

    def test_softens_near_key_edge(self):
        image = Image.new("RGB", (3, 1), (0, 255, 0))
        image.putpixel((1, 0), (20, 220, 20))
        alpha = mt.chroma_alpha(
            image, (0, 255, 0), transparent_distance=5, opaque_distance=100
        )
        self.assertEqual(alpha.getpixel((0, 0)), 0)
        self.assertGreater(alpha.getpixel((1, 0)), 0)
        self.assertLess(alpha.getpixel((1, 0)), 255)

    def test_removes_dark_jpeg_green_but_keeps_muted_green(self):
        image = Image.new("RGB", (2, 1))
        image.putpixel((0, 0), (5, 180, 5))
        image.putpixel((1, 0), (70, 105, 65))
        result, _ = mt.make_transparent(image, key=(0, 255, 0))
        self.assertLess(result.getpixel((0, 0))[3], 80)
        self.assertEqual(result.getpixel((1, 0))[3], 255)

    def test_source_mask_prevents_frame_leakage(self):
        generated = Image.new("RGB", (8, 4), (255, 0, 0))
        generated.putpixel((0, 0), (0, 255, 0))
        source = Image.new("RGBA", (2, 1), (0, 0, 0, 0))
        source.putpixel((0, 0), (255, 255, 255, 255))
        result, _ = mt.make_transparent(
            generated, key=(0, 255, 0), source_mask=source
        )
        self.assertEqual(result.getpixel((1, 2))[3], 255)
        self.assertEqual(result.getpixel((7, 2))[3], 0)

    def test_edge_contract_trims_outer_alpha_pixel(self):
        image = Image.new("RGB", (7, 7), (255, 0, 0))
        result, _ = mt.make_transparent(
            image, key=(0, 255, 0), edge_contract=1, despill=False
        )
        self.assertEqual(result.getpixel((0, 3))[3], 255)

        keyed = Image.new("RGB", (7, 7), (0, 255, 0))
        for y in range(1, 6):
            for x in range(1, 6):
                keyed.putpixel((x, y), (255, 0, 0))
        contracted, _ = mt.make_transparent(
            keyed, key=(0, 255, 0), edge_contract=1, despill=False
        )
        self.assertEqual(contracted.getpixel((1, 3))[3], 0)
        self.assertEqual(contracted.getpixel((2, 3))[3], 255)

    def test_refuses_aspect_mismatched_source_mask(self):
        source = Image.new("RGBA", (2, 1), (0, 0, 0, 255))
        with self.assertRaisesRegex(ValueError, "different aspect ratios"):
            mt.resized_source_alpha(source, (4, 4))


class CommandTests(unittest.TestCase):
    def test_command_writes_rgba_png(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            source = root / "input.png"
            output = root / "output.png"
            Image.new("RGB", (2, 2), (255, 0, 255)).save(source)
            self.assertEqual(mt.main([str(source), str(output)]), 0)
            with Image.open(output) as result:
                self.assertEqual(result.mode, "RGBA")
                self.assertEqual(result.getchannel("A").getextrema(), (0, 0))


if __name__ == "__main__":
    unittest.main()
