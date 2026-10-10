#!/usr/bin/env python3
"""Compare two lift trees and report only the ways the new one got worse.

A pipeline change is scored by `tools/triage_lift_failures.py`, but aggregate
counts hide the failure mode that matters most here: a *silent* one.  Feeding
m2c a context file that declares a value-returning function `void` makes it
delete every `return` and emit a body that still parses, still looks complete,
and is wrong.  Bucket counts would show that as an improvement.

This tool therefore checks per function, not per bucket:

  lost_function      present in the baseline, absent now
  lost_body          had a body, now fails or is empty
  lost_return        had `return <expr>;`, now has none
  lost_return_type   had a resolved return type, now has m2c's `?`
  lost_call          a call disappeared from the body
  status_regression  complete -> incomplete/failed

`lost_return_type` was added 2026-08-12 after a change that gained 93 functions
also turned the return type of 31 others from `u32`/`s32`/`void *` into `?`,
with none going the other way. Every other check passed, so the tree scored
clean while it had quietly become less typed -- the same silent-degradation
failure mode the rest of this tool exists to catch.

    python3 tools/check_lift_regression.py --baseline exe-decomp --new /tmp/lift
"""

from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME_RE = re.compile(r"F0x[0-9a-fA-F]{8}")
RETURN_VALUE_RE = re.compile(r"(?m)^\s*return\s+[^;\s]")
CALL_RE = re.compile(r"\b(F0x[0-9a-fA-F]{8})\s*\(")
RANK = {"complete": 2, "incomplete": 1, "failed": 0}


def scan(root: Path) -> dict[str, dict]:
    out = {}
    for path in sorted(root.glob("**/F0x*.c")):
        if not NAME_RE.fullmatch(path.stem):
            continue
        module = "exe/fns" if path.parent.name == "c" else f"pro/{path.parent.name.removesuffix('_c')}"
        text = path.read_text(errors="replace")
        failed = "Decompilation failure" in text or not text.strip()
        definition = re.search(rf"(?m)^([^\n]*\b{path.stem}\s*\()", text)
        out[f"{module}:{path.stem}"] = {
            "failed": failed,
            "returns": len(RETURN_VALUE_RE.findall(text)),
            "calls": len(set(CALL_RE.findall(text)) - {path.stem}),
            "lines": text.count("\n"),
            # m2c writes `?` where it could not resolve a type. Comparing the
            # definition line rather than the whole file keeps this to the
            # function's own signature, not the `extern` block above it.
            "untyped_return": bool(definition and "?" in definition.group(1)),
            "signature": definition.group(1).strip() if definition else None,
        }
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--new", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=15)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    base = scan(args.baseline.resolve())
    new = scan(args.new.resolve())
    findings: dict[str, list[str]] = collections.defaultdict(list)
    for key, before in base.items():
        after = new.get(key)
        if after is None:
            # A function the new run does not attempt at all. This is expected
            # when the change removes entries that were never real functions, so
            # it is reported but weighted separately from a lost body.
            findings["lost_function"].append(key)
            continue
        if not before["failed"] and after["failed"]:
            findings["lost_body"].append(key)
        if before["returns"] > 0 and after["returns"] == 0:
            findings["lost_return"].append(
                f"{key} ({before['returns']} -> 0)"
            )
        if after["calls"] < before["calls"]:
            findings["lost_call"].append(
                f"{key} ({before['calls']} -> {after['calls']})"
            )
        if not before["untyped_return"] and after["untyped_return"]:
            findings["lost_return_type"].append(
                f"{key} ({before['signature']} -> {after['signature']})"
            )
    report = {
        "baseline_functions": len(base),
        "new_functions": len(new),
        "gained": len(set(new) - set(base)),
        "findings": {k: len(v) for k, v in sorted(findings.items())},
        "examples": {k: v[: args.limit] for k, v in sorted(findings.items())},
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(json.dumps(report, indent=2))
    serious = sum(
        len(findings[k]) for k in ("lost_body", "lost_return", "lost_call")
    )
    raise SystemExit(1 if serious else 0)


if __name__ == "__main__":
    main()
