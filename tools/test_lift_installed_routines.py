"""The recovery must not invent a routine, and must prove itself on known ones.

Two properties matter, and both are about NOT trusting the tool:

  * an address with no instruction boundary at its offset is NOT a hidden
    routine. Promoting it would manufacture one out of the middle of another.
  * the control. Every recovered routine is only as good as the run's ability
    to reproduce the routines we already had, byte for byte.
"""
import pathlib
import tempfile
import unittest

from tools.lift_installed_routines import Overlay, base_address, controls, promote


ASM = """\
# auto-generated
.global F0x80010000
F0x80010000:
.L0x00000000: addiu $sp, -0x20
.L0x00000004: jr $ra
.L0x00000008: nop
.L0x0000000c: addiu $sp, -0x10
.L0x00000010: jr $ra
"""


class BaseAddressTests(unittest.TestCase):
    def test_base_is_the_label_minus_its_offset(self):
        self.assertEqual(base_address(ASM.splitlines()), 0x80010000)

    def test_no_labelled_routine_is_an_error_not_a_guess(self):
        with self.assertRaises(ValueError):
            base_address([".L0x00000000: nop", ".L0x00000004: nop"])


class PromoteTests(unittest.TestCase):
    def _promote(self, wanted):
        ov = Overlay.__new__(Overlay)
        ov.norm_path = self.path
        return promote(ov, wanted, self.out)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = pathlib.Path(self.tmp.name) / "in.s"
        self.path.write_text(ASM)
        self.out = pathlib.Path(self.tmp.name) / "out.s"

    def test_an_address_on_an_instruction_boundary_becomes_an_entry(self):
        promoted, unplaced = self._promote({0x8001000C})
        self.assertEqual(promoted, [0x8001000C])
        self.assertEqual(unplaced, [])
        self.assertIn("F0x8001000c:", self.out.read_text())

    def test_an_address_between_instructions_is_refused(self):
        # 0x80010002 sits inside an instruction; there is no label for it, so
        # it is not a routine and must not be manufactured into one.
        promoted, unplaced = self._promote({0x80010002})
        self.assertEqual(promoted, [])
        self.assertEqual(unplaced, [0x80010002])

    def test_an_address_that_is_already_an_entry_is_left_alone(self):
        promoted, unplaced = self._promote({0x80010000})
        self.assertEqual((promoted, unplaced), ([], []))
        self.assertEqual(self.out.read_text().count("F0x80010000:"), 1)


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = pathlib.Path(self.tmp.name)
        self.old, self.new = root / "old", root / "new"
        self.old.mkdir()
        self.new.mkdir()
        self.ov = Overlay.__new__(Overlay)
        self.ov.c_dir = self.old
        self.ov.entries = lambda: {0x80010000, 0x80010010}

    def test_identical_output_passes(self):
        for d in (self.old, self.new):
            (d / "F0x80010000.c").write_text("void f(void) {}\n")
        same, differ, bad = controls(self.ov, {0x80010000}, self.new)
        self.assertEqual((same, differ, bad), (1, 0, []))

    def test_any_difference_fails_and_is_named(self):
        (self.old / "F0x80010000.c").write_text("void f(void) {}\n")
        (self.new / "F0x80010000.c").write_text("void f(int a) {}\n")
        same, differ, bad = controls(self.ov, {0x80010000}, self.new)
        self.assertEqual((same, differ), (0, 1))
        self.assertEqual(bad, ["F0x80010000.c"])

    def test_a_routine_with_no_prior_copy_is_not_counted_either_way(self):
        (self.new / "F0x80010010.c").write_text("void g(void) {}\n")
        self.assertEqual(controls(self.ov, {0x80010010}, self.new), (0, 0, []))


if __name__ == "__main__":
    unittest.main()
