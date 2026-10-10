"""Focused checks for native model authoring validation."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("custom_fight_model", ROOT / "tools/custom_fight_model.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class CustomFightModelTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.folder = "m999guide"
        self.source = self.root / self.folder
        self.source.mkdir()
        example = ROOT / "data/custom" / self.folder
        self.model = json.loads((example / "anim.json").read_text())
        (self.source / "texture.png").write_bytes((example / "texture.png").read_bytes())
        self.save()

    def save(self):
        (self.source / "anim.json").write_text(json.dumps(self.model))

    def test_complete_independent_example(self):
        self.assertEqual(tool.validate(self.folder, self.root)["triangles"], 4)

    def test_blend_target_end_sentinel_matches_extracted_models(self):
        self.model["timeline"][0]["table"].insert(
            1, {"value": 0x8001, "loop_target": 0xffff, "aux": 0})
        self.save()
        self.assertEqual(tool.validate(self.folder, self.root)["triangles"], 4)

    def test_bad_parent_and_missing_motion_table(self):
        self.model["bones"][1]["parent_slot"] = 3
        self.save()
        with self.assertRaisesRegex(ValueError, "parent_slot"):
            tool.validate(self.folder, self.root)
        self.model["bones"][1]["parent_slot"] = 1
        self.model["actions"][5]["ops"].insert(0, {"op": 2, "words": [0, 0, 14]})
        self.save()
        with self.assertRaisesRegex(ValueError, "timeline 14"):
            tool.validate(self.folder, self.root)

    def test_texture_cannot_be_non_power_of_two(self):
        Image.new("RGBA", (300, 300), "blue").save(self.source / "texture.png")
        with self.assertRaisesRegex(ValueError, "power-of-two"):
            tool.validate(self.folder, self.root)

    def test_inspect_reports_bone_and_draws_uv_overlay(self):
        overlay = self.root / "overlay.png"
        with patch.object(tool, "SOURCE_ROOT", self.root):
            rows = tool.inspect(self.folder, 1, overlay)
        self.assertEqual(rows[0]["triangles"], 2)
        self.assertEqual(rows[0]["parent_slot"], 1)
        with Image.open(overlay) as image:
            self.assertEqual(image.size, (256, 256))

    def test_build_registers_new_name_and_rejects_existing_name(self):
        dest = self.root / "assets"
        (dest / "models").mkdir(parents=True)
        (dest / "textures").mkdir()
        (dest / "models/index.json").write_text('["m005grey"]')
        (dest / "model_map.json").write_text('{"Greymon":"m005grey"}')
        registry = self.root / "registry.json"
        registry.write_text("{}")
        with patch.object(tool, "SOURCE_ROOT", self.root), patch.object(tool, "DEST", dest), patch.object(tool, "REGISTRY", registry):
            tool.build(self.folder, "Guide Example")
            self.assertEqual(json.loads(registry.read_text())["Guide Example"], self.folder)
            self.assertEqual(json.loads((dest / "model_map.json").read_text())["Greymon"], "m005grey")
            self.assertIn(self.folder, json.loads((dest / "models/index.json").read_text()))
            with self.assertRaisesRegex(ValueError, "already maps"):
                tool.build(self.folder, "Greymon")


if __name__ == "__main__":
    unittest.main()
