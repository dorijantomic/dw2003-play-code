#!/usr/bin/env python3
"""How much of the card-effect opcode interpreter is actually read?

CARD-Q002 asks "what does each of the ~175 card-effect opcode handler bodies
do?", and a manifest note dated 2026-08-12 called that "the largest single decode
gap in the project". Both numbers were wrong, and this tool exists so nobody has
to take either on trust again.

Two corrections it makes mechanically:

  * **There are not ~175 bodies.** The 174 opcodes dispatch through two tables --
    enter at 0x80082CF8 indexed (op-1)*4, update at 0x80082FB0 indexed op*4 --
    and those resolve to far fewer DISTINCT targets, because many opcodes share
    a handler. Counted from cardgame-opcode-registry.json (authority 2, both
    phases for all 174 opcodes).
  * **The distinct targets are not unread.** docs/research/card/
    cardgame-plain-descriptions.md is a reading of all 268 decompiled bodies,
    with a per-row confidence mark. Joining the two says exactly how many
    handlers are read, at what confidence, and how many are anchored.

The output separates what is READ from what is ANCHORED, because they are
different things and the gap between them is the actual remaining work: a
reading in a plain-language document sits at authority 5-6 and cannot support a
promotion, however correct it is.

`--json` writes the full join. Exit status is always 0: this measures, it does
not gate.

Usage:
    python3 tools/card_opcode_coverage.py
    python3 tools/card_opcode_coverage.py --unanchored   # the work queue
    python3 tools/card_opcode_coverage.py --json out.json
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "docs/research/card/cardgame-opcode-registry.json"
DESCRIPTIONS = ROOT / "docs/research/card/cardgame-plain-descriptions.md"
LEDGER = ROOT / "docs/research/evidence/ledger.json"
ADDR_RE = re.compile(r"0x[0-9a-fA-F]{8}")


def registry_targets() -> tuple[dict[str, set[int]], dict[str, set[int]]]:
    """Distinct handler addresses -> the opcodes that reach them, per phase."""
    data = json.loads(REGISTRY.read_text())
    ops = data["opcodes"]
    items = ops.items() if isinstance(ops, dict) else enumerate(ops)
    enter: dict[str, set[int]] = collections.defaultdict(set)
    update: dict[str, set[int]] = collections.defaultdict(set)
    for key, rec in items:
        try:
            op = int(str(key), 0)
        except ValueError:
            op = -1
        for phase, sink in (("enter", enter), ("update", update)):
            for callee in (rec.get(phase) or {}).get("callees") or []:
                sink[callee.lstrip("F").lower()].add(op)
    return dict(enter), dict(update)


def described() -> dict[str, tuple[str, str]]:
    """address -> (confidence, what it does) from the plain-language reading."""
    out: dict[str, tuple[str, str]] = {}
    for line in DESCRIPTIONS.read_text(errors="replace").splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 3:
            continue
        m = ADDR_RE.search(cells[0])
        if not m:
            continue
        out[m.group(0).lower()] = (cells[-1].lower(), cells[1])
    return out


def anchored(addresses: list[str]) -> dict[str, str]:
    """`./dw3-research known`'s verdict per handler — DECODED/MENTIONED/...

    This shells out rather than re-deriving the answer from the ledger, on
    purpose. Three hand-rolled variants of "is it anchored" were tried while
    writing this tool and all three disagreed with `known`: counting locator
    fields alone said 9, counting any address in a cardgame record said 81, and
    `known` says 38. `known` is right — it resolves the function's EXTENT from
    docs/generated/function-extents.json and accepts an anchor anywhere inside
    it, which the flat text scans cannot do.

    Publishing a fourth number would be the exact error this tool exists to
    correct, so there is one authority and this is not it.
    """
    if not addresses:
        return {}
    cmd = [str(ROOT / "dw3-research"), "known", *addresses,
           "--overlay", "cardgame", "--quiet"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True,
                             cwd=ROOT, timeout=600)
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"  (could not run `dw3-research known`: {exc})", file=sys.stderr)
        return {}
    if out.returncode != 0:
        print(f"  (`dw3-research known` failed: {out.stderr.strip()[:200]})",
              file=sys.stderr)
        return {}
    verdicts: dict[str, str] = {}
    for line in out.stdout.splitlines():
        m = re.search(r"target=(0x[0-9a-fA-F]{8}).*?verdict=(\w+)", line)
        if m:
            verdicts[m.group(1).lower()] = m.group(2)
    return verdicts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--unanchored", action="store_true",
                    help="list the read-but-unanchored handlers, the real queue")
    ap.add_argument("--json", type=pathlib.Path)
    args = ap.parse_args()

    enter, update = registry_targets()
    desc = described()
    targets = sorted(set(enter) | set(update))
    verdicts = anchored(targets)

    rows = []
    for a in targets:
        conf, what = desc.get(a, ("no row", ""))
        rows.append({
            "addr": a,
            "phase": ("enter+update" if a in enter and a in update
                      else "enter" if a in enter else "update"),
            "opcodes": sorted(enter.get(a, set()) | update.get(a, set())),
            "confidence": conf,
            "reading": what,
            "known": verdicts.get(a, "unqueried"),
        })

    conf_counts = collections.Counter(r["confidence"] for r in rows)
    known_counts = collections.Counter(r["known"] for r in rows)
    n_anch = known_counts.get("DECODED", 0)
    opcodes = json.loads(REGISTRY.read_text())["opcodes"]
    n_ops = len(opcodes)

    print(f"opcodes in the registry           : {n_ops}")
    print(f"DISTINCT handler bodies they reach: {len(rows)}"
          f"  (enter {len(enter)}, update {len(update)},"
          f" both {len(set(enter) & set(update))})")
    print()
    print("read? — from cardgame-plain-descriptions.md, a reading of all 268 bodies:")
    for mark in ("high", "med", "low", "no row"):
        if conf_counts.get(mark):
            print(f"  {mark:8s}: {conf_counts[mark]:3d}")
    print()
    print("anchored? — `./dw3-research known`, the one authority on this:")
    for mark in ("DECODED", "MENTIONED", "AMBIGUOUS", "UNKNOWN", "unqueried"):
        if known_counts.get(mark):
            print(f"  {mark:10s}: {known_counts[mark]:3d}")
    print(f"  read but not DECODED (authority 5-6, unpromotable): {len(rows) - n_anch}")
    print()
    print("The gap is anchoring and review of existing readings, NOT unread code.")
    print("A reading in a plain-language doc is correct or not on its own merits;")
    print("it just cannot carry a promotion. See docs/research/infra/decode-coverage-traps.md.")

    if args.unanchored:
        print()
        for r in rows:
            if r["known"] != "DECODED":
                ops_s = ",".join(f"0x{o:02x}" for o in r["opcodes"][:6])
                more = "..." if len(r["opcodes"]) > 6 else ""
                print(f"  {r['addr']}  {r['known']:10s} {r['confidence']:6s} {r['phase']:12s} "
                      f"ops {ops_s}{more}")

    if args.json:
        args.json.write_text(json.dumps(
            {"opcodes": n_ops, "distinct_handlers": len(rows),
             "confidence": dict(conf_counts), "known": dict(known_counts),
             "rows": rows}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
