"""Tests for tools/encoded_words.py, the shared instruction-word reader.

Three things are pinned, one per reason the words were missing:

* the **raw** assembly shape (``.word 0x... # mnemonic``) is read as well as the
  decoded one (``mnemonic # .word 0x...``);
* a mnemonic-only module is read from its **overlay image**;
* an absolute-addressed module is read from the pinned **RAM dump**.

The last test runs against the real corpus and only asserts the modules the
reader is supposed to rescue, so it fails loudly if an overlay image stops
being resolvable.

Run: .venv/bin/python3 -m unittest tools.test_encoded_words
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.encoded_words import (
    NATIVE_MANIFEST,
    OverlayImage,
    ModuleWords,
    load_overlay_images,
    parse_word_column,
)


class WordColumnTests(unittest.TestCase):
    def test_reads_the_decoded_shape(self) -> None:
        text = ".L0x00000000: addiu $sp, -0x20   # .word 0x27bdffe0\n"
        self.assertEqual(parse_word_column(text), {0: 0x27BDFFE0})

    def test_reads_the_raw_shape(self) -> None:
        text = ".L0x00000004: .word 0x8ca30000 # lw $v1, ($a1)\n"
        self.assertEqual(parse_word_column(text), {4: 0x8CA30000})

    def test_reads_both_shapes_in_one_file(self) -> None:
        text = (
            ".L0x00000000: .word 0x80084584 # lb $t0, 0x4584($zr)\n"
            ".L0x00000004: nop                      # .word 0x00000000\n"
        )
        self.assertEqual(parse_word_column(text), {0: 0x80084584, 4: 0x00000000})

    def test_ignores_symbolic_and_commentless_rows(self) -> None:
        text = (
            ".L0x00000000: .word F0x80085390\n"
            ".L0x00000004: .word 0x00000280\n"  # no comment: still a raw hex row
        )
        self.assertEqual(parse_word_column(text), {4: 0x00000280})


class OverlayImageTests(unittest.TestCase):
    def test_word_reads_little_endian_from_the_load_base(self) -> None:
        image = OverlayImage("pro/x", 0x80082CB0, bytes.fromhex("08e0c003") + b"\x00" * 4)
        self.assertEqual(image.word(0x80082CB0), 0x03C0E008)
        self.assertIsNone(image.word(0x80082CB0 - 4))


class ModuleWordsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write(self, name: str, text: str) -> Path:
        path = self.dir / name
        path.write_text(text)
        return path

    def test_raw_shape_module_reads_from_the_label_column(self) -> None:
        source = self._write("raw.s", (
            ".L0x00000000: .word 0x27bdffe0 # addiu $sp, -0x20\n"
            ".L0x00000004: .word 0xafbf0018 # sw $ra, 0x18($sp)\n"
            ".L0x00000008: .word 0x03e00008 # jr $ra\n"
        ))
        module = {
            "id": "pro/raw", "source": str(source),
            "functions": [
                {"id": "pro/raw:F0x80001000", "address": "0x80001000", "source_line": 1},
                {"id": "pro/raw:F0x80001008", "address": "0x80001008", "source_line": 3,
                 "provisional_end_address": "0x8000100c"},
            ],
        }
        reader = ModuleWords(module, dump=None, images={})
        self.assertEqual(reader.kind, "labels")
        self.assertEqual(reader.body(module["functions"][0]), [0x27BDFFE0, 0xAFBF0018])
        self.assertEqual(reader.body(module["functions"][1]), [0x03E00008])

    def test_mnemonic_only_module_reads_from_the_overlay_image(self) -> None:
        source = self._write("mnem.s", (
            ".L0x00000000: addiu $sp, -0x20\n"
            ".L0x00000004: sw $ra, 0x18($sp)\n"
            ".L0x00000008: jr $ra\n"
        ))
        base = 0x80082CB0
        data = b"".join(w.to_bytes(4, "little")
                        for w in (0x27BDFFE0, 0xAFBF0018, 0x03E00008))
        module = {
            "id": "pro/mnem", "source": str(source),
            "functions": [
                {"id": "pro/mnem:F0x80082cb0", "address": hex(base),
                 "source_line": 1, "provisional_end_address": hex(base + 0xC)},
            ],
        }
        reader = ModuleWords(module, dump=None, images={"pro/mnem": OverlayImage("pro/mnem", base, data)})
        self.assertEqual(reader.kind, "image")
        self.assertEqual(reader.body(module["functions"][0]), [0x27BDFFE0, 0xAFBF0018, 0x03E00008])

    def test_absolute_address_module_reads_from_the_dump(self) -> None:
        source = self._write("dump.s", ".L0x80010000: jr $ra\n")
        base = 0x80010000
        dump = bytearray(0x20000)
        off = base - 0x80000000
        dump[off:off + 4] = (0x03E00008).to_bytes(4, "little")
        module = {
            "id": "pro/abs", "source": str(source),
            "functions": [
                {"id": "pro/abs:F0x80010000", "address": hex(base), "source_line": 1,
                 "provisional_end_address": hex(base + 4)},
            ],
        }
        reader = ModuleWords(module, dump=bytes(dump), images={})
        self.assertEqual(reader.kind, "dump")
        self.assertEqual(reader.body(module["functions"][0]), [0x03E00008])

    def test_no_source_is_reported_with_a_reason(self) -> None:
        source = self._write("bare.s", ".L0x00000000: nop\n")
        module = {"id": "pro/bare", "source": str(source),
                  "functions": [{"id": "pro/bare:F0x80000000", "address": "0x80000000",
                                 "source_line": 1}]}
        reader = ModuleWords(module, dump=None, images={})
        self.assertFalse(reader.readable())
        self.assertIn("no word column", reader.reason)


class RealCorpusTests(unittest.TestCase):
    """The modules the reader exists to rescue, checked against the tree."""

    def setUp(self) -> None:
        if not NATIVE_MANIFEST.exists():
            self.skipTest("no native screen manifest in this tree")
        self.images = load_overlay_images()
        self.inventory = json.loads(
            (Path(__file__).resolve().parent.parent
             / "recovered/ddw3/function-inventory.json").read_text())
        self.by_id = {m["id"]: m for m in self.inventory["modules"]}

    def test_the_mnemonic_only_overlays_have_an_image(self) -> None:
        for module_id in ("pro/fightstg", "pro/stdwtitl", "pro/shocktst", "pro/wfightts"):
            self.assertIn(module_id, self.images, f"{module_id} has no overlay image")

    def test_fightstg_bodies_resolve(self) -> None:
        module = self.by_id["pro/fightstg"]
        reader = ModuleWords(module, dump=None, images=self.images)
        readable = sum(1 for f in module["functions"] if reader.body(f))
        self.assertGreater(readable, 200, "fightstg should read hundreds of bodies")

    def test_overlay_image_matches_the_assembly_word_column(self) -> None:
        # The image is ground truth only if it reproduces the encoding the
        # assembly already carries for the data rows.
        import re
        module = self.by_id["pro/stdwtitl"]
        image = self.images["pro/stdwtitl"]
        source = Path(module["source"].replace("~", str(Path.home()))).read_text()
        pairs = [(int(a, 16), int(w, 16)) for a, w in
                 re.findall(r"\.L0x([0-9a-f]{8}): \.word (0x[0-9a-f]{8})", source)]
        self.assertTrue(pairs, "fixture drift: stdwtitl has no raw word rows")
        matched = sum(1 for off, word in pairs if image.word(image.base + off) == word)
        self.assertEqual(matched, len(pairs), "overlay image disagrees with the assembly")


if __name__ == "__main__":
    unittest.main()
