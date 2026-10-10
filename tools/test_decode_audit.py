"""Tests for the base-function ranking."""

from __future__ import annotations

import unittest

from tools.decode_audit import call_graph, rank


def record(overlay: str, address: int, calls=(), status="decoded", dispatch=()):
    return {"overlay": overlay, "address": address, "status": status,
            "proven": {"calls": [{"target": t} for t in calls]},
            "dispatch": list(dispatch),
            "coverage": {"total": 10}, "shape": {"rule": "unmatched"}}


def through(target: int | None):
    return {"resolved": target is not None,
            "candidates": [f"0x{target:08X}"] if target is not None else []}


def records(*rows):
    return {(r["overlay"], r["address"]): r for r in rows}


class CallGraphTests(unittest.TestCase):
    def test_direct_calls_become_edges(self) -> None:
        rows = records(record("fns", 0x1000, ["0x00002000", "0x00002000"]),
                       record("fns", 0x1100, ["0x00002000"]),
                       record("fns", 0x2000))
        callers, sites, via = call_graph(rows)
        self.assertEqual(callers[0x2000], {("fns", 0x1000), ("fns", 0x1100)})
        self.assertEqual(sites[0x2000], 3)
        self.assertEqual(via[0x2000], 0)

    def test_an_unresolved_pointer_call_contributes_no_edge(self) -> None:
        """A slot nobody was ever seen filling still names no target."""
        callers, _, _ = call_graph(records(
            record("fns", 0x1000,
                   ["indirect", "unresolved", "EnterCriticalSection"],
                   dispatch=[through(None)])))
        self.assertEqual(dict(callers), {})

    def test_a_resolved_pointer_call_is_an_edge_counted_apart(self) -> None:
        """823 sites read one cell of the shipped data; they are real callers."""
        rows = records(record("fns", 0x1000, ["0x00002000"],
                              dispatch=[through(0x2000), through(0x3000)]))
        callers, sites, via = call_graph(rows)
        self.assertEqual(callers[0x2000], {("fns", 0x1000)})
        self.assertEqual((sites[0x2000], via[0x2000]), (2, 1))
        self.assertEqual((sites[0x3000], via[0x3000]), (1, 1))

    def test_direct_only_leaves_the_inferred_edges_out(self) -> None:
        rows = records(record("fns", 0x1000, ["0x00002000"],
                              dispatch=[through(0x3000)]))
        callers, _, via = call_graph(rows, direct_only=True)
        self.assertEqual(dict(callers), {0x2000: {("fns", 0x1000)}})
        self.assertEqual(dict(via), {})

    def test_an_error_record_contributes_no_edge(self) -> None:
        rows = records(record("fns", 0x1000, ["0x00002000"], status="error"),
                       record("fns", 0x1100, [], status="error",
                              dispatch=[through(0x2000)]))
        callers, _, _ = call_graph(rows)
        self.assertEqual(dict(callers), {})


class RankTests(unittest.TestCase):
    ROWS = records(record("fns", 0x1000, ["0x00002000"]),
                   record("fns", 0x1100, ["0x00002000"]),
                   record("fns", 0x1200, ["0x00003000"]),
                   record("fns", 0x2000),
                   record("fns", 0x3000))

    def test_most_called_comes_first(self) -> None:
        got = rank(self.ROWS, set(), None)
        self.assertEqual([r["address"] for r in got], [0x2000, 0x3000])
        self.assertEqual(got[0]["callers"], 2)

    def test_an_established_function_is_marked_not_dropped(self) -> None:
        got = rank(self.ROWS, {("fns", 0x2000)}, None)
        self.assertTrue(got[0]["established"])
        self.assertFalse(got[1]["established"])

    def test_the_overlay_filter_selects(self) -> None:
        self.assertEqual(rank(self.ROWS, set(), "cardgame"), [])
        self.assertEqual(len(rank(self.ROWS, set(), "fns")), 2)

    def test_a_target_with_no_record_still_ranks(self) -> None:
        """The most-called routine in the game had no record at all."""
        rows = records(record("fns", 0x1000, ["0x00009999"]))
        got = rank(rows, set(), None)
        self.assertEqual(got[0]["address"], 0x9999)
        self.assertIsNone(got[0]["instructions"])
        self.assertEqual(got[0]["shape"], "no record")


if __name__ == "__main__":
    unittest.main()
