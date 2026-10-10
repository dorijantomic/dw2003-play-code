#!/usr/bin/env python3
"""Regression tests for the five false-positive classes closed on 2026-08-29.

Each of these produced a FAIL against real ledger prose that was correct.
"""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'ccpc', Path(__file__).with_name('check_claim_prose_citations.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def groups(clause, at=None):
    """Mnemonic groups the clause charges to its reference."""
    spans = [(mm.start(), mm.end()) for mm in m.LREF.finditer(clause)]
    if at is not None:
        spans = [at]
    return {frozenset(g) for g in m.mnemonic_groups(clause, spans)}


class ClauseScope(unittest.TestCase):
    def test_next_clause_mnemonic_is_not_charged(self):
        text = 'sltiu 0x2 + slti 0x64 + li 0x63 L7715-L7721; addiu -0x2 + sltiu 0x4 L7724-L7729'
        first = m.CLAUSE.split(text)[0]
        self.assertNotIn(frozenset({'addiu'}), groups(first))
        self.assertIn(frozenset({'sltiu'}), groups(first))

    def test_mnemonic_before_the_reference_is_read(self):
        self.assertIn(frozenset({'sw'}), groups('sw $zr at L12384, sw $s1 at L12385'))

    def test_distant_mnemonic_describes_the_idiom_not_the_line(self):
        clause = ('35 slots are installed each by a lui/addiu pair followed by a store, '
                  'in cardgame.s: 0xEA4 = 0x8009BE40 (installed at L27053)')
        self.assertEqual(groups(clause), set())


class Negation(unittest.TestCase):
    def test_absence_prose_charges_nothing(self):
        clause = 'four hits, all in exe/fns.s L7285-7288 -- no jal, no la, no .word'
        self.assertNotIn(frozenset({'jal'}), groups(clause))


class Pairs(unittest.TestCase):
    def test_slash_pair_is_one_alternative_set(self):
        clause = 'enumerated every sb/sh instruction in L36501-36549'
        self.assertIn(frozenset({'sb', 'sh'}), groups(clause))


class Buttons(unittest.TestCase):
    def test_r1_l1_is_not_line_one(self):
        clause = 'the +10 (R1/L1 fast-adjust) handler computes qty+10, slt(stock, qty+10)'
        refs = [mm for mm in m.LREF.finditer(clause)
                if not m.BUTTON.search(clause[max(0, mm.start() - 4):mm.start()])]
        self.assertEqual(refs, [])


class FileReference(unittest.TestCase):
    def test_dated_basename_survives_the_path(self):
        clause = 'docs/research/ui/stcrddek-decoded-2026-07-12.md L99 names it'
        at = clause.index('L99')
        self.assertEqual(m.named_file(clause, at), 'stcrddek-decoded-2026-07-12.md')

    def test_plain_name(self):
        clause = 'the row-select handler (stagslct.s L2620-2637) writes'
        at = clause.index('L2620')
        self.assertEqual(m.named_file(clause, at), 'stagslct.s')


class DelaySlot(unittest.TestCase):
    def test_delay_slot_widens_backwards(self):
        self.assertTrue(m.DELAY.search('L10044, in the jr $ra delay slot'))


if __name__ == '__main__':
    unittest.main()
