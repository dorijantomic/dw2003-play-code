"""Tests for the suggestion layer.

The four tests the design names by hand are `test_rarity_*`, `test_tie_*`,
`test_contradicted_*` and `test_hops_*`. The rest guard the machinery those
four depend on.
"""

from __future__ import annotations

import pathlib
import unittest
from unittest import mock

from tools.decode_corpus import (Anchor, Body, Claim, MIN_BODY, build_corpus,
                                 call_graph_pass, edit_distance, find_tables,
                                 loosen, measure, normalise, path_of_overlay,
                                 position_pass, shared_data_pass, skeleton_pass,
                                 suggest)

VERIFIED = Claim("TEST-C001", "verified", "The stage clock advances one tick.")
OTHER = Claim("TEST-C002", "verified", "The card is discarded.")


def body(address: int, skeleton, *, overlay="fns", reads=(), writes=(), callees=()):
    skeleton = tuple(skeleton)
    return Body(overlay, address, skeleton, loosen(skeleton), frozenset(callees),
                frozenset(reads), frozenset(writes))


def skeleton(tag: str, length: int = 10):
    return tuple(f"{tag}{i}" for i in range(length))


def filler(count: int, start: int = 0x900000) -> dict:
    """Unrelated bodies, so the rarity denominator is realistic."""
    return {("fns", start + i * 0x100): body(start + i * 0x100,
                                             skeleton(f"filler{i}"))
            for i in range(count)}


class NormaliseTests(unittest.TestCase):
    def test_same_code_at_two_addresses_normalises_alike(self) -> None:
        left = ["8001b0f0  .L0x8001b0f0: jal F0x8001ac14",
                "8001b0f4  .L0x8001b0f4: lw $v0, 0x18($sp)",
                "8001b0f8  .L0x8001b0f8: beq $s1, $v0, .L0x8001b190"]
        right = ["8009a000  .L0x8009a000: jal F0x8009b220",
                 "8009a004  .L0x8009a004: lw $v0, 0x18($sp)",
                 "8009a008  .L0x8009a008: beq $s1, $v0, .L0x8009a0f0"]
        self.assertEqual(normalise(left), normalise(right))

    def test_a_different_field_offset_is_a_different_skeleton(self) -> None:
        """Struct displacements are what the source wrote, so they are kept."""
        self.assertNotEqual(normalise(["1  x: lw $v0, 0x18($sp)"]),
                            normalise(["1  x: lw $v0, 0x1c($sp)"]))

    def test_a_different_register_is_a_different_skeleton(self) -> None:
        self.assertNotEqual(normalise(["1  x: lw $v0, 0x18($sp)"]),
                            normalise(["1  x: lw $v1, 0x18($sp)"]))


class EditDistanceTests(unittest.TestCase):
    def test_identical_bodies_are_distance_zero(self) -> None:
        self.assertEqual(edit_distance(("a", "b"), ("a", "b"), 2), 0)

    def test_one_substitution(self) -> None:
        self.assertEqual(edit_distance(("a", "b", "c"), ("a", "x", "c"), 2), 1)

    def test_over_the_cap_returns_cap_plus_one(self) -> None:
        left, right = tuple("abcdefgh"), tuple("zzzzzzzz")
        self.assertEqual(edit_distance(left, right, 3), 4)

    def test_length_difference_alone_can_exceed_the_cap(self) -> None:
        self.assertEqual(edit_distance(("a",), ("a", "b", "c", "d"), 2), 3)


class CorpusMembershipTests(unittest.TestCase):
    RANGES = {"asm/fns.s": [(0x80001000, 0x80001100, "fns")]}

    def ledger(self, status: str) -> dict:
        return {
            "claims": [{"id": "TEST-C001", "status": status,
                        "statement": "x", "evidence": ["EV-1"]}],
            "evidence": [{"id": "EV-1", "source": "asm/fns.s",
                          "locator": "0x80001040"}],
        }

    def test_contradicted_claims_never_enter_the_corpus(self) -> None:
        """32 claims hold this status today; a refuted claim anchors nothing."""
        self.assertEqual(build_corpus(self.ledger("contradicted"), self.RANGES), {})

    def test_live_claims_do_enter_the_corpus(self) -> None:
        for status in ("verified", "partially_verified", "candidate"):
            corpus = build_corpus(self.ledger(status), self.RANGES)
            self.assertEqual(list(corpus), [("fns", 0x80001000)], status)
            self.assertEqual(corpus[("fns", 0x80001000)].hops, 0)

    def test_an_address_outside_every_function_anchors_nothing(self) -> None:
        ledger = self.ledger("verified")
        ledger["evidence"][0]["locator"] = "0x80009999"
        self.assertEqual(build_corpus(ledger, self.RANGES), {})

    def test_evidence_source_picks_the_overlay(self) -> None:
        """35 queue addresses name a different function in each of two overlays."""
        ranges = {"asm/fns.s": [(0x80001000, 0x80001100, "fns")],
                  "asm/pro/cardgame.s": [(0x80001000, 0x80001100, "cardgame")]}
        corpus = build_corpus(self.ledger("verified"), ranges)
        self.assertEqual(list(corpus), [("fns", 0x80001000)])


class SkeletonPassTests(unittest.TestCase):
    def test_rarity_outranks_a_common_skeleton(self) -> None:
        """A 2-member skeleton must score above an 88-member one, all else equal."""
        rare, common = skeleton("rare"), skeleton("common")
        bodies = filler(200)
        anchors = {}
        bodies[("fns", 0x1000)] = body(0x1000, rare)
        anchors[("fns", 0x1000)] = Anchor((VERIFIED,))
        for i in range(88):
            key = ("fns", 0x20000 + i * 0x100)
            bodies[key] = body(0x20000 + i * 0x100, common)
            anchors[key] = Anchor((VERIFIED,))
        bodies[("fns", 0x3000)] = body(0x3000, rare)     # target of the rare one
        bodies[("fns", 0x4000)] = body(0x4000, common)   # target of the common one
        targets = {k: bodies[k] for k in (("fns", 0x3000), ("fns", 0x4000))}

        found = skeleton_pass(targets, bodies, anchors, measure(bodies, anchors))
        self.assertGreater(found[("fns", 0x3000)]["confidence"],
                           found[("fns", 0x4000)]["confidence"])
        self.assertEqual(found[("fns", 0x3000)]["similarity"], 1.0)

    def test_a_tie_is_left_unresolved_rather_than_picked(self) -> None:
        shared = skeleton("shared")
        bodies = filler(50)
        bodies[("fns", 0x1000)] = body(0x1000, shared)
        bodies[("fns", 0x2000)] = body(0x2000, shared)
        bodies[("fns", 0x3000)] = body(0x3000, shared)
        anchors = {("fns", 0x1000): Anchor((VERIFIED,)),
                   ("fns", 0x2000): Anchor((OTHER,))}
        found = skeleton_pass({("fns", 0x3000): bodies[("fns", 0x3000)]},
                              bodies, anchors, measure(bodies, anchors))
        row = found[("fns", 0x3000)]
        self.assertTrue(row["unresolved"])
        self.assertEqual(row["claims"], ["TEST-C001", "TEST-C002"])
        self.assertIn("tie", row["text"])
        self.assertIn("GUESS:", row["text"])

    def test_one_claim_across_every_twin_is_resolved(self) -> None:
        shared = skeleton("shared")
        bodies = filler(50)
        for address in (0x1000, 0x2000, 0x3000):
            bodies[("fns", address)] = body(address, shared)
        anchors = {("fns", 0x1000): Anchor((VERIFIED,)),
                   ("fns", 0x2000): Anchor((VERIFIED,))}
        row = skeleton_pass({("fns", 0x3000): bodies[("fns", 0x3000)]},
                            bodies, anchors, measure(bodies, anchors))[("fns", 0x3000)]
        self.assertFalse(row["unresolved"])
        self.assertIn("TEST-C001", row["text"])
        self.assertIn("stage clock", row["text"])

    def test_one_twin_carrying_several_claims_is_not_a_tie(self) -> None:
        """Claims describe a function from several angles; that is not disagreement."""
        shared = skeleton("shared")
        bodies = filler(50)
        bodies[("fns", 0x1000)] = body(0x1000, shared)
        bodies[("fns", 0x2000)] = body(0x2000, shared)
        anchors = {("fns", 0x1000): Anchor((VERIFIED, OTHER))}
        row = skeleton_pass({("fns", 0x2000): bodies[("fns", 0x2000)]}, bodies,
                            anchors, measure(bodies, anchors))[("fns", 0x2000)]
        self.assertFalse(row["unresolved"])
        self.assertEqual(row["claims"], ["TEST-C001", "TEST-C002"])
        self.assertIn("It also carries TEST-C002", row["text"])

    def test_twins_that_disagree_are_a_tie_even_at_one_claim_each(self) -> None:
        shared = skeleton("shared")
        bodies = filler(50)
        for address in (0x1000, 0x2000, 0x3000):
            bodies[("fns", address)] = body(address, shared)
        anchors = {("fns", 0x1000): Anchor((VERIFIED,)),
                   ("fns", 0x2000): Anchor((VERIFIED, OTHER))}
        row = skeleton_pass({("fns", 0x3000): bodies[("fns", 0x3000)]}, bodies,
                            anchors, measure(bodies, anchors))[("fns", 0x3000)]
        self.assertTrue(row["unresolved"])

    def test_a_body_shorter_than_the_floor_is_skipped(self) -> None:
        tiny = skeleton("tiny", MIN_BODY - 1)
        bodies = {("fns", 0x1000): body(0x1000, tiny),
                  ("fns", 0x2000): body(0x2000, tiny)}
        anchors = {("fns", 0x1000): Anchor((VERIFIED,))}
        found = skeleton_pass({("fns", 0x2000): bodies[("fns", 0x2000)]}, bodies,
                              anchors, measure(bodies, anchors))
        self.assertEqual(found, {})

    def test_matching_callees_raise_confidence(self) -> None:
        """Masking call targets is the known way two routines look alike."""
        shared = skeleton("shared")
        def score(target_callees, twin_callees):
            bodies = filler(50)
            bodies[("fns", 0x1000)] = body(0x1000, shared, callees=twin_callees)
            bodies[("fns", 0x2000)] = body(0x2000, shared, callees=target_callees)
            anchors = {("fns", 0x1000): Anchor((VERIFIED,))}
            return skeleton_pass({("fns", 0x2000): bodies[("fns", 0x2000)]}, bodies,
                                 anchors, measure(bodies, anchors))[("fns", 0x2000)]
        same = score((("fns", 0x1234),), (("fns", 0x1234),))
        different = score((("fns", 0x1234),), (("fns", 0xFFFF),))
        self.assertGreater(same["confidence"], different["confidence"])
        self.assertTrue(same["callees_match"])
        self.assertFalse(different["callees_match"])


class LooseGradeTests(unittest.TestCase):
    def test_masking_constants_keeps_the_register_number_of_a_gte_operand(self) -> None:
        self.assertEqual(loosen(("mtc2|$t3,$9",)), ("mtc2|$t3,$9",))
        self.assertEqual(loosen(("lw|$v0,0x18($sp)",)), ("lw|$v0,#($sp)",))
        self.assertEqual(loosen(("addiu|$sp,$sp,-32",)), ("addiu|$sp,$sp,#",))

    def test_the_loose_grade_matches_where_the_exact_grade_cannot(self) -> None:
        """Same code, one different struct offset."""
        left = body(0x1000, [f"lw|$v0,{i:#x}($a0)" for i in range(10)])
        right = body(0x2000, [f"lw|$v0,{i + 1:#x}($a0)" for i in range(10)])
        bodies = {left.key: left, right.key: right, **filler(50)}
        anchors = {left.key: Anchor((VERIFIED,))}
        stats = measure(bodies, anchors)
        self.assertEqual(skeleton_pass({right.key: right}, bodies, anchors,
                                       stats, "exact"), {})
        row = skeleton_pass({right.key: right}, bodies, anchors,
                            stats, "loose")[right.key]
        self.assertEqual(row["source"], "skeleton-twin-loose")
        self.assertEqual(row["grade"], "loose")
        self.assertIn("constants are masked", row["text"])

    def test_a_loose_group_never_outscores_the_strict_group_inside_it(self) -> None:
        """The discount is the rarity count itself, not a hand-tuned penalty."""
        shape = [f"lw|$v0,{i:#x}($a0)" for i in range(10)]
        exact_twin = body(0x1000, shape)
        target = body(0x2000, shape)
        cousins = {("fns", 0x3000 + i * 0x100):
                   body(0x3000 + i * 0x100, [f"lw|$v0,{i + j + 1:#x}($a0)"
                                             for j in range(10)])
                   for i in range(20)}
        bodies = {exact_twin.key: exact_twin, target.key: target,
                  **cousins, **filler(50)}
        anchors = {exact_twin.key: Anchor((VERIFIED,))}
        stats = measure(bodies, anchors)
        strict = skeleton_pass({target.key: target}, bodies, anchors, stats,
                               "exact")[target.key]
        loose = skeleton_pass({target.key: target}, bodies, anchors, stats,
                              "loose")[target.key]
        self.assertGreater(strict["confidence"], loose["confidence"])


class SharedDataPassTests(unittest.TestCase):
    def test_names_both_sides_and_the_direction(self) -> None:
        bodies = filler(50)
        bodies[("fns", 0x1000)] = body(0x1000, skeleton("a"), reads=(0x80048750,))
        bodies[("fns", 0x2000)] = body(0x2000, skeleton("b"), writes=(0x80048750,))
        anchors = {("fns", 0x1000): Anchor((VERIFIED,))}
        row = shared_data_pass({("fns", 0x2000): bodies[("fns", 0x2000)]}, bodies,
                               anchors, measure(bodies, anchors))[("fns", 0x2000)]
        self.assertEqual(row["direction"], "reads")
        self.assertEqual(row["shared"], ["0x80048750"])
        self.assertIn("0x00001000", row["text"])

    def test_a_widely_touched_global_scores_below_a_rare_one(self) -> None:
        bodies = filler(50)
        bodies[("fns", 0x1000)] = body(0x1000, skeleton("a"), reads=(0x80048750,))
        bodies[("fns", 0x2000)] = body(0x2000, skeleton("b"), reads=(0x80049999,))
        for index, key in enumerate(list(filler(30, 0x800000))):
            bodies[key] = body(key[1], skeleton(f"c{index}"), reads=(0x80049999,))
        target_rare = body(0x3000, skeleton("d"), writes=(0x80048750,))
        target_common = body(0x4000, skeleton("e"), writes=(0x80049999,))
        bodies[("fns", 0x3000)] = target_rare
        bodies[("fns", 0x4000)] = target_common
        anchors = {("fns", 0x1000): Anchor((VERIFIED,)),
                   ("fns", 0x2000): Anchor((VERIFIED,))}
        found = shared_data_pass({("fns", 0x3000): target_rare,
                                  ("fns", 0x4000): target_common},
                                 bodies, anchors, measure(bodies, anchors))
        self.assertGreater(found[("fns", 0x3000)]["confidence"],
                           found[("fns", 0x4000)]["confidence"])

    def test_no_shared_global_yields_no_suggestion(self) -> None:
        bodies = {("fns", 0x1000): body(0x1000, skeleton("a"), reads=(0x1,)),
                  ("fns", 0x2000): body(0x2000, skeleton("b"), writes=(0x2,))}
        self.assertEqual(
            shared_data_pass({("fns", 0x2000): bodies[("fns", 0x2000)]}, bodies,
                             {("fns", 0x1000): Anchor((VERIFIED,))},
                             measure(bodies, {})), {})

    def test_an_unresolved_global_is_not_a_shared_global(self) -> None:
        """Two functions the analyzer failed on have nothing in common.

        An unresolved global reaches the record with no address. Carrying the
        None into the read/write sets made every such pair look like it shared
        one, and the pass then crashed formatting it -- which was the lucky
        part, because otherwise it scored as a match.
        """
        bodies = {("fns", 0x1000): body(0x1000, skeleton("a"), reads=(None,)),
                  ("fns", 0x2000): body(0x2000, skeleton("b"), writes=(None,))}
        self.assertEqual(
            shared_data_pass({("fns", 0x2000): bodies[("fns", 0x2000)]}, bodies,
                             {("fns", 0x1000): Anchor((VERIFIED,))},
                             measure(bodies, {})), {})


class CallGraphPassTests(unittest.TestCase):
    """The weakest pass, and the only one that reaches an unlike, isolated body.

    Measured over the 588 functions the other four left untouched: 179 are called
    by an anchored function, 45 call one, 165 share a callee with one.
    """

    def run_pass(self, bodies, anchors, target):
        return call_graph_pass({target: bodies[target]}, bodies, anchors,
                               measure(bodies, anchors)).get(target)

    def test_being_called_by_an_anchored_function_is_a_link(self) -> None:
        bodies = filler(50)
        bodies[("fns", 0x2000)] = body(0x2000, skeleton("b"))
        bodies[("fns", 0x1000)] = body(0x1000, skeleton("a"),
                                       callees=[("fns", 0x2000)])
        row = self.run_pass(bodies, {("fns", 0x1000): Anchor((VERIFIED,))},
                            ("fns", 0x2000))
        self.assertEqual(row["link"], "called-by")
        self.assertIn("called by fns 0x00001000", row["text"])
        self.assertIn("where this belongs, not what it does", row["text"])

    def test_calling_an_anchored_function_is_a_link(self) -> None:
        bodies = filler(50)
        bodies[("fns", 0x1000)] = body(0x1000, skeleton("a"))
        bodies[("fns", 0x2000)] = body(0x2000, skeleton("b"),
                                       callees=[("fns", 0x1000)])
        row = self.run_pass(bodies, {("fns", 0x1000): Anchor((VERIFIED,))},
                            ("fns", 0x2000))
        self.assertEqual(row["link"], "calls")

    def test_a_shared_callee_names_the_sibling_and_counts_it(self) -> None:
        bodies = filler(50)
        helper = ("fns", 0x9000)
        bodies[helper] = body(0x9000, skeleton("helper"))
        bodies[("fns", 0x1000)] = body(0x1000, skeleton("a"), callees=[helper])
        bodies[("fns", 0x2000)] = body(0x2000, skeleton("b"), callees=[helper])
        row = self.run_pass(bodies, {("fns", 0x1000): Anchor((VERIFIED,))},
                            ("fns", 0x2000))
        self.assertEqual(row["link"], "shared-callee")
        self.assertEqual(row["shared_callees"], 1)
        self.assertIn("calls the same routine as fns 0x00001000", row["text"])

    def test_sharing_a_heavily_used_utility_scores_below_a_rare_helper(self) -> None:
        """Everything calls the memory clear; that identifies nobody."""
        rare, utility = ("fns", 0x9000), ("fns", 0x9100)
        bodies = filler(50)
        bodies[rare] = body(0x9000, skeleton("rare_helper"))
        bodies[utility] = body(0x9100, skeleton("utility"))
        for index in range(40):          # the utility is called by everything
            key = ("fns", 0x700000 + index * 0x100)
            bodies[key] = body(0x700000 + index * 0x100, skeleton(f"user{index}"),
                               callees=[utility])
        bodies[("fns", 0x1000)] = body(0x1000, skeleton("a"), callees=[rare])
        bodies[("fns", 0x1100)] = body(0x1100, skeleton("c"), callees=[utility])
        bodies[("fns", 0x2000)] = body(0x2000, skeleton("b"), callees=[rare])
        bodies[("fns", 0x2100)] = body(0x2100, skeleton("d"), callees=[utility])
        anchors = {("fns", 0x1000): Anchor((VERIFIED,)),
                   ("fns", 0x1100): Anchor((VERIFIED,))}
        stats = measure(bodies, anchors)
        found = call_graph_pass({("fns", 0x2000): bodies[("fns", 0x2000)],
                                 ("fns", 0x2100): bodies[("fns", 0x2100)]},
                                bodies, anchors, stats)
        self.assertGreater(found[("fns", 0x2000)]["confidence"],
                           found[("fns", 0x2100)]["confidence"])

    def test_no_call_edge_to_anchored_work_yields_nothing(self) -> None:
        bodies = filler(50)
        bodies[("fns", 0x1000)] = body(0x1000, skeleton("a"))
        bodies[("fns", 0x2000)] = body(0x2000, skeleton("b"))
        self.assertIsNone(self.run_pass(bodies, {("fns", 0x1000): Anchor((VERIFIED,))},
                                        ("fns", 0x2000)))

    def test_callers_that_disagree_are_still_a_tie(self) -> None:
        bodies = filler(50)
        bodies[("fns", 0x3000)] = body(0x3000, skeleton("c"))
        bodies[("fns", 0x1000)] = body(0x1000, skeleton("a"),
                                       callees=[("fns", 0x3000)])
        bodies[("fns", 0x2000)] = body(0x2000, skeleton("b"),
                                       callees=[("fns", 0x3000)])
        row = self.run_pass(bodies, {("fns", 0x1000): Anchor((VERIFIED,)),
                                     ("fns", 0x2000): Anchor((OTHER,))},
                            ("fns", 0x3000))
        self.assertTrue(row["unresolved"])
        self.assertNotIn("where this belongs", row["text"])


class PositionPassTests(unittest.TestCase):
    def test_position_is_stated_as_proven_and_the_role_as_a_guess(self) -> None:
        bodies = {("fns", 0x1000): body(0x1000, skeleton("a")),
                  ("fns", 0x2000): body(0x2000, skeleton("b"))}
        anchors = {("fns", 0x1000): Anchor((VERIFIED,))}
        row = position_pass({("fns", 0x2000): bodies[("fns", 0x2000)]}, bodies,
                            anchors, {("fns", 0x80082CF8): [("fns", 0x1000),
                                                            ("fns", 0x2000)]},
                            measure(bodies, anchors))[("fns", 0x2000)]
        self.assertEqual(row["index"], 1)
        self.assertEqual(row["entries"], 2)
        self.assertIsNone(row["similarity"])
        self.assertIn("proven from the table data", row["text"])
        self.assertIn("GUESS:", row["text"])

    def test_a_table_with_no_decoded_sibling_states_only_the_position(self) -> None:
        bodies = {("fns", 0x2000): body(0x2000, skeleton("b"))}
        row = position_pass(bodies, bodies, {},
                            {("fns", 0x80082CF8): [("fns", 0x1000),
                                                   ("fns", 0x2000)]},
                            measure(bodies, {}))[("fns", 0x2000)]
        self.assertEqual(row["confidence"], 0.0)
        self.assertNotIn("GUESS:", row["text"])
        self.assertIn("No other entry carries a claim", row["text"])


class TableReadingTests(unittest.TestCase):
    SOURCES = {"asm/pro/cardgame.s": {
        0x80082CF8: ".word 0x800843a0",
        0x80082CFC: ".word 0x800844b0",
        0x80082D00: ".word 0x80011000",      # a function in the resident overlay
        0x80082D04: ".word 0x00000063",      # not a function: the run ends here
        0x80082D08: "addiu $sp, $sp, -0x20",
    }}
    STARTS = {("cardgame", 0x800843A0), ("cardgame", 0x800844B0),
              ("fns", 0x80011000)}

    def test_a_run_of_pointers_to_functions_is_a_table(self) -> None:
        tables = find_tables(self.SOURCES, {"asm/pro/cardgame.s": "cardgame"},
                             self.STARTS)
        self.assertEqual(tables, {("cardgame", 0x80082CF8): [
            ("cardgame", 0x800843A0), ("cardgame", 0x800844B0),
            ("fns", 0x80011000)]})

    def test_a_run_shorter_than_the_floor_is_not_a_table(self) -> None:
        """Two adjacent pointers are a coincidence, not a dispatch table."""
        sources = {"asm/pro/cardgame.s": dict(list(self.SOURCES[
            "asm/pro/cardgame.s"].items())[:2])}
        self.assertEqual(find_tables(sources, {"asm/pro/cardgame.s": "cardgame"},
                                     self.STARTS), {})

    def test_a_word_that_is_not_a_function_address_is_not_an_entry(self) -> None:
        tables = find_tables(self.SOURCES, {"asm/pro/cardgame.s": "cardgame"},
                             self.STARTS)
        self.assertNotIn(0x63, [address for entries in tables.values()
                                for _, address in entries])


class PropagationTests(unittest.TestCase):
    def test_hops_increment_and_no_derived_anchor_joins_the_corpus(self) -> None:
        """Pass 1 settles B from the ledger; pass 3 reaches C through B.

        C's suggestion is two steps from evidence, so it is marked hops 2 and
        discounted. The corpus itself never grows: rarity weights come from the
        ledger-anchored set alone.
        """
        shared = skeleton("shared", 12)
        bodies = filler(400)
        bodies[("fns", 0x1000)] = body(0x1000, shared)                    # anchored
        bodies[("fns", 0x2000)] = body(0x2000, shared, reads=(0x80048750,))
        bodies[("fns", 0x3000)] = body(0x3000, skeleton("far", 40),
                                       writes=(0x80048750,))
        corpus = {("fns", 0x1000): Anchor((VERIFIED,))}
        found = suggest(bodies, corpus, {("fns", 0x2000), ("fns", 0x3000)}, {})

        first = found[("fns", 0x2000)][0]
        self.assertEqual(first["source"], "skeleton-twin")
        self.assertEqual(first["hops"], 1)
        self.assertFalse(first["unresolved"])

        second = found[("fns", 0x3000)][0]
        self.assertEqual(second["source"], "shared-data")
        self.assertEqual(second["hops"], 2)
        self.assertEqual(second["claims"], ["TEST-C001"])

        self.assertEqual(list(corpus), [("fns", 0x1000)])
        self.assertNotIn("_claims", first)

    def test_an_unresolved_suggestion_never_becomes_an_anchor(self) -> None:
        shared = skeleton("shared", 12)
        bodies = filler(400)
        bodies[("fns", 0x1000)] = body(0x1000, shared)
        bodies[("fns", 0x1500)] = body(0x1500, shared)
        bodies[("fns", 0x2000)] = body(0x2000, shared, reads=(0x80048750,))
        bodies[("fns", 0x3000)] = body(0x3000, skeleton("far", 40),
                                       writes=(0x80048750,))
        corpus = {("fns", 0x1000): Anchor((VERIFIED,)),
                  ("fns", 0x1500): Anchor((OTHER,))}
        found = suggest(bodies, corpus, {("fns", 0x2000), ("fns", 0x3000)}, {})
        self.assertTrue(found[("fns", 0x2000)][0]["unresolved"])
        # 0x2000 was a tie, so it anchors nothing and 0x3000 has no partner.
        self.assertNotIn(("fns", 0x3000), found)


if __name__ == "__main__":
    unittest.main()


class OverlayPathTests(unittest.TestCase):
    """Nine indexed "source files" claim to be fns.s; one is the file.

    The others are ledger evidence `source` fields written as prose or with an
    unexpanded `~`, which the index holds as separate sources. A plain dict
    comprehension keeps whichever came last, and it kept a prose blob -- so
    every discovered function start was filed under a key with no extents, the
    real file's extents were never subdivided, and claims anchored on the
    enclosing extent instead of the function their evidence quotes.
    """

    def fingerprints(self, mapping):
        return {"functions": mapping}

    def test_the_file_that_exists_beats_a_prose_key(self) -> None:
        real = __file__          # any path that is genuinely on disk
        prose = "~/ddw3/asm/x.s (overlay base 0x80082cb0); ~/ddw3/asm/y.s"
        with mock.patch("tools.decode_corpus.fingerprints",
                        return_value=self.fingerprints({
                            real: [{"overlay": "fns", "address": 1, "end": 2}],
                            prose: [{"overlay": "fns", "address": 3, "end": 4}]})):
            path_of_overlay.cache_clear() if hasattr(path_of_overlay, "cache_clear") else None
            self.assertEqual(path_of_overlay()["fns"], real)

    def test_ordering_does_not_decide_it(self) -> None:
        """The phantom came second in the real index; it must lose either way."""
        real = __file__
        prose = "~/ddw3/asm/x.s and ~/ddw3/asm/y.s"
        for mapping in ({prose: [{"overlay": "fns", "address": 3, "end": 4}],
                         real: [{"overlay": "fns", "address": 1, "end": 2}]},
                        {real: [{"overlay": "fns", "address": 1, "end": 2}],
                         prose: [{"overlay": "fns", "address": 3, "end": 4}]}):
            with mock.patch("tools.decode_corpus.fingerprints",
                            return_value=self.fingerprints(mapping)):
                self.assertEqual(path_of_overlay()["fns"], real)

    def test_between_two_real_files_the_fuller_one_wins(self) -> None:
        with mock.patch("tools.decode_corpus.fingerprints",
                        return_value=self.fingerprints({
                            __file__: [{"overlay": "x", "address": 1, "end": 2}],
                            str(pathlib.Path(__file__).parent / "decode_corpus.py"):
                                [{"overlay": "x", "address": 3, "end": 4},
                                 {"overlay": "x", "address": 5, "end": 6}]})):
            self.assertTrue(path_of_overlay()["x"].endswith("decode_corpus.py"))
