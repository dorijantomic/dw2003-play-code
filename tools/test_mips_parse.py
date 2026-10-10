"""Tests for the lexical MIPS line parser."""

from __future__ import annotations

import unittest

from tools.mips_parse import parse_line


class ParseLineTests(unittest.TestCase):
    def test_store_with_lo_symbol(self) -> None:
        got = parse_line("800246e8  .L0x800246e8: sw $a0, %lo(D0x8007f9a0)($at)")
        self.assertEqual(got.address, 0x800246E8)
        self.assertEqual(got.mnemonic, "sw")
        self.assertEqual(got.operands[0].kind, "reg")
        self.assertEqual(got.operands[0].reg, "a0")
        self.assertEqual(got.operands[1].kind, "mem")
        self.assertEqual(got.operands[1].base, "at")
        self.assertEqual(got.operands[1].symbol, 0x8007F9A0)
        self.assertEqual(got.operands[1].offset, 0)

    def test_load_with_numeric_offset(self) -> None:
        got = parse_line("8001b120  .L0x8001b120: lw $a1, 0x18($sp)")
        self.assertEqual(got.mnemonic, "lw")
        self.assertEqual(got.operands[1].base, "sp")
        self.assertEqual(got.operands[1].offset, 0x18)
        self.assertIsNone(got.operands[1].symbol)

    def test_load_with_no_offset(self) -> None:
        got = parse_line("800246e0  .L0x800246e0: lhu $v0, ($v0)")
        self.assertEqual(got.operands[1].base, "v0")
        self.assertEqual(got.operands[1].offset, 0)

    def test_hi_symbol_operand(self) -> None:
        got = parse_line("800246e4  .L0x800246e4: lui $at, %hi(D0x8007f9a0)")
        self.assertEqual(got.operands[1].kind, "sym")
        self.assertEqual(got.operands[1].symbol, 0x8007F9A0)

    def test_immediate_and_negative_immediate(self) -> None:
        self.assertEqual(parse_line("1  x: li $v0, 0x1f801120").operands[1].value,
                         0x1F801120)
        self.assertEqual(parse_line("1  x: addiu $sp, -0x20").operands[1].value, -0x20)

    def test_call_target_and_branch_label(self) -> None:
        call = parse_line("8001b0f0  .L0x8001b0f0: jal F0x8001ac14")
        self.assertEqual(call.mnemonic, "jal")
        self.assertEqual(call.operands[0].kind, "sym")
        self.assertEqual(call.operands[0].symbol, 0x8001AC14)
        branch = parse_line("8001b190  .L0x8001b190: beq $s1, $v0, .L0x8001b194")
        self.assertEqual(branch.operands[2].kind, "label")
        self.assertEqual(branch.operands[2].symbol, 0x8001B194)

    def test_pseudo_ops_keep_their_name(self) -> None:
        self.assertEqual(parse_line("1  x: move_ $s0, $a0").mnemonic, "move_")
        self.assertEqual(parse_line("1  x: la_ $a0, F0x8001ac14").mnemonic, "la_")

    def test_gte_register_operand(self) -> None:
        got = parse_line("1  x: mtc2 $t3, $9")
        self.assertEqual(got.mnemonic, "mtc2")
        self.assertEqual(got.operands[1].reg, "9")

    def test_comment_is_stripped(self) -> None:
        got = parse_line("80082cf8  .L0x48: .word 0x800843a0 # lb $t0, 0x43a0($zr)")
        self.assertEqual(got.mnemonic, ".word")
        self.assertEqual(got.operands[0].value, 0x800843A0)

    def test_blank_line_returns_none(self) -> None:
        self.assertIsNone(parse_line("   "))

    # The six tests below were added after review found the first version of
    # this parser silently dropped 722 operand instances across 564 real
    # instructions. Every one returned kind="sym" with symbol=None, which looks
    # like a valid operand to any caller that checks only .kind.

    def test_lo_symbol_outside_a_memory_operand(self) -> None:
        got = parse_line("80011060  x: addiu $s1, $v0, %lo(D0x80048d34)")
        self.assertEqual(got.operands[2].kind, "sym")
        self.assertEqual(got.operands[2].symbol, 0x80048D34)

    def test_named_call_target_keeps_its_name(self) -> None:
        got = parse_line("80011138  x: jal EnterCriticalSection")
        self.assertEqual(got.operands[0].kind, "sym")
        self.assertEqual(got.operands[0].name, "EnterCriticalSection")
        self.assertIsNone(got.operands[0].symbol)

    def test_named_symbol_with_an_addend(self) -> None:
        got = parse_line("80011418  x: lui $a0, %hi(LBA_OFFSETS + 0x1d2)")
        self.assertEqual(got.operands[1].name, "LBA_OFFSETS")
        self.assertEqual(got.operands[1].offset, 0x1D2)

    def test_symbol_arithmetic_in_a_memory_operand_stays_memory(self) -> None:
        got = parse_line("8001169c  x: lw $v0, %lo(D0x8004de10 + 0x62 * 0x4)($v0)")
        self.assertEqual(got.operands[1].kind, "mem")
        self.assertEqual(got.operands[1].base, "v0")
        self.assertEqual(got.operands[1].symbol, 0x8004DE10 + 0x62 * 0x4)

    def test_overlay_qualified_name_yields_both_name_and_address(self) -> None:
        got = parse_line("1  x: jal FIGHTSTG_F0x8009a298")
        self.assertEqual(got.operands[0].name, "FIGHTSTG_F0x8009a298")
        self.assertEqual(got.operands[0].symbol, 0x8009A298)

    def test_no_operand_is_a_sym_with_nothing_in_it(self) -> None:
        """The failure mode this whole group exists to prevent."""
        for text in ("80011060  x: addiu $s1, $v0, %lo(D0x80048d34)",
                     "80011138  x: jal f13",
                     "80011418  x: lui $a0, %hi(LBA_OFFSETS + 0x1d2)",
                     "8001169c  x: lw $v0, %lo(D0x8004de10 + 0x62 * 0x4)($v0)"):
            for operand in parse_line(text).operands:
                if operand.kind == "sym":
                    self.assertFalse(operand.symbol is None and operand.name is None,
                                     f"empty sym operand in: {text}")


if __name__ == "__main__":
    unittest.main()
