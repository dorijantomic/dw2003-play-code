"""Tests for gen_npc_sprites.py. Run: python3 tools/test_gen_npc_sprites.py

The global npc_id->sprite TABLE is decoded straight from FIELDSTG .data. It must
cover the FULL table the game indexes -- the field engine's resolver does a bare
`TABLE[npc_id]` with no upper bound, and event/cutscene puppets use npc_ids well
above 255 (e.g. the Blue-Card "Trickster Guilmon" reveal NPCs in Seiryu). The old
`MAX_NPC_ID = 256` truncation made those high-nid actors resolve to nothing, so
they were wrongly treated as invisible. The table ends naturally at npc_id 405;
entry 406 is a different .data structure.
"""

import unittest

from gen_npc_sprites import build_table


class TestSpriteTable(unittest.TestCase):
    table = build_table()

    def test_covers_high_nid_event_puppets(self):
        # npc 369 = Seiryu-Tower reveal Guilmon (dialogue 362 "it's a fake...").
        self.assertEqual(self.table.get("369"), "p194girl")
        # npc 296 = Tricky Guilmon who hands over the fake "8lue Card".
        self.assertEqual(self.table.get("296"), "p076hanm")

    def test_stops_at_true_table_end(self):
        # 405 is the last real handle (p196patl); 406 is the next .data block.
        self.assertEqual(self.table.get("405"), "p196patl")
        self.assertNotIn("406", self.table)

    def test_full_table_not_truncated_at_256(self):
        # The pre-fix table had 243 entries (npc_id 1..255). The real table has
        # many more high-nid puppets.
        self.assertGreater(len(self.table), 243)
        self.assertTrue(any(int(k) > 255 for k in self.table))

    def test_in_range_invisible_markers_still_absent(self):
        # handle 0 entries (npc 63/112/113/198) remain genuinely spriteless.
        for nid in ("63", "112", "113", "198"):
            self.assertNotIn(nid, self.table)


if __name__ == "__main__":
    unittest.main()
