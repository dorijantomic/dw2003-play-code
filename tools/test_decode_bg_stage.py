"""Tests for tools/decode_bg_stage.py -- the bg01 TIM-slice background decoder used
for the two stages (s415, s815) that have no map/dw2003/z_stage tile-stitch pack.
Run: python3 tools/test_decode_bg_stage.py
"""

import unittest
from pathlib import Path

from decode_bg_stage import bg_only_stage_ids, decode_bg01


class TestBgOnlyStageIds(unittest.TestCase):
    def test_finds_s415_and_s815(self):
        ids = bg_only_stage_ids()
        self.assertIn("s415", ids)
        self.assertIn("s815", ids)

    def test_excludes_stages_with_a_zstage_pack(self):
        # s410 has a normal map/dw2003/z_stage/s410pack.toml, so even if it had a
        # bg01 dir (it doesn't) it must never appear here.
        ids = bg_only_stage_ids()
        self.assertNotIn("s410", ids)


class TestDecodeBg01(unittest.TestCase):
    def test_s415_override_exists_and_is_320x240_rgba(self):
        override_path = Path(__file__).resolve().parent.parent / "web/assets/bg_override/s415.png"
        self.assertTrue(override_path.exists(), f"Override file not found at {override_path}")
        img = decode_bg01("s415")
        self.assertEqual(img.size, (320, 240))
        self.assertEqual(img.mode, "RGBA")

    def test_s815_is_128x256_rgba(self):
        img = decode_bg01("s815")
        self.assertEqual(img.size, (128, 256))
        self.assertEqual(img.mode, "RGBA")


if __name__ == "__main__":
    unittest.main()
