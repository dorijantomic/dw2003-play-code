"""Tests for extract_stage_encounters.py. Run: python3 tools/test_extract_stage_encounters.py"""

import struct
import unittest

from extract_stage_encounters import zone_blocks, _is_record

VALID = {54, 85, 86, 188, 200, 272, 328}


def rec(screen, param=0, tag=0x60080000):
    return struct.pack("<HHHHI", screen, 0, param, 0, tag)


def block(screens):
    assert len(screens) == 8
    return b"".join(rec(s, tag=(0x60040000 if s == 0 else 0x60080000)) for s in screens)


# An 8-record block is followed by a pad word + 8-pointer array in the real overlay;
# those pointer words are 0x800a.... (high nibble 8) so they break the record run.
PTRS = struct.pack("<I", 0) + struct.pack("<8I", *([0x800A6000] * 8))


class TestIsRecord(unittest.TestCase):
    def test_tag_must_be_0x60xx0000(self):
        self.assertTrue(_is_record(200, 18, 0x60080000))
        self.assertFalse(_is_record(200, 18, 0x12345678))   # wrong tag
        self.assertFalse(_is_record(200, 18, 0x60080001))   # low16 != 0
        self.assertFalse(_is_record(0x10000, 18, 0x60080000))  # screen not u16


class TestZoneBlocks(unittest.TestCase):
    def test_s200_genji_zone(self):
        data = b"\x00" * 8 + block([188, 200, 272, 0, 0, 0, 0, 0]) + PTRS
        self.assertEqual(zone_blocks(data, VALID), [[188, 200, 272, 0, 0, 0, 0, 0]])

    def test_weights_preserved_repeats_and_no_miss(self):
        # s320-style: 50/50 pool, never a miss.
        data = block([85, 85, 85, 85, 86, 86, 86, 86]) + PTRS
        self.assertEqual(zone_blocks(data, VALID), [[85, 85, 85, 85, 86, 86, 86, 86]])

    def test_all_empty_block_kept_for_index_alignment(self):
        # The engine indexes zoneArray[zone-1] positionally, so an all-empty block
        # occupies a zone number and must not be dropped. Live RAM (savestate 9,
        # s330 Central Park, 2026-07-26) has four blocks with the third all-empty.
        self.assertEqual(zone_blocks(block([0] * 8) + PTRS, VALID), [[0] * 8])

    def test_empty_block_does_not_renumber_later_blocks(self):
        data = (block([0] * 8) + PTRS + block([85, 85, 0, 0, 0, 0, 0, 0]) + PTRS)
        self.assertEqual(zone_blocks(data, VALID),
                         [[0] * 8, [85, 85, 0, 0, 0, 0, 0, 0]])

    def test_multiple_zones_kept_separate(self):
        data = (block([54, 0, 0, 0, 0, 0, 0, 0]) + PTRS
                + block([328, 328, 0, 0, 0, 0, 0, 0]) + PTRS)
        self.assertEqual(zone_blocks(data, VALID),
                         [[54, 0, 0, 0, 0, 0, 0, 0], [328, 328, 0, 0, 0, 0, 0, 0]])

    def test_spurious_leading_record_dropped_keeps_alignment(self):
        # s560 case: an out-of-range screen (3092) matches the tag pattern and glues
        # onto a real block — it must be dropped, not shift the 8-slot framing.
        data = rec(3092, 1, 0x60880000) + block([0, 0, 188, 0, 200, 0, 0, 0]) + PTRS
        self.assertEqual(zone_blocks(data, VALID), [[0, 0, 188, 0, 200, 0, 0, 0]])


# ---------------------------------------------------------------------------
# Zone GROUPS — selector records + the init-code interpreter.
# ---------------------------------------------------------------------------

from extract_stage_encounters import (  # noqa: E402
    SCENE_STRUCT, STORY_ORDINAL, _run_init, selector_records)
import wstag_extract as W  # noqa: E402

BASE = W._OVERLAY_BASE


def _lui(rt, imm):    return (0x0F << 26) | (rt << 16) | (imm & 0xFFFF)
def _addiu(rt, rs, i): return (0x09 << 26) | (rs << 21) | (rt << 16) | (i & 0xFFFF)
def _lw(rt, rs, off):  return (0x23 << 26) | (rs << 21) | (rt << 16) | (off & 0xFFFF)
def _slti(rt, rs, i):  return (0x0A << 26) | (rs << 21) | (rt << 16) | (i & 0xFFFF)
def _beqz(rs, off):    return (0x04 << 26) | (rs << 21) | (off & 0xFFFF)
def _j(ram):           return (0x02 << 26) | ((ram >> 2) & 0x3FFFFFF)
def _sw(rt, rs, off):  return (0x2B << 26) | (rs << 21) | (rt << 16) | (off & 0xFFFF)


def _hi(ram):
    """The `lui` half, carrying when the low half is a negative `addiu` immediate."""
    return ((ram >> 16) + (1 if ram & 0x8000 else 0)) & 0xFFFF


V0, V1, S1, SP, RA = 2, 3, 17, 29, 31
JR_RA = (RA << 21) | 0x08
NOP = 0


class TestSelectorRecords(unittest.TestCase):
    def test_records_map_pointers_to_block_indices(self):
        blocks = [0x100, 0x200, 0x300, 0x400, 0x500, 0x600, 0x700, 0x800]
        recs = struct.pack("<7I", 2, 0, 0, *(BASE + o for o in blocks[:4])) \
            + struct.pack("<7I", 25, 1, 0, *(BASE + o for o in blocks[4:]))
        got = selector_records(recs, blocks)
        self.assertEqual([r["tag"] for r in got], [2, 25])
        self.assertEqual([r["key"] for r in got], [0, 1])
        self.assertEqual([r["blocks"] for r in got], [[0, 1, 2, 3], [4, 5, 6, 7]])

    def test_non_record_words_are_skipped(self):
        blocks = [0x100, 0x200, 0x300, 0x400]
        data = b"\xff" * 16 + struct.pack("<7I", 7, 0, 0, *(BASE + o for o in blocks))
        self.assertEqual([r["blocks"] for r in selector_records(data, blocks)],
                         [[0, 1, 2, 3]])

    def test_third_word_must_be_zero(self):
        blocks = [0x100, 0x200, 0x300, 0x400]
        data = struct.pack("<7I", 7, 0, 1, *(BASE + o for o in blocks))
        self.assertEqual(selector_records(data, blocks), [])


class TestRunInit(unittest.TestCase):
    """The wstag335-shaped slti chain, hand-assembled: two thresholds, three records."""

    def _overlay(self):
        recs = [BASE + 0x900, BASE + 0x91C, BASE + 0x938]
        code = [
            _addiu(SP, SP, -0x20),                     # prologue
            _lui(V0, 0x8005),
            _lw(V1, V0, STORY_ORDINAL - 0x80050000),   # $v1 = [0x8004b370]
            NOP,
            _lui(S1, _hi(SCENE_STRUCT)),
            _addiu(S1, S1, SCENE_STRUCT & 0xFFFF),     # $s1 = scene struct
            _slti(V0, V1, 0xB),
            _beqz(V0, 3),                              # -> +0x14 (the 0x18 test)
            _lui(V0, _hi(recs[0])),
            _j(BASE + 0x48),
            _addiu(V0, V0, recs[0] & 0xFFFF),          # delay slot
            _slti(V0, V1, 0x18),
            _beqz(V0, 3),
            _lui(V0, _hi(recs[1])),
            _j(BASE + 0x48),
            _addiu(V0, V0, recs[1] & 0xFFFF),
            _lui(V0, _hi(recs[2])),
            _addiu(V0, V0, recs[2] & 0xFFFF),
            _sw(V0, S1, 0x20),                         # file 0x48 -> RAM BASE+0x48
            JR_RA,
            NOP,
        ]
        # `_j` targets are absolute RAM; 0x48 is the shared `sw $v0, 0x20($s1)` tail.
        data = struct.pack(f"<{len(code)}I", *code)
        return data.ljust(0x60, b"\x00"), recs

    def test_thresholds_pick_the_three_records(self):
        data, recs = self._overlay()
        for ordinal, want in [(0, 0), (10, 0), (11, 1), (23, 1), (24, 2), (45, 2)]:
            self.assertEqual(_run_init(data, 0, ordinal), recs[want],
                             f"ordinal {ordinal}")

    def test_store_must_target_the_scene_struct(self):
        data, _ = self._overlay()
        # Point $s1 somewhere else: the +0x20 store is then not the selector store.
        bad = bytearray(data)
        struct.pack_into("<I", bad, 4 * 4, _lui(S1, 0x1234))
        struct.pack_into("<I", bad, 5 * 4, _addiu(S1, S1, 0x5678))
        self.assertIsNone(_run_init(bytes(bad), 0, 0))


if __name__ == "__main__":
    unittest.main()
