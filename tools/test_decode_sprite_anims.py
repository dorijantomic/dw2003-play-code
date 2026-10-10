"""Tests for tools/decode_sprite_anims.py -- real per-frame durations extraction.
Run: python3 tools/test_decode_sprite_anims.py
"""

import struct
import tempfile
import unittest
from pathlib import Path

from decode_sprite_anims import (
    _decode_bin_pairs,
    _decode_clip_directory,
    _stand_first_pairs,
    decode_sprite,
)


def _directory_bytes(records):
    # records: list of (clip_id, [dir_bin0..4]); terminated with a clip_id==0 record.
    out = b""
    for clip_id, dir_bins in records:
        out += struct.pack("<6H", clip_id, *dir_bins)
    out += struct.pack("<6H", 0, 0, 0, 0, 0, 0)
    return out


def _format_a_bytes(records):
    # records: list of (duration, frame_idx, x_off, y_off); terminated with a 0-duration record.
    out = b""
    for duration, idx, x, y in records:
        out += struct.pack("<iiii", duration, idx, x, y)
    out += struct.pack("<iiii", 0, 0, 0, 0)
    return out


def _format_b_bytes(frame_ids):
    # u16 sequence: [type_flag, frame_id, ..., 0]
    return struct.pack(f"<{2 + len(frame_ids)}H", 1, *frame_ids, 0)


class TestDecodeBinPairs(unittest.TestCase):
    def test_format_a_returns_frame_and_duration_pairs(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "0.bin"
            p.write_bytes(_format_a_bytes([(60, 5, 0, 0), (65, 6, 0, 0), (58, 5, 0, 0)]))
            pairs = _decode_bin_pairs(p)
            self.assertEqual(pairs, [(5, 60), (6, 65), (5, 58)])

    def test_format_b_uses_default_duration(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "0.bin"
            p.write_bytes(_format_b_bytes([7, 8, 7]))
            pairs = _decode_bin_pairs(p)
            self.assertEqual([f for f, _ in pairs], [7, 8, 7])
            self.assertTrue(all(dur == 8 for _, dur in pairs))  # _DEFAULT_DURATION


class TestStandFirstPairs(unittest.TestCase):
    def test_repeated_frame_becomes_stand_first_keeping_its_duration(self):
        # walk cycle [s1, s2, STAND, s3, s4, STAND] with STAND=5
        pairs = [(1, 10), (2, 11), (5, 70), (3, 12), (4, 13), (5, 71)]
        result = _stand_first_pairs(pairs)
        self.assertEqual(result[0], (5, 70))  # first duration seen for the stand frame wins
        self.assertEqual([f for f, _ in result], [5, 1, 2, 3, 4])

    def test_no_repeat_dedups_in_order(self):
        pairs = [(1, 10), (2, 11), (3, 12)]
        self.assertEqual(_stand_first_pairs(pairs), pairs)

    def test_empty_is_empty(self):
        self.assertEqual(_stand_first_pairs([]), [])


class TestDecodeClipDirectory(unittest.TestCase):
    def test_decodes_records_up_to_terminator(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "202.bin"
            p.write_bytes(_directory_bytes([(1, [146, 147, 148, 149, 150]), (4, [151, 152, 153, 154, 155])]))
            records = _decode_clip_directory(p)
            self.assertEqual(records, [(1, [146, 147, 148, 149, 150]), (4, [151, 152, 153, 154, 155])])

    def test_rejects_non_directory_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            # A plain format-A animation bin (16-byte records) is not a valid directory.
            p = Path(d) / "0.bin"
            p.write_bytes(_format_a_bytes([(60, 5, 0, 0), (65, 6, 0, 0)]))
            self.assertEqual(_decode_clip_directory(p), [])

    def test_rejects_missing_terminator(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "202.bin"
            p.write_bytes(struct.pack("<6H", 1, 146, 147, 148, 149, 150))  # no zero record
            self.assertEqual(_decode_clip_directory(p), [])

    def test_empty_file_is_empty(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "202.bin"
            p.write_bytes(b"")
            self.assertEqual(_decode_clip_directory(p), [])


class TestDecodeSpriteShape(unittest.TestCase):
    def test_returns_frames_and_durations_with_matching_lengths(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            sprite_dir = root / "pack/dw2003/field/sprite/p999test"
            sprite_dir.mkdir(parents=True)
            tim_dir = root / "tim/dw2003/field/sprite/p999test"
            tim_dir.mkdir(parents=True)
            for i in range(10):
                (tim_dir / f"{i}.png").write_bytes(b"")
            # 3-bin simplified layout: down, left, up (n>=3, n<5 branch)
            (sprite_dir / "0.bin").write_bytes(
                _format_a_bytes([(60, 0, 0, 0), (65, 1, 0, 0), (60, 0, 0, 0), (62, 2, 0, 0)])
            )
            (sprite_dir / "1.bin").write_bytes(
                _format_a_bytes([(60, 3, 0, 0), (65, 4, 0, 0), (60, 3, 0, 0)])
            )
            (sprite_dir / "2.bin").write_bytes(
                _format_a_bytes([(60, 5, 0, 0), (65, 6, 0, 0), (60, 5, 0, 0)])
            )
            layout = decode_sprite(sprite_dir)
            self.assertIsNotNone(layout)
            # "offsets" rides along since 2026-09-05 (Format A record words 2/3,
            # entity+0xDC/E0 — claims world-q007-*-001, verified); zero here.
            self.assertEqual(set(layout.keys()), {"frames", "durations", "offsets"})
            for direction in ("down", "left", "up"):
                self.assertEqual(
                    len(layout["frames"][direction]), len(layout["durations"][direction])
                )
                self.assertEqual(
                    layout["offsets"][direction],
                    [[0, 0]] * len(layout["frames"][direction]),
                )
            self.assertEqual(layout["durations"]["down"][0], 60)  # stand frame's duration

    def test_clips_key_present_when_a_directory_bin_exists(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            sprite_dir = root / "pack/dw2003/field/sprite/p999test"
            sprite_dir.mkdir(parents=True)
            tim_dir = root / "tim/dw2003/field/sprite/p999test"
            tim_dir.mkdir(parents=True)
            for i in range(10):
                (tim_dir / f"{i}.png").write_bytes(b"")
            # bins 0-4: group 0 (idle, picked as the 5-9 branch needs n>=10 so use n>=5 path)
            for n, name in enumerate(["0", "1", "2", "3", "4"]):
                (sprite_dir / f"{name}.bin").write_bytes(
                    _format_a_bytes([(60, n, 0, 0), (60, n, 0, 0)])
                )
            # a distinct "gesture" bin the directory alone points at (clip 42)
            (sprite_dir / "5.bin").write_bytes(_format_a_bytes([(20, 7, 0, 0), (20, 7, 0, 0)]))
            # highest-numbered bin = the clip directory
            (sprite_dir / "6.bin").write_bytes(
                _directory_bytes([(1, [0, 1, 2, 3, 4]), (42, [5, 5, 5, 5, 5])])
            )
            layout = decode_sprite(sprite_dir)
            self.assertIsNotNone(layout)
            self.assertIn("clips", layout)
            self.assertEqual(set(layout["clips"].keys()), {"1", "42"})
            self.assertEqual(layout["clips"]["42"]["down"]["frames"], [7, 7])


if __name__ == "__main__":
    unittest.main()
