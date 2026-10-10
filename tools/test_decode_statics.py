"""Tests for the function pointers the shipped image already holds."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.decode_statics import INVENTORY, pointer_cells

SOURCE = "~/ddw3/rust/dw2003_exe_data/src/data.rs"


def read(inventory: dict, asm: str | None = None) -> dict[int, dict]:
    """Run the reader against a throwaway inventory and exe assembly."""
    with tempfile.TemporaryDirectory() as name:
        root = Path(name)
        (root / "function-inventory.json").write_text(json.dumps(inventory))
        if asm is not None:
            (root / "asm").mkdir()
            (root / "asm/f5.s").write_text(asm)
        return pointer_cells(root / "function-inventory.json",
                             root / "asm" if asm is not None else root / "none")


def resident(name: str, target: str | None, symbol: str | None = None) -> dict:
    return {"global_function_pointers": {name: {
        "target_address": target, "target_symbol": symbol,
        "source": SOURCE, "source_line": 3677}}}


class ResidentCellTests(unittest.TestCase):
    def test_a_cell_is_keyed_by_the_address_the_linker_gives_it(self) -> None:
        got = read(resident("D0x8004bbd8", "0x80018980"))
        self.assertEqual(got[0x8004BBD8]["target"], 0x80018980)
        self.assertEqual(got[0x8004BBD8]["scope"], "resident")
        self.assertEqual(got[0x8004BBD8]["source"], f"{SOURCE}:3677")

    def test_a_cell_that_is_not_an_address_is_skipped(self) -> None:
        self.assertEqual(read({"global_function_pointers": {"NOT_A_CELL": {}}}), {})

    def test_a_missing_inventory_is_empty_not_an_error(self) -> None:
        self.assertEqual(pointer_cells(Path("/nonexistent/inventory.json")), {})


class UnresolvedSymbolTests(unittest.TestCase):
    """The inventory records a bare symbol without an address; this fills it in.

    tools/build_recovered_inventory.py leaves `ptr::addr_of!(f5)` as a name.
    The address is in the section header and nowhere else.
    """

    ASM = ('.include "macros.s"\n\n.section "section_f5.0x8001355c"\n'
           ".global f5\nf5:\n\tjr $ra\n")

    def test_a_named_symbol_resolves_through_its_section_header(self) -> None:
        got = read(resident("D0x80042b98", None, "f5"), asm=self.ASM)
        self.assertEqual(got[0x80042B98]["target"], 0x8001355C)

    def test_an_unresolvable_symbol_is_kept_named_not_guessed(self) -> None:
        got = read(resident("D0x80042b98", None, "f5"))
        self.assertIsNone(got[0x80042B98]["target"])
        self.assertEqual(got[0x80042B98]["symbol"], "f5")

    def test_a_data_symbol_is_never_taken_as_a_function(self) -> None:
        """`fns.s` exports its data tables `.global` too."""
        asm = ('.section "fns0_0.0x80010000"\n.global D0x8001085c\n'
               "D0x8001085c:\n\t.word 0\n")
        got = read(resident("D0x80044b30", None, "D0x8001085c"), asm=asm)
        self.assertIsNone(got[0x80044B30]["target"])


class OverlayCellTests(unittest.TestCase):
    """A cell inside an overlay exists only while that overlay is loaded."""

    def entry(self, at: int, target: str) -> dict:
        return {"overlay_function_pointers": {"D0x8009b704": [{
            "cell_address": at, "target_address": target,
            "owner_module": "pro/fieldstg",
            "source": "~/ddw3/rust/dw2003_pro_fieldstg/src/data.rs",
            "source_line": 12}]}}

    def test_an_overlay_cell_carries_the_overlay_that_owns_it(self) -> None:
        got = read(self.entry(0x8009B704, "0x800928cc"))
        self.assertEqual(got[0x8009B704]["target"], 0x800928CC)
        self.assertEqual(got[0x8009B704]["scope"], "pro/fieldstg")

    def test_a_resident_cell_wins_over_an_overlay_cell(self) -> None:
        """Two overlays share a load address; the resident program does not."""
        rows = resident("D0x8004bbd8", "0x80018980")
        rows.update(self.entry(0x8004BBD8, "0x80099999"))
        self.assertEqual(read(rows)[0x8004BBD8]["target"], 0x80018980)


class ShippedCorpusTests(unittest.TestCase):
    """Against the committed inventory, when it is checked out.

    Every expected value was published independently before this tool existed:
    the resident four by a live RAM capture in
    docs/research/field/s780-street-life-native-system.md, 0x8004B5FC in ledger
    evidence EV-encounter-zone-map-cleared-on-field-entry-2026-07-26, and
    0x8009B704 in the table in
    docs/research/field/typed-terrain-layer-decoded-2026-07-28.md.
    """

    KNOWN = {0x80044F5C: 0x800140D8, 0x8004BBC4: 0x80018854,
             0x8004BBD8: 0x80018980, 0x8004DC0C: 0x8001933C,
             0x8004B5FC: 0x80017F54, 0x8009B704: 0x800928CC,
             0x8009B714: 0x800928E4}

    def setUp(self) -> None:
        if not INVENTORY.is_file():
            self.skipTest(f"{INVENTORY} is not built")
        self.cells = pointer_cells()

    def test_the_known_cells_hold_what_earlier_work_measured(self) -> None:
        got = {at: self.cells.get(at, {}).get("target") for at in self.KNOWN}
        self.assertEqual(got, self.KNOWN)

    def test_no_cell_lands_outside_the_program(self) -> None:
        for at, cell in self.cells.items():
            self.assertTrue(0x80010000 <= at < 0x80800000, f"cell 0x{at:08X}")
            if cell["target"] is not None:
                self.assertTrue(0x80010000 <= cell["target"] < 0x80800000,
                                f"target of 0x{at:08X}")

    def test_the_section_header_pass_still_earns_its_keep(self) -> None:
        """It is the only thing that resolves these; the inventory leaves them null."""
        for at in (0x8004DC0C, 0x80042B98, 0x80055D30):
            self.assertIsNotNone(self.cells.get(at, {}).get("target"),
                                 f"cell 0x{at:08X}")


if __name__ == "__main__":
    unittest.main()
