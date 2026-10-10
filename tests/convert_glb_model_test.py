"""Acceptance checks for the generated GLB creature's articulated attack."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from convert_glb_model import keyed_motion  # noqa: E402
from model_authoring import pose  # noqa: E402


class GlbAnimationTest(unittest.TestCase):
    def test_attack_animates_every_joint_independently(self):
        recipe = json.loads((ROOT / "data/model-authoring/recipes/hunyuan_glb_conversion.json").read_text())
        model = json.loads((ROOT / "data/custom/m905xros/anim.json").read_text())
        self.assertNotIn("animation_style", recipe)
        signatures = []
        for guide, bone in zip(recipe["joints"], model["bones"]):
            self.assertEqual(set(guide["motion_curves"]), {"idle", "attack", "hit", "victory"})
            attack = [key[:3] for key in bone["anim"]["ch2"] if 150 <= key[3] <= 240]
            self.assertGreater(max(max(abs(angle) for angle in key) for key in attack), 20,
                               f"{guide['id']} remains rigid during attack")
            signatures.append(tuple(tuple(key) for key in attack))
        self.assertEqual(len(set(signatures)), len(signatures), "joints share one motion track")
        tail = model["bones"][3]["anim"]["ch2"]
        base = model["bones"][2]["anim"]["ch2"]
        peak = lambda track: max((key for key in track if 150 <= key[3] <= 240),
                                 key=lambda key: key[1])[3]
        self.assertGreater(peak(tail), peak(base), "tail tip must follow the base")
        report = json.loads((ROOT / "data/custom/m905xros/conversion-report.json").read_text())
        self.assertLess(report["seams"]["max_animated_gap"], .1)
        self.assertGreater(report["seams"]["vertices"], 300)
        self.assertGreater(next(part["faces"] for part in report["parts"]
                                if part["id"] == "hand_b"), 200)
        self.assertTrue(any(entry is not None for bone in model["bones"]
                            for entry in bone["skin"]))
        rest = pose(model, 0)
        ground = max(translation[1] + sum(rotation[1][axis] * vertex[axis]
                                         for axis in range(3))
                     for bone, (translation, rotation) in zip(model["bones"], rest)
                     for vertex in bone["verts"])
        self.assertLess(abs(ground), .1, "rest pose feet miss the arena floor")

    def test_bad_motion_curve_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "must span 0..1"):
            keyed_motion({"id": "probe", "motion_curves": {
                "attack": [[.2, 0, 0, 0], [1, 50, 0, 0]]}})


if __name__ == "__main__":
    unittest.main()
