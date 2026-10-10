"""Tests for the symbolic MIPS analyzer."""

from __future__ import annotations

import unittest

from tools.mips_parse import parse_line
from tools.mips_decode import (
    apply_arithmetic, apply_memory, arg, const, glob, initial_state, join, unknown,
)


def run(lines):
    state = initial_state()
    for text in lines:
        apply_arithmetic(state, parse_line(text))
    return state


def run_memory(lines):
    state, sink = initial_state(), []
    for text in lines:
        insn = parse_line(text)
        if not apply_memory(state, insn, sink):
            apply_arithmetic(state, insn)
    return state, sink


class ValueTests(unittest.TestCase):
    def test_arguments_start_as_arguments(self) -> None:
        self.assertEqual(initial_state()["a0"], arg("a0"))

    def test_join_of_equal_values_keeps_them(self) -> None:
        self.assertEqual(join(const(4), const(4)), const(4))

    def test_join_of_different_values_is_unknown(self) -> None:
        self.assertEqual(join(const(4), const(5)).kind, "unknown")


class ArithmeticTests(unittest.TestCase):
    def test_li_sets_a_constant(self) -> None:
        self.assertEqual(run(["1  x: li $v0, 0x1f801120"])["v0"], const(0x1F801120))

    def test_move_copies(self) -> None:
        self.assertEqual(run(["1  x: move_ $s0, $a0"])["s0"], arg("a0"))

    def test_la_sets_a_global(self) -> None:
        self.assertEqual(run(["1  x: la_ $a0, F0x8001ac14"])["a0"], glob(0x8001AC14))

    def test_lui_hi_symbol_sets_a_global(self) -> None:
        self.assertEqual(run(["1  x: lui $at, %hi(D0x8007f9a0)"])["at"],
                         glob(0x8007F9A0))

    def test_named_symbol_is_a_global_with_a_name(self) -> None:
        """65 routines are written by name; `symbol is not None` misses them all."""
        got = run(["1  x: lui $a0, %hi(LBA_OFFSETS + 0x1d2)"])["a0"]
        self.assertEqual(got.kind, "global")
        self.assertEqual(got.name, "LBA_OFFSETS")

    def test_addiu_folds_a_constant(self) -> None:
        self.assertEqual(run(["1  x: li $v0, 0x10", "2  x: addiu $v1, $v0, 0x4"])["v1"],
                         const(0x14))

    def test_addiu_on_unknown_is_unknown(self) -> None:
        self.assertEqual(run(["1  x: addiu $v1, $t9, 0x4"])["v1"].kind, "unknown")

    def test_zero_register_reads_as_zero(self) -> None:
        self.assertEqual(run(["1  x: addiu $v0, $zr, 0x7"])["v0"], const(7))

    def test_sll_produces_a_scaled_index(self) -> None:
        got = run(["1  x: sll $v0, $s1, 0x2"])["v0"]
        self.assertEqual(got.kind, "scaled")
        self.assertEqual(got.number, 2)

    def test_scaled_plus_global_is_a_table(self) -> None:
        got = run(["1  x: sll $v0, $a0, 0x2",
                   "2  x: lui $at, %hi(D0x80082cf8)",
                   "3  x: addu $at, $at, $v0"])["at"]
        self.assertEqual(got.kind, "table")
        self.assertEqual(got.number, 2)

    def test_unhandled_mnemonic_is_reported_unconsumed(self) -> None:
        self.assertFalse(apply_arithmetic(initial_state(), parse_line("1  x: ctc2 $t0, $31")))


class MemoryTests(unittest.TestCase):
    def test_store_to_lo_symbol_is_a_global_write(self) -> None:
        _, sink = run_memory([
            "800246e4  x: lui $at, %hi(D0x8007f9a0)",
            "800246e8  x: sw $a0, %lo(D0x8007f9a0)($at)",
        ])
        self.assertEqual(len(sink), 1)
        self.assertEqual(sink[0]["object"], "global")
        self.assertEqual(sink[0]["address"], 0x8007F9A0)
        self.assertEqual(sink[0]["access"], "write")
        self.assertEqual(sink[0]["width"], "word")
        self.assertEqual(sink[0]["at"], 0x800246E8)
        self.assertEqual(sink[0]["value"], "arg(a0)")

    def test_load_through_argument_is_a_field_read(self) -> None:
        _, sink = run_memory(["1  x: move_ $s0, $a0", "2  x: lw $v0, 0x5a4($s0)"])
        self.assertEqual(sink[0]["object"], "a0")
        self.assertEqual(sink[0]["offset"], 0x5A4)
        self.assertEqual(sink[0]["access"], "read")

    def test_stack_slot_is_not_an_argument_field(self) -> None:
        _, sink = run_memory(["1  x: sw $a0, 0x18($sp)"])
        # Nothing has moved the stack pointer yet, so the frame base is +0x0
        # and the local is that plus 0x18. The base names WHICH local now;
        # see describe_object.
        self.assertEqual(sink[0]["object"], "stack+0x0")
        self.assertEqual(sink[0]["offset"], 0x18)

    def test_hardware_register_is_classified_apart(self) -> None:
        _, sink = run_memory(["800246d8  x: li $v0, 0x1f801120",
                              "800246e0  x: lhu $v0, ($v0)"])
        self.assertEqual(sink[0]["object"], "hardware")
        self.assertEqual(sink[0]["address"], 0x1F801120)
        self.assertEqual(sink[0]["width"], "halfword")

    def test_loaded_value_is_tracked_into_the_register(self) -> None:
        state, _ = run_memory(["1  x: lw $v0, 0x10($a1)"])
        self.assertEqual(state["v0"].kind, "load")
        self.assertEqual(state["v0"].offset, 0x10)

    def test_byte_and_halfword_widths(self) -> None:
        _, sink = run_memory(["1  x: sb $a0, 0x2($a1)", "2  x: sh $a0, 0x4($a1)"])
        self.assertEqual([row["width"] for row in sink], ["byte", "halfword"])

    def test_unaligned_access_is_recorded(self) -> None:
        _, sink = run_memory(["1  x: lwl $v0, 0x3($a1)"])
        self.assertEqual(sink[0]["width"], "word-unaligned")

    def test_symbol_arithmetic_load_is_a_memory_access(self) -> None:
        """Review found this form reclassified as a symbol, losing its base."""
        _, sink = run_memory(
            ["8001169c  x: lw $v0, %lo(D0x8004de10 + 0x62 * 0x4)($v0)"])
        self.assertEqual(len(sink), 1)
        self.assertEqual(sink[0]["address"], 0x8004DE10 + 0x62 * 0x4)

    def test_indexed_table_load_records_base_and_stride(self) -> None:
        _, sink = run_memory([
            "1000  x: sll $v0, $a0, 0x2",
            "1004  x: lui $at, %hi(D0x80082cf8)",
            "1008  x: addu $at, $at, $v0",
            "100c  x: lw $v1, %lo(D0x80082cf8)($at)",
        ])
        self.assertEqual(sink[0]["table_base"], 0x80082CF8)
        self.assertEqual(sink[0]["table_stride"], 4)
        self.assertEqual(sink[0]["table_index"], "arg(a0)")


from tools.mips_decode import LOOP_CAP, decode_function, walk

SNAPSHOT = [
    "800246d8  x: li $v0, 0x1f801120",
    "800246e0  x: lhu $v0, ($v0)",
    "800246e4  x: lui $at, %hi(D0x8007f9a0)",
    "800246e8  x: sw $a0, %lo(D0x8007f9a0)($at)",
    "800246ec  x: lui $at, %hi(D0x8007f99c)",
    "800246f0  x: jr $ra",
    "800246f4  x: sw $v0, %lo(D0x8007f99c)($at)",
]


def walk_lines(lines):
    return walk([parse_line(text) for text in lines])


class ControlFlowTests(unittest.TestCase):
    def test_delay_slot_after_return_is_executed(self) -> None:
        """The `sw` after `jr $ra` performs a real store. Dropping it loses work."""
        result = walk_lines(SNAPSHOT)
        writes = [result.memory[a] for a in sorted(result.memory)
                  if result.memory[a]["access"] == "write"]
        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[1]["address"], 0x8007F99C)
        self.assertEqual(writes[1]["value"], "load(hardware+0x0, halfword)")

    def test_delay_slot_after_a_call_is_executed(self) -> None:
        result = walk_lines(["1000  x: jal F0x8001ac14", "1004  x: li $a0, 0x5"])
        self.assertNotIn(0x1004, result.unreached)

    def test_disagreeing_paths_produce_unknown(self) -> None:
        result = walk_lines(["1000  x: beqz $a0, .L0x100c",
                             "1004  x: nop",
                             "1008  x: li $v0, 0x1",
                             "100c  x: sw $v0, 0x0($a1)"])
        self.assertEqual(result.states[0x100C]["v0"].kind, "unknown")

    def test_agreeing_paths_keep_the_value(self) -> None:
        result = walk_lines(["1000  x: li $v0, 0x7",
                             "1004  x: beqz $a0, .L0x100c",
                             "1008  x: nop",
                             "100c  x: sw $v0, 0x0($a1)"])
        self.assertEqual(result.states[0x100C]["v0"], const(7))

    def test_loop_terminates(self) -> None:
        result = walk_lines(["1000  x: li $v0, 0x0",
                             "1004  x: addiu $v0, $v0, 0x1",
                             "1008  x: bnez $a0, .L0x1004",
                             "100c  x: nop"])
        self.assertTrue(result.capped or result.states[0x1004]["v0"].kind == "unknown")

    def test_unknown_mnemonic_is_listed_not_dropped(self) -> None:
        self.assertEqual(walk_lines(["1000  x: cop0 $t0"]).unmodelled, [0x1000])

    def test_loop_cap_is_a_named_constant(self) -> None:
        self.assertEqual(LOOP_CAP, 8)


class DecodeFunctionTests(unittest.TestCase):
    def test_real_function_globals_and_hardware(self) -> None:
        got = decode_function(SNAPSHOT)["proven"]
        self.assertEqual(sorted(r["address"] for r in got["globals"]),
                         [0x8007F99C, 0x8007F9A0])
        self.assertEqual(got["hardware"][0]["address"], 0x1F801120)

    def test_real_function_has_full_coverage(self) -> None:
        coverage = decode_function(SNAPSHOT)["coverage"]
        self.assertEqual(coverage["unmodelled"], [])
        self.assertEqual(coverage["unreached"], [])
        self.assertEqual(coverage["modelled"], coverage["total"])

    def test_argument_roles_are_reported(self) -> None:
        got = decode_function(SNAPSHOT)["proven"]
        self.assertIn("a0", got["arguments"])
        self.assertNotIn("a1", got["arguments"])

    def test_direct_call_records_target_and_arguments(self) -> None:
        got = decode_function(["1000  x: li $a0, 0x3",
                               "1004  x: jal F0x8001ac14",
                               "1008  x: nop",
                               "100c  x: jr $ra",
                               "1010  x: nop"])["proven"]
        self.assertEqual(got["calls"][0]["target"], "0x8001AC14")
        self.assertEqual(got["calls"][0]["arguments"]["a0"], "const(0x3)")

    def test_named_call_target_is_not_unresolved(self) -> None:
        got = decode_function(["1000  x: jal EnterCriticalSection",
                               "1004  x: nop",
                               "1008  x: jr $ra",
                               "100c  x: nop"])["proven"]
        self.assertEqual(got["calls"][0]["target"], "EnterCriticalSection")

    def test_indirect_call_records_the_unresolved_base(self) -> None:
        got = decode_function(["1000  x: lw $v0, 0x3c($a0)",
                               "1004  x: jalr $v0",
                               "1008  x: nop"])["proven"]
        self.assertEqual(got["calls"][0]["target"], "indirect")
        self.assertEqual(got["calls"][0]["through"], "load(a0+0x3C, word)")

    def test_a_method_call_on_a_freshly_built_object_names_its_builder(self) -> None:
        """The object a constructor hands back stays traceable to the call.

        This is the whole point of tracking $v0 across a call: the receiver of
        the method call below is the thing `F0x8001AE38` just built, and the
        record has to say so or the call site cannot be typed.
        """
        got = decode_function(["1000  x: jal F0x8001ae38",
                               "1004  x: nop",
                               "1008  x: lw $v1, 0x114($v0)",
                               "100c  x: jalr $v1",
                               "1010  x: nop"])["proven"]
        self.assertEqual(got["calls"][1]["through"],
                         "load(returned(0x8001AE38)+0x114, word)")

    def test_an_indirect_call_leaves_v0_unnamed(self) -> None:
        """A `jalr` names no target, so its result may not claim one."""
        got = decode_function(["1000  x: lw $v0, 0x10($a0)",
                               "1004  x: jalr $v0",
                               "1008  x: nop",
                               "100c  x: lw $v1, 0x20($v0)",
                               "1010  x: jalr $v1",
                               "1014  x: nop"])["proven"]
        self.assertEqual(got["calls"][1]["through"], "load(other+0x20, word)")

    def test_a_typed_slot_call_names_what_it_reaches(self) -> None:
        """The second pass. Receiver typing worked out which function this
        slot holds, so the object it hands back is traceable -- but through a
        DIFFERENT word than a `jal`, because the instruction never said it."""
        got = decode_function(["1000  x: lw $v0, 0x10($a0)",
                               "1004  x: jalr $v0",
                               "1008  x: nop",
                               "100c  x: lw $v1, 0x20($v0)",
                               "1010  x: jalr $v1",
                               "1014  x: nop"],
                              reached_targets={0x1004: 0x8001AE38})["proven"]
        self.assertEqual(got["calls"][1]["through"],
                         "load(reached(0x8001AE38)+0x20, word)")

    def test_an_untyped_slot_call_still_leaves_v0_unnamed(self) -> None:
        """Only the sites the typing named are fed back; the rest stay dark."""
        got = decode_function(["1000  x: lw $v0, 0x10($a0)",
                               "1004  x: jalr $v0",
                               "1008  x: nop",
                               "100c  x: lw $v1, 0x20($v0)",
                               "1010  x: jalr $v1",
                               "1014  x: nop"],
                              reached_targets={0x9999: 0x8001AE38})["proven"]
        self.assertEqual(got["calls"][1]["through"], "load(other+0x20, word)")

    def test_a_call_still_destroys_the_other_caller_saved_registers(self) -> None:
        got = decode_function(["1000  x: jal F0x8001ae38",
                               "1004  x: nop",
                               "1008  x: lw $v1, 0x10($a1)",
                               "100c  x: jalr $v1",
                               "1010  x: nop"])["proven"]
        self.assertEqual(got["calls"][1]["through"], "load(other+0x10, word)")

    def test_a_pointer_parked_in_a_local_is_traceable_when_it_comes_back(self) -> None:
        """The frame is not an object. What a function stores in its own frame
        and reads back is the same value, and the call has to say so."""
        got = decode_function(["1000  x: addiu $sp, $sp, -0x100",
                               "1004  x: jal F0x8001ae38",
                               "1008  x: nop",
                               "100c  x: sw $v0, 0x9c($sp)",
                               "1010  x: lw $v1, 0x9c($sp)",
                               "1014  x: nop",
                               "1018  x: jalr $v1",
                               "101c  x: nop"])["proven"]
        self.assertEqual(got["calls"][1]["through"], "returned(0x8001AE38)")

    def test_a_local_read_before_it_is_written_is_not_an_object_field(self) -> None:
        got = decode_function(["1000  x: addiu $sp, $sp, -0x100",
                               "1004  x: lw $v0, 0x9c($sp)",
                               "1008  x: nop",
                               "100c  x: jalr $v0",
                               "1010  x: nop"])["proven"]
        # The base names the local the pointer came out of: this frame is
        # 0x100 deep, so slot 0x9C of it is `stack-0x100` plus 0x9C.
        self.assertEqual(got["calls"][0]["through"],
                         "load(stack-0x100+0x9C, word)")

    def test_the_frame_pointer_survives_the_prologue(self) -> None:
        """Before this the prologue threw the stack pointer away, and every
        local after it read as a field of an anonymous object."""
        _, sink = run_memory(["1000  x: addiu $sp, $sp, -0x20",
                              "1004  x: sw $a0, 0x10($sp)"])
        self.assertEqual(sink[0]["object"], "stack-0x20")

    def test_condition_records_test_and_target(self) -> None:
        got = decode_function(["1000  x: beqz $a0, .L0x1010",
                               "1004  x: nop",
                               "1008  x: jr $ra",
                               "100c  x: nop",
                               "1010  x: jr $ra",
                               "1014  x: nop"])["proven"]
        self.assertEqual(got["conditions"][0]["test"], "beqz arg(a0)")
        self.assertEqual(got["conditions"][0]["then"], "continue at 0x1010")

    def test_table_access_reports_base_and_stride(self) -> None:
        got = decode_function(["1000  x: sll $v0, $a0, 0x2",
                               "1004  x: lui $at, %hi(D0x80082cf8)",
                               "1008  x: addu $at, $at, $v0",
                               "100c  x: lw $v1, %lo(D0x80082cf8)($at)",
                               "1010  x: jr $ra",
                               "1014  x: nop"])["proven"]
        self.assertEqual(got["tables"][0]["address"], 0x80082CF8)
        self.assertEqual(got["tables"][0]["stride"], 4)

    def test_return_value_is_reported(self) -> None:
        got = decode_function(SNAPSHOT)["proven"]
        self.assertEqual(got["returns"]["v0"], "load(hardware+0x0, halfword)")

    def test_gte_instruction_counts_as_modelled(self) -> None:
        got = decode_function(["1000  x: ctc2 $t0, $31", "1004  x: jr $ra",
                               "1008  x: nop"])
        self.assertEqual(got["coverage"]["unmodelled"], [])

    def test_trailing_padding_is_not_a_reachability_gap(self) -> None:
        """382 of 924 real functions end in padding. Counting it as a gap made
        correct decodes look broken and hid the 10 with a real interior gap."""
        got = decode_function(["1000  x: jr $ra", "1004  x: nop",
                               "1008  x: nop", "100c  x: nop"])["coverage"]
        self.assertEqual(got["unreached"], [])
        self.assertEqual(got["padding"], [0x1008, 0x100C])

    def test_a_second_function_after_the_return_is_not_a_gap(self) -> None:
        """156 of the 188 reported gaps were this: one extent, several functions."""
        got = decode_function(["1000  x: jr $ra",
                               "1004  x: addiu $sp, 0x30",
                               "1008  x: addiu $sp, -0x20",
                               "100c  x: jr $ra",
                               "1010  x: nop"])["coverage"]
        self.assertEqual(got["next_function"], 0x1008)
        self.assertEqual(got["unreached"], [])
        self.assertEqual(got["total"], 2)

    def test_a_leaf_function_with_no_stack_frame_is_still_found(self) -> None:
        """A third of them allocate nothing, so a prologue test misses them."""
        got = decode_function(["1000  x: jr $ra",
                               "1004  x: nop",
                               "1008  x: sltiu $v0, $a0, 0x3",
                               "100c  x: jr $ra",
                               "1010  x: nop"])["coverage"]
        self.assertEqual(got["next_function"], 0x1008)

    def test_padding_before_the_next_function_stays_padding(self) -> None:
        got = decode_function(["1000  x: jr $ra",
                               "1004  x: nop",
                               "1008  x: nop",
                               "100c  x: addiu $sp, -0x20",
                               "1010  x: jr $ra",
                               "1014  x: nop"])["coverage"]
        self.assertEqual(got["next_function"], 0x100C)
        self.assertEqual(got["padding"], [0x1008])

    def test_a_coprocessor_register_never_enters_the_register_map(self) -> None:
        """Writing $9 made the state disagree in shape with other paths, and the
        branch-join merge raised KeyError. Three functions crashed this way."""
        state = run(["1  x: mfc2 $9, $t3", "2  x: ctc2 $31, $t0"])
        self.assertNotIn("9", state)
        self.assertNotIn("31", state)

    def test_a_branch_join_after_a_coprocessor_write_survives(self) -> None:
        got = decode_function(["1000  x: beqz $a0, .L0x100c",
                               "1004  x: mfc2 $9, $t3",
                               "1008  x: li $v0, 0x1",
                               "100c  x: jr $ra",
                               "1010  x: nop"])
        self.assertEqual(got["coverage"]["unreached"], [])

    def test_a_coprocessor_zero_word_is_consumed_not_unknown(self) -> None:
        """The disassembler emits raw words for COP0. `mfc0 $v0, $12` reads the
        CPU status register a critical section masks interrupts with; the
        analyzer tracks none of that, so it is consumed, not unknown."""
        got = decode_function(["1000  x: .word 0x40026000",   # mfc0 $v0, $12
                               "1004  x: .word 0x40826000",   # mtc0 $v0, $12
                               "1008  x: jr $ra",
                               "100c  x: nop"])["coverage"]
        self.assertEqual(got["unmodelled"], [])

    def test_a_data_word_that_is_not_coprocessor_stays_unknown(self) -> None:
        got = decode_function(["1000  x: .word 0x735f4443",
                               "1004  x: jr $ra",
                               "1008  x: nop"])["coverage"]
        self.assertEqual(got["unmodelled"], [0x1000])

    def test_unreached_data_words_are_data_not_a_reachability_gap(self) -> None:
        """225 words of table data inside one wfightts extent were counted as
        unreachable code, which is three of the last five reported gaps."""
        got = decode_function(["1000  x: jr $ra",
                               "1004  x: addiu $sp, 0x20",
                               "1008  x: .word 0x00f00140",
                               "100c  x: .word 0x01b9017a"])["coverage"]
        self.assertEqual(got["unreached"], [])
        self.assertEqual(got["data"], [0x1008, 0x100C])

    def test_the_next_function_is_found_across_a_data_blob(self) -> None:
        """Data between a return and the next function hid a whole routine."""
        got = decode_function(["1000  x: jr $ra",
                               "1004  x: nop",
                               "1008  x: .word 0x7350",
                               "100c  x: .word 0x470000",
                               "1010  x: sw $ra, ($a0)",
                               "1014  x: jr $ra",
                               "1018  x: nop"])["coverage"]
        self.assertEqual(got["next_function"], 0x1010)
        self.assertEqual(got["data"], [0x1008, 0x100C])

    def test_a_computed_jump_follows_the_addresses_the_data_holds(self) -> None:
        """A jr $reg goes to one table entry; which one is a runtime value, so
        every entry inside the function is walked and none is claimed."""
        lines = ["1000  x: jr $v0", "1004  x: nop",
                 "1008  x: li $v0, 0x1", "100c  x: jr $ra", "1010  x: nop"]
        self.assertEqual(decode_function(lines)["coverage"]["unreached"],
                         [0x1008, 0x100C])
        got = decode_function(lines, frozenset({0x1008}))["coverage"]
        self.assertEqual(got["unreached"], [])

    def test_a_branch_written_as_a_symbol_resolves(self) -> None:
        """8 functions branch with `beqz $v0, F0x...` instead of a local label."""
        got = decode_function(["1000  x: beqz $v0, F0x00001008",
                               "1004  x: nop",
                               "1008  x: jr $ra",
                               "100c  x: nop"])["coverage"]
        self.assertEqual(got["unreached"], [])

    def test_register_dispatch_leaves_a_real_interior_gap(self) -> None:
        got = decode_function(["1000  x: jr $v0",
                               "1004  x: nop",
                               "1008  x: li $v0, 0x1",
                               "100c  x: jr $ra",
                               "1010  x: nop"])["coverage"]
        self.assertEqual(got["unreached"], [0x1008, 0x100C])

    def test_genuinely_unhandled_instruction_lowers_coverage(self) -> None:
        got = decode_function(["1000  x: cop0 $t0", "1004  x: jr $ra",
                               "1008  x: nop"])
        self.assertEqual(got["coverage"]["unmodelled"], [0x1000])
        self.assertEqual(got["coverage"]["modelled"], 2)


if __name__ == "__main__":
    unittest.main()
