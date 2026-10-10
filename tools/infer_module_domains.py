#!/usr/bin/env python3
"""Assign a coarse DOMAIN (UI / FIELD / BATTLE / CARD / AUDIO / CORE) to every
recovered function, as a NAVIGATION AID.

This is not evidence and it must never enter the ledger. Its best measured
accuracy is about 80%, so roughly one function in five carries the wrong domain.
Use it to decide where to look; establish what anything does by reading the
original assembly.

Why this exists, and why it is not call-graph propagation
--------------------------------------------------------
The obvious design is to label the shared routines, then infer each caller's
domain from the routines it calls. That was built and measured on 2026-08-11
against held-out labels, and it FAILS:

    always guess the most common domain ....... 51.0%
    call-graph propagation (coarse domains) ... 30.2%
    call-graph propagation (73 fine labels) ..... 9.4%
    same module as labelled neighbours ........ 79.6%

Propagation scores worse than blind guessing because every domain calls the same
resident helpers -- playSound and the resource loader are called from UI, field
and battle alike -- so "who you call" carries almost no domain signal. The signal
is in WHERE THE CODE LIVES: the game is filed into overlays by purpose. Do not
re-attempt the call-graph version without re-reading that table.

Bases, strongest first
----------------------
    seed              the function already carries a curated subsystem label
    module_majority   >=80% of its module's labelled peers share one domain
    module_prefix     its module has no labels; the filename prefix does, and
                      that prefix was validated against labelled data
    unresolved        no usable signal -- notably ALL of exe/fns, which is
                      resident code genuinely spanning domains (44.6% purity)
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

# Substring -> domain, applied to the curated subsystem string. Order matters:
# the first match wins, so the more specific tokens are listed first.
DOMAIN_TOKENS = (
    ("card", "CARD"),
    ("menu", "UI"), ("window", "UI"), ("text", "UI"), ("font", "UI"), ("ui", "UI"),
    ("battle", "BATTLE"), ("fight", "BATTLE"), ("tech", "BATTLE"),
    ("field", "FIELD"), ("world", "FIELD"), ("stage", "FIELD"),
    ("map", "FIELD"), ("npc", "FIELD"),
    ("audio", "AUDIO"), ("sound", "AUDIO"), ("music", "AUDIO"),
    ("resident", "CORE"), ("core", "CORE"), ("math", "CORE"),
    ("engine", "CORE"), ("memory", "CORE"),
)

# Filename prefixes whose domain was validated against the labelled population.
# The share is the measured agreement; anything mixed is deliberately absent so
# it falls through to `unresolved` rather than inventing a domain.
PREFIX_DOMAINS = {
    "wstag": ("FIELD", 0.916, 369),
    "st": ("UI", 0.958, 142),
    "fieldstg": ("FIELD", 0.820, 50),
    "stg": ("UI", 0.840, 25),
    "fightstg": ("BATTLE", 0.750, 24),
    "cardgame": ("CARD", 1.000, 8),
}
PREFIX_ORDER = ("wstag", "fightstg", "fieldstg", "cardgame", "stg", "st")

# A module whose labelled peers disagree this much is not a reliable donor.
PURITY_FLOOR = 0.8
# Prefix agreement below this is too weak to assign a domain from the name.
PREFIX_FLOOR = 0.75


def coarse_domain(subsystem: str) -> str:
    lowered = subsystem.lower()
    for token, domain in DOMAIN_TOKENS:
        if token in lowered:
            return domain
    return "OTHER"


def module_prefix(module_id: str) -> str | None:
    stem = module_id.split("/")[-1]
    for prefix in PREFIX_ORDER:
        if stem.startswith(prefix):
            return prefix
    return None


def build_map(inventory: dict) -> dict:
    seeds: dict[str, str] = {}
    module_of: dict[str, str] = {}
    functions: list[tuple[str, str, dict]] = []
    for module in inventory["modules"]:
        for function in module["functions"]:
            functions.append((function["id"], module["id"], function))
            module_of[function["id"]] = module["id"]
            subsystem = function.get("semantic_subsystem")
            if subsystem and subsystem != "unclassified":
                seeds[function["id"]] = coarse_domain(subsystem)

    per_module: dict[str, Counter] = defaultdict(Counter)
    for function_id, domain in seeds.items():
        per_module[module_of[function_id]][domain] += 1

    donors: dict[str, tuple[str, float, int]] = {}
    for module_id, counts in per_module.items():
        total = sum(counts.values())
        domain, top = counts.most_common(1)[0]
        purity = top / total
        if purity >= PURITY_FLOOR:
            donors[module_id] = (domain, purity, total)

    entries = []
    for function_id, module_id, function in functions:
        if function_id in seeds:
            domain, basis, confidence = seeds[function_id], "seed", 1.0
        elif module_id in donors:
            domain, confidence, _ = donors[module_id]
            basis = "module_majority"
        else:
            prefix = module_prefix(module_id)
            candidate = PREFIX_DOMAINS.get(prefix) if prefix else None
            if candidate and candidate[1] >= PREFIX_FLOOR and module_id not in per_module:
                domain, confidence, _ = candidate
                basis = "module_prefix"
            else:
                domain, basis, confidence = None, "unresolved", 0.0
        entries.append({
            "id": function_id,
            "module": module_id,
            "domain": domain,
            "basis": basis,
            "confidence": round(confidence, 3),
            "semantic_name": function.get("semantic_name"),
        })

    by_basis = Counter(entry["basis"] for entry in entries)
    by_domain = Counter(entry["domain"] for entry in entries if entry["domain"])
    mixed = sorted(
        (module_id for module_id in per_module if module_id not in donors),
        key=lambda module_id: -sum(per_module[module_id].values()),
    )
    return {
        "schema_version": 1,
        "generated_by": "tools/infer_module_domains.py",
        "authority": 6,
        "is_evidence": False,
        "warning": (
            "NAVIGATION AID ONLY, measured accuracy about 80%. Roughly one in five "
            "entries is wrong. Never cite this as evidence and never record it in "
            "docs/research/evidence/ledger.json."
        ),
        "method": {
            "chosen": "module membership",
            "rejected": "call-graph propagation",
            "measured_accuracy": {
                "majority_class_baseline": 0.510,
                "callgraph_propagation_coarse": 0.302,
                "callgraph_propagation_fine": 0.094,
                "same_module_inheritance": 0.796,
            },
            "note": (
                "Call-graph propagation scores worse than guessing because every "
                "domain calls the same resident helpers. Measured 2026-08-11 by "
                "hiding 25% of known labels over 5 trials."
            ),
        },
        "summary": {
            "functions": len(entries),
            "by_basis": dict(by_basis),
            "by_domain": dict(by_domain),
            "mixed_modules_left_unresolved": mixed,
        },
        "functions": entries,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--inventory", type=Path,
        default=Path("recovered/ddw3/function-inventory.json"),
    )
    parser.add_argument(
        "--output", type=Path,
        default=Path("docs/generated/function-domain-map.json"),
    )
    args = parser.parse_args()
    result = build_map(json.loads(args.inventory.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    summary = result["summary"]
    print(f"functions={summary['functions']} output={args.output}")
    print(f"  by basis:  {summary['by_basis']}")
    print(f"  by domain: {summary['by_domain']}")
    print(f"  mixed modules left unresolved: {summary['mixed_modules_left_unresolved']}")


if __name__ == "__main__":
    main()
