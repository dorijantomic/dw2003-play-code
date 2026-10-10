#!/usr/bin/env python3
"""Rank functions by how much of the program decoding them would explain.

Bottom-up is the cheapest order to read a binary in: settle what a heavily used
routine does, and every one of its callers gains context for free. This tool
answers "which routine, if I understood it, would explain the most callers that
nobody has established yet".

It reads the records tools/decode_loop.py writes and the evidence ledger. No
database, no decoding, no tokens.

Two measurements shape what it reports:

  * **53% of all calls go through a pointer**, and half of those now have an
    answer. tools/decode_dispatch.py settles 7,053 of them, mostly by reading
    the function addresses the shipped image already holds, so those edges are
    counted here too -- in their own column, because a resolved pointer call is
    an inference and a `jal` is not. `--direct` leaves them out.
  * **A live ledger claim does not mean somebody established the function.**
    Ten claims are anchored on more than a hundred functions each, and one spans
    493 -- carrying it says the investigation passed through, not what the code
    does. So "established" here means a claim narrow enough to be about this
    function, and the width is a flag you can move.

Usage:
  tools/decode_audit.py                 # the ranked worklist
  tools/decode_audit.py --limit 40
  tools/decode_audit.py --breadth 5     # stricter idea of "established"
  tools/decode_audit.py --direct        # `jal` edges only, as before
  tools/decode_audit.py --overlay fns
"""

from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path

if __package__ in (None, ""):      # run as `tools/decode_audit.py`, not just -m
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.decode_corpus import (LEDGER, build_corpus, function_ranges,
                                 load_records, path_of_overlay)

# A claim anchored on more functions than this is about a system, not about any
# one of them. 20 is the knee of the measured distribution: 204 live claims sit
# at 20 or below, 30 sit above, and the 10 widest cover 100+ functions each.
NARROW = 20


def call_graph(records: dict, direct_only: bool = False,
               ) -> tuple[dict, collections.Counter, collections.Counter]:
    """Who calls whom, and how many of those edges came through a pointer.

    A `jal` names its target and is an edge. A pointer call names a slot, and
    the edge exists only if exactly one function was ever put in that slot --
    which tools/decode_dispatch.py decides, and which is an inference. The two
    are counted separately so the ranking can use both without the report
    claiming the second is as good as the first.
    """
    callers: dict[int, set] = collections.defaultdict(set)
    sites: collections.Counter = collections.Counter()
    via_pointer: collections.Counter = collections.Counter()
    for (overlay, address), record in records.items():
        if record.get("status") != "decoded":
            continue
        for call in record["proven"]["calls"]:
            target = call.get("target")
            if isinstance(target, str) and target.startswith("0x"):
                callers[int(target, 16)].add((overlay, address))
                sites[int(target, 16)] += 1
        if direct_only:
            continue
        for row in record.get("dispatch", []):
            if not row.get("resolved"):
                continue
            target = int(row["candidates"][0], 16)
            callers[target].add((overlay, address))
            sites[target] += 1
            via_pointer[target] += 1
    return callers, sites, via_pointer


def established(breadth_limit: int, records: dict) -> tuple[set, dict]:
    """Functions carrying a claim narrow enough to be about them.

    Also returns each live claim's breadth, so a report can show why a function
    counts as established or does not.
    """
    starts: dict[str, set[int]] = {}
    overlay_path = path_of_overlay()
    for (overlay, address), record in records.items():
        if "found_inside" in record and overlay in overlay_path:
            starts.setdefault(overlay_path[overlay], set()).add(address)
    corpus = build_corpus(json.loads(LEDGER.read_text()), function_ranges(starts))
    breadth: collections.Counter = collections.Counter()
    for anchor in corpus.values():
        for claim in anchor.claims:
            breadth[claim.id] += 1
    narrow = {key for key, anchor in corpus.items()
              if any(breadth[c.id] <= breadth_limit for c in anchor.claims)}
    return narrow, breadth


# A claim reaches a function two ways. An evidence anchor is one; naming the
# address in the statement is the other, and the ledger does the second far more
# often than the first. `UI-CURSORCLASS-B364-001` reconstructs F0x8001b364 in
# full -- allocation size, handler, all six installed slots -- and anchors none
# of its evidence at that address, so every anchor-only view of the ledger calls
# the menu cursor unexplored. Eight of the worklist's top 25 were like that.
ADDRESS_IN_STATEMENT = re.compile(r"0x(8[0-9a-fA-F]{7})\b")


def described(breadth_limit: int = NARROW) -> dict[int, list[str]]:
    """address -> the claims whose STATEMENT names it, censuses excluded.

    Breadth is counted the same way as for anchors: how many distinct code
    addresses one statement names. A statement naming 45 of them is a table
    census and says nothing about any single entry, so it is dropped -- the
    `MENTIONED` trap in written form.
    """
    try:
        ledger = json.loads(LEDGER.read_text())
    except (OSError, ValueError):
        return {}
    out: dict[int, list[str]] = collections.defaultdict(list)
    for claim in ledger.get("claims", []):
        if claim.get("status") in ("unresearched", "contradicted"):
            continue
        found = set(ADDRESS_IN_STATEMENT.findall(claim.get("statement", "").lower()))
        if not found or len(found) > breadth_limit:
            continue
        for text in found:
            out[int(text, 16)].append(claim["id"])
    return dict(out)


def declared_names() -> dict[int, str]:
    """address -> the symbol the assembly names, for every function that has one.

    Read from the extents rather than the records: a named function is usually
    hand-annotated, which means no address labels, no indexed lines, and so no
    decoded record to carry the name.
    """
    try:
        payload = json.loads(
            (Path(__file__).resolve().parents[1]
             / "docs/generated/function-extents.json").read_text())
    except (OSError, ValueError):
        return {}
    return {function["address"]: function["name"]
            for source in payload.get("sources", {}).values()
            for function in source["functions"] if function.get("name")}


def rank(records: dict, narrow: set, overlay: str | None,
         direct_only: bool = False, breadth_limit: int = NARROW,
         anchors_only: bool = False) -> list[dict]:
    """Every called function, most callers first, established ones marked."""
    callers, sites, via_pointer = call_graph(records, direct_only)
    names = declared_names()
    prose = {} if anchors_only else described(breadth_limit)
    by_address: dict[int, list] = collections.defaultdict(list)
    for key, record in records.items():
        by_address[key[1]].append((key, record))

    rows = []
    for address, who in callers.items():
        for key, record in by_address.get(address, [(("?", address), None)]):
            if overlay and key[0] != overlay:
                continue
            coverage = (record or {}).get("coverage", {})
            # A function the assembly NAMES needs no reading, so say the name
            # instead of ranking it as an unknown. `rand_u16` sat at the top of
            # this list with "no record" until 2026-08-10, because its body
            # carries no address labels and the index therefore holds none of it.
            named = names.get(address)
            claims = prose.get(address, [])
            shape = (record or {}).get("shape", {}).get("rule", "no record")
            if named:
                shape = f"NAMED {named}"
            elif claims:
                shape = f"CLAIMED {claims[0]}"
            rows.append({
                "overlay": key[0], "address": address,
                "callers": len(who), "sites": sites[address],
                "via_pointer": via_pointer[address],
                "established": (key in narrow or named is not None
                                or bool(claims)),
                "claims": claims,
                "instructions": coverage.get("total"),
                "shape": shape,
                "suggestions": len((record or {}).get("suggested", [])),
            })
    rows.sort(key=lambda row: (-row["callers"], -row["sites"], row["address"]))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--breadth", type=int, default=NARROW,
                        help="a claim anchored on more functions than this does "
                             "not count as establishing any of them")
    parser.add_argument("--overlay")
    parser.add_argument("--all", action="store_true",
                        help="include functions already established")
    parser.add_argument("--direct", action="store_true",
                        help="count only `jal` edges, not resolved pointer calls")
    parser.add_argument("--anchors-only", action="store_true",
                        help="ignore claims that only NAME an address in their "
                             "statement; count evidence anchors alone")
    args = parser.parse_args()

    records = load_records()
    if not records:
        print("no records; run tools/decode_loop.py first")
        return 1
    narrow, breadth = established(args.breadth, records)
    rows = rank(records, narrow, args.overlay, args.direct, args.breadth,
                args.anchors_only)
    worklist = [r for r in rows if args.all or not r["established"]]

    decoded = sum(1 for r in records.values() if r.get("status") == "decoded")
    by_prose = sum(1 for r in rows if r["claims"] and r["address"] not in
                   {k[1] for k in narrow})
    print(f"records {len(records)} ({decoded} decoded)   "
          f"called functions {len(rows)}   "
          f"established at breadth <= {args.breadth}: {len(narrow)}")
    if by_prose:
        print(f"{by_prose} more are described by a claim that names them but "
              f"anchors no evidence there (--anchors-only to ignore those).")
    reach = set()
    callers, _, _ = call_graph(records, args.direct)
    for row in worklist[:args.limit]:
        reach |= callers[row["address"]]
    print(f"the top {min(args.limit, len(worklist))} unestablished routines below "
          f"would give context to {len(reach)} distinct calling functions.")
    if not args.direct:
        print("`ptr` counts call sites reached through a resolved pointer -- an "
              "inference, unlike the rest.")
    print(f"\n{'callers':>7} {'sites':>6} {'ptr':>6}  {'function':<22} "
          f"{'size':>5}  shape")
    for row in worklist[:args.limit]:
        size = row["instructions"] if row["instructions"] is not None else "-"
        name = f"{row['overlay']} 0x{row['address']:08X}"
        mark = " *" if row["established"] else ""
        print(f"{row['callers']:7d} {row['sites']:6d} {row['via_pointer']:6d}  "
              f"{name:<22} {str(size):>5}  {row['shape']}{mark}")
    if args.all:
        print("\n* already established by a narrow claim")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
