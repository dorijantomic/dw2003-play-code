"""Tests for the shape rule engine."""

from __future__ import annotations

import unittest

from tools.decode_shapes import load_rules, match_shape


def proven(**overrides):
    base = {"arguments": {}, "fields": [], "globals": [], "hardware": [],
            "tables": [], "calls": [], "conditions": [],
            "returns": {"v0": "unknown", "paths": {}}}
    base.update(overrides)
    return base


def access(object_="a0", offset=0x10, access_="read", value=None):
    return {"object": object_, "offset": offset, "access": access_, "width": "word",
            "address": None, "name": None, "at": 0x1000, "value": value}


class RuleFileTests(unittest.TestCase):
    def test_rule_file_loads_and_is_not_empty(self) -> None:
        rules = load_rules()
        self.assertTrue(rules)
        for rule in rules:
            self.assertIn("name", rule)
            self.assertIn("summary", rule)

    def test_no_rule_claims_purpose(self) -> None:
        banned = ("initialise", "initialize", "handler for", "used to",
                  "probably", "likely", "in order to", "so that")
        for rule in load_rules():
            for word in banned:
                self.assertNotIn(word, rule["summary"].lower(),
                                 f"rule {rule['name']} states purpose")


class MatchTests(unittest.TestCase):
    def test_field_getter_is_named(self) -> None:
        got = match_shape(proven(arguments={"a0": "used"}, fields=[access()],
                                 returns={"v0": "load(a0+0x10, word)", "paths": {}}))
        self.assertEqual(got["rule"], "field-getter")

    def test_field_setter_is_named(self) -> None:
        got = match_shape(proven(fields=[access(access_="write", value="arg(a1)")]))
        self.assertEqual(got["rule"], "field-setter")

    def test_table_dispatch_is_named(self) -> None:
        got = match_shape(proven(
            tables=[{"address": 0x80082CF8, "stride": 4, "indexed_by": "arg(a0)",
                     "at": 0x100C}],
            calls=[{"at": 0x1010, "target": "indirect", "through": "x",
                    "arguments": {}}]))
        self.assertEqual(got["rule"], "table-dispatch")

    def test_unmatched_gets_a_mechanical_sentence(self) -> None:
        got = match_shape(proven(
            fields=[access(), access(offset=0x20)],
            calls=[{"at": 1, "target": "0x1", "through": None, "arguments": {}}],
            conditions=[{"at": 1, "test": "beqz", "then": "x"}]))
        self.assertEqual(got["rule"], "unmatched")
        self.assertIn("2 field", got["summary"])

    def test_rules_are_data_not_code(self) -> None:
        """Adding a shape must be a text edit, so the file must parse standalone."""
        names = [rule["name"] for rule in load_rules()]
        self.assertIn("table-dispatch", names)
        self.assertEqual(len(names), len(set(names)), "duplicate rule name")


if __name__ == "__main__":
    unittest.main()
