"""Regression guard for the s415/s815 stage-build gap (docs/superpowers/specs/
2026-07-01-gondola-s415-bg-stage-design.md): both stages must have a manifest
entry, a built map image, and a generated scene file, or the gondola's Blue-Card
HANDOFF to s415 silently no-ops again. Run: python3 tools/test_build_assets_bg_stages.py
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build_assets  # noqa: E402


class TestBgOnlyStagesBuilt(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / "web/assets/manifest.json").read_text())
        self.ids = {m["id"]: m for m in self.manifest["maps"]}

    def test_s415_and_s815_in_manifest(self):
        for sid in ("s415", "s815"):
            self.assertIn(sid, self.ids, f"{sid} missing from manifest.json")
            self.assertGreater(self.ids[sid]["width"], 0)
            self.assertGreater(self.ids[sid]["height"], 0)

    def test_map_images_exist(self):
        for sid in ("s415", "s815"):
            self.assertTrue((ROOT / "web/assets/maps" / f"{sid}.png").exists())

    def test_s415_uses_native_camera_projection_over_viewport_capture(self):
        self.assertTrue(self.ids["s415"]["fixedViewportBackground"])
        self.assertEqual(self.ids["s415"]["cutsceneCameraCenter"], [160, 140])

    def test_scenes_generated(self):
        for sid in ("s415", "s815"):
            self.assertTrue((ROOT / "web/assets/scenes" / f"{sid}.json").exists())

    def test_final_ordinal_aliases_reuse_base_stage_assets(self):
        s920 = next(m for m in build_assets.MAPS if m["id"] == "s920")
        self.assertEqual(s920["assetSource"], "s201")
        self.assertEqual(s920["name"], build_assets._STAGE_NAMES["s201"])


if __name__ == "__main__":
    unittest.main()
