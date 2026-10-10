"""Tests for match_psyq.py. Run: python3 -m tools.test_match_psyq

These pin the derivations whose failure would make the disposition lie: the
immediate mask, the version intersection, the interior-label rule, and the
library-zone boundary. A wrong interior rule either buries real library
routines or promotes shape collisions into function starts.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.match_psyq import (
    LIBRARY_ZONE_START,
    build_index,
    disposition,
    mask_word,
    pin_versions,
    reconcile,
    scan,
)
from tools.psyq_imports import (
    build_pattern_index,
    is_local_name,
    load_signatures,
    match_imported,
)

RAM_BASE = 0x80000000
TEXT_START = 0x80010000
TEXT_END = 0x80020000


def _write_import_source(root: Path, version: str, library: str, objects: list[dict]) -> Path:
    directory = root / version
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{library}.json"
    path.write_text(json.dumps(objects))
    return path


def _pattern(*words: str) -> str:
    return " ".join(words) + " "


# A four-instruction body with one relocated immediate (the `??` word), taken
# from the shape of a real SDK prologue. The label is the SDK symbol.
KNOWN_OBJECT = [{
    "name": "FOO.OBJ",
    "sig": _pattern("E8", "FF", "BD", "27", "14", "00", "BF", "AF",
                    "??", "??", "??", "0C", "21", "80", "80", "00",
                    "08", "00", "E0", "03", "00", "00", "00", "00"),
    "labels": [{"name": "sdk_known_body", "offset": 0}],
}]


class ImportedSignatureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _index(self, objects: list[dict], version: str = "460", library: str = "LIBGPU") -> dict:
        _write_import_source(self.root, version, library, objects)
        entries = load_signatures(self.root, min_size=6)
        return build_pattern_index(entries)

    def test_a_known_library_body_matches_after_import(self) -> None:
        index = self._index(KNOWN_OBJECT)
        body = bytearray(24)
        # the fixed bytes of the pattern, with the relocated word filled in
        fixed = [0xE8, 0xFF, 0xBD, 0x27, 0x14, 0x00, 0xBF, 0xAF]
        body[0:8] = bytes(fixed)
        body[8:11] = bytes([0xAA, 0xBB, 0xCC])  # the wildcarded immediate
        body[11] = 0x0C
        body[12:16] = bytes([0x21, 0x80, 0x80, 0x00])
        body[16:24] = bytes([0x08, 0x00, 0xE0, 0x03, 0x00, 0x00, 0x00, 0x00])
        hit = match_imported(bytes(body), RAM_BASE, RAM_BASE, RAM_BASE + len(body), index, min_size=8)
        self.assertIsNotNone(hit)
        self.assertEqual(hit["name"], "sdk_known_body")
        self.assertEqual(hit["library"], "libgpu")
        self.assertEqual(hit["hash_kind"], "pattern")

    def test_an_unrelated_body_does_not_match(self) -> None:
        index = self._index(KNOWN_OBJECT)
        # Different opcodes everywhere: cannot be the imported body.
        unrelated = bytes([0x11, 0x22, 0x33, 0x44] * 6)
        hit = match_imported(unrelated, RAM_BASE, RAM_BASE, RAM_BASE + len(unrelated), index, min_size=8)
        self.assertIsNone(hit)

    def test_a_wildcard_position_may_hold_anything(self) -> None:
        index = self._index(KNOWN_OBJECT)
        for filler in (0x00, 0x7F, 0xFF):
            body = bytearray(24)
            body[0:8] = bytes([0xE8, 0xFF, 0xBD, 0x27, 0x14, 0x00, 0xBF, 0xAF])
            body[8:11] = bytes([filler, filler, filler])
            body[11] = 0x0C
            body[12:16] = bytes([0x21, 0x80, 0x80, 0x00])
            body[16:24] = bytes([0x08, 0x00, 0xE0, 0x03, 0x00, 0x00, 0x00, 0x00])
            hit = match_imported(bytes(body), RAM_BASE, RAM_BASE, RAM_BASE + 24, index, min_size=8)
            self.assertIsNotNone(hit, f"filler {filler:#x} should be ignored")

    def test_a_placeholder_label_names_the_library_but_not_the_routine(self) -> None:
        objects = [{
            "name": "BAZ.OBJ",
            "sig": _pattern("01", "00", "02", "24", "??", "??", "??", "0C",
                            "08", "00", "E0", "03", "00", "00", "00", "00"),
            "labels": [
                {"name": "real_entry", "offset": 0},
                {"name": "text_10", "offset": 8},
            ],
        }]
        index = self._index(objects, version="410", library="LIBSPU")
        body = bytes([0x08, 0x00, 0xE0, 0x03, 0x00, 0x00, 0x00, 0x00])
        hit = match_imported(body, RAM_BASE, RAM_BASE, RAM_BASE + 8, index, min_size=6)
        self.assertIsNotNone(hit)
        self.assertIsNone(hit["name"])
        self.assertTrue(hit["local"])
        self.assertEqual(hit["library"], "libspu")
        self.assertEqual(hit["enclosing"], "real_entry")

    def test_scan_falls_back_to_imports_only_where_the_hash_db_is_silent(self) -> None:
        imports_dir = self.root / "imports"
        _write_import_source(imports_dir, "460", "LIBGPU", KNOWN_OBJECT)
        entries = load_signatures(imports_dir, min_size=6)
        import_index = build_pattern_index(entries)

        buffer = bytearray(RAM_BASE + 0x40)
        address = RAM_BASE + 0x20
        fixed = [0xE8, 0xFF, 0xBD, 0x27, 0x14, 0x00, 0xBF, 0xAF]
        buffer[address - RAM_BASE:address - RAM_BASE + 8] = bytes(fixed)
        buffer[address - RAM_BASE + 8:address - RAM_BASE + 11] = bytes([1, 2, 3])
        buffer[address - RAM_BASE + 11] = 0x0C
        buffer[address - RAM_BASE + 12:address - RAM_BASE + 16] = bytes([0x21, 0x80, 0x80, 0x00])
        buffer[address - RAM_BASE + 16:address - RAM_BASE + 24] = bytes([0x08, 0x00, 0xE0, 0x03, 0x00, 0x00, 0x00, 0x00])

        empty = build_index([])  # the hash database finds nothing
        matches = scan(
            bytes(buffer), empty, [address],
            text_start=RAM_BASE, text_end=RAM_BASE + 0x40,
            import_index=import_index, import_offsets={address}, import_min_size=8,
        )
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["name"], "sdk_known_body")
        self.assertEqual(matches[0]["hash_kind"], "pattern")


class ImportedHelpersTests(unittest.TestCase):
    def test_local_label_predicate(self) -> None:
        self.assertTrue(is_local_name("text_10"))
        self.assertTrue(is_local_name("loc_C"))
        self.assertTrue(is_local_name(None))
        self.assertFalse(is_local_name("MulMatrix0"))

    def test_disposition_keeps_a_placeholder_match_unidentified(self) -> None:
        exe = {"starts": {
            0x80026000: {"module": "exe/fns", "id": "exe/fns:F0x80026000",
                         "role": "function", "semantic_name": None},
        }}
        matches = [{
            "address": "0x80026000", "name": None, "local_label": "text_20",
            "library": "libgpu", "size": 32, "hash_kind": "pattern",
            "match_mode": "imported", "sources": ["460/LIBGPU.LIB"],
            "enclosing": "some_named_function",
        }]
        output = disposition(exe, matches, [])
        row = output["addresses"]["0x80026000"]
        self.assertEqual(row["disposition"], "library_unidentified")
        self.assertEqual(row["library"], "libgpu")
        self.assertEqual(row["enclosing"], "some_named_function")


class MaskWordTests(unittest.TestCase):
    def test_jump_keeps_the_opcode_only(self) -> None:
        self.assertEqual(mask_word((0x03 << 26) | 0x123456), 0x03 << 26)
        self.assertEqual(mask_word((0x02 << 26) | 0x123456), 0x02 << 26)

    def test_branch_and_immediate_keep_op_rs_rt(self) -> None:
        self.assertEqual(mask_word((0x04 << 26) | (4 << 21) | (5 << 16) | 0x7fff),
                         (0x04 << 26) | (4 << 21) | (5 << 16))
        self.assertEqual(mask_word(0x8C821234), 0x8C820000)

    def test_r_type_is_untouched(self) -> None:
        self.assertEqual(mask_word(0x00851021), 0x00851021)


class PinVersionsTests(unittest.TestCase):
    def test_universal_candidate_needs_every_match(self) -> None:
        matches = [
            {"name": "A", "library": "libgpu", "sources": ["v4.6/LIBGPU/SYS", "v4.7/LIBGPU/SYS"]},
            {"name": "B", "library": "libgpu", "sources": ["v4.6/LIBGPU/SYS"]},
        ]
        pin = pin_versions(matches)
        self.assertEqual(pin["universal_candidates"], ["v4.6"])
        self.assertEqual(pin["per_library"]["libgpu"]["candidates"], ["v4.6"])

    def test_no_universal_version_reports_support(self) -> None:
        matches = [
            {"name": "A", "library": "libgpu", "sources": ["v4.0/LIBGPU/SYS"]},
            {"name": "B", "library": "libgpu", "sources": ["v4.6/LIBGPU/SYS"]},
        ]
        pin = pin_versions(matches)
        self.assertEqual(pin["universal_candidates"], [])
        self.assertEqual(pin["support"], {"v4.0": 1, "v4.6": 1})
        self.assertEqual(pin["per_library"]["libgpu"]["candidates"], [])


class ReconcileTests(unittest.TestCase):
    def test_a_start_inside_a_match_without_its_own_match_is_interior(self) -> None:
        starts = {
            0x80010000: {"module": "exe/fns", "id": "exe/fns:F0x80010000",
                         "role": "function", "semantic_name": None},
            0x80010020: {"module": "exe/fns", "id": "exe/fns:F0x80010020",
                         "role": "function", "semantic_name": None},
        }
        matches = [
            {"address": "0x80010000", "size": 0x40, "name": "Big", "library": "libgpu",
             "hash_kind": "masked", "sources": []},
        ]
        result = reconcile(matches, starts, set())
        self.assertEqual([row["address"] for row in result["interior"]], ["0x80010020"])
        self.assertEqual(result["matches"][0]["interior_labels"][0]["address"], "0x80010020")

    def test_a_start_with_its_own_match_is_not_interior(self) -> None:
        starts = {
            0x80010000: {"module": "exe/fns", "id": "exe/fns:F0x80010000",
                         "role": "function", "semantic_name": None},
            0x80010020: {"module": "exe/fns", "id": "exe/fns:F0x80010020",
                         "role": "function", "semantic_name": None},
        }
        matches = [
            {"address": "0x80010000", "size": 0x40, "name": "Big", "library": "libgpu",
             "hash_kind": "masked", "sources": []},
            {"address": "0x80010020", "size": 0x10, "name": "Small", "library": "libgpu",
             "hash_kind": "full", "sources": []},
        ]
        result = reconcile(matches, starts, set())
        self.assertEqual(result["interior"], [])

    def test_a_match_that_does_not_abut_is_reported_without_flags(self) -> None:
        starts = {0x80010000: {"module": "exe/fns", "id": "exe/fns:F0x80010000",
                               "role": "function", "semantic_name": None}}
        matches = [
            {"address": "0x80018000", "size": 0x10, "name": "Lonely", "library": "libcd",
             "hash_kind": "masked", "sources": []},
        ]
        result = reconcile(matches, starts, set())
        self.assertEqual(result["new_starts"][0]["abuts_previous"], False)
        self.assertEqual(result["new_starts"][0]["abuts_next"], False)


class DispositionTests(unittest.TestCase):
    def test_zone_boundary_is_the_first_stub(self) -> None:
        exe = {"starts": {
            0x8002507C: {"module": "exe/fns", "id": "exe/fns:F0x8002507c",
                         "role": "function", "semantic_name": None},
            0x80025070: {"module": "exe/fns", "id": "exe/fns:F0x80025070",
                         "role": "function", "semantic_name": None},
            0x80025080: {"module": "exe/fns", "id": "exe/fns:F0x80025080",
                         "role": "block", "semantic_name": None},
        }}
        matches = [{"address": "0x8002507c", "size": 16, "name": "InitHeap",
                    "library": "libapi", "hash_kind": "full", "sources": ["v4.6/LIBAPI/SYS"]}]
        output = disposition(exe, matches, [])
        rows = output["addresses"]
        self.assertEqual(rows["0x8002507c"]["disposition"], "psyq")
        self.assertEqual(rows["0x8002507c"]["zone"], "library")
        self.assertEqual(rows["0x80025070"]["disposition"], "game")
        self.assertEqual(rows["0x80025080"]["disposition"], "block")
        self.assertEqual(LIBRARY_ZONE_START, 0x8002507C)


if __name__ == "__main__":
    unittest.main()
