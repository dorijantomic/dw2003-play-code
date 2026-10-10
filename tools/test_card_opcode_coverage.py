"""Tests for the card-effect opcode coverage measurement.

This tool exists because a manifest note called the card-effect interpreter "the
largest single decode gap in the project" when every one of its handler bodies
already had a written reading. The tests pin the two things that made that note
wrong, plus the parsing the tool would otherwise get silently wrong.
"""

from __future__ import annotations

import unittest

from tools import card_opcode_coverage as cov


class RegistryTests(unittest.TestCase):
    def test_the_174_opcodes_reach_far_fewer_distinct_bodies(self) -> None:
        # The note counted opcodes and called them bodies. They are not the same
        # number: opcodes share handlers, which is the whole correction.
        enter, update = cov.registry_targets()
        self.assertEqual(len(enter), 40)
        self.assertEqual(len(update), 56)
        self.assertEqual(len(set(enter) & set(update)), 0,
                         "the two phases share no target; a body is one or the other")
        self.assertEqual(len(set(enter) | set(update)), 96)

    def test_every_target_carries_the_opcodes_that_reach_it(self) -> None:
        enter, update = cov.registry_targets()
        for table in (enter, update):
            for addr, ops in table.items():
                self.assertTrue(addr.startswith("0x"), addr)
                self.assertTrue(ops, f"{addr} must record which opcodes reach it")


class DescriptionTests(unittest.TestCase):
    def test_every_handler_has_a_reading_with_a_confidence_mark(self) -> None:
        enter, update = cov.registry_targets()
        desc = cov.described()
        marks = {desc[a][0] for a in (set(enter) | set(update)) if a in desc}
        self.assertTrue(marks <= {"high", "med", "low"}, marks)
        missing = [a for a in (set(enter) | set(update)) if a not in desc]
        # Exactly four targets sit outside pro/cardgame, so the reading of that
        # overlay's 268 bodies cannot cover them. If this number moves, the
        # claim "all 96 are read" needs restating rather than quietly widening.
        self.assertEqual(len(missing), 4, sorted(missing))


class VerdictParsingTests(unittest.TestCase):
    def test_it_reads_the_verdict_out_of_a_known_line(self) -> None:
        line = ("target=0x8008ec44 overlay=cardgame verdict=DECODED "
                "function=F0x8008ec44 exact_start=YES anchors=3 claims=2")
        import re
        m = re.search(r"target=(0x[0-9a-fA-F]{8}).*?verdict=(\w+)", line)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(1), "0x8008ec44")
        self.assertEqual(m.group(2), "DECODED")

    def test_no_addresses_means_no_subprocess(self) -> None:
        # Guards against shelling out with an empty argument list, which would
        # make `known` scan everything.
        self.assertEqual(cov.anchored([]), {})


if __name__ == "__main__":
    unittest.main()
