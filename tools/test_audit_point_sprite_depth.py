"""What the point-sprite depth audit must get right about footprints.

The fleet measurement needs ~/ddw3's tile tree and the built effect sheets, so
these cover the pixel decisions the tool makes on its own: which texels a
record's sprite claims, and that clipping never invents or loses an overlap.
"""

import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_point_sprite_depth import (  # noqa: E402
    CONTROL_BUCKET, MID_BUCKETS, sprite_mask,
)
import audit_point_sprite_depth as audit  # noqa: E402


def sheet(rows):
    """Boolean sheet alpha from a picture: '#' opaque, '.' transparent."""
    return np.array([[c == "#" for c in row] for row in rows], dtype=bool)


class SpriteMask(unittest.TestCase):
    SHEET = sheet([
        "##..",
        "#...",
        "....",
        "....",
    ])

    def mask(self, layers, x, y, shape=(8, 8)):
        return sprite_mask(self.SHEET, layers, x, y, shape)

    def test_places_only_the_opaque_texels(self):
        m = self.mask([{"x": 0, "y": 0, "w": 2, "h": 2, "dx": 0, "dy": 0}], 3, 4)
        self.assertEqual(sorted(map(tuple, np.argwhere(m))),
                         [(4, 3), (4, 4), (5, 3)])

    def test_layer_offset_moves_the_footprint(self):
        m = self.mask([{"x": 0, "y": 0, "w": 2, "h": 2, "dx": -1, "dy": 2}], 3, 4)
        self.assertEqual(sorted(map(tuple, np.argwhere(m))),
                         [(6, 2), (6, 3), (7, 2)])

    def test_several_layers_union(self):
        m = self.mask([
            {"x": 0, "y": 0, "w": 1, "h": 1, "dx": 0, "dy": 0},
            {"x": 0, "y": 0, "w": 1, "h": 1, "dx": 2, "dy": 0},
        ], 1, 1)
        self.assertEqual(sorted(map(tuple, np.argwhere(m))), [(1, 1), (1, 3)])

    def test_negative_position_clips_without_wrapping(self):
        # A record placed off the top-left keeps only the texels still on the
        # map. Slicing with a negative index would wrap them to the far edge.
        solid = sheet(["##", "##"])
        m = sprite_mask(solid, [{"x": 0, "y": 0, "w": 2, "h": 2,
                                 "dx": 0, "dy": 0}], -1, -1, (8, 8))
        self.assertEqual(sorted(map(tuple, np.argwhere(m))), [(0, 0)])

    def test_clips_past_the_far_edge(self):
        solid = sheet(["##", "##"])
        m = sprite_mask(solid, [{"x": 0, "y": 0, "w": 2, "h": 2,
                                 "dx": 0, "dy": 0}], 7, 7, (8, 8))
        self.assertEqual(sorted(map(tuple, np.argwhere(m))), [(7, 7)])

    def test_fully_off_map_claims_nothing(self):
        m = self.mask([{"x": 0, "y": 0, "w": 2, "h": 2, "dx": 0, "dy": 0}], 20, 20)
        self.assertFalse(m.any())


class CellOrigin(unittest.TestCase):
    """A map object's world_offset is relative to its own 128x128 cell.

    Reading it as an absolute coordinate compares the props against the wrong
    part of the map. It answered a clean, wrong zero on 2026-08-21 and was only
    caught by a screenshot; these pin the arithmetic so it cannot come back.
    """

    def test_layer_mask_offsets_each_object_by_its_cell(self):
        # A 3-cell-wide map. The object sits at world_offset (5, 6) of cell 4,
        # which is column 1, row 1 -> map pixel (128 + 5, 128 + 6).
        cfg = {"width": 3, "height": 2, "entries": ["a"] * 6}
        tile = Image.new("RGBA", (16, 16), (9, 9, 9, 255))
        layers = [[((5, 6), (0, 0), (2, 2))], [], []]

        with mock.patch.object(audit, "tomllib") as tl, \
             mock.patch.object(audit, "parse_entry") as pe, \
             mock.patch.object(audit.Image, "open") as op, \
             mock.patch.object(audit, "solidify", side_effect=lambda t: (t, 0)), \
             mock.patch.object(audit.Path, "exists", return_value=True), \
             mock.patch.object(audit.Path, "read_text", return_value=""):
            tl.loads.return_value = cfg
            pe.side_effect = lambda e: (Path("t.png"), layers) if e == "a" else (None, [])
            op.return_value = tile
            mask = audit.layer_mask("sX", 0, (256, 384))

        expected = sorted(
            (128 * row + 6 + dy, 128 * col + 5 + dx)
            for row in (0, 1) for col in (0, 1, 2)
            for dy in (0, 1) for dx in (0, 1)
        )
        self.assertEqual(sorted(map(tuple, np.argwhere(mask))), expected)


class Buckets(unittest.TestCase):
    def test_measured_buckets_lie_between_the_map_layers(self):
        # Ground draws at 7 and map layer 2 at 11, so only these can sit
        # between them; the control must draw in front of the ground.
        self.assertEqual(MID_BUCKETS, (8, 9, 10))
        for bucket in MID_BUCKETS:
            self.assertTrue(7 < bucket < 11)
        self.assertLess(CONTROL_BUCKET, 7)


if __name__ == "__main__":
    unittest.main()
