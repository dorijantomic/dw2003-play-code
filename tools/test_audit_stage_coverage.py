"""Tests for audit_stage_coverage.py. Run: python3 tools/test_audit_stage_coverage.py

The s420 integration case pins the doc'd Seiryu census (34 point records,
point-sprite-ambient-system.md); the classify() cases exercise the gap
bucketing logic synthetically.
"""

import unittest

import audit_stage_coverage as asc


def card(stage="s000", dec=None, shp=None, shipped=None):
    d = {"pack": True, "tmpk": True, "mask": True, "descriptor_fields": [],
         "music_id": [], "bgm": [],
         "points": 0, "points_error": None, "events": 0, "native_events": 0,
         "materialize_candidate": False}
    d.update(dec or {})
    s = {"points": 0, "events": 0, "scene": True, "sound": True,
         "materialize": False, "native": False}
    s.update(shp or {})
    return asc.classify(stage, d, s, shipped or {"events": {}, "sounds": {}})


class TestClassify(unittest.TestCase):
    def test_points_missing_and_partial(self):
        self.assertEqual(card(dec={"points": 5})["points_missing"]["n"], 5)
        g = card(dec={"points": 5}, shp={"points": 3})["points_partial"]
        self.assertEqual((g["n"], g["shipped"], g["declared"]), (2, 3, 5))
        self.assertEqual(card(dec={"points": 5}, shp={"points": 5}), {})

    def test_point_actor_gated_by_native_and_materialize(self):
        dec = {"materialize_candidate": True}
        self.assertIn("point_actor_unparsed", card(dec=dec))
        self.assertNotIn("point_actor_unparsed",
                         card(dec=dec, shp={"native": True}))
        self.assertNotIn("point_actor_unparsed",
                         card(dec=dec, shp={"materialize": True}))

    def test_bgm_mismatch(self):
        shipped = {"events": {}, "sounds": {"s000": {
            "play_id": "0x60100000", "alt_play_ids": ["0x607c0000"]}}}
        self.assertEqual(card(dec={"bgm": [0x60100000, 0x607C0000]},
                              shipped=shipped), {})
        g = card(dec={"bgm": [0x60990000]}, shipped=shipped)["bgm_mismatch"]
        self.assertEqual(g["declared"], ["0x60990000"])

    def test_scene_and_sound_missing(self):
        self.assertIn("scene_missing", card(shp={"scene": False}))
        self.assertIn("sound_missing",
                      card(dec={"bgm": [1]}, shp={"scene": False, "sound": False}))

    def test_descriptor_field_unknown_only_fires_on_new_offsets(self):
        # Every offset in the decoded map is silent...
        known = sorted(asc.DESCRIPTOR_FIELDS)
        self.assertNotIn("descriptor_field_unknown",
                         card(dec={"descriptor_fields": known}))
        # ...an offset nothing has decoded yet is reported by name.
        g = card(dec={"descriptor_fields": known + [0x44]})
        self.assertEqual(g["descriptor_field_unknown"]["offsets"], ["+0x44"])


class TestIntegration(unittest.TestCase):
    def test_no_meft_bucket_from_point_sprite_x_coordinates(self):
        """Regression: the falsified 2026-07-04 MEFT census, removed 2026-08-05.

        s480 used to report 'MEFT placements 1017, 1047'. Both numbers are the
        X COORDINATE of a point sprite the walker already renders — the census
        matched `X<<16|kind` in the 18-byte point records at u32 alignment and
        read X as a MEFT id. No stage-to-MEFT binding is known, so nothing
        here may be bucketed per stage.
        """
        c = asc.audit(["s480"])["s480"]
        self.assertNotIn("meft_unrendered", c["gaps"])
        xs = {r["x"] for r in
              asc.load_shipped()["points"]["s480"]["records"]}
        self.assertTrue({1017, 1047} <= xs)

    def test_s420_matches_seiryu_census(self):
        cards = asc.audit(["s420"])
        c = cards["s420"]
        self.assertEqual(c["declared"]["points"], 34)  # the doc'd windmill census
        self.assertEqual(c["shipped"]["points"], 34)
        self.assertEqual(c["declared"]["events"], c["shipped"]["events"])
        for bucket in ("points_missing", "points_partial", "points_error",
                       "point_actor_unparsed", "scene_missing"):
            self.assertNotIn(bucket, c["gaps"])

    def test_baseline_shape_roundtrip(self):
        cards = {"s001": {"declared": {}, "shipped": {},
                          "gaps": {"points_missing": {"n": 3, "declared": 3}}}}
        self.assertEqual(asc.baseline_shape(cards),
                         {"points_missing": {"s001": 3}})


if __name__ == "__main__":
    unittest.main()
