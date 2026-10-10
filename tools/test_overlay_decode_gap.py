"""Tests for the overlay decode-gap audit.

The tool's job is to say what is left to read. Its failure mode is the opposite:
it matches ADDRESSES, and the plain-language documents that carry most of this
project's decoded knowledge are forbidden from printing addresses, so a fully
read overlay can score as untouched. That has sent three sessions to re-read
finished work (stcrddek twice, stgtrain once). These tests pin the two
corrections that make the output honest: the mechanical bucket, and the header
that points at the surfaces the address match cannot see.
"""

from __future__ import annotations

import unittest

from tools import overlay_decode_gap as gap


class MechanicalBucketTests(unittest.TestCase):
    def test_boilerplate_is_not_counted_as_unread(self) -> None:
        # The classifier and the audit must agree about what is derivable, or the
        # audit reports wrappers and setters as work.
        mech = gap.mechanical_addresses("stgtrain")
        self.assertTrue(mech, "stgtrain has mechanically derivable functions")
        self.assertTrue(all(a.startswith("0x") for a in mech))

    def test_an_unknown_overlay_yields_no_mechanical_rows(self) -> None:
        # Failing to classify must never SHRINK the reported work queue.
        self.assertEqual(gap.mechanical_addresses("no_such_overlay_xyz"), set())


class OtherSurfacesTests(unittest.TestCase):
    def test_it_reports_the_overlay_doc_and_its_coverage_sentence(self) -> None:
        s = gap.other_surfaces("stgtrain")
        self.assertIsNotNone(s["overlay_doc"])
        self.assertIsNotNone(s["coverage_sentence"])
        # The sentence is quoted verbatim, not parsed into a number: the document
        # is the authority on its own coverage, this tool is not.
        self.assertIn("all read", s["coverage_sentence"])
        self.assertNotIn("*", s["coverage_sentence"])

    def test_it_counts_the_decompiled_corpus_and_the_dated_docs(self) -> None:
        s = gap.other_surfaces("stgtrain")
        self.assertEqual(s["decompiled"], 60)
        self.assertGreater(len(s["dated_docs"]), 5)
        # The overlay's own document is the header's first field, so it must not
        # also be counted among the dated ones.
        self.assertNotIn(s["overlay_doc"], s["dated_docs"])

    def test_an_overlay_with_no_document_says_so_rather_than_failing(self) -> None:
        s = gap.other_surfaces("no_such_overlay_xyz")
        self.assertIsNone(s["overlay_doc"])
        self.assertEqual(s["decompiled"], 0)


class RegressionTests(unittest.TestCase):
    def test_the_two_overlays_that_cost_sessions_no_longer_read_as_untouched(self) -> None:
        # stcrddek was read in full twice while this tool reported 2 of 46
        # anchored. Its residue — functions with no anchor, no mention, and no
        # derivable shape — must be zero.
        fns = gap.overlay_functions("stcrddek")
        ev, claims = gap.load_ledger()
        anchored = gap.anchored_addresses(ev, "stcrddek")
        named = gap.named_addresses(claims, "stcrddek") | gap.doc_addresses("stcrddek")
        mech = gap.mechanical_addresses("stcrddek")
        residue = [a for a in fns if a not in anchored and a not in named and a not in mech]
        self.assertEqual(residue, [], "stcrddek was read in full; residue must be empty")


if __name__ == "__main__":
    unittest.main()
