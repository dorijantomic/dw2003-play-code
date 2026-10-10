"""Invariants for the joined semantic evidence graph.

These lock down the rules that were derived from measurements, not from taste.
The one that matters most: a call edge must never create a topic. That design
was measured at 30.2% against a 51.0% baseline on 2026-08-11 and rejected, and
a future change that quietly reintroduces it should fail here rather than ship.
"""

from __future__ import annotations

import unittest
from dataclasses import dataclass, field
from pathlib import Path

from tools.dw3_semantics import graph
from tools.dw3_semantics.signals import Edge, Signals, _overlay_from_path


# --------------------------------------------------------------------------
# minimal stand-ins: the real Corpus/Family carry far more than these rules use
# --------------------------------------------------------------------------

@dataclass
class FakeFunction:
    id: str
    module: str
    address: int = 0x80010000
    end_address: int | None = None
    curated_subsystem: str | None = None
    direct_calls: list = field(default_factory=list)
    indirect_calls: list = field(default_factory=list)


@dataclass
class FakeCorpus:
    functions: dict
    callers: dict = field(default_factory=dict)
    modules: dict = field(default_factory=dict)


@dataclass
class FakeFamily:
    id: str
    members: list
    can_carry_name: bool = True
    tier: str = "exact"
    statements: int = 12

    @property
    def member_count(self) -> int:
        return len(self.members)


def corpus_of(*functions) -> FakeCorpus:
    by_id = {fn.id: fn for fn in functions}
    return FakeCorpus(
        functions=by_id,
        callers={fid: set() for fid in by_id},
        modules={fn.module: {} for fn in functions},
    )


def ledger_edge(fid, topic, weight=0.75) -> Edge:
    return Edge(function_id=fid, kind="ledger", topic=topic, weight=weight,
                authority=2, source="ledger.json", locator="C1", detail="claim")


class SeedingTests(unittest.TestCase):
    def test_curated_subsystem_seeds_a_topic(self) -> None:
        corpus = corpus_of(FakeFunction("m:F1", "pro/x", curated_subsystem="ui-chrome"))
        topics = graph.seed_topics(corpus, Signals())
        self.assertEqual(topics["m:F1"].topic, "ui-chrome")
        self.assertEqual(topics["m:F1"].basis, "curated")

    def test_unclassified_is_not_a_subsystem(self) -> None:
        corpus = corpus_of(FakeFunction("m:F1", "pro/x", curated_subsystem="unclassified"))
        self.assertEqual(graph.seed_topics(corpus, Signals()), {})

    def test_hidden_ids_are_withheld_from_both_label_sources(self) -> None:
        """The leakage guard: a held-out function must not see its own answer."""
        corpus = corpus_of(FakeFunction("m:F1", "pro/x", curated_subsystem="ui-chrome"))
        signals = Signals(edges=[ledger_edge("m:F1", "card-battle")])
        topics = graph.seed_topics(corpus, signals, hidden={"m:F1"})
        self.assertNotIn("m:F1", topics)

    def test_a_bound_carries_no_topic(self) -> None:
        """Bounds are facts about instructions; they name no system."""
        corpus = corpus_of(FakeFunction("m:F1", "pro/x"))
        signals = Signals(edges=[Edge("m:F1", "bound", None, 0.3, 2, "b.json", "L1", "clamp 99")])
        self.assertEqual(graph.seed_topics(corpus, signals), {})


class CallGraphExclusionTests(unittest.TestCase):
    def test_no_basis_is_derived_from_a_call_edge(self) -> None:
        """Measured at 30.2% vs a 51.0% baseline on 2026-08-11, and rejected.

        A caller of a labelled function must stay unlabelled. If this test ever
        fails, someone has reintroduced call-graph propagation; re-read the
        measurement in tools/infer_module_domains.py before changing it.
        """
        callee = FakeFunction("m:F2", "pro/x", curated_subsystem="card-battle")
        caller = FakeFunction("m:F1", "pro/y",
                              direct_calls=[{"target_id": "m:F2"}])
        corpus = corpus_of(callee, caller)
        corpus.callers = {"m:F2": {"m:F1"}, "m:F1": set()}
        topics, _ = graph.assign(corpus, Signals(), {}, {})
        self.assertIn("m:F2", topics)
        self.assertNotIn("m:F1", topics)
        self.assertNotIn("call_graph", graph.BASIS_SCORE)


class FamilyTransferTests(unittest.TestCase):
    def test_family_carries_a_curated_structural_label(self) -> None:
        a = FakeFunction("m:F1", "pro/x", curated_subsystem="window-fold-ui")
        b = FakeFunction("m:F2", "pro/y")
        corpus = corpus_of(a, b)
        families = {"fam:1": FakeFamily("fam:1", ["m:F1", "m:F2"])}
        topics, _ = graph.assign(corpus, Signals(), families,
                                 {"m:F1": ["fam:1"], "m:F2": ["fam:1"]})
        self.assertEqual(topics["m:F2"].topic, "window-fold-ui")
        self.assertEqual(topics["m:F2"].basis, "family")

    def test_family_never_carries_a_ledger_system(self) -> None:
        """Measured 2026-08-12: family predicts a ledger system at 6.7%.

        Families are shape identity -- the same display-object routine is copied
        into cardgame and fieldstg alike. Shared shape, different game system.
        """
        b = FakeFunction("m:F2", "pro/y")
        corpus = corpus_of(FakeFunction("m:F1", "pro/x"), b)
        signals = Signals(edges=[ledger_edge("m:F1", "card-battle")])
        families = {"fam:1": FakeFamily("fam:1", ["m:F1", "m:F2"])}
        topics, _ = graph.assign(corpus, signals, families,
                                 {"m:F1": ["fam:1"], "m:F2": ["fam:1"]})
        self.assertEqual(topics["m:F1"].topic, "card-battle")
        self.assertNotIn("m:F2", topics)

    def test_a_family_that_cannot_carry_a_name_transfers_nothing(self) -> None:
        a = FakeFunction("m:F1", "pro/x", curated_subsystem="ui-chrome")
        corpus = corpus_of(a, FakeFunction("m:F2", "pro/y"))
        families = {"fam:1": FakeFamily("fam:1", ["m:F1", "m:F2"], can_carry_name=False)}
        topics, _ = graph.assign(corpus, Signals(), families,
                                 {"m:F1": ["fam:1"], "m:F2": ["fam:1"]})
        self.assertNotIn("m:F2", topics)


class ModuleMajorityTests(unittest.TestCase):
    def test_a_pure_module_donates_to_its_unlabelled_peers(self) -> None:
        corpus = corpus_of(
            FakeFunction("m:F1", "pro/ststatus", curated_subsystem="ui-chrome"),
            FakeFunction("m:F2", "pro/ststatus", curated_subsystem="ui-chrome"),
            FakeFunction("m:F3", "pro/ststatus"),
        )
        topics, _ = graph.assign(corpus, Signals(), {}, {})
        self.assertEqual(topics["m:F3"].topic, "ui-chrome")
        self.assertEqual(topics["m:F3"].basis, "module_majority")

    def test_a_mixed_module_donates_nothing(self) -> None:
        """exe/fns is 44.6% pure; inheriting a plurality from it would be wrong."""
        corpus = corpus_of(
            FakeFunction("m:F1", "exe/fns", curated_subsystem="ui-chrome"),
            FakeFunction("m:F2", "exe/fns", curated_subsystem="audio"),
            FakeFunction("m:F3", "exe/fns", curated_subsystem="battle"),
            FakeFunction("m:F4", "exe/fns"),
        )
        topics, _ = graph.assign(corpus, Signals(), {}, {})
        self.assertNotIn("m:F4", topics)

    def test_one_labelled_peer_is_not_a_majority(self) -> None:
        corpus = corpus_of(
            FakeFunction("m:F1", "pro/x", curated_subsystem="ui-chrome"),
            FakeFunction("m:F2", "pro/x"),
        )
        topics, _ = graph.assign(corpus, Signals(), {}, {})
        self.assertNotIn("m:F2", topics)


class ConvergenceTests(unittest.TestCase):
    def test_assignment_converges_and_reports_a_quiet_final_round(self) -> None:
        corpus = corpus_of(
            FakeFunction("m:F1", "pro/x", curated_subsystem="ui-chrome"),
            FakeFunction("m:F2", "pro/x", curated_subsystem="ui-chrome"),
            FakeFunction("m:F3", "pro/x"),
        )
        _, rounds = graph.assign(corpus, Signals(), {}, {})
        self.assertEqual(rounds[-1]["topics_changed"], 0)
        self.assertLess(len(rounds), graph.MAX_ROUNDS)


class OverlayQualificationTests(unittest.TestCase):
    def test_overlay_is_read_off_an_assembly_path(self) -> None:
        self.assertEqual(
            _overlay_from_path("/home/dorij/ddw3/asm/dw2003/pro/wstag927.s"), "wstag927")

    def test_overlay_is_read_off_a_decompilation_directory(self) -> None:
        self.assertEqual(
            _overlay_from_path("exe-decomp/cardgame_c/F0x80097acc.c"), "cardgame")

    def test_an_unqualifiable_path_yields_nothing(self) -> None:
        """No overlay means no attribution: ~294 wstag overlays share a load base."""
        self.assertIsNone(_overlay_from_path("docs/research/notes.md"))


class ResolutionTests(unittest.TestCase):
    def test_an_address_shared_by_two_overlays_never_resolves_unqualified(self) -> None:
        by_pair = {("cardgame", 0x80082CB0): "pro/cardgame:F0x80082cb0",
                   ("fieldstg", 0x80082CB0): "pro/fieldstg:F0x80082cb0"}
        by_address = {0x80082CB0: ["pro/cardgame:F0x80082cb0", "pro/fieldstg:F0x80082cb0"]}
        from tools.dw3_semantics.signals import _resolve
        self.assertIsNone(_resolve(by_pair, by_address, None, 0x80082CB0))
        self.assertEqual(_resolve(by_pair, by_address, "cardgame", 0x80082CB0),
                         "pro/cardgame:F0x80082cb0")

    def test_a_unique_address_resolves_without_an_overlay(self) -> None:
        from tools.dw3_semantics.signals import _resolve
        by_pair = {("fns", 0x80010E88): "exe/fns:F0x80010e88"}
        by_address = {0x80010E88: ["exe/fns:F0x80010e88"]}
        self.assertEqual(_resolve(by_pair, by_address, None, 0x80010E88),
                         "exe/fns:F0x80010e88")


class ValidationHonestyTests(unittest.TestCase):
    def test_verdict_refuses_a_basis_set_that_loses_to_guessing(self) -> None:
        self.assertIn("does NOT beat", graph._verdict(0.30, 0.51))

    def test_verdict_flags_a_margin_too_small_to_rely_on(self) -> None:
        self.assertIn("too close to rely on", graph._verdict(0.55, 0.51))

    def test_verdict_accepts_a_real_margin(self) -> None:
        self.assertIn("beats", graph._verdict(0.93, 0.29))


if __name__ == "__main__":
    unittest.main()


class SharedGlobalTests(unittest.TestCase):
    """A proven global access links functions across overlays; a hub does not."""

    def test_three_labelled_donors_carry_a_topic_to_a_fourth(self) -> None:
        corpus = corpus_of(
            *[FakeFunction(f"m:F{i}", f"pro/{i}", curated_subsystem="fishing")
              for i in range(1, 4)],
            FakeFunction("m:F4", "pro/z"),
        )
        signals = Signals(global_index={0x8004B414: {f"m:F{i}" for i in range(1, 5)}})
        topics, _ = graph.assign(corpus, signals, {}, {})
        self.assertEqual(topics["m:F4"].topic, "fishing")
        self.assertEqual(topics["m:F4"].basis, "shared_global")

    def test_two_agreeing_donors_are_not_enough(self) -> None:
        """Excluded structurally, not empirically: with two donors purity is
        0.5 or 1.0, and PURITY_FLOOR admits only 1.0, so "100% agree" is true by
        construction and carries no information."""
        corpus = corpus_of(
            FakeFunction("m:F1", "pro/a", curated_subsystem="fishing"),
            FakeFunction("m:F2", "pro/b", curated_subsystem="fishing"),
            FakeFunction("m:F3", "pro/c"),
        )
        signals = Signals(global_index={0x8004B414: {"m:F1", "m:F2", "m:F3"}})
        topics, _ = graph.assign(corpus, signals, {}, {})
        self.assertNotIn("m:F3", topics)

    def test_the_donor_floor_is_three(self) -> None:
        """Per-space audit 2026-08-12: 3-4 donors 62%, 5-9 donors 80%, against
        a 28.6% baseline. A floor of 5 was set earlier from a merged-vocabulary
        audit and discarded the 62% bucket. Do not raise it without a per-space
        measurement."""
        self.assertEqual(graph.GLOBAL_DONOR_FLOOR, 3)

    def test_disagreeing_donors_carry_nothing(self) -> None:
        """Enough donors to clear the floor, but they do not agree."""
        corpus = corpus_of(
            *[FakeFunction(f"m:F{i}", f"pro/{i}", curated_subsystem="fishing")
              for i in range(1, 4)],
            *[FakeFunction(f"m:G{i}", f"pro/g{i}", curated_subsystem="audio")
              for i in range(1, 3)],
            FakeFunction("m:F9", "pro/z"),
        )
        members = {f"m:F{i}" for i in range(1, 4)} | {"m:G1", "m:G2", "m:F9"}
        signals = Signals(global_index={0x8004B414: members})
        topics, _ = graph.assign(corpus, signals, {}, {})
        self.assertNotIn("m:F9", topics)

    def test_one_donor_is_not_enough(self) -> None:
        corpus = corpus_of(
            FakeFunction("m:F1", "pro/a", curated_subsystem="fishing"),
            FakeFunction("m:F2", "pro/b"),
        )
        signals = Signals(global_index={0x8004B414: {"m:F1", "m:F2"}})
        topics, _ = graph.assign(corpus, signals, {}, {})
        self.assertNotIn("m:F2", topics)

    def test_a_shared_global_never_outranks_module_majority(self) -> None:
        """Module majority measured 95.6%; shared global measured 57%."""
        self.assertLess(graph.BASIS_SCORE["shared_global"],
                        graph.BASIS_SCORE["module_majority"])


class StringIndexTests(unittest.TestCase):
    """The bank request's following argument is the index into that bank.

    Validated 2026-08-12: all 106 sites where a literal follows resolve inside
    their bank (0 out of range), and the words they select match their screen --
    stgtrain picks 'LV'/'HP'/'TP', stitshop picks 'How many?'/'Buy'.
    """

    def _index(self, line: str):
        from tools.join_strings_to_code import BANK_CALL, _string_index
        match = BANK_CALL.search(line)
        self.assertIsNotNone(match, "the bank-call pattern must match the fixture")
        return _string_index(line, match.end())

    def test_a_literal_after_the_bank_request_is_the_index(self) -> None:
        line = ("temp->unk114(temp, (void *)0x80044B38->unk414("
                "*(s32 *)0x8005CCA8 + 0xF), 0x45);")
        self.assertEqual(self._index(line), 0x45)

    def test_a_decimal_literal_is_read_too(self) -> None:
        line = ("obj->unk114(obj, (void *)0x80044B38->unk404("
                "*(s32 *)0x8005CCA8 + 0x10B), 92);")
        self.assertEqual(self._index(line), 92)

    def test_a_computed_index_yields_nothing(self) -> None:
        """A variable index is not resolvable statically, and that is not a failure."""
        line = ("obj->unk114(obj, (void *)0x80044B38->unk414("
                "*(s32 *)0x8005CCA8 + 0xF), temp_v0);")
        self.assertIsNone(self._index(line))

    def test_an_out_of_range_index_is_reported_not_clamped(self) -> None:
        from tools.join_strings_to_code import resolve_strings
        rows = [{"text_file": "escardgm", "string_index": 900}]
        counts = resolve_strings(rows, {"escardgm": ["a", "b"]})
        self.assertEqual(counts["out_of_range"], 1)
        self.assertIsNone(rows[0]["string"])
        self.assertEqual(rows[0]["string_index_out_of_range"], 2)

    def test_a_resolved_index_attaches_the_games_own_word(self) -> None:
        from tools.join_strings_to_code import resolve_strings
        rows = [{"text_file": "estraini", "string_index": 1}]
        resolve_strings(rows, {"estraini": ["", "LV", "HP"]})
        self.assertEqual(rows[0]["string"], "LV")


class SourcePathParsingTests(unittest.TestCase):
    """Path shapes the ledger actually uses. Each cost claims their anchor."""

    def test_an_inline_annotation_after_the_path_is_ignored(self) -> None:
        self.assertEqual(
            _overlay_from_path(
                "/home/dorij/ddw3/asm/dw2003/pro/fieldstg.s (overlay RAM base 0x80082cb0)"),
            "fieldstg")

    def test_the_per_overlay_rust_data_crate_names_its_overlay(self) -> None:
        self.assertEqual(
            _overlay_from_path("/home/dorij/ddw3/rust/dw2003_pro_fieldstg/src/data.rs"),
            "fieldstg")

    def test_a_decomp_directory_names_the_overlay_without_a_c_suffix(self) -> None:
        self.assertEqual(
            _overlay_from_path("recovered/ddw3/decomp/pro/cardgame/F0x8008d854.c"),
            "cardgame")

    def test_a_bare_pro_directory_is_not_an_overlay_name(self) -> None:
        self.assertIsNone(_overlay_from_path("recovered/ddw3/decomp/pro/F0x8008d854.c"))

    def test_a_shared_exe_data_crate_is_not_overlay_qualified(self) -> None:
        self.assertIsNone(_overlay_from_path("/home/dorij/ddw3/rust/dw2003_exe_data/src/data.rs"))


class ResolutionFallbackTests(unittest.TestCase):
    def test_a_named_overlay_that_lacks_the_address_falls_back_to_uniqueness(self) -> None:
        """Measured 2026-08-12: without this, a stricter path parse LOST anchors.

        A corpus-unique entry address is unambiguous whatever the citing path
        says, so a failed overlay lookup must not discard the citation.
        """
        from tools.dw3_semantics.signals import _resolve
        by_pair = {("fns", 0x80010E88): "exe/fns:F0x80010e88"}
        by_address = {0x80010E88: ["exe/fns:F0x80010e88"]}
        self.assertEqual(
            _resolve(by_pair, by_address, "cardgame", 0x80010E88), "exe/fns:F0x80010e88")

    def test_the_fallback_still_refuses_an_ambiguous_address(self) -> None:
        from tools.dw3_semantics.signals import _resolve
        by_pair = {}
        by_address = {0x80082CB0: ["pro/cardgame:F0x80082cb0", "pro/fieldstg:F0x80082cb0"]}
        self.assertIsNone(_resolve(by_pair, by_address, "wstag415", 0x80082CB0))


class TwoEvidenceStoresTests(unittest.TestCase):
    """Claims cite `ledger.json` rows AND research-index rows. Read both."""

    def test_ids_absent_from_the_ledger_are_looked_up_in_the_index(self) -> None:
        from tools.dw3_semantics import signals as signals_mod
        document = {"claims": [{"evidence": ["EV-known", "EV-elsewhere"]}]}
        known = {"EV-known": {"id": "EV-known"}}
        wanted = {
            eid for claim in document["claims"] for eid in claim["evidence"]
            if eid not in known
        }
        self.assertEqual(wanted, {"EV-elsewhere"},
                         "only the ids the ledger lacks may be looked up elsewhere")
        # With no index on disk the lookup must degrade to empty, never raise.
        original = signals_mod.INDEX_PATH
        try:
            signals_mod.INDEX_PATH = Path("/nonexistent/index.sqlite3")
            self.assertEqual(signals_mod._index_evidence(document, known), {})
        finally:
            signals_mod.INDEX_PATH = original

    def test_a_missing_row_in_one_store_is_not_an_absence(self) -> None:
        """Documents the near-miss: stopping at ledger.json reads as 64 broken
        claims. All 259 ids were in the index, at authority 2."""
        from tools.dw3_semantics.signals import _index_evidence
        self.assertEqual(_index_evidence({"claims": []}, {}), {})


class SemanticLadderTests(unittest.TestCase):
    """"Unnamed" is not one bucket. The ladder keeps the states apart."""

    def _state(self, candidate, topics=(), shaped=(), has_c=()):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "bsg", Path(__file__).resolve().parent.parent / "tools/build_semantic_graph.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.semantic_state("m:F1", candidate, set(topics), set(shaped),
                                     set(has_c))

    def test_a_c_body_on_disk_makes_a_function_readable(self) -> None:
        """The lift artifact, not the candidate file's vocabulary, decides this.
        Asking only for `lift == "decompiled_c_complete"` called 428 functions
        opaque that had a complete body sitting on disk."""
        self.assertEqual(
            self._state({"proposed_name": None, "role": None, "lift": "no_lift"},
                        has_c={"m:F1"}),
            "readable")

    def test_a_name_outranks_everything(self) -> None:
        self.assertEqual(self._state(
            {"proposed_name": "foo", "role": None, "lift": "no_lift"},
            topics=["m:F1"]), "named")

    def test_a_topic_outranks_a_structure(self) -> None:
        self.assertEqual(self._state(
            {"proposed_name": None, "role": "getter", "lift": "decompiled_c_complete"},
            topics=["m:F1"]), "topic")

    def test_a_proven_shape_makes_a_function_structural_not_opaque(self) -> None:
        self.assertEqual(self._state(
            {"proposed_name": None, "role": None, "lift": "no_lift"},
            shaped=["m:F1"]), "structural")

    def test_a_complete_c_body_with_no_structure_is_readable(self) -> None:
        self.assertEqual(self._state(
            {"proposed_name": None, "role": None, "lift": "decompiled_c_complete"}),
            "readable")

    def test_opaque_means_the_repository_holds_nothing_usable(self) -> None:
        self.assertEqual(self._state(
            {"proposed_name": None, "role": None, "lift": "no_lift"}), "opaque")


class AvenueRegisterTests(unittest.TestCase):
    """The register must measure, not assert.

    Its whole value is that a verdict can be re-derived from disk. A hardcoded
    "incapable" is worse than no register at all, because it looks like evidence.
    """

    def test_a_verdict_is_one_of_the_four(self) -> None:
        from tools.dw3_semantics import avenues
        report = avenues.register(set())
        for row in report["avenues"]:
            self.assertIn(row["verdict"],
                          {"exploited", "rejected", "incapable", "untested"})

    def test_every_measured_avenue_reports_its_row_count(self) -> None:
        """A zero reach next to zero rows is a different claim from a zero
        reach next to thirty thousand rows, and must stay distinguishable."""
        from tools.dw3_semantics import avenues
        report = avenues.register(set())
        for row in report["avenues"]:
            self.assertIsInstance(row["rows"], int)
            self.assertGreaterEqual(row["rows"], 0)

    def test_an_empty_residue_leaves_no_open_work(self) -> None:
        from tools.dw3_semantics import avenues
        self.assertEqual(avenues.register(set())["open_work"], [])


class ResidueCharacterizationTests(unittest.TestCase):
    def test_a_jal_target_is_a_real_function(self) -> None:
        from tools.dw3_semantics import avenues
        text = ("F0x80011134:\n"
                ".L0x80011134: nop\n"
                ".L0x80011200: jal F0x80011134\n")
        self.assertIn("F0x80011134", avenues.JAL_RE.findall(text))

    def test_a_pointer_table_word_is_not_a_call(self) -> None:
        from tools.dw3_semantics import avenues
        text = ".L0x80010000: .word F0x80011134\n"
        self.assertEqual(avenues.JAL_RE.findall(text), [])
        self.assertIn("F0x80011134", avenues.WORD_RE.findall(text))

    def test_a_branch_target_is_not_a_call(self) -> None:
        from tools.dw3_semantics import avenues
        text = ".L0x8001110c: beqz $v0, F0x80011134\n"
        self.assertEqual(avenues.JAL_RE.findall(text), [])
        self.assertIn("F0x80011134", avenues.BRANCH_RE.findall(text))

    def test_the_manual_queue_subtracts_data_and_phantom_entries(self) -> None:
        from tools.dw3_semantics import avenues
        report = avenues.characterize(set())
        self.assertEqual(report["manual_queue"], 0)
        self.assertEqual(report["residue"], 0)

    def test_a_data_line_is_told_from_a_code_line_by_directive_order(self) -> None:
        """Code is `instruction # .word`; data is `.word ... # instruction`."""
        from tools.dw3_semantics import avenues
        code = "\n.L0x00000010: addiu $sp, -0x20   # .word 0x27bdffe0\n"
        data = "\n.L0x00000010: .word 0x09080703   # j 0x84201c0c\n"
        byte = "\n.L0x00000010: .byte 0x0\n"
        base = 0x80082cb0
        self.assertFalse(avenues._is_data(code, "F0x80082cc0", base))
        self.assertTrue(avenues._is_data(data, "F0x80082cc0", base))
        self.assertTrue(avenues._is_data(byte, "F0x80082cc0", base))


class EffectiveGlobalAddressTests(unittest.TestCase):
    """A `lui` base is not a global identity.

    The static decoder records the base the compiler materialised plus a signed
    offset. Keying the index by the base alone merged distinct globals that
    happened to share a 64 KiB window and split one global reached from two
    bases. Measured 2026-08-12: `0x8004df98` looked like an 8-function link and
    is touched by 87 -- a hub the fanout rule exists to cut, hidden because the
    other 79 reached it from a different base.
    """

    def _load(self, entries):
        """Two functions touch the same entries: the hub cut drops any global
        fewer than two functions reach, so a one-function fixture indexes
        nothing and would test the cut instead of the addressing."""
        import json, tempfile
        from tools.dw3_semantics import signals as signals_mod

        corpus = corpus_of(
            FakeFunction("exe/fns:F0x80001000", "exe/fns", address=0x80001000),
            FakeFunction("exe/fns:F0x80002000", "exe/fns", address=0x80002000),
        )
        signals = Signals()
        with tempfile.TemporaryDirectory() as tmp:
            for address in (0x80001000, 0x80002000):
                record = {"overlay": "fns", "address": address,
                          "proven": {"globals": entries}}
                Path(tmp, f"fns-{address:08x}.json").write_text(json.dumps(record))
            signals_mod.load_static_decode(corpus, signals, root=Path(tmp))
        return signals

    def test_the_offset_is_added_to_the_base(self) -> None:
        signals = self._load([
            {"address": 0x8004DE00, "offset": 4, "access": "read"},
            {"address": 0x8004DE00, "offset": 12, "access": "read"},
        ])
        self.assertEqual(sorted(signals.global_index), [0x8004DE04, 0x8004DE0C])
        self.assertNotIn(0x8004DE00, signals.global_index)

    def test_a_negative_offset_borrows_out_of_the_lui_window(self) -> None:
        """`0x80090000 + (-11860)` is `0x8008d1ac`, three pages below the base."""
        signals = self._load([{"address": 0x80090000, "offset": -11860,
                               "access": "read"}])
        self.assertEqual(list(signals.global_index), [0x8008D1AC])

    def test_one_global_reached_from_two_bases_is_one_key(self) -> None:
        signals = self._load([
            {"address": 0x8008D1AC, "offset": 0, "access": "read"},
            {"address": 0x80090000, "offset": -11860, "access": "write"},
        ])
        self.assertEqual(list(signals.global_index), [0x8008D1AC])


class ObservationOnlyTopicTests(unittest.TestCase):
    """`text:<bank>` means "requests that bank". Nothing may infer it.

    Measured 2026-08-12: of the 13 rows shared_global produced with a `text:`
    topic, none of the 13 functions appears in string-code-join.json at all.
    """

    def test_a_text_topic_never_propagates_through_a_shared_global(self) -> None:
        corpus = corpus_of(
            *[FakeFunction(f"m:F{i}", f"pro/{i}") for i in range(1, 5)],
        )
        signals = Signals(
            edges=[Edge(f"m:F{i}", "text_bank", "text:esstatus", 0.7, 4,
                        "string-code-join.json", "L1", "requests bank")
                   for i in range(1, 4)],
            global_index={0x8009B5D8: {f"m:F{i}" for i in range(1, 5)}},
        )
        topics, _ = graph.assign(corpus, signals, {}, {})
        self.assertEqual(topics["m:F1"].basis, "text_bank")
        self.assertNotIn("m:F4", topics)

    def test_a_text_topic_never_propagates_through_a_module(self) -> None:
        corpus = corpus_of(*[FakeFunction(f"m:F{i}", "pro/ststatus")
                             for i in range(1, 4)])
        signals = Signals(edges=[
            Edge(f"m:F{i}", "text_bank", "text:esstatus", 0.7, 4,
                 "string-code-join.json", "L1", "requests bank")
            for i in range(1, 3)])
        topics, _ = graph.assign(corpus, signals, {}, {})
        self.assertNotIn("m:F3", topics)

    def test_a_system_topic_still_propagates(self) -> None:
        """The guard must be specific to observation-only topics."""
        self.assertFalse(graph.is_observation_only("ui-chrome"))
        self.assertTrue(graph.is_observation_only("text:esitshop"))


class LedgerClaimStatusTests(unittest.TestCase):
    """The ledger join must not let a decompiler fallback window read as decoded.

    A decompiled-only function is given a 0x400 extent by the index, which can
    contain the next routine's evidence. Counting that as "already decoded" was
    the first version of this join and inflated the worklist's anchored count
    from 44 to 148.
    """

    ADDRS = ["0x80010000", "0x80020000", "0x80030000", "0x80040000"]

    def _status(self, report):
        from unittest import mock
        from tools.build_semantic_graph import ledger_claim_status
        with mock.patch("tools.dw3_research.cli.known_report",
                        return_value=report):
            return ledger_claim_status(self.ADDRS)

    @staticmethod
    def _item(rows, mentions=()):
        return {"rows": rows, "ambiguous": None,
                "mentions": list(mentions), "skipped": []}

    @staticmethod
    def _row(source):
        return {"overlay": None, "function": "F", "exact_start": True,
                "start": 0x80010000, "end": 0x80010040, "verdict": "DECODED",
                "source": source,
                "claims": [{"id": "CLAIM-1", "status": "partially_verified"}],
                "anchors": []}

    def test_precise_assembly_extent_is_decoded(self) -> None:
        report = [(0x80010000, self._item([self._row("x/exe/fns.s")]))]
        status = self._status(report)
        self.assertEqual(status["0x80010000"]["verdict"], "DECODED")
        self.assertTrue(status["0x80010000"]["decoded"])

    def test_decompiled_only_extent_is_a_fallback_not_a_decode(self) -> None:
        report = [(0x80010000, self._item([self._row("exe-decomp/c/F.c")]))]
        status = self._status(report)
        self.assertEqual(status["0x80010000"]["verdict"], "FALLBACK")
        self.assertFalse(status["0x80010000"]["decoded"])

    def test_precise_wins_when_both_sources_cover_the_address(self) -> None:
        report = [(0x80010000, self._item(
            [self._row("exe-decomp/c/F.c"), self._row("x/exe/fns.s")]))]
        self.assertEqual(self._status(report)["0x80010000"]["verdict"], "DECODED")

    def test_an_enclosing_only_anchor_establishes_nothing(self) -> None:
        row = self._row("x/exe/fns.s")
        row["exact_start"] = False
        report = [(0x80010000, self._item([row]))]
        self.assertEqual(self._status(report)["0x80010000"]["verdict"], "ENCLOSING")

    def test_a_mention_without_an_anchor_is_mentioned(self) -> None:
        report = [(0x80010000, self._item([], [("claim", "C", "candidate")]))]
        self.assertEqual(self._status(report)["0x80010000"]["verdict"], "MENTIONED")

    def test_nothing_recorded_is_unknown(self) -> None:
        report = [(0x80010000, self._item([]))]
        self.assertEqual(self._status(report)["0x80010000"]["verdict"], "UNKNOWN")


class InteriorLabelTests(unittest.TestCase):
    """Inventory starts that are labels inside another routine must not read as functions.

    A jump-table case body carries `.section`/`.global` in the original assembly,
    so the recovered inventory lists it as a function; it has no return of its
    own and consumes the owner's registers.
    """

    def test_the_committed_file_lists_the_text_widget_case_bodies(self) -> None:
        from tools.build_semantic_graph import load_interior_labels
        labels = load_interior_labels()
        for address in ("0x8001a344", "0x8001a354", "0x8001a364"):
            self.assertEqual(labels[address]["owner"], "exe/fns:F0x8001a2ac")

    def test_a_missing_file_degrades_to_empty(self) -> None:
        from tools.build_semantic_graph import load_interior_labels
        from pathlib import Path
        self.assertEqual(load_interior_labels(Path("/nonexistent/labels.json")), {})
