"""Tests for report_stage_interactions.py. Run: python3 tools/test_report_stage_interactions.py"""

import unittest

import report_stage_interactions as rsi


class TestReportStageInteractions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assets = rsi.collect_assets()

    def test_s505_contains_exit_and_npc_grant(self):
        doc = rsi.render(["s505"], self.assets)
        self.assertIn("## s505", doc)
        self.assertIn("| 688,416 32x32 | s500 | 232,380 | right |", doc)
        self.assertIn("AgumonSuit(15)", doc)

    def test_missing_spawn_formats_as_dash(self):
        doc = rsi.render(["s410"], self.assets)
        self.assertNotIn("None,None", doc)
        self.assertIn("| 450,296 56x48 | s440 | - | - |", doc)

    def test_available_stages_sorted(self):
        stages = rsi.available_stages()
        self.assertEqual(stages[0], "s200")
        self.assertIn("s505", stages)


if __name__ == "__main__":
    unittest.main()
