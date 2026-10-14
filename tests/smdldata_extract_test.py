"""Focused checks for the smdldata extractor's own reads.

The arena stand-off (+0x10) and hover (+0x18) are read by FIGHTSTG_F0x80087F38 with `lhu`
(fightstg.s:5437-5441, :5450-5454) — UNSIGNED halfwords that are negated into the slot
afterwards — so the extractor must not sign them. No shipped record sets the high bit, which is
exactly why the divergence needs a synthetic image: the real file cannot tell the two reads
apart, and the second test pins that fact on the shipped table.
"""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "extract_smdldata", ROOT / "tools/extract_smdldata.py"
)
assert spec and spec.loader
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def asm_image(words):
    """A disassembler-style `.s` image: one `.L0x<off>: .word 0x<value>` row per entry."""
    return "".join(
        f".L0x{off:x}: .word 0x{words[off]:08x}\n" for off in sorted(words)
    )


def synthetic_words():
    base = 0x80082CB0
    return {
        0x00: base,             # header word 0: the base +0x0c resolves against
        0x04: 0x10,             # header word 1: index offset
        0x08: 0x20,             # header word 2: section 2
        0x0C: 0x100,            # header word 3: section 3
        0x10: 0x01000003,       # index entry: key 3, selfIndex 0, slot 1 (bytes 03 00 00 01)
        0x14: 0x00000000,       # the zero key terminates the walk
        # The section-2 record at 0x20.
        0x20: 0x01F30014,       # +0x00 packed (resource 499 << 16) | member 20
        0x24: 0x01F30000,       # +0x04
        0x28: 0x01F30013,       # +0x08
        0x2C: base + 0x3F0,     # +0x0c the pool pointer, absolute against header word 0
        0x30: 0x00009000,       # +0x10 stand-off with the high bit SET
        0x38: 0x00008800,       # +0x18 hover with the high bit SET
        # The shared pool at 0x3F0: one live ten-byte entry, then the 0xff end byte at 0x3FA.
        0x3F0: 0x04030201,      # dst 1,2  size 3,4
        0x3F4: 0x08070605,      # src0 5,6  src1 7,8
        0x3F8: 0x00FF0A09,      # src2 9,10 then 0xff ends the walk
    }


class SmdldataExtractTest(unittest.TestCase):
    def test_standoff_and_hover_are_read_unsigned(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / "smdldata.s"
            src.write_text(asm_image(synthetic_words()))
            data = tool.extract(src)

        rec = data["models"]["3"]
        self.assertEqual(rec["section"], 2)
        # lhu: 0x9000 is 36864, not -28672; 0x8800 is 34816, not -30720.
        self.assertEqual(rec["standoff"], 0x9000)
        self.assertEqual(rec["hover"], 0x8800)
        # The pool walk still stops on the 0xff byte and keeps the ten-byte entry.
        self.assertEqual(rec["texture_anim"], [{
            "slot": 0, "dst": [1, 2], "size": [3, 4],
            "src": [[5, 6], [7, 8], [9, 10]],
        }])

    def test_no_shipped_record_sets_the_high_bit(self):
        """The unsigned read is a no-op on the disc's own 248 records — pin that."""
        path = ROOT / "web/assets/battle/model_placement.json"
        if not path.exists():
            self.skipTest("model_placement.json not built")
        for key, rec in json.loads(path.read_text())["models"].items():
            self.assertLess(rec["standoff"], 0x8000, f"key {key} stand-off")
            self.assertLess(rec["hover"], 0x8000, f"key {key} hover")


if __name__ == "__main__":
    unittest.main()
