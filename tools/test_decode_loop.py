"""Tests for the decode driver.

The driver used to run the Claude CLI twice per function and compare the replies,
so the tests that guarded the model path -- the credential breaker, the
consecutive-failure halt, the two-pass agreement measure -- went with it. What
survives is what still has teeth: records are keyed by overlay AND address, an
error record stays in the queue, and nothing in the tool can spend a token.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools import decode_loop


class RecordPathTests(unittest.TestCase):
    def test_record_path_includes_the_overlay(self) -> None:
        """Overlays share RAM addresses; keying on the address alone overwrote 64."""
        one = decode_loop.record_path("cardgame", 0x80082CF8)
        two = decode_loop.record_path("fightstg", 0x80082CF8)
        self.assertNotEqual(one, two)
        self.assertIn("cardgame", one.name)


class TypedTargetsTests(unittest.TestCase):
    """The second pass reads last pass's answers before it overwrites them."""

    def write(self, state, rows):
        (state / "fns-0x80001000.json").write_text(json.dumps(
            {"overlay": "fns", "address": 0x80001000, "status": "decoded",
             "receiver": rows}))

    def test_a_named_target_becomes_a_call_site_the_walk_can_use(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            self.write(state, [{"at": 0x80001234, "target": "0x8001AE38",
                                "contradicted": False}])
            with mock.patch.object(decode_loop, "STATE", state):
                self.assertEqual(decode_loop.typed_targets(),
                                 {"fns": {0x80001234: 0x8001AE38}})

    def test_a_contradicted_row_is_never_fed_back(self) -> None:
        """It is the one place the typing states its own answer is wrong."""
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            self.write(state, [{"at": 0x80001234, "target": "0x8001AE38",
                                "contradicted": True}])
            with mock.patch.object(decode_loop, "STATE", state):
                self.assertEqual(decode_loop.typed_targets(), {})


class LoadDoneTests(unittest.TestCase):
    def test_error_records_stay_in_the_queue(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            (state / "fns-80001000.json").write_text(json.dumps(
                {"overlay": "fns", "address": 0x80001000, "status": "error"}))
            (state / "fns-80002000.json").write_text(json.dumps(
                {"overlay": "fns", "address": 0x80002000, "status": "decoded"}))
            with mock.patch.object(decode_loop, "STATE", state):
                done = decode_loop.load_done()
        self.assertNotIn(("fns", 0x80001000), done)
        self.assertIn(("fns", 0x80002000), done)


class NoModelPathTests(unittest.TestCase):
    def test_nothing_in_the_decoder_can_spend_a_token(self) -> None:
        """The acceptance test for the whole rewrite."""
        for name in ("decode_loop.py", "mips_decode.py", "mips_parse.py",
                     "decode_shapes.py"):
            source = (Path(decode_loop.__file__).parent / name).read_text()
            body = "\n".join(line for line in source.splitlines()
                             if not line.strip().startswith("#"))
            for banned in ("subprocess", "urllib", "requests", "socket", "http"):
                self.assertNotIn(banned, body, f"{banned} appears in {name}")
            self.assertNotIn("claude -p", body, f"model call in {name}")


class DecodeOneTests(unittest.TestCase):
    def test_decode_one_produces_every_block(self) -> None:
        record = decode_loop.decode_one(
            {"overlay": "fns", "address": 0x800246D8, "shapes": []},
            ["800246d8  x: li $v0, 0x1f801120",
             "800246e0  x: lhu $v0, ($v0)",
             "800246f0  x: jr $ra",
             "800246f4  x: nop"])
        self.assertEqual(record["status"], "decoded")
        self.assertIn("proven", record)
        self.assertIn("shape", record)
        self.assertIn("coverage", record)
        self.assertEqual(record["overlay"], "fns")

    def test_empty_body_is_an_error_record_not_a_crash(self) -> None:
        record = decode_loop.decode_one(
            {"overlay": "fns", "address": 0x1, "shapes": []}, [])
        self.assertEqual(record["status"], "error")
        self.assertIn("no indexed instructions", record["reason"])


class ReportTests(unittest.TestCase):
    def test_report_counts_clean_records(self) -> None:
        rows = [{"status": "decoded", "shape": {"rule": "field-getter"},
                 "coverage": {"unmodelled": [], "unreached": [], "capped": False},
                 "proven": {k: [] for k in ("fields", "globals", "hardware",
                                            "tables", "calls", "conditions")}},
                {"status": "error"}]
        self.assertEqual(decode_loop.report(rows, True), 0)


if __name__ == "__main__":
    unittest.main()


class DecodeExtentTests(unittest.TestCase):
    """One extent is not always one function; 156 of the 924 hold two or more."""

    LINES = ["00001000  x: jr $ra",
             "00001004  x: addiu $sp, 0x30",
             "00001008  x: addiu $sp, -0x20",
             "0000100c  x: jr $ra",
             "00001010  x: nop"]

    def test_each_function_inside_an_extent_gets_its_own_record(self) -> None:
        got = decode_loop.decode_extent({"overlay": "fns", "address": 0x1000}, self.LINES)
        self.assertEqual([r["address"] for r in got], [0x1000, 0x1008])
        self.assertEqual(got[1]["found_inside"], "0x00001000")
        self.assertNotIn("found_inside", got[0])
        self.assertTrue(all(r["status"] == "decoded" for r in got))

    def test_a_single_function_extent_yields_one_record(self) -> None:
        got = decode_loop.decode_extent({"overlay": "fns", "address": 0x1000},
                            ["00001000  x: jr $ra", "00001004  x: nop"])
        self.assertEqual(len(got), 1)
        self.assertIsNone(got[0]["coverage"]["next_function"])


class DataWordTests(unittest.TestCase):
    def test_both_written_forms_of_a_code_pointer_are_read(self) -> None:
        """Every switch table in fns.s uses the symbol form, so a pattern that
        accepts only bare numbers found none of them."""
        got = decode_loop.data_words({
            0x800109B8: ".L0x800109b8: .word F0x8002cedc",
            0x800109BC: ".L0x800109bc: .word 0x800843a0",
            0x800109C0: ".L0x800109c0: .word 0x735f4443",   # text, not an address
            0x800109C4: ".L0x800109c4: addiu $sp, -0x20",
        })
        self.assertEqual(got, frozenset({0x8002CEDC, 0x800843A0}))


class StaleRecordTests(unittest.TestCase):
    """The driver rewrites records but never removes one, so a boundary that
    moves orphans the old address. Two files survived that way on 2026-08-10."""

    QUEUE = [{"overlay": "fns", "address": 0x1000}]

    def record(self, address, nxt=None, inside=None):
        row = {"overlay": "fns", "address": address, "status": "decoded",
               "coverage": {"next_function": nxt}}
        if inside:
            row["found_inside"] = inside
        return row

    def rows(self, *records):
        return {(r["overlay"], r["address"]): r for r in records}

    def test_a_chain_from_a_queue_extent_is_all_live(self) -> None:
        rows = self.rows(self.record(0x1000, 0x1008),
                         self.record(0x1008, None, "0x00001000"))
        with mock.patch.object(decode_loop, "load_targets",
                               return_value=self.QUEUE):
            self.assertEqual(decode_loop.stale_records(rows), [])

    def test_an_orphan_left_by_a_moved_boundary_is_reported(self) -> None:
        rows = self.rows(self.record(0x1000, 0x1008),
                         self.record(0x1008, None, "0x00001000"),
                         self.record(0x1014, None, "0x00001000"))
        with mock.patch.object(decode_loop, "load_targets",
                               return_value=self.QUEUE):
            self.assertEqual(decode_loop.stale_records(rows), [("fns", 0x1014)])

    def test_a_record_for_an_address_no_longer_queued_is_reported(self) -> None:
        rows = self.rows(self.record(0x1000), self.record(0x9000))
        with mock.patch.object(decode_loop, "load_targets",
                               return_value=self.QUEUE):
            self.assertEqual(decode_loop.stale_records(rows), [("fns", 0x9000)])

    def test_a_chain_that_points_at_itself_terminates(self) -> None:
        rows = self.rows(self.record(0x1000, 0x1000))
        with mock.patch.object(decode_loop, "load_targets",
                               return_value=self.QUEUE):
            self.assertEqual(decode_loop.stale_records(rows), [])


class BodyIdentityTests(unittest.TestCase):
    """Nine extents carry a body that starts somewhere else: their source path
    is written with an unexpanded `~`, making a phantom copy of a real assembly
    file that holds only ledger evidence rows. Some of those rows quote PROSE,
    and decoding them produced field accesses derived from an English sentence."""

    def test_a_body_that_does_not_start_at_the_entry_is_an_error(self) -> None:
        got = decode_loop.decode_one(
            {"overlay": "fns", "address": 0x80015590},
            ["800163b0  x: The READ dispatcher F0x800163b0 dispatches an equality chain"])
        self.assertEqual(got["status"], "error")
        self.assertIn("0x800163B0", got["reason"])
        self.assertNotIn("proven", got)

    def test_a_body_that_starts_at_the_entry_decodes(self) -> None:
        got = decode_loop.decode_one({"overlay": "fns", "address": 0x1000},
                                     ["00001000  x: jr $ra", "00001004  x: nop"])
        self.assertEqual(got["status"], "decoded")
