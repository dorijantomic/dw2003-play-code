"""What the semi-transparent-texel repair must and must not do.

The stitch itself needs ~/ddw3's tile tree, so these cover the decisions the
tool makes about pixels: which texels are made solid, and which pixels of the
shipped map are allowed to change.
"""

import sys
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from restitch_map_stp import HALF, config_of, patch, process_path, solidify  # noqa: E402


def img(pixels):
    im = Image.new("RGBA", (len(pixels[0]), len(pixels)))
    px = im.load()
    for y, row in enumerate(pixels):
        for x, v in enumerate(row):
            px[x, y] = v
    return im


BLACK_HALF = (0, 0, 0, HALF)
BLACK_SOLID = (0, 0, 0, 255)
CLEAR = (0, 0, 0, 0)
ART = (200, 100, 50, 255)


class Solidify(unittest.TestCase):
    def test_makes_a_half_texel_opaque_and_keeps_its_colour(self):
        out, n = solidify(img([[(10, 20, 30, HALF)]]))
        self.assertEqual(n, 1)
        self.assertEqual(out.load()[0, 0], (10, 20, 30, 255))

    def test_leaves_a_cut_out_transparent(self):
        """A fully transparent texel is a hole the console does not draw."""
        out, n = solidify(img([[CLEAR]]))
        self.assertEqual((n, out.load()[0, 0]), (0, CLEAR))

    def test_leaves_opaque_artwork_alone(self):
        out, n = solidify(img([[ART]]))
        self.assertEqual((n, out.load()[0, 0]), (0, ART))


class Patch(unittest.TestCase):
    def test_writes_only_the_pixels_the_fix_changes(self):
        shipped = img([[ART, (9, 9, 9, 255)]])
        faithful = img([[BLACK_HALF, (9, 9, 9, 255)]])
        solid = img([[BLACK_SOLID, (9, 9, 9, 255)]])
        was_half, covered = patch(shipped, faithful, solid)
        self.assertEqual((was_half, covered), (1, 0))
        self.assertEqual(shipped.load()[0, 0], BLACK_SOLID)
        self.assertEqual(shipped.load()[1, 0], (9, 9, 9, 255),
                         "an unchanged pixel must survive untouched")

    def test_counts_a_blended_pixel_separately(self):
        """Half-alpha black over artwork darkens it; the console covers it."""
        shipped = img([[(100, 50, 25, 255)]])
        faithful = img([[(100, 50, 25, 255)]])
        solid = img([[BLACK_SOLID]])
        self.assertEqual(patch(shipped, faithful, solid), (0, 1))
        self.assertEqual(shipped.load()[0, 0], BLACK_SOLID)

    def test_changes_nothing_when_the_stitches_agree(self):
        shipped, faithful, solid = img([[ART]]), img([[ART]]), img([[ART]])
        self.assertEqual(patch(shipped, faithful, solid), (0, 0))
        self.assertEqual(shipped.load()[0, 0], ART)

    def test_refuses_a_size_mismatch(self):
        with self.assertRaises(SystemExit):
            patch(img([[ART]]), img([[ART, ART]]), img([[ART, ART]]))


class PathRules(unittest.TestCase):
    def test_a_leading_slash_means_the_ddw3_root(self):
        self.assertEqual(process_path("/build/tim/a.tim", Path("/somewhere")),
                         Path.home() / "ddw3/build/tim/a.tim")

    def test_a_relative_path_hangs_off_its_config(self):
        self.assertEqual(process_path("8.png", Path("/base")), Path("/base/8.png"))

    def test_a_built_path_names_the_config_beside_its_source(self):
        self.assertEqual(config_of(Path("/x/build/tim/dw2003/s300pack/8.tim")),
                         Path("/x/tim/dw2003/s300pack/8.toml"))


if __name__ == "__main__":
    unittest.main()
