"""Tests for the masked-body signature database.

Known-truth fixture, not a snapshot of the corpus: a small hand-built function
and its mutated copies, so every mask level is pinned to the mutation it is
supposed to survive. If a level stops matching its mutation, the database is
silently giving false negatives -- the failure this tool exists to remove.

Run: .venv/bin/python3 -m unittest tools.test_function_signature_db
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from tools.function_signature_db import (
    MASK_LEVELS,
    canonicalize_registers,
    ensure_scan_cap,
    fingerprint_words,
    grade,
    mask_branch,
    mask_immediate,
    mine,
    match_functions,
    parse_word_column,
    scan_cap_argv,
)


def itype(op: int, rs: int, rt: int, imm: int) -> int:
    return (op << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)


def rtype(rs: int, rt: int, rd: int, funct: int, shamt: int = 0) -> int:
    return (rs << 21) | (rt << 16) | (rd << 11) | (shamt << 6) | funct


def jtype(op: int, target: int) -> int:
    return (op << 26) | (target & 0x03FFFFFF)


def realloc(word: int, delta: int) -> int:
    """Add `delta` (mod 32) to every non-zero register field of one word."""
    def shift(reg: int) -> int:
        return 0 if reg == 0 else (reg + delta) % 32
    op = (word >> 26) & 0x3F
    if op in (0x02, 0x03):
        return word
    if op == 0:
        rs, rt, rd = (word >> 21) & 31, (word >> 16) & 31, (word >> 11) & 31
        word &= ~((0x1F << 21) | (0x1F << 16) | (0x1F << 11))
        return word | (shift(rs) << 21) | (shift(rt) << 16) | (shift(rd) << 11)
    rs, rt = (word >> 21) & 31, (word >> 16) & 31
    word &= ~((0x1F << 21) | (0x1F << 16))
    return word | (shift(rs) << 21) | (shift(rt) << 16)


# The known-truth body: addiu $sp / sw $ra / sw $s0 / lw $v0 / lui $v1 /
# beq $v0,$a1 / addu / jr $ra. Eight words so the gapped level has enough
# signal to be tested honestly.
BODY = [
    itype(0x09, 29, 29, -0x20),  # addiu $sp,$sp,-0x20
    itype(0x2B, 29, 31, 0x18),   # sw $ra,0x18($sp)
    itype(0x2B, 29, 16, 0x10),   # sw $s0,0x10($sp)
    itype(0x23, 4, 2, 0x0C),     # lw $v0,0xc($a0)
    itype(0x0F, 0, 3, 0x8004),   # lui $v1,0x8004
    itype(0x04, 2, 5, 3),        # beq $v0,$a1,+3
    rtype(2, 3, 2, 0x21),        # addu $v0,$v0,$v1
    rtype(31, 0, 0, 0x08),       # jr $ra
]

IMMEDIATE_INDEX = 3
BRANCH_INDEX = 5


def index_from(named: list[tuple[list[int], dict]]) -> dict:
    index = {level: {} for level in MASK_LEVELS}
    from tools.function_signature_db import add_to_index
    for words, entry in named:
        add_to_index(index, entry, fingerprint_words(words))
    return index


def grade_body(words: list[int], named: list[tuple[list[int], dict]]) -> dict | None:
    index = index_from(named)
    tokens_by_size: dict = {}
    for w, entry in named:
        tokens_by_size.setdefault(len(w), []).append((fingerprint_words(w)["branch_tokens"], entry))
    fp = fingerprint_words(words)
    return grade(fp, fp["branch_tokens"], index, tokens_by_size)


class MaskTests(unittest.TestCase):
    def test_jump_target_is_left_by_the_immediate_mask_and_cleared_by_the_branch_mask(self) -> None:
        jal = jtype(0x03, 0x12345)
        self.assertEqual(mask_immediate(jal), jal, "imm keeps the jump target")
        self.assertEqual(mask_branch(jal), 0x03 << 26, "branch clears the jump target")

    def test_alu_immediate_and_load_displacement_are_cleared(self) -> None:
        addiu = itype(0x09, 4, 2, 0x7FFF)
        self.assertEqual(mask_immediate(addiu), addiu & 0xFFFF0000)
        lw = itype(0x23, 4, 2, 0x0C)
        self.assertEqual(mask_immediate(lw), lw & 0xFFFF0000)

    def test_branch_target_is_intact_under_the_immediate_mask(self) -> None:
        beq = itype(0x04, 2, 5, 3)
        self.assertEqual(mask_immediate(beq), beq)

    def test_register_canonicalisation_hides_allocation_order(self) -> None:
        a = [rtype(8, 9, 10, 0x21)]   # addu $t0,$t1,$t2
        b = [rtype(16, 17, 18, 0x21)]  # addu $s0,$s1,$s2
        self.assertEqual(canonicalize_registers(a), canonicalize_registers(b))
        # $zero is a fixed point of the renaming.
        self.assertEqual(canonicalize_registers([rtype(0, 9, 10, 0x21)])[0] >> 21 & 31, 0)


class GradeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.named = [(BODY, {"id": "m:F0x1000", "name": "familyBody",
                              "family": "fam", "module": "m", "address": "0x80001000"})]

    def test_identical_body_matches_full_as_type_1(self) -> None:
        result = grade_body(list(BODY), self.named)
        self.assertEqual(result["level"], "full")
        self.assertEqual(result["clone_type"], 1)
        self.assertEqual(result["family"], "fam")

    def test_changed_immediate_matches_at_the_immediate_level(self) -> None:
        mutated = [w for w in BODY]
        mutated[IMMEDIATE_INDEX] = itype(0x23, 4, 2, 0x10)  # lw displacement 0xc -> 0x10
        result = grade_body(mutated, self.named)
        self.assertEqual(result["level"], "imm", "a constant-different copy is type 2 at imm")
        self.assertEqual(result["clone_type"], 2)

    def test_changed_branch_target_matches_at_the_branch_level(self) -> None:
        mutated = [w for w in BODY]
        mutated[BRANCH_INDEX] = itype(0x04, 2, 5, 5)  # beq target +3 -> +5
        result = grade_body(mutated, self.named)
        self.assertEqual(result["level"], "branch", "a moved branch is type 2 at branch")
        self.assertEqual(result["clone_type"], 2)

    def test_changed_register_matches_at_the_register_level(self) -> None:
        # A consistent physical-register renaming: same structure, same
        # first-use order, every register moved by the same offset.
        mutated = [realloc(w, 8) for w in BODY]
        result = grade_body(mutated, self.named)
        self.assertEqual(result["level"], "reg", "a reallocated register is type 2 at reg")
        self.assertEqual(result["clone_type"], 2)

    def test_unrelated_body_does_not_match(self) -> None:
        unrelated = [rtype(0, 0, 0, 0x00)] * 8  # eight nops, same length, no opcode overlap
        self.assertIsNone(grade_body(unrelated, self.named))

    def test_gapped_body_matches_as_type_3(self) -> None:
        mutated = BODY[:3] + [0] + BODY[3:]  # insert a nop
        result = grade_body(mutated, self.named)
        self.assertIsNotNone(result)
        self.assertEqual(result["level"], "gapped")
        self.assertEqual(result["clone_type"], 3)

    def test_a_hash_two_families_claim_is_ambiguous_not_guessed(self) -> None:
        named = self.named + [(list(BODY), {"id": "m:F0x2000", "name": "otherBody",
                                            "family": "famB", "module": "m",
                                            "address": "0x80002000"})]
        result = grade_body(list(BODY), named)
        self.assertTrue(result["ambiguous"])
        self.assertEqual(sorted(result["families"]), ["fam", "famB"])


def word_line(index: int, word: int) -> str:
    return f".L0x{index * 4:08x}: nop  # .word 0x{word:08x}"


def fixture_source() -> str:
    mutated = list(BODY)
    mutated[IMMEDIATE_INDEX] = itype(0x23, 4, 2, 0x10)  # immediate-only change
    lines = ['.section "fixture"']
    lines += [word_line(i, w) for i, w in enumerate(BODY)]
    lines += [word_line(len(BODY) + i, w) for i, w in enumerate(mutated)]
    return "\n".join(lines) + "\n"


class PipelineTests(unittest.TestCase):
    """mine() -> match_functions() over a temp word-column source."""

    SOURCE = fixture_source()

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "fixture.s"
        self.path.write_text(self.SOURCE)
        self.module = {
            "id": "pro/fixture", "source": str(self.path),
            "functions": [
                {"id": "pro/fixture:F0x80001000", "address": "0x80001000",
                 "source_line": 2, "semantic_name": "knownBody",
                 "semantic_family": None, "role": "function"},
                {"id": "pro/fixture:F0x80001020", "address": "0x80001020",
                 "source_line": 2 + len(BODY), "semantic_name": None, "role": "function"},
            ],
        }
        self.inventory = {"modules": [self.module]}

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_word_column_parses(self) -> None:
        words = parse_word_column(self.SOURCE)
        self.assertEqual(words[0], BODY[0])
        self.assertEqual(len(words), 2 * len(BODY))

    def test_mine_then_match_finds_the_mutated_copy(self) -> None:
        db = mine(self.inventory, {"claims": [], "evidence": []}, dump=None)
        self.assertEqual(db["counts"]["fingerprinted"], 1)
        rows = match_functions(db, self.inventory, [self.module], dump=None)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "pro/fixture:F0x80001020")
        self.assertEqual(rows[0]["status"], "matched")
        self.assertEqual(rows[0]["level"], "imm")
        self.assertEqual(rows[0]["clone_type"], 2)
        self.assertEqual(rows[0]["family"], "knownBody")


class ScanCapTests(unittest.TestCase):
    def test_cap_argv_is_built_when_uncapped(self) -> None:
        old = os.environ.pop("DW3_SCAN_CAPPED", None)
        try:
            argv = scan_cap_argv()
            if argv is not None:  # only meaningful on Linux with taskset
                self.assertEqual(argv[:2], ["taskset", "-c"])
                self.assertIn("--as=4294967296", argv)
                self.assertIn("prlimit", argv)
        finally:
            if old is not None:
                os.environ["DW3_SCAN_CAPPED"] = old

    def test_already_capped_returns_no_argv(self) -> None:
        old = os.environ.get("DW3_SCAN_CAPPED")
        os.environ["DW3_SCAN_CAPPED"] = "1"
        try:
            self.assertIsNone(scan_cap_argv())
            ensure_scan_cap()  # must not exec
        finally:
            if old is None:
                os.environ.pop("DW3_SCAN_CAPPED", None)
            else:
                os.environ["DW3_SCAN_CAPPED"] = old


if __name__ == "__main__":
    unittest.main()
