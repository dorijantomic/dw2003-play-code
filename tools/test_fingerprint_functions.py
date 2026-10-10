"""Tests for the deterministic function fingerprinter.

The acceptance cases are real functions decoded by hand on 2026-08-09, so the
classifier is checked against ground truth it was not fitted to. Each unit test
below pins a bug that the acceptance run actually exposed:

  * two-operand `addiu` -- the assembly renders `addiu $v0, 0x58c4`, and reading
    only the three-operand form lost every constructed table address;
  * label-relative branch targets -- pro/cardgame labels lines by FILE OFFSET
    while pro/fightstg uses RAM, so comparing a target against a RAM address made
    every cardgame loop invisible and the pile sweep classify as unclassified;
  * `beq` switch chains -- a compiled switch is not always a jump table, and
    looking only for register dispatch missed the banner step machine.
"""

from __future__ import annotations

import unittest

from tools.fingerprint_functions import classify, constants_before, fingerprint, source_base


def lines(*pairs: tuple[int, str]) -> dict[int, str]:
    return dict(pairs)


class FingerprintTests(unittest.TestCase):
    def test_two_operand_addiu_builds_a_table_address(self) -> None:
        body = lines((0x80080000, "lui $v0, 0x800a"),
                     (0x80080004, "addiu $v0, 0x58c4"),
                     (0x80080008, "jalr $v0"), (0x8008000C, "jalr $v0"),
                     (0x80080010, "jr $ra"))
        item = fingerprint(body, 0x80080000, 0x80080014)
        self.assertIn(0x800A58C4, item["constructed_addresses"])
        self.assertIn("table_index_call", classify(item))

    def test_label_relative_branch_is_recognised_as_a_loop(self) -> None:
        """Labels are file offsets here, so the branch target needs the source base."""
        body = lines((0x80082CB0, ".L0x00000000: nop"),
                     (0x80082CB4, ".L0x00000004: andi $s0, $s0, 0x1"),
                     (0x80082CB8, ".L0x00000008: sb $zero, 0x446($v1)"),
                     (0x80082CBC, ".L0x0000000c: bnez $v0, .L0x00000004"),
                     (0x80082CC0, ".L0x00000010: jr $ra"))
        base = source_base(body)
        self.assertEqual(base, 0x80082CB0)
        item = fingerprint(body, 0x80082CB0, 0x80082CC4, base)
        self.assertTrue(item["has_loop"], "label-relative back branch must count")
        self.assertIn("masked_sweep", classify(item))

    def test_absolute_labels_still_work(self) -> None:
        body = lines((0x80082CB0, ".L0x80082cb0: nop"),
                     (0x80082CB4, ".L0x80082cb4: bnez $v0, .L0x80082cb0"),
                     (0x80082CB8, ".L0x80082cb8: jr $ra"))
        self.assertEqual(source_base(body), 0)
        item = fingerprint(body, 0x80082CB0, 0x80082CBC, 0)
        self.assertTrue(item["has_loop"])

    def test_beq_chain_counts_as_a_step_machine(self) -> None:
        body = lines((0x80080000, "lbu $v1, 0x422($s3)"),
                     (0x80080004, "beq $v1, $a1, .L0x00001000"),
                     (0x80080008, "beq $v1, $v0, .L0x00002000"),
                     (0x8008000C, "beq $v1, $a2, .L0x00003000"),
                     (0x80080010, "jr $ra"))
        self.assertIn("step_machine", classify(fingerprint(body, 0x80080000, 0x80080014)))

    def test_pad_service_is_recognised_structurally(self) -> None:
        """It never appears as a symbol; it is built as lui 0x8005 / addiu -0x4830."""
        body = lines((0x80080000, "lui $v0, 0x8005"),
                     (0x80080004, "addiu $s1, $v0, -0x4830"),
                     (0x80080008, "jr $ra"))
        item = fingerprint(body, 0x80080000, 0x8008000C)
        self.assertTrue(item["touches_pad_service"])
        self.assertIn("prompt_confirm", classify(item))

    def test_call_argument_in_the_delay_slot_is_resolved(self) -> None:
        """MIPS runs the delay slot before the branch; the card dispatch blocks put
        the discriminating argument there, and a lui there means 0x000F0000 not 0xF."""
        body = lines((0x80080000, "move $a0, $s1"),
                     (0x80080004, "jal 0x8008ca4c"),
                     (0x80080008, "lui $a2, 0xf"))
        self.assertEqual(constants_before(body, 0x80080004).get("a2"), 0x000F0000)

    def test_fingerprint_emits_no_semantics(self) -> None:
        """The boundary: structure only. If a meaning-bearing key ever appears here,
        the tool has crossed into interpretation and the ledger is at risk."""
        body = lines((0x80080000, "jr $ra"))
        item = fingerprint(body, 0x80080000, 0x80080004)
        for key in item:
            self.assertNotIn(key, {"meaning", "name", "purpose", "description"})


if __name__ == "__main__":
    unittest.main()
