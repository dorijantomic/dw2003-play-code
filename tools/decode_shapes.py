#!/usr/bin/env python3
"""Name the shape of a decoded body from a rule file.

The rules are data (tools/decode_patterns.toml) so that adding one is a text
edit a reviewer can read without opening the analyzer. A rule names a SHAPE; it
never states purpose.
"""

from __future__ import annotations

import functools
import tomllib
from pathlib import Path

RULES = Path(__file__).resolve().parent / "decode_patterns.toml"

COUNTERS = {
    "fields_read": lambda p: sum(1 for r in p["fields"] if r["access"] == "read"),
    "fields_written": lambda p: sum(1 for r in p["fields"] if r["access"] == "write"),
    "globals_read": lambda p: sum(1 for r in p["globals"] if r["access"] == "read"),
    "globals_written": lambda p: sum(1 for r in p["globals"] if r["access"] == "write"),
    "hardware_read": lambda p: sum(1 for r in p["hardware"] if r["access"] == "read"),
    "hardware_written": lambda p: sum(1 for r in p["hardware"] if r["access"] == "write"),
    "calls": lambda p: sum(1 for r in p["calls"] if r["target"] != "indirect"),
    "indirect_calls": lambda p: sum(1 for r in p["calls"] if r["target"] == "indirect"),
    "conditions": lambda p: len(p["conditions"]),
    "tables": lambda p: len(p["tables"]),
}
NO_RETURN = ("nothing", "unknown", "")


@functools.lru_cache(maxsize=4)
def load_rules(path: Path | None = None) -> tuple[dict, ...]:
    return tuple(tomllib.loads((path or RULES).read_text())["rule"])


def mechanical_summary(proven: dict) -> str:
    """A plain count of what the body does. No plural gymnastics."""
    parts = [f"{len(proven.get(key) or [])} {label}"
             for key, label in (("fields", "field"), ("globals", "global"),
                                ("hardware", "hardware"), ("tables", "table"),
                                ("calls", "call"), ("conditions", "test"))
             if proven.get(key)]
    if not parts:
        return "no memory access, no call and no test"
    return ", ".join(parts)


def match_shape(proven: dict, rules=None) -> dict:
    for rule in rules if rules is not None else load_rules():
        if _matches(rule, proven):
            return {"rule": rule["name"], "summary": rule["summary"]}
    return {"rule": "unmatched", "summary": mechanical_summary(proven)}


def _matches(rule: dict, proven: dict) -> bool:
    for key, counter in COUNTERS.items():
        if key in rule and counter(proven) != rule[key]:
            return False
    returns = str((proven.get("returns") or {}).get("v0", ""))
    if rule.get("returns_load") and not returns.startswith("load("):
        return False
    if rule.get("returns_none") and returns not in NO_RETURN:
        return False
    return True
