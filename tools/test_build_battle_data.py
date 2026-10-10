"""Tests for tools/build_battle_data.py."""

import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_battle_data as bbd


class TestBuildBattleData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = bbd.build_payload()
        cls.by_name = {entry["name"]: entry for entry in cls.payload["digimon"]}

    def test_emits_decoded_growth_and_tech_fields(self):
        kotemon = self.by_name["Kotemon"]
        self.assertEqual(kotemon["growth_xp"], 8)
        self.assertEqual(kotemon["tech_dna_dv"], 0)
        self.assertEqual(kotemon["tech_level_learn"], [0, 0, 0, 0, 0])
        self.assertEqual(kotemon["tech_level_load"], [0, 0, 0, 0, 0])
        self.assertEqual(kotemon["blasts"], [9, 20, 33, 47, 45])

    def test_fields_exist_on_nonstarter_entry(self):
        wargreymon = self.by_name["WarGreymon"]
        self.assertIn("growth_xp", wargreymon)
        self.assertIn("tech_dna_dv", wargreymon)
        self.assertEqual(len(wargreymon["tech_level_learn"]), 5)
        self.assertEqual(len(wargreymon["tech_level_load"]), 5)
        self.assertEqual(len(wargreymon["blasts"]), 5)


if __name__ == "__main__":
    unittest.main()
