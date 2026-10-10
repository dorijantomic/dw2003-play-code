#!/usr/bin/env python3
"""Resolve calls made through a pointer, by finding who stored the pointer.

53% of the calls in this game name no target: the code loads a function address
out of an object or a global and jumps to it. That half of the call graph was
invisible, and it is the half that matters -- reading the two most-called
routines showed both are object constructors that install a table of methods
(`fns` 0x8001F648 writes eleven function addresses into slots +0x70..+0x98 of
its argument; `F0x800143DC` writes nine into +0x28..+0x4C).

So the two halves fit together. One function writes a function address into a
slot; another loads that slot and jumps. Matching them turns an indirect call
into a named target, with no decoding and no tokens.

What is proven and what is not:

  * That a call goes through slot +0x74 of some object is PROVEN -- the
    instructions say so, and phase 1 already recorded it.
  * WHICH function runs is inferred, because the slot alone does not say which
    kind of object is in the register. When several installers write different
    functions to the same slot the record lists them all and stays unresolved,
    the same rule the suggestion layer uses.

A pointer loaded from a named global is the strong case: the global address
identifies the slot exactly, so only writes to that same address can match.

And most of those never come from a store at all. The resident program's
service table is initialised DATA -- 823 call sites read the cell 0x8004BBD8
and no instruction anywhere writes it, because the linker already put
`F0x80018980` there. tools/decode_statics.py reads those cells, which is why
this phase went from ten answers to a few thousand. A cell is `static mut`, so
it says what the word holds at load; where a code store hits the same address
both answers are listed and the site stays unresolved.

Usage:
  tools/decode_dispatch.py                 # write `dispatch` into every record
  tools/decode_dispatch.py --report        # measure, write nothing
  tools/decode_dispatch.py --tables        # the installed method tables
"""

from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path

if __package__ in (None, ""):      # run as `tools/decode_dispatch.py`, not just -m
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.decode_loop import ROOT, STATE, record_path
from tools.decode_statics import pointer_cells

# A function address materialised as a literal reads as `const`, not `global`:
# `lui`+`ori` leaves a number, `lui`+`addiu`-with-a-symbol leaves an address.
# Only the second form was accepted, so 682 of the 854 installed pointers in
# the game were invisible -- including every behaviour routine an actor gets.
# The address must still be the entry of a decoded function, which is what
# keeps an ordinary number from being read as code.
FUNCTION_VALUE = re.compile(r"^(?:global|const)\(0x(8[0-9A-Fa-f]{7})\)$")
# Greedy, so the LAST `+0x…` wins and a nested base stays whole:
# `load(load(a0+0x0, word)+0x20, word)` splits into base and slot 0x20.
THROUGH = re.compile(r"^load\((.+)\+0x(-?[0-9A-Fa-f]+), \w+\)$")
GLOBAL_BASE = re.compile(r"^global\(0x([0-9A-Fa-f]{8})\)$")
# Three or more pointers into one object is a method table rather than a single
# stored callback. Both are used for matching; the count is reported so a reader
# can tell which kind of evidence a candidate rests on.
TABLE = 3


def slot_of(base: str, offset: int) -> tuple[str, int]:
    """The identity a write and a call must share to be the same slot.

    Two kinds, and only the first is an identity:

    * a pointer held in a named global is identified exactly, by address;
    * anything else is identified by OFFSET ALONE, which is not an identity at
      all -- every object and every table in the program numbers its slots from
      its own base, so `+0x84` names a slot in whichever of them is in the
      register.

    The second kind is sub-divided for reporting only. A base that is itself a
    load is a pointer held in a struct field, so the call is a second hop; a
    bare register is a pointer the caller already had. That distinction says
    where the pointer came from, NOT what it points at, so it may not decide
    which stores a site is allowed to match -- see `candidates_for`.
    """
    found = GLOBAL_BASE.match(base)
    if found:
        return ("global", int(found.group(1), 16) + offset)
    if base.startswith("stack"):
        # A local is not a slot of anything shared. Calling it one matched 314
        # calls through a local at +0x9C, and 266 at +0xA4, against the method
        # tables of real objects that number a slot the same way. The base now
        # names WHICH local, so the prefix test replaces the exact one.
        return ("frame", offset)
    if base.startswith("load("):
        return ("table-slot", offset)
    return ("slot", offset)


def candidates_for(stores: dict, identity: tuple[str, int]) -> list[dict]:
    """Every store a call site with this identity could be reaching.

    An absolute address matches only itself. An offset matches BOTH buckets:
    treating `table-slot` as its own namespace assumed that a pointer held in a
    struct field points at a shared table, and it can equally point at an
    object whose constructor writes the same offsets. That assumption resolved
    189 sites to `fns` 0x8003224C and 0x8003227C -- the top two entries of the
    whole worklist -- while `fns` 0x8001F648 writes different functions to the
    very same +0x80 and +0x84 of the objects it builds. Unioning the buckets
    costs 304 of 7,518 answers and leaves the 6,991 matched by address intact.
    """
    kind, key = identity
    if kind == "global":
        return stores.get(identity, [])
    if kind == "frame":
        return []                        # nobody installs a table in your frame
    other = "slot" if kind == "table-slot" else "table-slot"
    return stores.get(identity, []) + stores.get((other, key), [])


def installed(records: dict, functions: set[int],
              statics: dict[int, dict] | None = None) -> dict:
    """Every function address a slot holds, and where it came from.

    Two sources, and the second is the larger one:

    * a `sw` that stores a function address -- the object constructors;
    * a word the shipped image already holds. The resident service table is
      never written by code, so matching stores alone answered 10 of its 8,026
      call sites.
    """
    out: dict[tuple[str, int], list[dict]] = collections.defaultdict(list)
    for address, cell in (statics or {}).items():
        if cell["target"] is None:
            continue
        out[("global", address)].append(
            {"installer": f"shipped data {cell['source']}",
             "target": cell["target"], "object": "static", "static": True})
    for key, record in records.items():
        if record.get("status") != "decoded":
            continue
        # offset -> the row itself, so annotating the table annotates every
        # bucket the row was filed under. Keying by target instead meant a
        # global installer -- whose rows go to ("global", …) and ("table-slot",
        # …), never ("slot", …) -- was never annotated at all, and `--tables`
        # could not show `fns 0x8003086C`, the 37-pointer table that answers
        # 189 call sites.
        tables: dict[str, dict[int, dict]] = collections.defaultdict(dict)
        for entry in record["proven"]["fields"] + record["proven"]["globals"]:
            if entry["access"] != "write":
                continue
            found = FUNCTION_VALUE.match(str(entry.get("value") or ""))
            if not found or int(found.group(1), 16) not in functions:
                continue
            target = int(found.group(1), 16)
            offset = entry.get("offset") or 0
            row = {"installer": f"{key[0]} 0x{key[1]:08X}", "target": target,
                   "object": entry["object"]}
            if entry["object"] == "global" and entry.get("address") is not None:
                out[("global", entry["address"] + offset)].append(row)
                # The same write also fills slot `offset` of a shared table, so
                # a second-hop call that indexes any such table can reach it.
                out[("table-slot", offset)].append(row)
            else:
                out[("slot", offset)].append(row)
            tables[entry["object"]][offset] = row
        for table in tables.values():
            if len(table) >= TABLE:
                for row in table.values():
                    row["table_size"] = len(table)
    return out


def sites(records: dict) -> list[dict]:
    """Every call made through a pointer, with the slot it reads."""
    found = []
    for key, record in records.items():
        if record.get("status") != "decoded":
            continue
        for call in record["proven"]["calls"]:
            if call.get("target") != "indirect":
                continue
            match = THROUGH.match(str(call.get("through") or ""))
            if not match:
                continue
            offset = int(match.group(2), 16) if not match.group(2).startswith("-") \
                else -int(match.group(2)[1:], 16)
            found.append({"key": key, "at": call["at"], "base": match.group(1),
                          "offset": offset,
                          "identity": slot_of(match.group(1), offset)})
    return found


def resolve(records: dict, functions: set[int],
            statics: dict[int, dict] | None = None) -> dict:
    """Attach candidate targets to every indirect call site."""
    stores = installed(records, functions, statics)
    out: dict[tuple[str, int], list[dict]] = collections.defaultdict(list)
    for site in sites(records):
        rows = candidates_for(stores, site["identity"])
        targets = sorted({row["target"] for row in rows})
        kind = {"global": "same-global", "table-slot": "shared-table",
                "slot": "slot-only", "frame": "local-variable"}[
                    site["identity"][0]]
        found = {
            "at": site["at"],
            "slot": (f"0x{site['identity'][1]:08X}" if kind == "same-global"
                     else f"+0x{site['offset']:X}"),
            "through": site["base"],
            "basis": kind,
            "candidates": [f"0x{t:08X}" for t in targets],
            "installers": sorted({row["installer"] for row in rows})[:6],
            "resolved": len(targets) == 1,
        }
        # Which answers are the word the disc holds rather than a store. The
        # cell is writable, so this is the value at load, not for all time.
        image = sorted({row["target"] for row in rows if row.get("static")})
        if image:
            found["from_image"] = [f"0x{t:08X}" for t in image]
        out[site["key"]].append(found)
    return out


def report(records: dict, resolved: dict, functions: set[int],
           statics: dict[int, dict] | None = None) -> None:
    total = sum(len(v) for v in resolved.values())
    settled = sum(1 for rows in resolved.values() for r in rows if r["resolved"])
    named = sum(1 for rows in resolved.values() for r in rows if r["candidates"])
    strong = sum(1 for rows in resolved.values() for r in rows
                 if r["resolved"] and r["basis"] == "same-global")
    image = sum(1 for rows in resolved.values() for r in rows if r.get("from_image"))
    print(f"indirect call sites with a readable slot: {total}")
    print(f"  reach at least one stored function: {named} ({named / max(total,1):.0%})")
    print(f"  exactly one candidate (resolved):   {settled}")
    print(f"     of those, identified by address:  {strong}")
    print(f"     answered by the shipped data:     {image}")
    stores = installed(records, functions, statics)
    # One row is filed under several buckets, so count the rows, not the entries.
    tables = len({id(r) for rows in stores.values() for r in rows
                  if "table_size" in r})
    print(f"slots somebody stores a function into: {len(stores)} "
          f"({tables} of them part of a method table)")
    # The cells are writable, so the caveat has to stay measured rather than
    # asserted. A store seen on the same address puts a second candidate on
    # every site that reads it, and the site stops being resolved.
    both = sum(1 for rows in stores.values()
               if any(r.get("static") for r in rows)
               and any(not r.get("static") for r in rows))
    print(f"shipped cells an instruction also writes: {both} of "
          f"{len(statics or {})}")
    unresolved: dict[int, int] = collections.Counter()
    for rows in resolved.values():
        for row in rows:
            if row["basis"] == "same-global" and not row["candidates"]:
                unresolved[int(row["slot"], 16)] += 1
    overlay = sum(n for a, n in unresolved.items() if a >= 0x80080000)
    print(f"named-global sites still dark: {sum(unresolved.values())} over "
          f"{len(unresolved)} cells; {overlay} of them read a cell inside an "
          f"overlay, where the data segment is only partly extracted")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--tables", action="store_true")
    args = parser.parse_args()

    records = {}
    for path in STATE.glob("*.json"):
        row = json.loads(path.read_text())
        records[(row["overlay"], row["address"])] = row
    if not records:
        print("no records; run tools/decode_loop.py first")
        return 1
    functions = {key[1] for key in records}
    statics = pointer_cells()
    resolved = resolve(records, functions, statics)

    if args.tables:
        stores = installed(records, functions, statics)
        by_installer: dict[str, list] = collections.defaultdict(list)
        seen: set[int] = set()
        # A global installer files one row under both ("global", address) and
        # ("table-slot", offset). Take the global bucket first: its key is the
        # absolute address, which names the table instead of just indexing it.
        for identity, rows in sorted(stores.items(),
                                     key=lambda kv: kv[0][0] != "global"):
            for row in rows:
                if "table_size" not in row or id(row) in seen:
                    continue
                seen.add(id(row))
                by_installer[row["installer"]].append((identity[1], row["target"]))
        for installer, slots in sorted(by_installer.items(),
                                       key=lambda kv: -len(kv[1]))[:12]:
            joined = ", ".join(
                (f"0x{o:08X}->0x{t:08X}" if o >= 0x80000000
                 else f"+0x{o:X}->0x{t:08X}") for o, t in sorted(slots)[:6])
            print(f"{installer}  {len(slots):2d} slots  {joined}")
        return 0

    report(records, resolved, functions, statics)
    if args.report:
        return 0
    for key, record in records.items():
        record["dispatch"] = resolved.get(key, [])
        record_path(*key).write_text(json.dumps(record, indent=1))
    print(f"{len(records)} records updated in {STATE.relative_to(ROOT)}, zero tokens.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
