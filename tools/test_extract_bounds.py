"""Tests for the hard-bound extractor.

Three defects were fixed on 2026-08-12 and each is locked here:

  * a saturating counter (`if (v < K) v = v + 1`) is a cap, but `clamp` cannot
    see it, because the assignment is `v + 1` rather than K. This is how the
    99-cap in `pro/cardgame:F0x8008d854` was missed;
  * `exe-decomp/c/` -- the main executable, 749 functions -- did not match the
    `*_c` glob, so not one of its bounds had ever been extracted;
  * a row carried no `file:line`, so it could not be quoted into an evidence
    packet without finding the site again by hand.
"""

from __future__ import annotations

import pathlib
import tempfile
import unittest

from tools.extract_bounds import scan_file, scan_overlay


def scan(body: str, name: str = "F0x8008d854.c") -> list[dict]:
    with tempfile.TemporaryDirectory() as d:
        path = pathlib.Path(d) / name
        path.write_text(body)
        return scan_file(path)


def kinds(rows: list[dict], kind: str) -> list[int]:
    return sorted(r["value"] for r in rows if r["kind"] == kind)


class SaturateTests(unittest.TestCase):
    def test_saturating_increment_is_a_bound(self) -> None:
        rows = scan("void f(void) {\n"
                    "    if (temp_v1 < 0x63U) {\n"
                    "        temp_s1->unkC = (u8)(temp_v1 + 1);\n"
                    "    }\n"
                    "}\n")
        self.assertIn(99, kinds(rows, "saturate"))

    def test_a_clamp_does_not_see_a_saturating_increment(self) -> None:
        """The exact shape `clamp` misses -- this is why `saturate` exists."""
        rows = scan("void f(void) {\n"
                    "    if (temp_v1 < 0x63U) {\n"
                    "        temp_s1->unkC = (u8)(temp_v1 + 1);\n"
                    "    }\n"
                    "}\n")
        self.assertEqual(kinds(rows, "clamp"), [])

    def test_a_floor_form_is_not_asserted_as_a_bound(self) -> None:
        """`if (v >= K) g = v - 1` is indistinguishable from a one-shot
        decrement in m2c's SSA output, so it stays a `gate`."""
        rows = scan("void f(void) {\n"
                    "    if (var_a0 > 0x1E) {\n"
                    "        obj->unk4 = var_a0 - 1;\n"
                    "    }\n"
                    "}\n")
        self.assertEqual(kinds(rows, "saturate"), [])

    def test_a_threshold_that_steps_another_field_is_not_a_cap(self) -> None:
        """Three of the first four `>=` hits were this shape."""
        rows = scan("void f(void) {\n"
                    "    if (arg0->unk7C < 9) {\n"
                    "        arg0->unk74 = arg0->unk74 + 1;\n"
                    "    }\n"
                    "}\n")
        self.assertEqual(kinds(rows, "saturate"), [])

    def test_a_constant_assignment_is_not_a_step(self) -> None:
        rows = scan("void f(void) {\n"
                    "    if (temp_v0_9 < 0x2E) {\n"
                    "        var_v0 = -1;\n"
                    "    }\n"
                    "}\n")
        self.assertEqual(kinds(rows, "saturate"), [])

    def test_a_tier_selector_is_not_a_cap(self) -> None:
        """`+1`/`+2` here are tier indices, not a counter stepping."""
        rows = scan("void f(void) {\n"
                    "    if (temp_a2 < 0x64) {\n"
                    "        var_v0 = (obj->unk49 - 1) * 3;\n"
                    "    } else if (temp_a2 < 0x12C) {\n"
                    "        var_v0 = ((obj->unk49 - 1) * 3) + 1;\n"
                    "    }\n"
                    "}\n")
        self.assertEqual(kinds(rows, "saturate"), [])

    def test_a_plain_clamp_is_still_a_clamp(self) -> None:
        rows = scan("void f(void) {\n"
                    "    if (var_a0 > 0x270F) {\n"
                    "        obj->unk4 = 0x270F;\n"
                    "    }\n"
                    "}\n")
        self.assertIn(9999, kinds(rows, "clamp"))

    def test_small_and_noise_values_are_rejected(self) -> None:
        rows = scan("void f(void) {\n"
                    "    if (var_a0 < 2) {\n"
                    "        obj->unk4 = var_a0 + 1;\n"
                    "    }\n"
                    "    if (var_a1 < 0xFF) {\n"
                    "        obj->unk8 = var_a1 + 1;\n"
                    "    }\n"
                    "}\n")
        self.assertEqual(kinds(rows, "saturate"), [])


class CitationTests(unittest.TestCase):
    """A row with no citation is a question, not evidence."""

    BODY = ("void f(void) {\n"
            "    int i;\n"
            "\n"
            "    if (temp_v1 < 0x63U) {\n"
            "        temp_s1->unkC = (u8)(temp_v1 + 1);\n"
            "    }\n"
            "}\n")

    def test_every_row_carries_a_line_a_quote_and_a_path(self) -> None:
        rows = scan(self.BODY)
        self.assertTrue(rows)
        for row in rows:
            self.assertIn("line", row)
            self.assertIn("quote", row)
            self.assertIn("path", row)

    def test_the_quote_is_literally_at_the_cited_line(self) -> None:
        rows = scan(self.BODY)
        lines = self.BODY.split("\n")
        for row in rows:
            self.assertEqual(lines[row["line"] - 1].strip(), row["quote"])

    def test_the_cited_line_holds_the_compare(self) -> None:
        rows = [r for r in scan(self.BODY) if r["kind"] == "saturate"]
        self.assertEqual([r["quote"] for r in rows],
                         ["if (temp_v1 < 0x63U) {"])
        self.assertEqual([r["line"] for r in rows], [4])


class CorpusSelectionTests(unittest.TestCase):
    def test_the_main_executable_is_named_exe_not_c(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d) / "c"
            root.mkdir()
            (root / "F0x80012345.c").write_text(
                "void f(void) {\n"
                "    while (i < 0x10) {\n"
                "        i += 1;\n"
                "    }\n"
                "}\n")
            rows = scan_overlay(root)
        self.assertTrue(rows)
        self.assertEqual({r["overlay"] for r in rows}, {"exe"})

    def test_an_overlay_directory_keeps_its_name(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d) / "ststatus_c"
            root.mkdir()
            (root / "F0x800a1234.c").write_text(
                "void f(void) {\n"
                "    while (i < 0x10) {\n"
                "        i += 1;\n"
                "    }\n"
                "}\n")
            rows = scan_overlay(root)
        self.assertEqual({r["overlay"] for r in rows}, {"ststatus"})


class FailedLiftTests(unittest.TestCase):
    def test_a_failed_decompilation_yields_nothing(self) -> None:
        rows = scan("/* Decompilation failure: cannot determine jump table */\n"
                    "if (x < 0x63) { y = x + 1; }\n")
        self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
