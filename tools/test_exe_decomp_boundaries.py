"""Boundary rules for m2c entry selection in tools/exe_decomp/decompile_exe.py.

A `jr` through a `.word` table dispatches *within* a function, so its targets are
case labels sharing the caller's frame. A `jalr` through a table calls real
functions. Confusing the two either invents functions that read registers they
never assign, or deletes genuine entry points.
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "exe_decomp"))

import decompile_exe as d  # noqa: E402


JR_DISPATCH = """\
.set noat
.rodata
.global D0x80010000
D0x80010000:
.L0x80010000: .word F0x80011100
.L0x80010004: .word F0x80011200
.text
.global F0x80011000
F0x80011000:
.L0x80011000: sltiu $v0, $v1, 0x2
.L0x80011004: lui $v0, %hi(D0x80010000)
addiu $v0, $v0, %lo(D0x80010000)
.L0x8001100c: sll $v1, 0x2
.L0x80011010: addu $v1, $v0
.L0x80011014: lw $v0, ($v1)
.L0x80011018: jr $v0
.L0x8001101c: nop
.global F0x80011100
F0x80011100:
.L0x80011100: jr $ra
.L0x80011104: nop
.global F0x80011200
F0x80011200:
.L0x80011200: jr $ra
.L0x80011204: nop
"""

# Same table, but reached with `jalr` -- a call, so the targets are functions.
JALR_DISPATCH = JR_DISPATCH.replace(".L0x80011018: jr $v0", ".L0x80011018: jalr $v0")

# A case label that is also a genuine `jal` target must survive the filter.
JR_WITH_DIRECT_CALL = JR_DISPATCH.replace(
    ".L0x80011000: sltiu $v0, $v1, 0x2",
    ".L0x80011000: jal F0x80011200",
)


def load(text):
    with tempfile.NamedTemporaryFile("w", suffix=".s", delete=False) as handle:
        handle.write(text)
        path = handle.name
    units = d.parse_units(path)
    Path(path).unlink()
    return units, {u.label: i for i, u in enumerate(units) if u.label}


class SwitchCaseBoundaries(unittest.TestCase):
    def test_jr_table_targets_are_case_labels(self):
        units, idx = load(JR_DISPATCH)
        self.assertEqual(
            d.switch_case_labels(units, idx), {"F0x80011100", "F0x80011200"}
        )

    def test_case_labels_are_not_emitted_as_entries(self):
        units, idx = load(JR_DISPATCH)
        entries = d.real_entries(units, idx)
        self.assertNotIn("F0x80011100", entries)
        self.assertNotIn("F0x80011200", entries)

    def test_dispatching_function_remains_an_entry(self):
        units, idx = load(JR_DISPATCH)
        self.assertIn("F0x80011000", d.real_entries(units, idx))

    def test_jalr_table_targets_stay_entries(self):
        units, idx = load(JALR_DISPATCH)
        self.assertEqual(d.switch_case_labels(units, idx), set())
        entries = d.real_entries(units, idx)
        self.assertIn("F0x80011100", entries)
        self.assertIn("F0x80011200", entries)

    def test_direct_call_target_survives_the_filter(self):
        units, idx = load(JR_WITH_DIRECT_CALL)
        self.assertIn("F0x80011200", d.switch_case_labels(units, idx))
        # Called with `jal`, so it is a real function despite also being tabled.
        self.assertIn("F0x80011200", d.real_entries(units, idx))

    def test_case_bodies_stay_reachable_from_the_dispatcher(self):
        units, idx = load(JR_DISPATCH)
        text_idxs, rodata_idxs = d.closure(units, idx, idx["F0x80011000"])
        labels = {units[i].label for i in text_idxs if units[i].label}
        self.assertIn("F0x80011100", labels)
        self.assertIn("F0x80011200", labels)
        self.assertTrue(rodata_idxs, "jump table rodata must be emitted")


if __name__ == "__main__":
    unittest.main()
