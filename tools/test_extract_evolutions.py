"""Tests for tools/extract_evolutions.py.

The extractor reads the disc's own overlay image, so these are checks that the
eight tables it writes are the ones pro/stfgtrep.s file 0x369C-0x390C scans: eight
pointers at 0x8008903C, 44 records of 0x10 bytes each, in table order.
"""

import json
import os
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_evolutions as ee

OUT = Path(__file__).resolve().parent.parent / "web/assets/data/evolutions.json"


class TestExtractEvolutions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = ee.OVERLAY.read_bytes()
        cls.lines = ee.read_lines(cls.image)
        cls.payload = json.loads(OUT.read_text())

    def test_eight_lines_of_44_records(self):
        self.assertEqual(len(self.lines), 8)
        for line in self.lines:
            self.assertEqual(line["digimonId"], line["slot"] + 1)
            self.assertEqual(len(line["records"]), 44)

    def test_the_committed_json_is_what_the_image_says(self):
        self.assertEqual(self.payload["lines"], self.lines)

    def test_tree_pointers_are_the_disc_table_at_0x8008903C(self):
        # Eight equal 0x2C0-byte blocks in a row: that contiguity is what makes the
        # `slt $s3,$s7+0x2c0` walk bound (pro/stfgtrep.s file 0x38CC) read all 44 rows.
        groups = [struct.unpack_from("<I", self.image, ee.TREE_GROUP_TABLE - ee.LOAD_BASE + 4 * slot)[0]
                  for slot in range(8)]
        for earlier, later in zip(groups, groups[1:]):
            self.assertEqual(later - earlier, ee.GROUP_BYTES)

    def test_every_line_grants_the_same_44_forms_in_the_same_order(self):
        targets = [record["to"] for record in self.lines[0]["records"]]
        self.assertEqual(targets, list(range(9, 53)))
        for line in self.lines[1:]:
            self.assertEqual([record["to"] for record in line["records"]], targets)

    def test_kotemon_sample_rows(self):
        kotemon = self.lines[0]["records"]
        # Row 0: the starter's first unlock, and nothing but its own level asks.
        self.assertEqual(kotemon[0], {"to": 9, "req0": 0, "req0Level": 1, "req1": 0,
                                     "req1Level": 1, "kind": 7, "threshold": 5})
        # Row 2: Grizzmon behind Growlmon at Skill LV 30 and SPD 280.
        self.assertEqual(kotemon[2], {"to": 11, "req0": 14, "req0Level": 30, "req1": 0,
                                      "req1Level": 1, "kind": 5, "threshold": 280})
        # Row 16: Paildramon, the two requirement slots both filled.
        self.assertEqual(kotemon[16], {"to": 25, "req0": 13, "req0Level": 5, "req1": 18,
                                       "req1Level": 5, "kind": 0, "threshold": 1})
        # Row 41: Imperialdramon-P, the last of the two-form rows.
        self.assertEqual(kotemon[41], {"to": 50, "req0": 44, "req0Level": 40, "req1": 49,
                                       "req1Level": 40, "kind": 0, "threshold": 1})

    def test_renamon_line_puts_kyubimon_at_level_5_on_row_6(self):
        self.assertEqual(self.lines[6]["records"][6],
                         {"to": 15, "req0": 0, "req0Level": 1, "req1": 0,
                          "req1Level": 1, "kind": 7, "threshold": 5})

    def test_lines_differ_only_in_their_requirements(self):
        for other in self.lines[1:]:
            self.assertTrue(
                any(a["req0"] != b["req0"] or a["kind"] != b["kind"]
                    for a, b in zip(self.lines[0]["records"], other["records"])),
                "a line whose gates match the first line's is not a separate table")

    def test_no_requirement_or_kind_outside_what_the_routine_reads(self):
        kinds = {0, *range(1, 7), 7, *range(8, 15)}
        for line in self.lines:
            for record in line["records"]:
                self.assertIn(record["kind"], kinds)
                # A 0 requirement word carries the routine's placeholder level.
                for evo, level in ((record["req0"], record["req0Level"]),
                                   (record["req1"], record["req1Level"])):
                    if evo == 0:
                        self.assertEqual(level, 1)
                    else:
                        self.assertGreaterEqual(level, 0)


if __name__ == "__main__":
    unittest.main()