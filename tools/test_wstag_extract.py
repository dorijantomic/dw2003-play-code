"""Tests for wstag_extract.py. Run: python3 tools/test_wstag_extract.py"""

import struct
import unittest

import wstag_extract as W
from wstag_extract import (SIG, extract_doors, extract_warps, extract_ladders,
                           _decode_flaglist, extract_npcs, decode_ptrb_dialogues,
                           valid_flaglist, valid_triple_array, find_puppet_records,
                           _OVERLAY_BASE)

SCREENS = {"574": {"stage": 500}, "575": {"stage": 505},
           "512": {"stage": 200}}


def sig_rec(active, ident, x, y, d, param):
    return SIG + struct.pack("<6H", active, ident, x, y, d, param)


def trigger(idx, x, y1, y2):
    return struct.pack("<9H", 1, 0x0440 + idx, idx, 0, 0, x, y1, y2, 0)


class TestExtractDoors(unittest.TestCase):
    def test_finds_trigger_segments(self):
        data = b"\x00" * 16 + trigger(0, 300, 100, 150) + trigger(5, 600, 80, 130)
        doors = extract_doors(data)
        self.assertEqual([(d["idx"], d["x"], d["y1"], d["y2"]) for d in doors],
                         [(0, 300, 100, 150), (5, 600, 80, 130)])


class TestExtractLadders(unittest.TestCase):
    def test_pairs_act2_bottom_with_act3_top_by_id(self):
        # act2 (bottom) then act3 (top), same id 8; plus a second pair id 9.
        data = (b"\x00" * 8
                + sig_rec(2, 8, 240, 1240, 0, 0)
                + sig_rec(3, 8, 256, 1104, 0, 0)
                + sig_rec(2, 9, 816, 520, 0, 0)
                + sig_rec(3, 9, 832, 368, 0, 0))
        lad = extract_ladders(data)
        self.assertEqual(len(lad), 2)
        self.assertEqual(lad[0], {"id": 8, "bottom": {"x": 240, "y": 1240},
                                  "top": {"x": 256, "y": 1104}})
        self.assertEqual(lad[1]["top"], {"x": 832, "y": 368})

    def test_no_act2_records_gives_empty(self):
        data = b"\x00" * 8 + sig_rec(1, 512, 100, 200, 5, 0)
        self.assertEqual(extract_ladders(data), [])


class TestExtractWarps(unittest.TestCase):
    def test_active_records_with_screen_ids_are_warps(self):
        # A warp record's facing word is char+0x60's 0-7 index, copied into the
        # arriving actor unmapped (fieldstg.s:0xe758/:0xe760), so 7 is
        # down-right and 3 is up-left -- not the four-entry table this test used
        # to assert (7 = "right", 3 = "left"), which was a step out of true.
        data = (b"\x12\x34" * 16
                + sig_rec(1, 574, 232, 380, 7, 0)
                + b"\x00" * 4
                + sig_rec(1, 575, 704, 432, 3, 102))
        warps = extract_warps(data, SCREENS)
        self.assertEqual(warps, [
            {"screen": 574, "stage": 500, "spawnX": 232, "spawnY": 380,
             "dir": "down-right", "param": 0},
            {"screen": 575, "stage": 505, "spawnX": 704, "spawnY": 432,
             "dir": "up-left", "param": 102},
        ])

    def test_inactive_and_other_record_types_skipped(self):
        data = (sig_rec(0, 0, 0, 0, 0, 0)        # terminator
                + sig_rec(2, 3, 272, 256, 0, 0)  # act=2/3: not warps
                + sig_rec(1, 5000, 1, 2, 5, 0))  # id not a screen
        self.assertEqual(extract_warps(data, SCREENS), [])

    def test_every_facing_word_gets_a_name(self):
        # The eight words of char+0x60, in the disc's own order.
        self.assertEqual([W.DIR8[i] for i in range(8)], [
            "down", "down-left", "left", "up-left",
            "up", "up-right", "right", "down-right",
        ])
        # A self-warp record is no exception: 4 is "up", and it used to be kept
        # numeric only because the old table had no entry for it.
        warps = extract_warps(sig_rec(1, 512, 576, 216, 4, 0), SCREENS)
        self.assertEqual(warps[0]["dir"], "up")
        self.assertEqual(warps[0]["stage"], 200)

    def test_word_outside_the_eight_stays_numeric(self):
        warps = extract_warps(sig_rec(1, 512, 576, 216, 9, 0), SCREENS)
        self.assertEqual(warps[0]["dir"], 9)


class TestDecodeFlaglist(unittest.TestCase):
    """The spawn-gate flag-condition list at record+0x0 (F0x80016924).
    Reads {u16 id, u16 expected} pairs, 0xffff-terminated."""

    def test_single_condition(self):
        # {0x7018, 1}{0xffff} = spawn iff get_flag(0x7018)==1 (s200 0x800a6fa0)
        data = struct.pack("<HHHH", 0x7018, 0x0001, 0xFFFF, 0x0000)
        self.assertEqual(_decode_flaglist(data, 0),
                         [{"id": 0x7018, "expected": 1}])

    def test_multi_condition_and(self):
        # {0x7015,1}{0x6008,0}{0x6009,0}{0xffff} (s200 file 0x1140)
        data = struct.pack("<8H", 0x7015, 1, 0x6008, 0, 0x6009, 0, 0xFFFF, 0)
        self.assertEqual(_decode_flaglist(data, 0),
                         [{"id": 0x7015, "expected": 1},
                          {"id": 0x6008, "expected": 0},
                          {"id": 0x6009, "expected": 0}])

    def test_empty_list_terminator_first(self):
        data = struct.pack("<H", 0xFFFF)
        self.assertEqual(_decode_flaglist(data, 0), [])

    def test_respects_offset(self):
        data = struct.pack("<6H", 0xDEAD, 0xBEEF, 0x4004, 1, 0xFFFF, 0)
        self.assertEqual(_decode_flaglist(data, 4),
                         [{"id": 0x4004, "expected": 1}])


class TestDecodePtrbDialogues(unittest.TestCase):
    """ptrB is the per-NPC dialogue state machine (talk handler F0x80090afc):
    12-byte triples {ptr1=flag-gate, ptr2=on-close set_flag table, id=estalk00 line}.
    The handler shows estalk00[id] of the first triple whose ptr1 gate passes, then
    applies ptr2 on close. (Was wrongly read as talk-word lists + a story counter.)
    See docs/research/scripting/field-script-engine-verified.md §WS5."""

    def _overlay(self, *blocks):
        # concatenate byte blocks at OVERLAY_BASE, return (data, base)
        return b"".join(blocks)

    def test_triple_emits_id_gate_and_onclose(self):
        B = _OVERLAY_BASE
        gate = struct.pack("<4H", 0x1A00, 1, 0xFFFF, 0)        # @+0x00  get_flag(0x1a00)==1
        onclose = struct.pack("<4H", 0x9004, 1, 0xFFFF, 0)     # @+0x08  set_flag(0x9004,1)
        triple = struct.pack("<III", B + 0, B + 8, 1158)       # @+0x10  id=1158 (estalk00 idx)
        term = struct.pack("<III", 0, 0, 0)                    # @+0x1c
        data = self._overlay(gate, onclose, triple, term)
        self.assertEqual(
            decode_ptrb_dialogues(data, B + 0x10),
            [{"id": 1158,
              "gate": [{"id": 0x1A00, "expected": 1}],
              "on_close": [{"id": 0x9004, "expected": 1}]}],
        )

    def test_null_gate_is_unconditional(self):
        B = _OVERLAY_BASE
        triple = struct.pack("<III", 0, 0, 103)                # ptr1=ptr2=0
        term = struct.pack("<III", 0, 0, 0)
        data = struct.pack("<I", 0) + triple + term            # pad so B+4 = triple
        self.assertEqual(
            decode_ptrb_dialogues(data, B + 4),
            [{"id": 103, "gate": [], "on_close": []}],
        )


class TestSpawnFlagsEmitted(unittest.TestCase):
    """extract_npcs attaches the decoded flag-list as `spawn_flags`."""

    def _overlay_with_one_npc(self, flaglist_words):
        # Build a tiny overlay: [flaglist @0x40][record @0x80]
        buf = bytearray(0x200)
        fl_off = 0x40
        struct.pack_into("<%dH" % len(flaglist_words), buf, fl_off, *flaglist_words)
        rec_off = 0x80
        # {flaglist_ptr, ptrB=0, slot5|npc46, y0x20|x0x30, n=5}
        struct.pack_into("<IIIII", buf, rec_off,
                         _OVERLAY_BASE + fl_off, 0,
                         (5 << 16) | 46, (0x20 << 16) | 0x30, 5)
        # terminator record (all-zero npc_id breaks the run)
        return bytes(buf)

    def test_spawn_flags_present(self):
        data = self._overlay_with_one_npc([0x4004, 1, 0xFFFF, 0])
        npcs = extract_npcs(data)
        self.assertEqual(len(npcs), 1)
        self.assertEqual(npcs[0]["spawn_flags"], [{"id": 0x4004, "expected": 1}])


class TestPuppetRecordMerge(unittest.TestCase):
    """High-nid event/quest puppets live in SEPARATE mini-tables the best-run scan
    discards; extract_npcs merges them in when their ptrB validates as a real
    dialogue-triple array (so npc 369, the Seiryu reveal Guilmon, appears as a
    visible NPC instead of being dropped by the old nid<=200 cap)."""

    def _overlay(self, puppet_pb_valid=True):
        buf = bytearray(0x400)
        B = _OVERLAY_BASE
        # flag-list @0x40: {0x4004==1} terminated
        struct.pack_into("<HHH", buf, 0x40, 0x4004, 1, 0xFFFF)
        # valid triple array @0x60: one triple {gate=flaglist, set=0, id=362} + (0,0,0)
        struct.pack_into("<III", buf, 0x60, B + 0x40, 0, 362)
        struct.pack_into("<III", buf, 0x6C, 0, 0, 0)
        # main contiguous table @0x100: one plain NPC (nid46, ptrB=0), then a
        # zero record that breaks the run.
        struct.pack_into("<IIIII", buf, 0x100, 0, 0, (5 << 16) | 46, (100 << 16) | 100, 1)
        # separate puppet record @0x180: nid369, slot16, pos(833,257), ptrB->triple
        struct.pack_into("<IIIII", buf, 0x180, 0, B + 0x60, (16 << 16) | 369, (257 << 16) | 833, 5)
        if not puppet_pb_valid:
            # point ptrB at non-triple bytes -> must be rejected
            struct.pack_into("<I", buf, 0x184, B + 0x200)
        return bytes(buf)

    def test_puppet_merged_as_visible_npc(self):
        npcs = extract_npcs(self._overlay())
        ids = {n["id"] for n in npcs}
        self.assertIn(46, ids)            # main NPC still present
        self.assertIn(369, ids)           # puppet surfaced
        p = next(n for n in npcs if n["id"] == 369)
        self.assertEqual((p["x"], p["y"]), (833, 257))
        self.assertEqual(p["ptrb_dialogues"][0]["id"], 362)

    def test_garbage_ptrb_not_admitted(self):
        npcs = extract_npcs(self._overlay(puppet_pb_valid=False))
        self.assertNotIn(369, {n["id"] for n in npcs})

    def test_single_line_ungated_puppet_admitted(self):
        """A puppet whose dialogue is ONE ungated line {0,0,id} (no internal
        gate/on_close pointer) must still be admitted. Real case: s200 Asuka City
        Agumon npc365 -> estalk00[21] and Patamon npc371 -> estalk00[20], both
        gated (via the record's ptrA spawn-flag list) on progress ordinal 0x6004
        (post-Genji-Kuwagamon). The old nontrivial-triple guard dropped these, so
        neither Digimon rendered after the fight."""
        buf = bytearray(0x400)
        B = _OVERLAY_BASE
        # ptrA spawn-gate flag list @0x40: {0x6004 == 1}
        struct.pack_into("<HHH", buf, 0x40, 0x6004, 1, 0xFFFF)
        # ptrB single-line dialogue array @0x60: {0,0,21} then (0,0,0) terminator
        struct.pack_into("<III", buf, 0x60, 0, 0, 21)
        struct.pack_into("<III", buf, 0x6C, 0, 0, 0)
        # puppet record @0x180: nid365 slot12 pos(719,235), ptrA->gate, ptrB->array
        struct.pack_into("<IIIII", buf, 0x180, B + 0x40, B + 0x60,
                         (12 << 16) | 365, (235 << 16) | 719, 7)
        npcs = extract_npcs(bytes(buf))
        p = next((n for n in npcs if n["id"] == 365), None)
        self.assertIsNotNone(p, "single-line ungated puppet must be admitted")
        self.assertEqual((p["x"], p["y"]), (719, 235))
        self.assertEqual(p["ptrb_dialogues"][0]["id"], 21)
        self.assertEqual(p["spawn_flags"], [{"id": 0x6004, "expected": 1}])

    def test_validators(self):
        buf = bytearray(0x80)
        struct.pack_into("<HHH", buf, 0x10, 0x4004, 1, 0xFFFF)
        self.assertTrue(valid_flaglist(bytes(buf), 0x10))
        # A LIST OF NOPLISTS is still rejected: no entry at all before the
        # terminator, and a bank past the plausible range.
        struct.pack_into("<HH", buf, 0x00, 0xFFFF, 0)
        self.assertFalse(valid_flaglist(bytes(buf), 0x00))
        struct.pack_into("<HHH", buf, 0x20, 0xFC00, 1, 0xFFFF)
        self.assertFalse(valid_flaglist(bytes(buf), 0x20))
        # Flag id 0x0000 IS a legitimate id — bank 0x00 bit 0, the "repeat-examine
        # search point" unary counter's first bit, verified live at s235's Asuka Inn
        # shelf (docs/research/field/repeat-examine-search-points-2026-07-26.md). The
        # assertion below used to demand the opposite and had been failing since that
        # correction: the validator changed on purpose and this line did not.
        struct.pack_into("<HHH", buf, 0x30, 0x0000, 1, 0xFFFF)
        self.assertTrue(valid_flaglist(bytes(buf), 0x30))


if __name__ == "__main__":
    unittest.main()
