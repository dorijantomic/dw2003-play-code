#!/usr/bin/env python3
"""Tests for the semantic inference pipeline."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dw3_semantics import apply as apply_mod, cbody, emitc, families, roles, signatures
from dw3_semantics.corpus import Corpus, Function
from dw3_semantics.propagate import Propagated

GETTER = """
void F0x80010000(void);
s32 F0x80010000(void *arg0) {
    return arg0->unk10;
}
"""
SETTER = """
void F0x80010100(void *arg0, s32 arg1) {
    arg0->unk8 = arg1;
}
"""
WRAPPER = """
void F0x80010200(s32 arg0) {
    F0x80099999(arg0);
}
"""
INCOMPLETE = """
void F0x80010300(void) {
    saved_reg_s1->unk4 = 1;
    saved_reg_s1->unk8 = 2;
    saved_reg_s1->unkC = 3;
    saved_reg_s1->unk10 = 4;
}
"""


def make_function(fid: str, text: str, **kwargs) -> Function:
    module, address = fid.split(":")
    fn = Function(
        id=fid, module=module, address=int(address[3:], 16),
        source=f"~/ddw3/asm/dw2003/{module}.s", source_line=1,
        end_address=None, boundary_status="labeled",
        entry_evidence=kwargs.get("entry_evidence", ("original_label",)),
        decompiled_sources=("test.c",), direct_calls=kwargs.get("direct_calls", []),
        indirect_calls=[], curated_name=kwargs.get("curated_name"),
        curated_subsystem=kwargs.get("curated_subsystem"), curated_family=None,
        recovery={}, body_text=text,
    )
    fn.features = cbody.extract(text)
    return fn


def make_corpus(functions) -> Corpus:
    by_id = {fn.id: fn for fn in functions}
    return Corpus(
        functions=by_id, modules={
            fn.module: {"id": fn.module, "source": fn.source, "source_sha256": "x",
                        "load_base": None, "function_count": 1}
            for fn in functions
        },
        global_function_pointers={}, overlay_function_pointers={}, rejected_entries=[],
        curated={}, curated_families={}, curated_globals={}, summary={},
        callers={fn.id: set() for fn in functions},
    )


class ExtractionTests(unittest.TestCase):
    def test_getter_features(self):
        features = cbody.extract(GETTER)
        self.assertTrue(features.parsed)
        self.assertTrue(features.complete)
        self.assertEqual([("arg0", "void *")], features.params)
        self.assertEqual([0x10], features.offsets_for("arg0"))

    def test_incomplete_body_is_not_complete(self):
        features = cbody.extract(INCOMPLETE)
        self.assertTrue(features.parsed)
        self.assertFalse(features.complete)
        self.assertIn("saved_reg", features.incomplete)

    def test_unparsable_body_reports_error(self):
        features = cbody.extract("this is not m2c output")
        self.assertFalse(features.parsed)
        self.assertIsNotNone(features.parse_error)

    def test_shape_hash_ignores_constants_exact_hash_does_not(self):
        template = "void F0x80010100(void *arg0) {{\n    arg0->unk8 = {0};\n}}\n"
        a = cbody.extract(template.format("1"))
        b = cbody.extract(template.format("1"))
        c = cbody.extract(template.format("0x20"))
        self.assertEqual(a.exact_hash, b.exact_hash)
        # A different literal is a different body ...
        self.assertNotEqual(a.exact_hash, c.exact_hash)
        # ... but the same shape, which is what a parameterized family captures.
        self.assertEqual(a.shape_hash, c.shape_hash)

    def test_shape_hash_still_separates_different_structure(self):
        a = cbody.extract("void F0x80010100(void *arg0) {\n    arg0->unk8 = 1;\n}\n")
        b = cbody.extract("void F0x80010100(void *arg0, s32 arg1) {\n    arg0->unk8 = arg1;\n}\n")
        self.assertNotEqual(a.shape_hash, b.shape_hash)


class RoleTests(unittest.TestCase):
    def classify(self, text, fid="exe/fns:F0x80010000", **kwargs):
        fn = make_function(fid, text, **kwargs)
        corpus = make_corpus([fn])
        return fn, roles.classify(fn, corpus)

    def test_getter(self):
        _, (verdicts, contradictions) = self.classify(GETTER)
        self.assertEqual("getter", verdicts[0].role)
        self.assertTrue(verdicts[0].mechanical)
        self.assertEqual([], contradictions)

    def test_setter(self):
        _, (verdicts, _) = self.classify(SETTER, "exe/fns:F0x80010100")
        self.assertEqual("setter", verdicts[0].role)
        self.assertTrue(verdicts[0].mechanical)

    def test_wrapper(self):
        _, (verdicts, _) = self.classify(WRAPPER, "exe/fns:F0x80010200")
        self.assertEqual("wrapper", verdicts[0].role)

    def test_empty_body_yields_no_role(self):
        _, (verdicts, _) = self.classify("void F0x80010400(void) {\n}\n", "exe/fns:F0x80010400")
        self.assertEqual([], verdicts)


class FamilyTests(unittest.TestCase):
    def test_empty_bodies_are_quarantined_not_clustered(self):
        stub = "void F0x{0:08x}(void) {{\n}}\n"
        corpus = make_corpus([
            make_function(f"pro/a:F0x8008{i:04x}", stub.format(0x80080000 + i))
            for i in range(4)
        ])
        built, quarantine = families.build_families(corpus)
        self.assertEqual({}, built)
        self.assertEqual(4, len(quarantine["trivial_empty_body_requires_triage"]))

    def test_trivial_forwarders_do_not_form_a_name_carrying_family(self):
        corpus = make_corpus([
            make_function(f"pro/m{i}:F0x8008{i:04x}", WRAPPER) for i in range(3)
        ])
        built, quarantine = families.build_families(corpus)
        self.assertEqual({}, built)
        self.assertIn("below_triviality_floor", quarantine)

    def test_exact_family_needs_two_members(self):
        body = """
void F0x{0:08x}(void *arg0) {{
    arg0->unk0 = 1;
    arg0->unk4 = 2;
    arg0->unk8 = 3;
    arg0->unkC = 4;
    arg0->unk10 = 5;
}}
"""
        corpus = make_corpus([
            make_function("pro/a:F0x80080000", body.format(0x80080000)),
            make_function("pro/b:F0x80090000", body.format(0x80090000)),
        ])
        built, _ = families.build_families(corpus)
        self.assertEqual(1, len(built))
        family = next(iter(built.values()))
        self.assertEqual("exact", family.tier)
        self.assertTrue(family.can_carry_name)


class PropagationTests(unittest.TestCase):
    def test_correlated_evidence_does_not_raise_confidence(self):
        hop = Propagated(
            target="pro/a:F0x1", name="x", subsystem=None, confidence=0.5,
            origin="pro/b:F0x2", origin_kind="curated", path=["pro/b:F0x2", "pro/a:F0x1"],
            evidence_classes={"family"},
        )
        hop.corroborate("family", "another homolog", 1.0)
        self.assertEqual(0.5, hop.confidence)

    def test_independent_evidence_recovers_only_part_of_the_decay(self):
        hop = Propagated(
            target="pro/a:F0x1", name="x", subsystem=None, confidence=0.5,
            origin="pro/b:F0x2", origin_kind="curated", path=[], evidence_classes={"family"},
        )
        hop.corroborate("research", "cited in a document", 1.0)
        self.assertGreater(hop.confidence, 0.5)
        self.assertLessEqual(hop.confidence, 1.0)

    def test_confidence_never_exceeds_origin(self):
        hop = Propagated(
            target="pro/a:F0x1", name="x", subsystem=None, confidence=0.6,
            origin="pro/b:F0x2", origin_kind="mechanical", path=[],
            evidence_classes={"family"},
        )
        for evidence_class in ("research", "call_graph", "global_pointer"):
            hop.corroborate(evidence_class, "note", 0.7)
        self.assertLessEqual(hop.confidence, 0.7)


class EmissionTests(unittest.TestCase):
    def candidate(self, **kwargs):
        base = {
            "confidence": 0.9, "confidence_basis": "mechanical_role",
            "role": "getter", "lift": "decompiled_c_complete",
        }
        base.update(kwargs)
        return base

    def test_complete_body_emits_clean_typed_c(self):
        fn = make_function("exe/fns:F0x80010000", GETTER)
        signature = signatures.infer(fn, fn.features, [])
        emission = emitc.emit(self.candidate(), fn, signature, {})
        self.assertEqual("clean_typed_c", emission.grade)
        self.assertTrue(emission.syntax_ok)

    def test_incomplete_body_is_marked_pseudocode(self):
        fn = make_function("exe/fns:F0x80010300", INCOMPLETE)
        signature = signatures.infer(fn, fn.features, [])
        emission = emitc.emit(
            self.candidate(lift="decompiled_c_incomplete"), fn, signature, {})
        self.assertEqual("recovered_pseudocode", emission.grade)
        self.assertIn("RECOVERED PSEUDOCODE", emission.text)

    def test_missing_body_emits_typed_skeleton(self):
        fn = make_function("exe/fns:F0x80010500", "garbage")
        signature = signatures.infer(fn, fn.features, [])
        emission = emitc.emit(self.candidate(lift="no_lift"), fn, signature, {})
        self.assertEqual("typed_skeleton", emission.grade)


class ApplyTests(unittest.TestCase):
    def base_candidate(self, **kwargs):
        candidate = {
            "id": "pro/a:F0x80080000", "proposed_name": "get_unk_0x10_a_80080000",
            "name_basis": "mechanical_role", "signature": "int32_t f(void *self)",
            "summary": "Reads a slot.", "structure_fields": [], "structures": {},
            "mechanically_established": True, "contradictions": [],
            "lift": "decompiled_c_complete", "evidence": ["a", "b"],
            "unknowns": [], "evidence_paths": ["x.c"],
            "provenance": {"path": ["pro/a:F0x80080000"], "hops": 0},
        }
        candidate.update(kwargs)
        return candidate

    def test_heuristic_names_are_not_eligible(self):
        self.assertFalse(apply_mod.eligible(
            self.base_candidate(mechanically_established=False)))

    def test_contradicted_candidates_are_not_eligible(self):
        self.assertFalse(apply_mod.eligible(
            self.base_candidate(contradictions=["incompatible roles"])))

    def test_no_lift_is_not_eligible(self):
        self.assertFalse(apply_mod.eligible(self.base_candidate(lift="no_lift")))

    def test_generated_entry_is_marked_and_never_verified(self):
        entry = apply_mod.build_entry(self.base_candidate())
        self.assertTrue(entry["generated"])
        self.assertIn("rule_version", entry)
        self.assertIn("evidence_paths", entry)
        self.assertNotEqual("verified", entry["recovery"]["verification"])
        self.assertNotEqual("verified", entry["recovery"]["semantics"])

    def test_role_precision_does_not_grant_strongly_inferred(self):
        entry = apply_mod.build_entry(self.base_candidate(name_basis="mechanical_role"))
        self.assertEqual("candidate", entry["recovery"]["semantics"])

    def test_revert_removes_only_generated_entries(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump({
                "schema_version": 1,
                "functions": {
                    "pro/a:F0x1": {"name": "curatedThing", "generated": False},
                    "pro/a:F0x2": {"name": "gen", "generated": True},
                },
            }, handle)
            path = Path(handle.name)
        try:
            outcome = apply_mod.revert(path)
            self.assertEqual(1, outcome["removed"])
            remaining = json.loads(path.read_text())["functions"]
            self.assertIn("pro/a:F0x1", remaining)
            self.assertNotIn("pro/a:F0x2", remaining)
        finally:
            path.unlink(missing_ok=True)


class BoundaryTests(unittest.TestCase):
    """The six documented ground-truth cases for phantom boundary rejection."""

    def test_documented_phantoms_are_rejected_and_stubs_retained(self):
        inventory_path = Path(__file__).resolve().parents[1] / "recovered/ddw3/function-inventory.json"
        if not inventory_path.is_file():
            self.skipTest("inventory not built")
        inventory = json.loads(inventory_path.read_text())
        rejected = {entry["id"] for entry in inventory.get("rejected_entries", [])}
        present = {
            fn["id"] for module in inventory["modules"] for fn in module["functions"]
        }
        # The property under test is that a confirmed false boundary is never
        # treated as a function -- not which stage removes it. These three are
        # jump-table case labels, so `real_entries()` in decompile_exe.py now
        # excludes them upstream and they never reach the fall-through rule that
        # used to list them in `rejected_entries`. Either outcome is correct;
        # being present as a function is not.
        for phantom in ("pro/stplnmet:F0x80085a4c", "pro/stcrddek:F0x800884c4",
                        "pro/stitshop:F0x8008af50"):
            self.assertNotIn(
                phantom, present, f"{phantom} is a confirmed false boundary"
            )
        for stub in ("pro/stgtrain:F0x80088100", "pro/stgtrain:F0x80088108",
                     "pro/stgtrain:F0x80088130"):
            self.assertIn(stub, present, f"{stub} is a confirmed genuine stub")
            self.assertNotIn(stub, rejected)


if __name__ == "__main__":
    unittest.main()
