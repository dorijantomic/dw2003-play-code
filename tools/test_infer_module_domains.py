from __future__ import annotations

import unittest

from tools.infer_module_domains import build_map, coarse_domain, module_prefix


def function(function_id: str, subsystem: str | None = None) -> dict:
    return {
        "id": function_id,
        "semantic_subsystem": subsystem,
        "semantic_name": None,
        "direct_calls": [],
        "indirect_calls": [],
    }


def inventory(modules: dict[str, list[dict]]) -> dict:
    return {
        "modules": [
            {"id": name, "functions": functions} for name, functions in modules.items()
        ]
    }


class InferModuleDomainsTests(unittest.TestCase):
    def test_pure_module_donates_its_domain_to_unlabelled_peers(self) -> None:
        result = build_map(inventory({
            "pro/ststatus": [
                function("pro/ststatus:F0x1", "ui-chrome"),
                function("pro/ststatus:F0x2", "menu-chrome"),
                function("pro/ststatus:F0x3"),
            ],
        }))
        by_id = {entry["id"]: entry for entry in result["functions"]}
        self.assertEqual(by_id["pro/ststatus:F0x3"]["domain"], "UI")
        self.assertEqual(by_id["pro/ststatus:F0x3"]["basis"], "module_majority")
        self.assertEqual(by_id["pro/ststatus:F0x1"]["basis"], "seed")

    def test_mixed_module_donates_nothing(self) -> None:
        """exe/fns really is 44.6% pure -- inheriting from it would be wrong.

        A module whose labelled peers disagree must leave its unlabelled
        functions `unresolved` rather than handing them the plurality domain.
        """
        result = build_map(inventory({
            "exe/fns": [
                function("exe/fns:F0x1", "ui-chrome"),
                function("exe/fns:F0x2", "resident-core"),
                function("exe/fns:F0x3", "audio"),
                function("exe/fns:F0x4", "battle"),
                function("exe/fns:F0x5"),
            ],
        }))
        by_id = {entry["id"]: entry for entry in result["functions"]}
        self.assertEqual(by_id["exe/fns:F0x5"]["basis"], "unresolved")
        self.assertIsNone(by_id["exe/fns:F0x5"]["domain"])
        self.assertIn("exe/fns", result["summary"]["mixed_modules_left_unresolved"])

    def test_prefix_fills_in_a_module_with_no_labels_at_all(self) -> None:
        result = build_map(inventory({
            "pro/wstag805": [function("pro/wstag805:F0x1"), function("pro/wstag805:F0x2")],
        }))
        entry = result["functions"][0]
        self.assertEqual(entry["domain"], "FIELD")
        self.assertEqual(entry["basis"], "module_prefix")

    def test_prefix_never_overrides_a_module_that_has_its_own_labels(self) -> None:
        """A module's own evidence beats its filename, even when they disagree."""
        result = build_map(inventory({
            "pro/wstag923": [
                function("pro/wstag923:F0x1", "ui-chrome"),
                function("pro/wstag923:F0x2", "ui-chrome"),
                function("pro/wstag923:F0x3"),
            ],
        }))
        by_id = {entry["id"]: entry for entry in result["functions"]}
        self.assertEqual(by_id["pro/wstag923:F0x3"]["domain"], "UI")
        self.assertEqual(by_id["pro/wstag923:F0x3"]["basis"], "module_majority")

    def test_output_is_marked_as_not_evidence(self) -> None:
        result = build_map(inventory({"pro/x": [function("pro/x:F0x1")]}))
        self.assertFalse(result["is_evidence"])
        self.assertEqual(result["authority"], 6)
        self.assertIn("NAVIGATION AID", result["warning"])

    def test_domain_and_prefix_helpers(self) -> None:
        self.assertEqual(coarse_domain("card-battle"), "CARD")
        self.assertEqual(coarse_domain("window-fold-ui"), "UI")
        self.assertEqual(coarse_domain("world-exploration"), "FIELD")
        self.assertEqual(module_prefix("pro/wstag400"), "wstag")
        self.assertEqual(module_prefix("pro/ststatus"), "st")
        self.assertIsNone(module_prefix("exe/fns"))


if __name__ == "__main__":
    unittest.main()
