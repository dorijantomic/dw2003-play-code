#!/usr/bin/env python3
"""The naming join must never invent a name, and must key by the class's slot."""
from __future__ import annotations

import unittest

from tools.name_slots import SEED, own_slot, settle


class OwnSlotTests(unittest.TestCase):
    """The caller's number and the class's number are not the same number."""

    def test_a_plain_receiver_keeps_its_number(self):
        self.assertEqual(own_slot({"slot": "+0x114"}), "+0x114")

    def test_an_embedded_receiver_is_shifted_back(self):
        row = {"slot": "+0x94", "embedded_at": "+0x10"}
        self.assertEqual(own_slot(row), "+0x84")

    def test_the_two_forms_of_one_job_land_on_one_key(self):
        # This is the whole point: the same job reached two ways must not be
        # counted as two jobs, or each half gets half the evidence.
        plain = own_slot({"slot": "+0x84"})
        embedded = own_slot({"slot": "+0x94", "embedded_at": "+0x10"})
        self.assertEqual(plain, embedded)


class SettleTests(unittest.TestCase):
    """Two names for one job is a disagreement, never a vote."""

    def test_one_name_settles(self):
        settled, disputed = settle({("A", "+0x4"): {"set_text"}})
        self.assertEqual(settled[("A", "+0x4")][0], "set_text")
        self.assertEqual(disputed, {})

    def test_two_names_are_recorded_as_a_disagreement(self):
        settled, disputed = settle({("A", "+0x4"): {"set_text", "hide_text"}})
        self.assertNotIn(("A", "+0x4"), settled)
        self.assertEqual(disputed[("A", "+0x4")], ["hide_text", "set_text"])

    def test_the_majority_does_not_win(self):
        # A count would pick a winner. The harvest carries no evidence that
        # decides between two readings, so picking one would invent it.
        settled, disputed = settle({("A", "+0x4"): {"one", "two", "three"}})
        self.assertNotIn(("A", "+0x4"), settled)

    def test_nothing_found_names_nothing(self):
        settled, disputed = settle({("A", "+0x4"): set()})
        self.assertNotIn(("A", "+0x4"), settled)
        self.assertNotIn(("A", "+0x4"), disputed)

    def test_a_seeded_name_is_not_overridden_by_the_harvest(self):
        pair = next(iter(SEED))
        settled, _ = settle({pair: {"something_else"}})
        self.assertEqual(settled[pair], SEED[pair])


class SeedTests(unittest.TestCase):
    def test_every_seeded_name_carries_its_authority(self):
        for pair, (name, source) in SEED.items():
            self.assertTrue(name and source, pair)

    def test_the_draw_context_pivot_is_seeded_at_its_own_slot(self):
        # +0x94 is the CLASS's slot. Callers that embed the context write
        # +0xA4. Seeding the caller's number would name the wrong job.
        self.assertEqual(SEED[("fns 0x8001F648", "+0x94")][0], "set_pivot")


if __name__ == "__main__":
    unittest.main()
