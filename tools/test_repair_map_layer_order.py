"""What the map-tile layer-order repair must and must not do.

The stitch itself needs ~/ddw3's tile tree, so these cover the decisions the
tool makes about pixels: which order the layers are drawn in, and how a changed
pixel is reported.
"""

import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from repair_map_layer_order import DEPTH_ORDER, classify  # noqa: E402


def img(pixels):
    im = Image.new("RGBA", (len(pixels[0]), len(pixels)))
    px = im.load()
    for y, row in enumerate(pixels):
        for x, v in enumerate(row):
            px[x, y] = v
    return im


CLEAR = (0, 0, 0, 0)
GROUND = (200, 100, 50, 255)
FILL = (48, 80, 96, 255)
FG = (10, 200, 10, 255)


class DrawOrder(unittest.TestCase):
    def test_layer_two_is_drawn_first_and_the_foreground_last(self):
        """Far to near: layer 2 at depth 11, ground at 7, foreground at 3."""
        self.assertEqual(DEPTH_ORDER, (2, 0, 1))


class Classify(unittest.TestCase):
    def test_reports_a_pixel_layer_two_covered_on_the_ground(self):
        """The case a player sees: flat fill lying over finished artwork."""
        changed, over_ground, over_fg, other = classify(
            img([[FILL]]), img([[GROUND]]), img([[GROUND]]), img([[CLEAR]]))
        self.assertEqual((changed, over_ground, over_fg, other),
                         ([(0, 0)], 1, 0, 0))

    def test_separates_a_pixel_the_foreground_overlay_redraws(self):
        """Layer 2 over foreground art is repaired at runtime anyway, so it is
        counted apart from the pixels a player actually sees wrongly."""
        _, over_ground, over_fg, _ = classify(
            img([[FILL]]), img([[FG]]), img([[CLEAR]]), img([[FG]]))
        self.assertEqual((over_ground, over_fg), (0, 1))

    def test_ignores_a_pixel_both_orders_agree_on(self):
        """Most overlapping texels carry the same colour in both layers; moving
        them changes nothing and must not be written or counted."""
        changed, *_ = classify(
            img([[GROUND]]), img([[GROUND]]), img([[GROUND]]), img([[CLEAR]]))
        self.assertEqual(changed, [])


if __name__ == "__main__":
    unittest.main()
