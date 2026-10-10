import unittest

from extract_story_trigger_grids import compact_lookup


class CompactLookupTests(unittest.TestCase):
    def test_truly_constant_grid_is_compacted(self):
        self.assertEqual(compact_lookup([0, 0, 0, 0], 32, 2, 2), {"uniform": 0})
        self.assertEqual(compact_lookup([32, 32], 32, 2, 1), {"uniform": 32})

    def test_background_plus_one_trigger_value_keeps_geometry(self):
        grid = [0, 0, 32, 0]
        self.assertEqual(compact_lookup(grid, 32, 2, 2), {
            "cell": 32,
            "w": 2,
            "h": 2,
            "grid": grid,
        })


if __name__ == "__main__":
    unittest.main()
