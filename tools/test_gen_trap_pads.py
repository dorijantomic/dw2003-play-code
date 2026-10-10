"""Tests for gen_trap_pads.py. Run: python3 tools/test_gen_trap_pads.py"""

import unittest

import wstag_extract
from gen_trap_pads import DIRS, _longest_runs, pad_values_for, reset_dir, trap_mask

# The wrap-maze exit records' own enum (gen_scenes.py:74, from a rig capture):
# 1 south, 3 west, 5 north, 7 east. NOT char+0x60's order.
MAZE_DIR_NAMES = {1: "down", 3: "left", 5: "up", 7: "right"}


class TestLongestRuns(unittest.TestCase):
    def test_contiguous_and_gapped(self):
        # s745-style: an isolated path value 3, then the 6..23 trap run.
        runs = _longest_runs({3, 6, 7, 8, 9, 23} | set(range(10, 23)))
        self.assertIn((6, 23, 18), runs)
        self.assertIn((3, 3, 1), runs)

    def test_empty(self):
        self.assertEqual(_longest_runs(set()), [])


class TestPadValuesFor(unittest.TestCase):
    def test_picks_run_matching_record_count(self):
        # Layer with a 3-long run (5,6,7) plus noise; 3 act-13 records.
        layer = [[5, 6, 7, 9, 0], [5, 6, 7, 99, 0]]
        vals, picked = pad_values_for([layer], 3)
        self.assertEqual(vals, {5, 6, 7})
        self.assertIs(picked, layer)

    def test_no_matching_run_returns_none(self):
        layer = [[5, 6, 7, 0]]   # only a 3-run available
        vals, picked = pad_values_for([layer], 10)
        self.assertIsNone(vals)
        self.assertIsNone(picked)


class TestTrapMask(unittest.TestCase):
    def test_majority_cell_marked(self):
        # 8x8 px layer (one cell). Fill >= half with pad value 6 -> trap cell.
        layer = [[6] * 8 if r < 4 else [0] * 8 for r in range(8)]
        block = trap_mask(layer, {6}, 8, 8)
        self.assertEqual(block["cols"], 1)
        self.assertEqual(block["rows"], 1)
        self.assertEqual(block["mask"], ["1"])

    def test_sparse_cell_not_marked(self):
        layer = [[6] + [0] * 7 for _ in range(8)]   # only 8/64 px are pad
        block = trap_mask(layer, {6}, 8, 8)
        self.assertEqual(block["mask"], ["0"])


class TestResetFacing(unittest.TestCase):
    """The bounce drops the player facing the way the act-13 record's own word
    says: char+0x60's 0-7 order (fieldstg.s:0xe758 / :0xe760 copies it in with
    no translation), named through wstag_extract.DIR8."""

    def test_reads_the_single_char60_table(self):
        self.assertIs(DIRS, wstag_extract.DIR8)

    def test_not_the_wrap_maze_enum(self):
        # The two tables disagree on every odd word, which is exactly what moved
        # s745/s746 (word 7) and s820 (word 3). A pad named with the maze enum
        # would land facing a quarter turn out.
        self.assertIsNot(DIRS, MAZE_DIR_NAMES)
        for word in (1, 3, 5, 7):
            self.assertNotEqual(DIRS[word], MAZE_DIR_NAMES[word], word)

    def test_words_the_three_bug_mazes_carry(self):
        # s745 and s746: 18 and 19 act-13 records all reading word 7.
        # s820: one record reading word 3.
        self.assertEqual(reset_dir(7), "down-right")
        self.assertEqual(reset_dir(3), "up-left")
        self.assertEqual(reset_dir(1), "down-left")
        self.assertEqual(reset_dir(5), "up-right")
        self.assertEqual(reset_dir(0), "down")      # unmapped word: the old default


if __name__ == "__main__":
    unittest.main()
