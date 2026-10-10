"""Regression tests for `dw3-research known` overlay scoping.

All ~294 `wstag` stage overlays load at 0x800a5de0, so one address resolves inside
every one of them. Until 2026-08-11 `known` read the overlay off the TAIL of an
evidence `source` string; ledger sources are free-text file lists, so the tail
almost never ended in an overlay and the lookup returned None -- which the anchor
filter read as "not overlay-scoped, applies everywhere". `known 0x800a6118`
answered DECODED for all 294 stage overlays off anchors recorded in wstag740,
wstag735 and wstag330.
"""

from __future__ import annotations

import unittest

from tools.dw3_research.cli import evidence_overlay_tokens, overlay_token


class OverlayTokenTests(unittest.TestCase):
    def test_path_form_is_unchanged(self) -> None:
        self.assertEqual(overlay_token("~/ddw3/asm/dw2003/pro/cardgame.s"), "cardgame")
        self.assertEqual(overlay_token("exe-decomp/wstag200_c/F0x800a5de4.c"), "wstag200")
        self.assertIsNone(overlay_token("exe-decomp/c/F0x8001ed6c.c"))


class EvidenceOverlayTokenTests(unittest.TestCase):
    def test_free_text_source_yields_every_overlay_it_names(self) -> None:
        # The real EV-field-fire-trap-controller-static source. `overlay_token`
        # returns None for this string; that None is the whole defect.
        source = ("~/ddw3/asm/dw2003/pro/wstag740.s and wstag741.s, "
                  "web/assets/data/fire_traps.json, "
                  "docs/research/field/captures/fire-dungeon-explosion-state4.txt")
        self.assertIsNone(overlay_token(source))
        self.assertEqual(evidence_overlay_tokens(source), {"wstag740", "wstag741"})

    def test_ten_overlay_list_is_read_whole(self) -> None:
        source = ("~/ddw3/asm/dw2003/pro/wstag311.s wstag735.s wstag736.s wstag745.s "
                  "wstag746.s wstag750.s wstag800.s wstag810.s wstag815.s wstag820.s, "
                  "~/ddw3/asm/dw2003/exe/fns.s, exe-decomp/c/F0x8001f648.c")
        tokens = evidence_overlay_tokens(source)
        self.assertIn("wstag311", tokens)
        self.assertIn("wstag820", tokens)
        self.assertIn("fns", tokens)
        self.assertNotIn("wstag200", tokens)

    def test_a_wildcard_source_stays_family_wide(self) -> None:
        # "all 294 wstag*.s overlays" really does span the family, so it must not
        # be narrowed to one member -- it is reported unscoped, and the caller
        # demotes it to AMBIGUOUS rather than counting it as a per-overlay decode.
        source = ("FIELDSTG.PRO disc image as web/assets/native/fieldstg.bin; "
                  "all 294 ~/ddw3/asm/dw2003/pro/wstag*.s overlays")
        self.assertIsNone(evidence_overlay_tokens(source))

    def test_a_runtime_capture_names_no_overlay(self) -> None:
        source = ("PCSX-Redux savestate SLES03936.sstate9 (2026-07-26 14:28), "
                  "gzip blob, 2 MB main RAM at decompressed offset 0x27")
        self.assertIsNone(evidence_overlay_tokens(source))

    def test_bin_and_decompiled_directory_forms_are_recognised(self) -> None:
        self.assertEqual(
            evidence_overlay_tokens("web/assets/native/fieldstg.bin"), {"fieldstg"})
        self.assertEqual(
            evidence_overlay_tokens("exe-decomp/cardgame_c/F0x8008ec44.c"), {"cardgame"})


if __name__ == "__main__":
    unittest.main()
