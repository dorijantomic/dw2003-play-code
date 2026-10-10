"""Tests for resolving calls made through a pointer."""

from __future__ import annotations

import unittest

from tools.decode_dispatch import installed, resolve, sites, slot_of

FUNCTIONS = {0x8001ECBC, 0x8001ED6C, 0x80014274}


def store(obj, offset, target, address=None):
    return {"object": obj, "offset": offset, "access": "write",
            "address": address, "value": f"global(0x{target:08X})"}


def caller(overlay, address, through, at=0x1000):
    return {"overlay": overlay, "address": address, "status": "decoded",
            "proven": {"fields": [], "globals": [],
                       "calls": [{"at": at, "target": "indirect",
                                  "through": through, "arguments": {}}]}}


def installer(overlay, address, stores, in_globals=False):
    return {"overlay": overlay, "address": address, "status": "decoded",
            "proven": {"fields": [] if in_globals else stores,
                       "globals": stores if in_globals else [], "calls": []}}


def records(*rows):
    return {(r["overlay"], r["address"]): r for r in rows}


class SlotIdentityTests(unittest.TestCase):
    def test_a_global_slot_is_identified_by_address(self) -> None:
        self.assertEqual(slot_of("global(0x8004B600)", 0x8), ("global", 0x8004B608))

    def test_an_object_slot_is_identified_only_by_offset(self) -> None:
        """The slot's owner is whatever happened to be in the register."""
        self.assertEqual(slot_of("a0", 0x74), ("slot", 0x74))
        self.assertEqual(slot_of("other", 0x74), ("slot", 0x74))


class SecondHopTests(unittest.TestCase):
    """The object holds a pointer to a shared table; the method is in the table.

    Most of this game's tables are built that way -- fns 0x8003086C writes 37
    pointers into one global -- so flattening the first hop left two thirds of
    the pointer calls unmatchable.
    """

    def test_a_nested_base_is_a_table_slot_not_an_object_slot(self) -> None:
        self.assertEqual(slot_of("load(a0+0x0, word)", 0x20), ("table-slot", 0x20))

    def test_the_outer_offset_is_the_one_that_indexes(self) -> None:
        got = sites(records(caller("fns", 0x2000,
                                   "load(load(a0+0x0, word)+0x20, word)")))
        self.assertEqual(got[0]["identity"], ("table-slot", 0x20))
        self.assertEqual(got[0]["base"], "load(a0+0x0, word)")

    def test_a_call_through_a_table_reaches_what_was_stored_in_it(self) -> None:
        rows = records(
            installer("fns", 0x3086C, [store("global", 0x20, 0x8001ECBC,
                                             address=0x80050000)], in_globals=True),
            caller("fns", 0x2000, "load(load(a0+0x0, word)+0x20, word)"))
        got = resolve(rows, FUNCTIONS)[("fns", 0x2000)][0]
        self.assertEqual(got["basis"], "shared-table")
        self.assertTrue(got["resolved"])
        self.assertEqual(got["candidates"], ["0x8001ECBC"])

    def test_an_object_slot_write_is_a_rival_answer_to_a_table_call(self) -> None:
        """A pointer in a struct field can point at an object, not just a table.

        The base tells you where the pointer was KEPT, never what it points at,
        so an object constructor writing the same offset is a rival candidate
        and the site must not resolve. Ruling those out was how +0x80 and +0x84
        came to answer 189 sites with `fns` 0x8003224C and 0x8003227C while
        `fns` 0x8001F648 writes its own functions to both offsets.
        """
        rows = records(
            installer("fns", 0x3086C, [store("global", 0x20, 0x8001ECBC,
                                             address=0x80050000)], in_globals=True),
            installer("fns", 0x1F648, [store("a0", 0x20, 0x8001ED6C)]),
            caller("fns", 0x2000, "load(load(a0+0x0, word)+0x20, word)"))
        got = resolve(rows, FUNCTIONS)[("fns", 0x2000)][0]
        self.assertEqual(got["candidates"], ["0x8001ECBC", "0x8001ED6C"])
        self.assertFalse(got["resolved"])

    def test_a_table_write_is_a_rival_answer_to_an_object_slot_call(self) -> None:
        """The same doubt runs the other way, for a pointer held in a register."""
        rows = records(
            installer("fns", 0x3086C, [store("global", 0x74, 0x8001ECBC,
                                             address=0x80050000)], in_globals=True),
            installer("fns", 0x1F648, [store("a0", 0x74, 0x8001ED6C)]),
            caller("fns", 0x2000, "load(a0+0x74, word)"))
        got = resolve(rows, FUNCTIONS)[("fns", 0x2000)][0]
        self.assertEqual(got["basis"], "slot-only")
        self.assertFalse(got["resolved"])


class SiteTests(unittest.TestCase):
    def test_an_indirect_call_through_a_slot_is_found(self) -> None:
        got = sites(records(caller("fns", 0x2000, "load(a0+0x74, word)")))
        self.assertEqual(got[0]["identity"], ("slot", 0x74))
        self.assertEqual(got[0]["at"], 0x1000)

    def test_a_call_through_an_unknown_value_is_skipped(self) -> None:
        self.assertEqual(sites(records(caller("fns", 0x2000, "unknown"))), [])


class ResolveTests(unittest.TestCase):
    def test_one_installer_gives_a_resolved_target(self) -> None:
        rows = records(
            installer("fns", 0x1F648, [store("a0", 0x74, 0x8001ECBC)]),
            caller("fns", 0x2000, "load(a0+0x74, word)"))
        got = resolve(rows, FUNCTIONS)[("fns", 0x2000)][0]
        self.assertTrue(got["resolved"])
        self.assertEqual(got["candidates"], ["0x8001ECBC"])
        self.assertEqual(got["installers"], ["fns 0x0001F648"])
        self.assertEqual(got["basis"], "slot-only")

    def test_two_installers_disagreeing_stay_unresolved(self) -> None:
        """The slot alone cannot say which kind of object is in the register."""
        rows = records(
            installer("fns", 0x1F648, [store("a0", 0x74, 0x8001ECBC)]),
            installer("fns", 0x1EBF8, [store("a0", 0x74, 0x8001ED6C)]),
            caller("fns", 0x2000, "load(a0+0x74, word)"))
        got = resolve(rows, FUNCTIONS)[("fns", 0x2000)][0]
        self.assertFalse(got["resolved"])
        self.assertEqual(got["candidates"], ["0x8001ECBC", "0x8001ED6C"])

    def test_a_global_slot_matches_only_the_same_address(self) -> None:
        rows = records(
            installer("fns", 0x1000, [store("global", 0x0, 0x8001ECBC,
                                            address=0x8004B600)], in_globals=True),
            installer("fns", 0x1100, [store("global", 0x0, 0x8001ED6C,
                                            address=0x8004B700)], in_globals=True),
            caller("fns", 0x2000, "load(global(0x8004B600)+0x0, word)"))
        got = resolve(rows, FUNCTIONS)[("fns", 0x2000)][0]
        self.assertTrue(got["resolved"])
        self.assertEqual(got["candidates"], ["0x8001ECBC"])
        self.assertEqual(got["basis"], "same-global")

    def test_a_stored_value_that_is_not_a_function_is_ignored(self) -> None:
        """A pointer to data is not a method."""
        rows = records(
            installer("fns", 0x1F648, [store("a0", 0x74, 0x80099999)]),
            caller("fns", 0x2000, "load(a0+0x74, word)"))
        got = resolve(rows, FUNCTIONS)[("fns", 0x2000)][0]
        self.assertEqual(got["candidates"], [])
        self.assertFalse(got["resolved"])


class ShippedDataTests(unittest.TestCase):
    """The resident service table is placed by the linker, not by a store.

    8,026 calls read a handler out of a named global and stores answered ten of
    them, because nothing stores those cells at all: the word is already in the
    image. 823 sites read 0x8004BBD8 alone.
    """

    CELL = {0x8004B608: {"target": 0x8001ECBC, "symbol": "F0x8001ECBC",
                         "declared": "D0x8004b608", "source": "data.rs:1"}}

    def test_a_cell_the_image_holds_answers_the_call(self) -> None:
        rows = records(caller("fns", 0x2000, "load(global(0x8004B600)+0x8, word)"))
        got = resolve(rows, FUNCTIONS, self.CELL)[("fns", 0x2000)][0]
        self.assertTrue(got["resolved"])
        self.assertEqual(got["candidates"], ["0x8001ECBC"])
        self.assertEqual(got["from_image"], ["0x8001ECBC"])
        self.assertEqual(got["installers"], ["shipped data data.rs:1"])

    def test_a_cell_a_store_also_writes_stays_unresolved(self) -> None:
        """`static mut` says what the word holds at load, not for all time."""
        rows = records(
            installer("fns", 0x1000, [store("global", 0x8, 0x8001ED6C,
                                            address=0x8004B600)], in_globals=True),
            caller("fns", 0x2000, "load(global(0x8004B600)+0x8, word)"))
        got = resolve(rows, FUNCTIONS, self.CELL)[("fns", 0x2000)][0]
        self.assertFalse(got["resolved"])
        self.assertEqual(got["candidates"], ["0x8001ECBC", "0x8001ED6C"])
        self.assertEqual(got["from_image"], ["0x8001ECBC"])

    def test_a_cell_does_not_answer_a_call_through_an_object_slot(self) -> None:
        """An absolute address matches an absolute address and nothing else."""
        rows = records(caller("fns", 0x2000, "load(a0+0x8, word)"))
        got = resolve(rows, FUNCTIONS, self.CELL)[("fns", 0x2000)][0]
        self.assertEqual(got["candidates"], [])

    def test_a_site_with_no_cell_carries_no_image_field(self) -> None:
        rows = records(caller("fns", 0x2000, "load(global(0x8004B600)+0x8, word)"))
        got = resolve(rows, FUNCTIONS, {})[("fns", 0x2000)][0]
        self.assertNotIn("from_image", got)


class TableTests(unittest.TestCase):
    def test_three_pointers_into_one_object_count_as_a_table(self) -> None:
        rows = records(installer("fns", 0x1F648, [
            store("a0", 0x70, 0x8001ECBC), store("a0", 0x74, 0x8001ED6C),
            store("a0", 0x78, 0x80014274)]))
        got = installed(rows, FUNCTIONS)
        self.assertTrue(all("table_size" in r for rs in got.values() for r in rs))
        self.assertEqual(got[("slot", 0x74)][0]["table_size"], 3)

    def test_a_lone_stored_callback_is_not_a_table(self) -> None:
        rows = records(installer("fns", 0x1F648, [store("a0", 0x74, 0x8001ECBC)]))
        got = installed(rows, FUNCTIONS)
        self.assertNotIn("table_size", got[("slot", 0x74)][0])


if __name__ == "__main__":
    unittest.main()
