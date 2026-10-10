"""Checks for the reusable model catalog and native model operations."""

import copy
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import model_authoring as author  # noqa: E402


class ModelAuthoringTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(author.CATALOG.read_text())
        cls.source = json.loads((ROOT / "web/assets/battle/models/m003agum/anim.json").read_text())

    def test_catalog_is_decoded_collection_with_structural_patterns(self):
        self.assertEqual(len(self.catalog["models"]), 245)
        self.assertGreater(sum(len(r["parts"]) for r in self.catalog["models"].values()), 4000)
        self.assertGreater(len(self.catalog["patterns"]["clusters"]), 10)
        row = self.catalog["models"]["m003agum"]
        self.assertTrue(all("bind_local" in b and "regions" in b and "motion" in b for b in row["bones"]))
        self.assertTrue(all("pattern" in part for part in row["parts"]))
        with sqlite3.connect(author.DATABASE) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM models").fetchone()[0], 245)
            vertices, faces = db.execute("SELECT vertices, triangles FROM bones WHERE model_id='m003agum' AND bone_id=0").fetchone()
            self.assertEqual(json.loads(vertices), self.source["bones"][0]["verts"])
            self.assertEqual(json.loads(faces), self.source["bones"][0]["faces"])
            self.assertGreater(len(db.execute("SELECT texture_png FROM models WHERE id='m003agum'").fetchone()[0]), 1000)

    def test_part_retrieval_can_use_size_and_joint_anchor(self):
        part = self.catalog["models"]["m005grey"]["parts"][0]
        box = [hi-lo for lo, hi in part["bounds_world"]]
        anchor = [(part["root_position"][i]-part["bounds_world"][i][0])/box[i]
                  for i in range(3)]
        matches = author.search_parts(self.catalog, {"box": box, "anchor": anchor,
                                                      "joint_axis": [1, 0, 0]}, limit=5)
        self.assertTrue(matches)
        self.assertGreaterEqual(matches[0][0], 0)

    def test_recipe_site_reflection_is_deterministic(self):
        sites = list(author.expand_sites([{"position": [.2, .3, .4],
                                           "direction": [-1, 0, .5], "mirror_axis": 0}]))
        self.assertEqual(len(sites), 2)
        self.assertEqual(sites[1]["position"], [.8, .3, .4])
        self.assertEqual(sites[1]["direction"], [1, 0, .5])

    def test_adapt_scales_whole_chain_without_touching_other_bones(self):
        model = copy.deepcopy(self.source)
        row = author.describe(model)
        part = author.select_part(row, {"centerline": True, "direction": [0, 0, 1], "bone_count": 3})
        before = copy.deepcopy(model)
        author.adapt_chain(model, part, [0, 0, 1], 1.3, .9)
        self.assertEqual(before["bones"][0], model["bones"][0])
        self.assertNotEqual(before["bones"][part["root"]]["verts"], model["bones"][part["root"]]["verts"])
        child = part["bones"][1]
        self.assertNotEqual(before["bones"][child]["anim"]["ch1"], model["bones"][child]["anim"]["ch1"])

    def test_complete_chain_transplant_preserves_parent_links_and_texture(self):
        model = copy.deepcopy(self.source)
        donor = json.loads((ROOT / "web/assets/battle/models/m373rena/anim.json").read_text())
        source_part = next(p for p in author.describe(donor)["parts"] if p["root"] == 10)
        root = len(model["bones"])
        copied = author.transplant(model, donor, source_part, 0, [0, 0, 0], .6, "inherit", [0, 0, 1])
        self.assertEqual(len(copied), len(source_part["bones"]))
        self.assertEqual(model["bones"][root]["parent_slot"], 1)
        self.assertEqual(model["bones"][root+1]["parent_slot"], root+1)
        image = Image.open(ROOT / "web/assets/battle/textures/m003agum.png").convert("RGBA")
        donor_image = Image.open(ROOT / "web/assets/battle/textures/m373rena.png").convert("RGBA")
        copied_image = image.copy()
        uv = author.copy_part_texture(model, copied.values(), donor, source_part["bones"],
                                      copied_image, donor_image, author.atlas_occupancy(self.source))
        self.assertNotEqual(uv["source_uv"], uv["target_uv"])
        self.assertEqual(uv["source_uv"][2]-uv["source_uv"][0], uv["target_uv"][2]-uv["target_uv"][0])

    def test_attachment_clearance_is_motion_sampled_and_deterministic(self):
        donor = json.loads((ROOT / "web/assets/battle/models/m005grey/anim.json").read_text())
        parent = donor["bones"][15]["parent_slot"]-1
        profile = author.attachment_clearance(donor, 15, parent, [0, 1, 2], [0, 100, 300, 500])
        self.assertEqual(len(profile), 4)
        self.assertTrue(all(len(row) == 3 and all(value >= 0 for value in row) for row in profile))
        self.assertEqual(author.attachment_profile_error(profile, profile, 1), 0)

    def test_generated_surface_is_joined_to_existing_triangle(self):
        model = copy.deepcopy(self.source)
        target = max(range(len(model["bones"])), key=lambda i: len(model["bones"][i]["faces"]))
        bone = model["bones"][target]
        old_faces = len(bone["faces"])
        old_verts = len(bone["verts"])
        rect = author.allocate(author.atlas_occupancy(model), 24, 24)
        attachment = author.protrusion(model, target, [.5, .15, .4], [0, -1, 0], 1.3, rect, self.catalog["patterns"])
        self.assertEqual(len(bone["faces"]), old_faces+3)
        self.assertEqual(len(bone["verts"]), old_verts+1)
        self.assertEqual(set(attachment["face"]), set(v for face in bone["faces"][-3:] for v in face[:3] if v != old_verts))

    def test_fitted_shell_and_local_paint_keep_valid_mesh_and_atlas(self):
        model = json.loads((ROOT / "web/assets/battle/models/m005grey/anim.json").read_text())
        model["folder"] = "m705test"
        image = author.source_texture("m005grey")
        reference = Image.new("RGB", (32, 32), (70, 75, 85))
        bone_id = 2
        original_faces = [len(b["faces"]) for b in model["bones"]]
        rect = author.allocate(author.atlas_occupancy(model), 32, 32)
        author.fill_island(image, rect, (70, 75, 85))
        shell = author.armor_shell(model, bone_id, [.5, .08, .45], [0, -1, -.25],
                                   10, .12, rect, original_faces[bone_id])
        self.assertGreaterEqual(shell["faces"], 4)
        painted = author.paint_mesh_region(model, image, [bone_id], reference,
                                           [.5, .5], 1, [[0, .5]])
        self.assertGreater(painted["pixels"], 20)
        author.validate_generated(model, image, [], [0, 100], original_faces)

    def test_generated_chain_uses_measured_pattern_and_validates_motion(self):
        model = copy.deepcopy(self.source)
        model["folder"] = "m705test"
        image = Image.open(ROOT / "web/assets/battle/textures/m003agum.png").convert("RGBA")
        pattern = next(p for p in self.catalog["patterns"]["clusters"] if p["bone_count_median"] >= 3)
        result = author.generate_chain(model, 0, [.5, .2, .4], [0, -1, 0], .3,
                                       pattern, image, (60, 90, 140), author.atlas_occupancy(model))
        self.assertGreaterEqual(result["segments"], 2)
        self.assertEqual(model["num_bones"], len(self.source["bones"])+result["segments"])
        validated = author.validate_generated(model, image, [result], [0, 100, 300, 500])
        self.assertEqual(validated["attachments"], 1)

    def test_repaint_uses_reference_color_and_keeps_uv_alpha(self):
        image = Image.open(ROOT / "web/assets/battle/textures/m003agum.png").convert("RGBA")
        before_alpha = image.getchannel("A").tobytes()
        reference = Image.new("RGB", (20, 20), (60, 100, 145))
        result = author.repaint_palette(image, reference, [{"source_rank": 0, "reference_sample": [.5, .5]}])
        self.assertEqual(tuple(result[0]["reference_color"]), (60, 100, 145))
        self.assertEqual(image.getchannel("A").tobytes(), before_alpha)

    def test_validation_rejects_a_broken_parent_and_uv(self):
        model = copy.deepcopy(self.source)
        model["folder"] = "m705test"
        image = Image.open(ROOT / "web/assets/battle/textures/m003agum.png").convert("RGBA")
        model["bones"][1]["parent_slot"] = 200
        with self.assertRaisesRegex(ValueError, "invalid parent"):
            author.validate_generated(model, image, [], [0])
        model["bones"][1]["parent_slot"] = self.source["bones"][1]["parent_slot"]
        model["bones"][0]["faces"][0][3] = 300
        with self.assertRaisesRegex(ValueError, "invalid UV"):
            author.validate_generated(model, image, [], [0])

    def test_second_creature_uses_same_recipe_pipeline(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "design.png"
            Image.new("RGB", (64, 64), (70, 110, 150)).save(reference)
            recipe = {
                "base_model": "m003agum", "output_model": "m705probe", "reference": str(reference),
                "changes": [
                    {"operation": "adapt_chain", "select": {"centerline": True, "direction": [0, 0, 1], "bone_count": 3},
                     "axis": [0, 0, 1], "length_scale": 1.2},
                    {"operation": "surface_protrusions", "select": {"centerline": True, "direction": [0, -1, -.3], "bone_count": 2},
                     "reference_sample": [.5, .5], "sites": [{"position": [.5, .1, .4],
                                                          "direction": [0, -1, 0], "length_ratio": 1.2}]}
                ], "validation": {"idle": 0, "attack": 14, "hit": 20, "victory": 44}}
            model, texture, report = author.build_recipe(recipe, self.catalog)
            self.assertEqual(model["folder"], "m705probe")
            self.assertEqual(report["validation"]["attachments"], 1)
            self.assertEqual(len(set(report["validation"]["samples"].values())), 4)
            self.assertEqual(texture.size, (256, 256))


if __name__ == "__main__":
    unittest.main()
