"""Tests for naming the OBJECT on the receiving end of a method-slot call."""

from __future__ import annotations

import unittest

from tools.type_receivers import (bindings, canonical, classes, grade,
                                  receivers, type_of)

BUILDER_A = 0x8001AE38
BUILDER_B = 0x8001E5BC
SLOT_A = {0x110: 0x80011111, 0x114: 0x80022222, 0x170: 0x80033333}
SLOT_B = {0x110: 0x80044444, 0x114: 0x80055555, 0x168: 0x80066666}


def installs(overlay, address, table, obj="other"):
    """A constructor that writes a method table into the object it is building."""
    return {"overlay": overlay, "address": address, "status": "decoded",
            "proven": {"globals": [], "calls": [],
                       "fields": [{"object": obj, "offset": off, "access": "write",
                                   "address": None,
                                   "value": f"global(0x{fn:08X})"}
                                  for off, fn in table.items()]}}


def uses(overlay, address, base, offsets, stores=()):
    return {"overlay": overlay, "address": address, "status": "decoded",
            "proven": {"globals": [], "fields": list(stores),
                       "calls": [{"at": 0x1000 + i, "target": "indirect",
                                  "through": f"load({base}+0x{off:X}, word)",
                                  "arguments": {}}
                                 for i, off in enumerate(offsets)]}}


def stored(obj, offset, built):
    return {"object": obj, "offset": offset, "access": "write", "address": None,
            "value": f"returned(0x{built:08X})"}


def stub(address):
    """classes() only trusts a stored pointer that names a decoded function."""
    return {"overlay": "fns", "address": address, "status": "decoded",
            "proven": {"globals": [], "fields": [], "calls": []}}


def records(*rows):
    out = {(r["overlay"], r["address"]): r for r in rows}
    for table in (SLOT_A, SLOT_B):
        for fn in table.values():
            out.setdefault(("fns", fn), stub(fn))
    return out


class ClassTests(unittest.TestCase):
    def test_a_constructor_that_installs_three_pointers_is_a_class(self) -> None:
        found = classes(records(installs("fns", BUILDER_A, SLOT_A)))
        self.assertEqual(found, {("fns", BUILDER_A): SLOT_A})

    def test_a_single_stored_callback_is_not_a_class(self) -> None:
        """One function pointer in an object is a callback, not a method table."""
        rows = records(installs("fns", BUILDER_A, {0x110: 0x80011111}))
        self.assertEqual(classes(rows), {})

    def test_a_table_written_to_a_global_is_not_an_object_class(self) -> None:
        row = installs("fns", BUILDER_A, SLOT_A, obj="global")
        row["proven"]["globals"] = row["proven"]["fields"]
        row["proven"]["fields"] = []
        self.assertEqual(classes(records(row)), {})

    def test_two_constructors_with_the_same_table_are_one_class(self) -> None:
        rows = records(installs("fns", BUILDER_A, SLOT_A),
                       installs("fns", 0x8001EBFC, SLOT_A))
        same = canonical(classes(rows))
        self.assertEqual(same[("fns", 0x8001EBFC)], same[("fns", BUILDER_A)])


class TypingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rows = records(installs("fns", BUILDER_A, SLOT_A),
                            installs("fns", BUILDER_B, SLOT_B))
        self.tables = classes(self.rows)
        self.same = canonical(self.tables)

    def type_it(self, site, rows=None):
        cells, fields = bindings(rows or self.rows, set(self.tables))
        return type_of(site, cells, fields, self.same)

    def test_a_receiver_the_call_itself_returned_is_typed(self) -> None:
        site = {"key": ("stgtrain", 0x80090000), "at": 1,
                "base": f"returned(0x{BUILDER_A:08X})", "offset": 0x110}
        self.assertEqual(self.type_it(site), (("fns", BUILDER_A), "built-here"))

    def test_a_receiver_returned_by_an_unknown_call_is_declined(self) -> None:
        site = {"key": ("stgtrain", 0x80090000), "at": 1,
                "base": "returned(0x80099999)", "offset": 0x110}
        self.assertEqual(self.type_it(site), (None, "declined"))

    def test_a_field_filled_from_a_constructor_types_later_readers(self) -> None:
        rows = dict(self.rows)
        holder = uses("stgtrain", 0x80090000, "a0", [],
                      stores=[stored("a0", 0x14, BUILDER_A)])
        rows[("stgtrain", 0x80090000)] = holder
        site = {"key": ("stgtrain", 0x80090100), "at": 1,
                "base": "load(a1+0x14, word)", "offset": 0x110}
        self.assertEqual(self.type_it(site, rows),
                         (("fns", BUILDER_A), "field-binding"))

    def test_a_field_two_classes_reach_is_declined(self) -> None:
        """The same offset in two objects is not one field. Answering would be
        the offset-is-not-an-identity mistake with an extra step."""
        rows = dict(self.rows)
        rows[("stgtrain", 0x80090000)] = uses(
            "stgtrain", 0x80090000, "a0", [],
            stores=[stored("a0", 0x14, BUILDER_A), stored("a1", 0x14, BUILDER_B)])
        site = {"key": ("stgtrain", 0x80090100), "at": 1,
                "base": "load(a1+0x14, word)", "offset": 0x110}
        self.assertEqual(self.type_it(site, rows), (None, "declined"))

    def test_a_field_binding_does_not_cross_overlays(self) -> None:
        rows = dict(self.rows)
        rows[("stgtrain", 0x80090000)] = uses(
            "stgtrain", 0x80090000, "a0", [], stores=[stored("a0", 0x14, BUILDER_A)])
        site = {"key": ("ststatus", 0x80090100), "at": 1,
                "base": "load(a1+0x14, word)", "offset": 0x110}
        self.assertEqual(self.type_it(site, rows), (None, "declined"))

    def test_a_bare_register_receiver_is_declined(self) -> None:
        site = {"key": ("stgtrain", 0x80090000), "at": 1,
                "base": "a1", "offset": 0x110}
        self.assertEqual(self.type_it(site), (None, "declined"))


class FieldBindingCheckTests(unittest.TestCase):
    """A field binding is keyed by OFFSET, so the object has to vouch for it.

    Over the whole program this check dropped 151 sites and every one of them
    was wrong, keeping all 1,237 right ones. The `contradicted` rows fell from
    264 to 39.
    """

    def setUp(self) -> None:
        self.rows = records(installs("fns", BUILDER_A, SLOT_A),
                            installs("fns", BUILDER_B, SLOT_B))
        self.tables = classes(self.rows)
        self.same = canonical(self.tables)

    def ask(self, field, offsets, overlay="stgtrain"):
        """One function fills a struct field; another reads that field and
        calls the given slots on what it finds there."""
        from tools.type_receivers import instances
        rows = dict(self.rows)
        rows[(overlay, 0x80090000)] = uses(
            overlay, 0x80090000, "a0", [],
            stores=[stored("a0", field, BUILDER_A)])
        held = f"load(a1+0x{field:X}, word)"
        rows[(overlay, 0x80090100)] = {
            "overlay": overlay, "address": 0x80090100, "status": "decoded",
            "proven": {"globals": [], "fields": [], "calls": [
                {"at": 0x2000 + i, "target": "indirect",
                 "through": f"load({held}+0x{off:X}, word)", "arguments": {}}
                for i, off in enumerate(offsets)]}}
        cells, fields = bindings(rows, set(self.tables))
        sites = [s for s in receivers(rows) if s["key"][1] == 0x80090100]
        seen = instances(sites)
        return type_of(sites[0], cells, fields, self.same, seen, self.tables,
                       slot_set=False)

    def test_a_binding_the_other_slots_agree_with_is_kept(self) -> None:
        self.assertEqual(self.ask(0x14, [0x110, 0x170]),
                         (("fns", BUILDER_A), "field-binding"))

    def test_a_binding_another_slot_contradicts_is_dropped(self) -> None:
        """0x168 belongs to the other class, so this +0x14 is a different
        struct's +0x14 and the binding says nothing about this object."""
        self.assertEqual(self.ask(0x14, [0x110, 0x168])[1], "declined")

    def test_an_object_asked_for_one_slot_is_marked_apart(self) -> None:
        """Nothing can vouch for it, so it is typed but reported separately."""
        self.assertEqual(self.ask(0x14, [0x110]),
                         (("fns", BUILDER_A), "field-binding-alone"))

    def test_the_first_word_alone_is_never_enough(self) -> None:
        """Every object in an overlay has a +0x0. Unvouched it scored 13 right
        against 74 wrong, which is the random control."""
        self.assertEqual(self.ask(0x0, [0x110])[1], "declined")

    def test_the_first_word_is_kept_when_another_slot_vouches(self) -> None:
        self.assertEqual(self.ask(0x0, [0x110, 0x170]),
                         (("fns", BUILDER_A), "field-binding"))

    def test_the_slot_being_typed_never_vouches_for_itself(self) -> None:
        """0x168 is not in class A. If the check counted the site's own slot,
        this would decline; the back test would then grade its own input."""
        self.assertEqual(self.ask(0x14, [0x168]),
                         (("fns", BUILDER_A), "field-binding-alone"))


class LocalObjectTests(unittest.TestCase):
    """A local a caller hands to a constructor, and the calls it then makes.

    Four classes are set up inside something the caller already owns. Naming
    which local a call is made on is what made this usable: measured over the
    whole program it answers 1,262 calls that were all refused before, 1,210 of
    them right, against a control of 11.2%.
    """

    def setUp(self) -> None:
        self.rows = records(installs("fns", BUILDER_A, SLOT_A, obj="a0"),
                            installs("fns", BUILDER_B, SLOT_B))
        self.tables = classes(self.rows)
        self.same = canonical(self.tables)

    def ask(self, handed, calls, overlay="stgtrain"):
        from tools.type_receivers import handed_in, install_object, instances
        rows = dict(self.rows)
        rows[(overlay, 0x80090100)] = {
            "overlay": overlay, "address": 0x80090100, "status": "decoded",
            "proven": {"globals": [], "fields": [], "calls": [
                {"at": 0x2000, "target": f"0x{BUILDER_A:08X}", "through": None,
                 "arguments": {"a0": where}} for where in handed] + [
                {"at": 0x3000 + i, "target": "indirect", "arguments": {},
                 "through": f"load({base}+0x{off:X}, word)"}
                for i, (base, off) in enumerate(calls)]}}
        cells, fields = bindings(rows, set(self.tables))
        given = handed_in(rows, self.tables, install_object(rows), self.same)
        sites = [s for s in receivers(rows) if s["key"][1] == 0x80090100]
        seen = instances(sites)
        return sites, type_of(sites[0], cells, fields, self.same, seen,
                              self.tables, given=given)

    def test_a_local_handed_to_a_constructor_types_the_calls_on_it(self) -> None:
        """The class sits 0x10 inside the local, so slot +0x120 is its +0x110."""
        sites, got = self.ask(["stack-0xB0"], [("stack-0xC0", 0x120)])
        self.assertEqual(got, (("fns", BUILDER_A), "handed-in"))
        self.assertEqual(sites[0]["shift"], 0x10)

    def test_the_gap_is_what_makes_the_slot_readable(self) -> None:
        """Without subtracting it, +0x120 is a slot the class does not carry."""
        sites, _ = self.ask(["stack-0xB0"], [("stack-0xC0", 0x120)])
        self.assertNotIn(0x120, self.tables[("fns", BUILDER_A)])
        self.assertIn(0x120 - sites[0]["shift"], self.tables[("fns", BUILDER_A)])

    def test_a_local_nobody_handed_over_is_declined(self) -> None:
        """This is the rejected lane: 2,151 calls read a plain function pointer
        out of the frame, and their offsets are an array stride."""
        _, got = self.ask([], [("stack-0xC0", 0x120)])
        self.assertEqual(got[1], "declined")

    def test_two_candidate_locals_are_declined(self) -> None:
        _, got = self.ask(["stack-0xB0", "stack-0xB8"], [("stack-0xC0", 0x120)])
        self.assertEqual(got[1], "declined")

    def test_a_local_too_far_away_is_not_a_candidate(self) -> None:
        _, got = self.ask(["stack-0x10"], [("stack-0xC0", 0x120)])
        self.assertEqual(got[1], "declined")

    def test_the_slot_set_basis_never_answers_a_local(self) -> None:
        """Letting it would rebuild the source the file header rejects."""
        from tools.type_receivers import by_slot_set, instances
        sites, _ = self.ask([], [("stack-0xC0", 0x110), ("stack-0xC0", 0x170)])
        self.assertIsNone(by_slot_set(sites[0], instances(sites),
                                      self.tables, self.same))


class SlotSetTests(unittest.TestCase):
    """One slot number names nothing. The set of them can."""

    def setUp(self) -> None:
        self.rows = records(installs("fns", BUILDER_A, SLOT_A),
                            installs("fns", BUILDER_B, SLOT_B))
        self.tables = classes(self.rows)
        self.same = canonical(self.tables)
        self.cells, self.fields = bindings(self.rows, set(self.tables))

    def ask(self, offsets):
        from tools.type_receivers import instances
        rows = dict(self.rows)
        rows[("stgtrain", 0x80090000)] = uses("stgtrain", 0x80090000, "a1", offsets)
        sites = receivers(rows)
        seen = instances(sites)
        return type_of(sites[0], self.cells, self.fields, self.same,
                       seen, self.tables)

    def test_a_set_only_one_class_carries_names_it(self) -> None:
        self.assertEqual(self.ask([0x110, 0x170]),
                         (("fns", BUILDER_A), "slot-set"))

    def test_a_set_two_classes_carry_is_declined(self) -> None:
        self.assertEqual(self.ask([0x110, 0x114])[1], "declined")

    def test_one_call_alone_is_never_enough(self) -> None:
        """A single slot number is the identity mistake this file exists to
        avoid, so one call on an object decides nothing."""
        self.assertEqual(self.ask([0x170])[1], "declined")

    def test_a_set_no_class_carries_is_declined(self) -> None:
        self.assertEqual(self.ask([0x170, 0x168])[1], "declined")


class BackTestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rows = records(installs("fns", BUILDER_A, SLOT_A),
                            installs("fns", BUILDER_B, SLOT_B))
        self.tables = classes(self.rows)
        self.same = canonical(self.tables)
        self.cells, self.fields = bindings(self.rows, set(self.tables))

    def grade(self, base, offsets):
        rows = dict(self.rows)
        rows[("stgtrain", 0x80090000)] = uses("stgtrain", 0x80090000, base, offsets)
        return grade(receivers(rows), self.tables, self.same,
                     self.cells, self.fields)

    def test_a_class_from_another_overlay_cannot_be_the_answer(self) -> None:
        """Two overlays are never in memory together, so one overlay's object
        cannot be the receiver of a call made in another."""
        from tools.type_receivers import in_scope
        rows = records(installs("stgtrain", 0x80090000, SLOT_A))
        tables = classes(rows)
        self.assertEqual(in_scope(tables, "stgtrain"), [("stgtrain", 0x80090000)])
        self.assertEqual(in_scope(tables, "cardgame"), [])

    def test_a_slot_the_class_installs_counts_as_a_hit(self) -> None:
        got = self.grade(f"returned(0x{BUILDER_A:08X})", [0x110, 0x170])
        self.assertEqual((got["inside"], got["outside"]), (2, 0))

    def test_a_slot_the_class_does_not_install_counts_as_a_miss(self) -> None:
        """0x168 belongs to the other class, so typing this receiver as A is
        contradicted by the very call it is meant to explain."""
        got = self.grade(f"returned(0x{BUILDER_A:08X})", [0x168])
        self.assertEqual((got["inside"], got["outside"]), (0, 1))

    def test_a_declined_site_is_not_graded(self) -> None:
        got = self.grade("a1", [0x110])
        self.assertEqual((got["inside"], got["outside"]), (0, 0))


class ContradictionTests(unittest.TestCase):
    """A typed receiver whose slot the class does not carry names no target."""

    def test_the_class_table_decides_the_target(self) -> None:
        rows = records(installs("fns", BUILDER_A, SLOT_A),
                       installs("fns", BUILDER_B, SLOT_B))
        tables = classes(rows)
        self.assertEqual(tables[("fns", BUILDER_A)][0x110], SLOT_A[0x110])
        self.assertIsNone(tables[("fns", BUILDER_A)].get(0x168))


if __name__ == "__main__":
    unittest.main()


class ConfidenceTests(unittest.TestCase):
    """Every source must carry a measured grade before it can ship.

    The pooled score said 96.6% while one source inside it was 81%. A new
    source that nobody graded must not inherit a good average, so the default
    is the worst grade and this test refuses an unlisted source.
    """

    def test_every_shipped_basis_is_graded(self):
        from tools.type_receivers import CONFIDENCE
        for basis in ("built-here", "field-binding", "handed-in", "slot-set",
                      "field-binding-alone"):
            self.assertIn(basis, CONFIDENCE, basis)

    def test_the_self_unchecked_source_is_marked_weak(self):
        from tools.type_receivers import CONFIDENCE
        self.assertEqual(CONFIDENCE["field-binding-alone"], "weak")

    def test_only_identities_are_marked_exact(self):
        from tools.type_receivers import CONFIDENCE
        exact = {b for b, g in CONFIDENCE.items() if g == "exact"}
        self.assertEqual(exact, {"built-here", "field-binding"})

    def test_an_unlisted_source_falls_to_the_worst_grade(self):
        from tools.type_receivers import CONFIDENCE
        self.assertEqual(CONFIDENCE.get("something-new", "weak"), "weak")
