"""Tests for screen_table.py. Run: python3 tools/test_screen_table.py"""

import struct
import unittest

from screen_table import build_table, find_warp_table, parse_lba_names

RS_SAMPLE = """
pub const LBA_FIELDSTG_PRO_IDX: usize = 358;
pub const LBA_WSTAG200_PRO_IDX: usize = 466;
pub const LBA_WSTAG205_PRO_IDX: usize = 467;
pub const LBA_WSTAG500_PRO_IDX: usize = 1039;
pub const LBA_WSTAG505_PRO_IDX: usize = 540;
pub const LBA_WSTAG201_PRO_IDX: usize = 700;
pub const LBA_WSTAG920_PRO_IDX: usize = 701;
"""


def rec(screen_id, lba_idx, ptr=0x800A6000):
    return struct.pack("<3I", screen_id, lba_idx, ptr)


class TestParseLbaNames(unittest.TestCase):
    def test_maps_idx_to_name(self):
        names = parse_lba_names(RS_SAMPLE)
        self.assertEqual(names[466], "WSTAG200_PRO")
        self.assertEqual(names[358], "FIELDSTG_PRO")
        self.assertEqual(names[1039], "WSTAG500_PRO")


class TestFindWarpTable(unittest.TestCase):
    def test_finds_record_run_amid_garbage(self):
        table = rec(0x270, 466) + rec(0x271, 467) + rec(0x23E, 540)
        blob = b"\x12\x34" * 50 + table + b"\xff" * 40
        recs = find_warp_table(blob, min_records=3)
        self.assertEqual(recs, [(0x270, 466), (0x271, 467), (0x23E, 540)])

    def test_misframed_prefix_does_not_eat_the_run(self):
        # A stray word before the table that happens to look like a screen
        # id lets a phase-shifted 1-record "run" start 4 bytes early; the
        # scanner must still find the real 3-record table behind it.
        table = rec(0x270, 466) + rec(0x271, 467) + rec(0x23E, 540)
        blob = struct.pack("<I", 0x250) + table
        recs = find_warp_table(blob, min_records=3)
        self.assertEqual(recs, [(0x270, 466), (0x271, 467), (0x23E, 540)])

    def test_rejects_runs_shorter_than_minimum(self):
        blob = b"\x00" * 64 + rec(0x270, 466) + b"\x00" * 64
        with self.assertRaises(ValueError):
            find_warp_table(blob, min_records=3)


class TestBuildTable(unittest.TestCase):
    def test_resolves_stage_names_and_numbers(self):
        names = parse_lba_names(RS_SAMPLE)
        recs = [(0x23E, 1039), (0x23F, 540)]
        table = build_table(recs, names)
        self.assertEqual(table["574"], {"stage": 500, "lbaIdx": 1039,
                                        "file": "WSTAG500_PRO"})
        self.assertEqual(table["575"]["stage"], 505)

    def test_dual_screen_keeps_variant_as_primary_s9xx_as_alt(self):
        # Screens 0x270+ can map to both a s9xx alias (first in table
        # order) and a story-variant stage; the sub-900 stage is primary.
        names = parse_lba_names(RS_SAMPLE)
        table = build_table([(0x270, 701), (0x270, 700)], names)
        self.assertEqual(table["624"]["stage"], 201)
        self.assertEqual(table["624"]["alt"], {"stage": 920, "lbaIdx": 701,
                                               "file": "WSTAG920_PRO"})

    def test_rejects_non_wstag_destination(self):
        names = parse_lba_names(RS_SAMPLE)
        with self.assertRaises(ValueError):
            build_table([(0x23E, 358)], names)  # FIELDSTG is not a stage


if __name__ == "__main__":
    unittest.main()
