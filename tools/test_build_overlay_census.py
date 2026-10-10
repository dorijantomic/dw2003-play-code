"""Tests for build_overlay_census.py. Run: python3 tools/test_build_overlay_census.py

These pin the derivations that were wrong in a first pass and that would make
the census lie in the exact way it exists to prevent: attributing a document to
the wrong overlay, and turning "we have not looked" into "this file is data".
"""

import unittest

import build_overlay_census as boc


class TestSourceToModule(unittest.TestCase):
    def test_absolute_and_tilde_sources_agree(self):
        self.assertEqual(
            boc.source_to_module("/home/dorij/ddw3/asm/dw2003/pro/fieldstg.s"),
            "pro/fieldstg")
        self.assertEqual(
            boc.source_to_module("~/ddw3/asm/dw2003/pro/fieldstg.s"),
            "pro/fieldstg")

    def test_nested_module_keeps_its_path(self):
        self.assertEqual(
            boc.source_to_module("~/ddw3/asm/dw2003/pro/stgtrain/f0.s"),
            "pro/stgtrain/f0")

    def test_non_assembly_sources_are_ignored(self):
        self.assertIsNone(boc.source_to_module("docs/research/field/maps.md"))
        self.assertIsNone(boc.source_to_module("~/ddw3/asm/dw2003/pro/cardgame.c"))


class TestCodeRegion(unittest.TestCase):
    def test_absent_empty_and_populated(self):
        self.assertEqual(boc.code_region(b"SMDLDATA:\n.word 0x1\n"), "absent")
        self.assertEqual(
            boc.code_region(b"X:\n# Start of code\n# End of code\n.word 0x1\n"),
            "empty")
        self.assertEqual(
            boc.code_region(b"X:\n# Start of code\na\nb\n# End of code\n"),
            "2 lines")

    def test_unterminated_marker_is_reported_not_guessed(self):
        self.assertEqual(boc.code_region(b"X:\n# Start of code\na\n"),
                         "unterminated")


class TestClassify(unittest.TestCase):
    def test_claim_status_wins_over_naming(self):
        row = {"claim_status": "verified", "named_functions": 0, "functions": 3}
        boc.classify(row)
        self.assertEqual(row["status"], "verified")

    def test_status_ladder_below_claims(self):
        named = {"named_functions": 2, "functions": 3, "docs": []}
        mentioned = {"named_functions": 0, "functions": 3, "docs": ["d.md"]}
        nothing = {"named_functions": 0, "functions": 3, "docs": []}
        for row, want in ((named, "named-only"), (mentioned, "mentioned-only"),
                          (nothing, "unidentified")):
            boc.classify(row)
            self.assertEqual(row["status"], want)

    def test_zero_functions_is_no_code_entry_not_data(self):
        """A scanner zero is a coverage gap, never proof the file holds no code."""
        row = {"functions": 0, "named_functions": 0, "docs": []}
        boc.classify(row)
        self.assertEqual(row["kind"], "no-code-entry")

    def test_missing_from_inventory_is_distinct_from_zero(self):
        row = {"functions": None, "named_functions": 0, "docs": []}
        boc.classify(row)
        self.assertEqual(row["kind"], "uninventoried")


class TestSplitBlocks(unittest.TestCase):
    def test_dispositioned_blocks_leave_the_function_counts(self):
        functions = [
            {"semantic_name": "real"},
            {"role": "block"},
            {"role": "function"},
        ]
        kept, blocks = boc.split_blocks(functions)
        self.assertEqual(len(kept), 2)
        self.assertEqual(len(blocks), 1)


class TestDocTokens(unittest.TestCase):
    def test_english_basenames_are_not_bare_tokens(self):
        """`start` and `loading` must not tokenize to a module by themselves.

        They remain reachable as `start.s` / `loading.s` or the full module id;
        only the bare English word is refused, and cryptic `pro/` basenames
        stay matched bare.
        """
        tokens = boc.doc_tokens(
            {"exe/start": {}, "exe/loading": {}, "pro/smdldata": {},
             "pro/stgtrain/f0": {}})
        self.assertNotIn("start", tokens)
        self.assertNotIn("loading", tokens)
        self.assertNotIn("f0", tokens)
        self.assertEqual(tokens.get("smdldata"), "pro/smdldata")
        self.assertEqual(tokens.get("start.s"), "exe/start")
        self.assertEqual(tokens.get("exe/start"), "exe/start")


class TestFamilyOf(unittest.TestCase):
    def test_numbered_siblings_group_and_others_do_not(self):
        self.assertEqual(boc.family_of("pro/wstag880"), "pro/wstag*")
        self.assertEqual(boc.family_of("pro/stgtrain/f0"), "pro/stgtrain/f*")
        self.assertEqual(boc.family_of("pro/cardgame"), "pro/cardgame")


class TestCensusOutput(unittest.TestCase):
    """Integration checks against the committed census."""

    @classmethod
    def setUpClass(cls):
        import json
        if not boc.OUT_JSON.exists():
            raise unittest.SkipTest("census not built")
        cls.census = json.loads(boc.OUT_JSON.read_text())
        cls.by_module = {m["module"]: m for m in cls.census["modules"]}

    def test_every_assembly_file_has_exactly_one_row(self):
        modules = [m["module"] for m in self.census["modules"]]
        self.assertEqual(len(modules), len(set(modules)))
        self.assertEqual(len(modules), self.census["summary"]["modules"])

    def test_english_named_units_do_not_collect_prose_mentions(self):
        """`start` may only gain docs through explicit source references.

        Its row is empty of prose mentions (any doc listing it either names the
        unit explicitly, or is a canonical doc of a system whose claims cite
        it), so a doc with only the English word must not appear.
        """
        for module in ("exe/start", "exe/loading"):
            row = self.by_module[module]
            token = f"{module.rsplit('/', 1)[-1]}.s"
            allowed = set(row.get("canonical_docs") or ())
            for doc in row["docs"]:
                text = (boc.ROOT / doc).read_text(errors="replace")
                self.assertTrue(
                    doc in allowed or module in text or token in text,
                    f"{module} collected a prose-only mention: {doc}")

    def test_overlay_doc_prefers_the_doc_named_after_it(self):
        docs = self.by_module["pro/soundtst"]["docs"]
        self.assertIn("soundtst", docs[0],
                      f"soundtst should lead with its own doc, got {docs[0]}")

    def test_smdldata_is_not_presented_as_a_code_system(self):
        """The model-data file stays a data file, decoded or not.

        Its container format now has claims (its records are decoded as data),
        but it still has no discovered code entry, so its kind must stay
        `no-code-entry` and it must never read as a code overlay.
        """
        row = self.by_module["pro/smdldata"]
        self.assertEqual(row["kind"], "no-code-entry")
        self.assertTrue(row.get("claims"), "the data format's claims are attached")
        self.assertEqual(row["functions"], 0)


if __name__ == "__main__":
    unittest.main()
