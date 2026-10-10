"""Tests for zone_registration.py. Run: python3 tools/test_zone_registration.py"""

import glob
import os
import unittest
from collections import Counter

from extract_zone_grids import WSTAG_DIR
from extract_story_trigger_grids import type7_id
from zone_registration import registrations, type0_id, type_id


def _all_stages():
    stages = []
    for path in glob.glob(os.path.join(WSTAG_DIR, "wstag*.s")):
        name = os.path.basename(path)
        stages.append(name[len("wstag"):-len(".s")])
    return stages


class TestControlStages(unittest.TestCase):
    def test_type0_sub(self):
        self.assertEqual(type0_id("350")[1], 1)
        self.assertEqual(type0_id("205")[1], 2)
        self.assertEqual(type0_id("745")[1], 1)
        self.assertEqual(type0_id("825")[1], 1)

    def test_type7_sub(self):
        self.assertEqual(type_id("350", 7)[1], 2)
        self.assertEqual(type_id("205", 7)[1], 1)
        self.assertEqual(type_id("745", 7)[1], 2)
        self.assertEqual(type_id("825", 7)[1], 2)


class TestPopulation(unittest.TestCase):
    def test_type0_population_and_sub_distribution(self):
        stages = _all_stages()
        self.assertEqual(len(stages), 294)
        found = {}
        missing = []
        for s in stages:
            tid = type0_id(s)
            if tid is None:
                missing.append(s)
            else:
                found[s] = tid
        self.assertEqual(len(found), 292)
        self.assertEqual(sorted(missing), ["260", "415"])
        subs = Counter(fn_sub[1] for fn_sub in found.values())
        self.assertEqual(dict(subs), {0: 10, 1: 238, 2: 26, 4: 4, 6: 14})
        self.assertEqual(subs[2], 26)


class TestCrossValidation(unittest.TestCase):
    def test_type7_via_tracker_agrees_with_committed_type7_id(self):
        # Validates the generic register tracker against the already-verified
        # window matcher on the type it CAN also parse (type 7), as a sanity
        # check that the tracker isn't silently wrong before trusting it on
        # type 0 (which the window matcher structurally cannot parse at all).
        stages = _all_stages()
        pairs = 0
        disagreements = []
        for s in stages:
            tracked = type_id(s, 7)
            committed = type7_id(s)
            if tracked is not None and committed is not None:
                pairs += 1
                if tracked != committed:
                    disagreements.append((s, tracked, committed))
        self.assertEqual(disagreements, [])
        self.assertEqual(pairs, 282)


class TestPhantomRegistrationRegression(unittest.TestCase):
    def test_exactly_one_type0_registration(self):
        expected_sub = {
            "295": 1,
            "305": 1,
            "311": 1,
            "366": 1,
            "620": 1,
            "655": 1,
            "947": 1,
            "922": 4,
        }
        for s, sub in expected_sub.items():
            type0_regs = [(idx, a0, a1) for idx, a0, a1 in registrations(s) if a0 == 0]
            self.assertEqual(len(type0_regs), 1, f"stage {s}: {type0_regs}")
            _, _, a1 = type0_regs[0]
            self.assertEqual(a1 & 0xFFFF, sub, f"stage {s}")


if __name__ == "__main__":
    unittest.main()
