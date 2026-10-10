#!/usr/bin/env python3
"""What every caller passes to one function.

The decoder records the value in each argument register at 81% of the 19,472
call sites it found, and tools/decode_dispatch.py names a target for 7,518 of
the calls that go through a pointer. Put those together and a function can be
interrogated from the OUTSIDE: not "what does this body do" but "what does the
rest of the program ask it for".

That is often the faster question. `F0x8002006c` takes one packed value; reading
its body gives the bit layout, but reading its 506 call sites gives the actual
set of values the game ever plays. And a routine whose first argument is always
one of four small constants is an indexed selector whatever its body looks like.

Two things this is careful about:

  * A resolved pointer call is an INFERENCE. Direct and indirect call sites are
    counted separately and the report says which is which, so a distribution
    resting entirely on inferred edges is visible as such.
  * `const(...)` is the only form that means a literal. `arg(a1)`, `load(...)`
    and `unknown` are reported as shapes, never folded into the constant
    histogram -- a caller forwarding its own argument tells you about the
    caller, not about the value.

Usage:
  tools/decode_callsites.py 0x8002006c            # who calls it, and with what
  tools/decode_callsites.py 0x8002006c --values   # every distinct constant
  tools/decode_callsites.py --top 20              # targets with the most callers
"""

from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path

if __package__ in (None, ""):      # run as `tools/decode_callsites.py`
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.decode_loop import STATE

CONST = re.compile(r"^const\(0x([0-9A-Fa-f]+)\)$")
SLOTS = ("a0", "a1", "a2", "a3")

# How a resolved pointer call was matched to its target, strongest first. The
# offset alone is NOT an identity: `+0x84` is a slot of a shared table when the
# pointer's base is itself a load, and a slot of whatever object was in the
# register otherwise. Printing the offset without the basis merges the two, and
# on 0x8003227C that merge read as a contradiction of a recorded claim -- its 86
# edges index the table `fns` 0x8003086C builds, not the object method table.
BASIS = {
    "same-global": "a named global, matched by address",
    "shared-table": "a shared table, matched by index",
    "slot-only": "an object slot, matched by offset alone",
}


def load() -> list[dict]:
    rows = []
    for path in STATE.glob("*.json"):
        row = json.loads(path.read_text())
        if row.get("status") == "decoded":
            rows.append(row)
    return rows


def sites_for(records: list[dict], target: int) -> list[dict]:
    """Every call site that reaches `target`, direct or resolved.

    A record's `dispatch` rows are keyed by the call's own address, which is how
    an indirect call site is matched back to the arguments phase 1 recorded for
    it.
    """
    found = []
    for record in records:
        resolved = {row["at"]: row for row in record.get("dispatch", [])
                    if row.get("resolved")}
        for call in record["proven"]["calls"]:
            name = call.get("target")
            direct = isinstance(name, str) and name.startswith("0x") \
                and int(name, 16) == target
            row = resolved.get(call.get("at"))
            indirect = (row is not None
                        and int(row["candidates"][0], 16) == target)
            if direct or indirect:
                found.append({"caller": (record["overlay"], record["address"]),
                              "at": call.get("at"), "direct": direct,
                              "arguments": call.get("arguments") or {},
                              "slot": None if direct else row.get("slot"),
                              "basis": None if direct else row.get("basis")})
    return found


def distribution(sites: list[dict]) -> dict[str, dict]:
    """Per argument register: the constants passed, and the other shapes."""
    out: dict[str, dict] = {}
    for slot in SLOTS:
        constants: collections.Counter = collections.Counter()
        shapes: collections.Counter = collections.Counter()
        for site in sites:
            value = str(site["arguments"].get(slot) or "")
            if not value:
                continue
            found = CONST.match(value)
            if found:
                constants[int(found.group(1), 16)] += 1
            else:
                shapes[re.sub(r"0x[0-9A-Fa-f]+", "N", value)] += 1
        if constants or shapes:
            out[slot] = {"constants": constants, "shapes": shapes}
    return out


def describe(slot: str, data: dict) -> str:
    """One line saying what this argument looks like across every caller."""
    constants, shapes = data["constants"], data["shapes"]
    total = sum(constants.values()) + sum(shapes.values())
    if not constants:
        return f"{slot}: never a literal ({total} sites)"
    values = sorted(constants)
    literal = sum(constants.values())
    span = f"0x{values[0]:X}..0x{values[-1]:X}" if len(values) > 1 \
        else f"0x{values[0]:X}"
    note = ""
    if len(values) == 1:
        note = "  ALWAYS the same value"
    elif values[-1] < 0x20 and len(values) <= 8:
        note = "  a small set -- looks like a selector or index"
    elif len(values) > 32:
        note = "  many distinct literals -- looks like an id or packed value"
    return (f"{slot}: {literal}/{total} sites pass a literal, "
            f"{len(values)} distinct, {span}{note}")


def report(records: list[dict], target: int, show_values: bool) -> int:
    sites = sites_for(records, target)
    if not sites:
        print(f"no call site reaches 0x{target:08X}")
        return 1
    direct = sum(1 for s in sites if s["direct"])
    callers = {s["caller"] for s in sites}
    print(f"0x{target:08X}: {len(sites)} call sites in {len(callers)} functions "
          f"({direct} direct, {len(sites) - direct} through a resolved pointer)")
    slots: collections.Counter = collections.Counter()
    for site in sites:
        if site["slot"]:
            slots[(site["slot"], site["basis"])] += 1
    for (name, basis), count in slots.most_common(6):
        print(f"  reached through {name} x{count} -- "
              f"{BASIS.get(basis, basis or 'unknown')}")
    if sites and direct == 0 and not any(s["basis"] == "same-global"
                                         for s in sites):
        print("  every edge here is INFERRED: no call site names this target")
    for slot, data in distribution(sites).items():
        print("  " + describe(slot, data))
        if show_values and data["constants"]:
            values = ", ".join(f"0x{v:X}({n})" for v, n
                               in data["constants"].most_common(24))
            print(f"      {values}")
        if show_values and data["shapes"]:
            for shape, count in data["shapes"].most_common(4):
                print(f"      {count:5d}x {shape}")
    return 0


def top(records: list[dict], limit: int) -> int:
    counts: collections.Counter = collections.Counter()
    for record in records:
        resolved = {row["at"]: row for row in record.get("dispatch", [])
                    if row.get("resolved")}
        for call in record["proven"]["calls"]:
            name = call.get("target")
            if isinstance(name, str) and name.startswith("0x"):
                counts[int(name, 16)] += 1
            elif call.get("at") in resolved:
                counts[int(resolved[call["at"]]["candidates"][0], 16)] += 1
    print(f"{'sites':>6}  target")
    for address, count in counts.most_common(limit):
        print(f"{count:6d}  0x{address:08X}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", nargs="?")
    parser.add_argument("--values", action="store_true")
    parser.add_argument("--top", type=int)
    args = parser.parse_args()

    records = load()
    if not records:
        print("no records; run tools/decode_loop.py first")
        return 1
    if args.top:
        return top(records, args.top)
    if not args.target:
        parser.error("give a target address, or --top N")
    return report(records, int(args.target, 16), args.values)


if __name__ == "__main__":
    raise SystemExit(main())
