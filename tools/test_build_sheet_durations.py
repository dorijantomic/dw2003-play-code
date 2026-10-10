"""Tests for build_assets.py's build_sheet() frameDurations propagation.
Run: python3 tools/test_build_sheet_durations.py
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root
import build_assets as ba


class TestBuildSheetFrameDurations(unittest.TestCase):
    def test_character_entry_has_frame_durations_matching_frame_counts(self):
        # First authored CHARACTERS entry is guaranteed to have real sprite PNGs on disk.
        char = ba.CHARACTERS[0]
        entry = ba.build_sheet(char, ba.CHAR_ROW_ORDER)
        self.assertIn("frameDurations", entry)
        for direction in entry["rows"]:
            self.assertEqual(
                len(entry["frameDurations"][direction]), entry["frameCounts"][direction],
                f"duration/count length mismatch for {direction}",
            )

    def test_npc_entry_has_frame_durations_matching_frame_counts(self):
        npc = ba.NPCS[0]
        entry = ba.build_sheet(npc, ba.NPC_ROW_ORDER)
        self.assertIn("frameDurations", entry)
        for direction in entry["rows"]:
            self.assertEqual(
                len(entry["frameDurations"][direction]), entry["frameCounts"][direction],
                f"duration/count length mismatch for {direction}",
            )

    def test_mirrored_right_row_reuses_left_durations(self):
        char = ba.CHARACTERS[0]
        entry = ba.build_sheet(char, ba.CHAR_ROW_ORDER)
        self.assertEqual(entry["frameDurations"]["right"], entry["frameDurations"]["left"])


if __name__ == "__main__":
    unittest.main()
