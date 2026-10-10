#!/usr/bin/env python3
"""Which OBJECT is on the receiving end of a call through a method slot.

tools/decode_dispatch.py matches a call to a stored function by slot OFFSET.
That is not an identity: two of this game's object classes install different
functions over the same +0x110..+0x168 range, so 5,827 of the object-slot call
sites stay unresolved and no amount of further slot matching will settle them.
The missing fact is the class of the pointer in the register.

This file recovers that class where the evidence carries it, and DECLINES
everywhere else. Three sources, strongest first:

  * `returned(0xNNNNNNNN)` -- the pointer is what a named call handed back, so
    the class is the class that call builds. This is an identity, not a guess.
    It exists only because tools/mips_decode.py now keeps $v0 across a call.
  * a global cell some function filled from such a call. The address identifies
    the cell exactly, so only writes to that same address can bind it.
  * the SET of slots one object is asked for. A single slot number is not an
    identity, and with eight known classes a set was not either -- graded by
    holding one slot out, it answered none of the cases whose answer we knew.
    With thirty-two it answers 318 and misses 19, against a control of 9%.
    What changed is the class list, not the idea.
  * a struct field some function filled from such a call. A field is named by
    OFFSET, which is the same weak key the slot matcher already has, so a field
    binding is used only when every binding of that offset inside the overlay
    agrees, and it is reported apart from the two strong sources. That was not
    enough on its own: two unrelated structs in one overlay both have a +0x14,
    and 264 sites called a slot their class does not carry. The object now has
    to vouch for the binding -- every OTHER slot it is asked for must belong to
    the class, which is evidence the back test does not use. That drops 151
    sites, all of them wrong, and keeps all 1,237 right ones. An object asked
    for exactly ONE slot has no other slot to vouch with; it is reported as
    `field-binding-alone` and carries every contradiction that is left. Read
    from the first word of a struct it is not reported at all, because every
    object has a +0x0 and unvouched it scored 13 right against 74 wrong.

TWO sources were tried and REJECTED by that back test, and are left out on
purpose. The second is the argument an installer sets up. Four classes are
installed not into a fresh object but into a PARAMETER: the caller owns the
thing and passes it in. Those four installers are called 276 times, and each
call looked like an identity -- whatever the caller handed over IS that class.
Typing the caller's argument that way scored 0 right against 12 wrong, against
a control of 9.9%. Every one of the twelve calls a slot near +0x28..+0x3C while
the installer's table sits at +0x1C..+0x2C or +0x70..+0x98. GUESS: one object
carries more than one table, and the installer names only its own, which is not
the one these calls read. That is not established. Do not rebuild this without
settling it.

The first rejected source: 2,151 calls read a function pointer out of a local, and no function
ever writes the local it reads, so the value must arrive through a pointer the
function hands out. 97 constructor calls do take the address of a local, which
made "the object lives in the frame" look right. Typing those calls that way
scores 45 right against 1,202 wrong -- worse than drawing a class at random.
The slots they read run +0x144, +0x14C, +0x154, +0x15C, +0x164, +0x16C: an
even stride of 8, which is an array being indexed, not an object being asked
for its method. Do not rebuild it without new evidence.

`--backtest` is the point of the file. It grades the typing against evidence the
typing did not use, and it prints the control beside the result, because a
scanner that answers everything scores well and teaches nothing.

Writing is the default, the same as tools/decode_dispatch.py: each record gains
a `receiver` list, one row per typed call, saying which class the object is,
which slot the call reads, which function that slot holds, and on what basis.
Without it the answer lives only in this terminal, and nothing downstream --
naming, the call graph, a later review -- can reach it.

The single largest source is the local a caller hands to a constructor. It only
became usable when `mips_decode.describe_object` started naming WHICH local a
call is made on: before that a plain function pointer read out of the frame and
a method slot of an object living in the frame both rendered `load(stack+0xN,
word)`. See handed_in() and frame_class().

Usage:
  tools/type_receivers.py                # write `receiver` into every record
  tools/type_receivers.py --report       # measure, write nothing
  tools/type_receivers.py --backtest     # grade it, with the control
  tools/type_receivers.py --classes      # the object classes it works from
"""

from __future__ import annotations

import argparse
import collections
import json
import random
import re
from pathlib import Path

if __package__ in (None, ""):
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.decode_loop import ROOT, STATE, record_path
from tools.decode_dispatch import FUNCTION_VALUE, THROUGH

RETURNED = re.compile(r"^returned\(0x([0-9A-Fa-f]{8})\)$")
# What a call THROUGH AN OBJECT SLOT handed back, which only the second decode
# pass knows. The instruction does not name that callee -- this typing does --
# so a value reached that way is never merged with `returned`, and every answer
# resting on one carries `-reached` in its basis and is graded on its own.
REACHED = re.compile(r"^reached\(0x([0-9A-Fa-f]{8})\)$")
FRAME_ADDRESS = re.compile(r"^stack([+-])0x([0-9A-Fa-f]+)$")
FIELD_BASE = re.compile(r"^load\((a[0-3]|other)\+0x(-?[0-9A-Fa-f]+), word\)$")
TABLE = 3           # three installed pointers make a method table, not a callback

# How far each source can be trusted, from the back test, measured PER SOURCE
# against the same cases with the class drawn at random. One pooled average
# hides a weak source behind a perfect one, so every written row carries the
# grade of the source that produced it and nothing downstream has to guess.
#   built-here            165 answers  100.0% right   random  7.3%
#   field-binding        1058 answers  100.0% right   random 10.2%
#   handed-in            1262 answers   95.9% right   random 13.0%
#   slot-set              630 answers   95.2% right   random  9.0%   (held out)
#   field-binding-alone   205 answers   81.0% right   random  8.8%
# `field-binding-alone` is the one source that cannot check itself: the object
# is asked for exactly one slot, so no second slot exists to vouch for the
# binding. It carries 39 of the 91 disagreements from 4% of the answers. It is
# kept because 81% is far above chance, and marked `weak` so that naming can
# require `exact` or `checked`.
CONFIDENCE = {
    "built-here": "exact",
    "field-binding": "exact",
    "field-binding-reached": "checked",
    "handed-in": "checked",
    "slot-set": "checked",
    "field-binding-alone": "weak",
    "field-binding-alone-reached": "weak",
}
ARGUMENTS = ("a0", "a1", "a2", "a3")


def load_records() -> dict:
    records = {}
    for path in STATE.glob("*.json"):
        row = json.loads(path.read_text())
        if row.get("status") == "decoded":
            records[(row["overlay"], row["address"])] = row
    return records


def classes(records: dict) -> dict[tuple[str, int], dict[int, int]]:
    """Every object class, as installer address -> {slot offset: function}.

    Only tables written into an object the constructor holds in a register. A
    table written to a named global is a static service table, which the slot
    matcher already resolves by address and which no receiver typing is needed
    for.
    """
    functions = {key[1] for key in records}
    # Keyed by OVERLAY and address, never by address alone. Overlays share the
    # same address range, so an address-only key merges two unrelated
    # constructors into one impossible object.
    found: dict[tuple[str, int], dict[int, int]] = {}
    for key, record in records.items():
        per_object: dict[str, dict[int, int]] = collections.defaultdict(dict)
        for entry in record["proven"]["fields"] + record["proven"]["globals"]:
            if entry["access"] != "write" or entry["object"] == "global":
                continue
            match = FUNCTION_VALUE.match(str(entry.get("value") or ""))
            if not match or int(match.group(1), 16) not in functions:
                continue
            per_object[entry["object"]][entry.get("offset") or 0] = \
                int(match.group(1), 16)
        for table in per_object.values():
            if len(table) >= TABLE:
                found[key] = table
    return found


def install_object(records: dict) -> dict[tuple[str, int], str]:
    """For each class, WHAT the installing function put the table into.

    26 classes are installed into an object a call handed back -- the ordinary
    constructor. Four are installed into a PARAMETER: the caller owns the thing
    and passes it in to be set up. Those four are called 276 times.
    """
    into: dict[tuple[str, int], str] = {}
    functions = {key[1] for key in records}
    for key, record in records.items():
        per_object: dict[str, set[int]] = collections.defaultdict(set)
        for entry in record["proven"]["fields"] + record["proven"]["globals"]:
            if entry["access"] != "write" or entry["object"] == "global":
                continue
            match = FUNCTION_VALUE.match(str(entry.get("value") or ""))
            if not match or int(match.group(1), 16) not in functions:
                continue
            per_object[entry["object"]].add(entry.get("offset") or 0)
        for obj, table in per_object.items():
            if len(table) >= TABLE:
                into[key] = obj
    return into


def handed_in(records: dict, tables: dict, into: dict, same: dict) -> dict:
    """Which LOCAL a caller handed to a constructor, and so what class it is.

    The callee writes a method table into the parameter, so the local the
    caller passed there IS that class. This is the honest form of the frame
    idea the file header rejects: there a receiver was ASSUMED to be an object
    because it sat in the frame, here one call states which local it is.

    It only became usable when `mips_decode.describe_object` started naming
    which local a call is made on; before that every frame receiver rendered
    alike and the claim could not be matched to a later call.

    A local is not the object itself. In 1,248 of 1,262 cases the caller hands
    over an address 0x10 ABOVE the local it later calls on, so the class sits
    EMBEDDED at a fixed offset inside a bigger local, and every slot the caller
    names is that far above the class's own. `frame_class` recovers the gap
    from the two addresses and the slot is read at `slot - gap`. The gap comes
    from the addresses, never from the slot, so the back test still predicts.

    Returns record key -> the local's frame address -> class.
    """
    out: dict[tuple, dict[str, tuple]] = collections.defaultdict(dict)
    installers = {key: obj for key, obj in into.items()
                  if obj in ARGUMENTS and key in tables}
    for key, record in records.items():
        for call in record["proven"]["calls"]:
            target = str(call.get("target") or "")
            if not target.startswith("0x"):
                continue
            callee = _class_key(key[0], int(target, 16), set(installers))
            if callee is None:
                continue
            passed = str(call.get("arguments", {}).get(installers[callee]) or "")
            if FRAME_ADDRESS.match(passed):
                out[key][passed] = same[callee]
    return dict(out)


def frame_class(site: dict, given: dict | None) -> tuple[tuple | None, int]:
    """The class of a local receiver, and how far into the local it sits.

    The window is 0x80. It is not doing any selecting: over the whole program
    no site has two candidate locals inside it, and the gaps that occur are
    0x10, 0x18, 0x30 and 0x48.
    """
    here = FRAME_ADDRESS.match(site["base"])
    if not here or not given:
        return None, 0
    at = int(here.group(2), 16) * (1 if here.group(1) == "+" else -1)
    fits = []
    for base, cls in given.get(site["key"], {}).items():
        found = FRAME_ADDRESS.match(base)
        offset = int(found.group(2), 16) * (1 if found.group(1) == "+" else -1)
        if 0 <= offset - at <= 0x80:
            fits.append((cls, offset - at))
    return fits[0] if len(fits) == 1 else (None, 0)


def canonical(tables: dict) -> dict:
    """Two constructors that install the identical table are one class.

    `fns` 0x8001EBF8 and 0x8001EBFC do this. Counting them as two classes makes
    every receiver they build look ambiguous when it is not.
    """
    by_shape: dict[tuple, tuple] = {}
    out = {}
    for key in sorted(tables):
        shape = tuple(sorted(tables[key].items()))
        out[key] = by_shape.setdefault(shape, key)
    return out


def _class_key(overlay: str, address: int, known: set) -> tuple | None:
    """Which constructor an address names, read from the calling overlay.

    An overlay sees its own code and the resident program, never another
    overlay -- they are never in memory together.
    """
    for candidate in ((overlay, address), ("fns", address), ("exe", address)):
        if candidate in known:
            return candidate
    return None


def bindings(records: dict, known: set,
             pattern: re.Pattern = RETURNED) -> tuple[dict, dict]:
    """Where a constructed object was put: global cells, and struct fields.

    Returns (global address -> {class}, (overlay, offset) -> {class}). Both keep
    a SET, so a cell or a field two different classes reach stays ambiguous and
    is declined rather than resolved to whichever was seen last.
    """
    cells: dict[int, set[int]] = collections.defaultdict(set)
    fields: dict[tuple[str, int], set[int]] = collections.defaultdict(set)
    for key, record in records.items():
        for entry in record["proven"]["fields"] + record["proven"]["globals"]:
            if entry["access"] != "write":
                continue
            match = pattern.match(str(entry.get("value") or ""))
            if not match:
                continue
            built = _class_key(key[0], int(match.group(1), 16), known)
            if built is None:
                continue
            offset = entry.get("offset") or 0
            if entry["object"] == "global" and entry.get("address"):
                cells[entry["address"] + offset].add(built)
            else:
                fields[(key[0], offset)].add(built)
    return cells, fields


def receivers(records: dict) -> list[dict]:
    """Every call through an object slot, with the expression it came from."""
    out = []
    for key, record in records.items():
        for call in record["proven"]["calls"]:
            if call.get("target") != "indirect":
                continue
            match = THROUGH.match(str(call.get("through") or ""))
            if not match:
                continue
            base = match.group(1)
            if base.startswith("global("):
                continue                  # an address, not an object
            digits = match.group(2)
            offset = -int(digits[1:], 16) if digits.startswith("-") \
                else int(digits, 16)
            out.append({"key": key, "at": call["at"], "base": base,
                        "offset": offset,
                        # A local. Only the source that names WHICH local was
                        # handed to a constructor may type one; the slot-set
                        # basis may not, because 2,151 of these read a plain
                        # function pointer out of the frame and their offsets
                        # are an array stride. See the file header.
                        "frame": base.startswith("stack")})
    return out


def instances(sites: list[dict]) -> dict[tuple, set[int]]:
    """Every slot each single object is asked for, keyed by where it came from."""
    out: dict[tuple, set[int]] = collections.defaultdict(set)
    for site in sites:
        out[(site["key"], site["base"])].add(site["offset"])
    return out


def in_scope(tables: dict, overlay: str) -> list:
    """The classes an overlay can reach: its own, and the resident program."""
    return [key for key in tables if key[0] in ("fns", "exe", overlay)]


def by_slot_set(site: dict, seen: dict, tables: dict, same: dict) -> tuple | None:
    """The one class that carries every slot this object is asked for."""
    if site.get("frame"):
        return None
    offsets = seen.get((site["key"], site["base"]))
    if not offsets or len(offsets) < 2:
        return None
    merged = {}
    for key in in_scope(tables, site["key"][0]):
        merged.setdefault(same[key], tables[key])
    fits = [key for key, table in merged.items() if offsets <= set(table)]
    return fits[0] if len(fits) == 1 else None


def _field_basis(site: dict, cls: tuple, offset: int, seen: dict | None,
                 tables: dict | None) -> str | None:
    """Whether a field binding survives the other slots of the same object.

    A field binding is keyed by OFFSET, and an offset is not an identity: two
    unrelated structs in one overlay both have a +0x14. The object itself says
    whether the binding is right, because a class has to carry every slot the
    object is asked for. This checks the OTHER slots and never the one being
    typed, so the back test still grades a prediction rather than its own input.

    Measured over the whole program: the check drops 151 sites and every one of
    them was wrong, and it keeps all 1,237 that were right. What is left over
    is `field-binding-alone`: an object asked for exactly one slot, where no
    other slot exists to check against. Those carried all 113 remaining wrong
    answers, so they are reported apart and a later naming pass may skip them.
    """
    if seen is None or tables is None:
        return "field-binding"
    rest = seen.get((site["key"], site["base"]), set()) - {site["offset"]}
    if not rest:
        # The first word of a struct is the weakest key there is -- every
        # object in the overlay has a +0x0. Unchecked it scored 13 right
        # against 74 wrong, which is the random control. It is kept only when
        # another slot can vouch for it.
        return None if offset == 0 else "field-binding-alone"
    return "field-binding" if rest <= set(tables[cls]) else None


def type_of(site: dict, cells: dict, fields: dict, same: dict,
            seen: dict | None = None, tables: dict | None = None,
            slot_set: bool = True,
            reached_fields: dict | None = None,
            given: dict | None = None) -> tuple[tuple | None, str]:
    """The class of this call's receiver, and how it was established."""
    if site.get("frame"):
        cls, shift = frame_class(site, given)
        if cls is None:
            return None, "declined"
        site["shift"] = shift
        return cls, "handed-in"
    for expression, tag in ((RETURNED, "built-here"), (REACHED, "built-here-reached")):
        match = expression.match(site["base"])
        if match:
            built = _class_key(site["key"][0], int(match.group(1), 16), set(same))
            if built is not None:
                return same[built], tag
    found = FIELD_BASE.match(site["base"])
    if found:
        digits = found.group(2)
        offset = -int(digits[1:], 16) if digits.startswith("-") \
            else int(digits, 16)
        for source, tag in ((fields, ""), (reached_fields or {}, "-reached")):
            bound = source.get((site["key"][0], offset))
            if not bound or len({same[b] for b in bound}) != 1:
                continue
            cls = same[next(iter(bound))]
            basis = _field_basis(site, cls, offset, seen, tables)
            if basis is not None:
                return cls, basis + tag
    if slot_set and seen is not None and tables is not None:
        found = by_slot_set(site, seen, tables, same)
        if found is not None:
            return found, "slot-set"
    return None, "declined"


def grade(sites: list[dict], tables: dict, same: dict,
          cells: dict, fields: dict, shuffle: bool = False,
          reached_fields: dict | None = None,
          given: dict | None = None) -> dict:
    """Does the class predict the slot the site actually calls?

    The test evidence is the OFFSET of the call, which no typing source above
    looks at. So a typed site is a prediction: the offset must be one the class
    installs. Under `shuffle` the class is drawn at random from the same
    distribution, which is the control -- if the real typing scores no better,
    the offset sets are simply too permissive to test anything.
    """
    pool = sorted({same[a] for a in tables})
    seen = instances(sites)
    inside = outside = 0
    per_basis: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0])
    for site in sites:
        # The slot-set basis is excluded here on purpose: it is built FROM the
        # offsets, so grading it against an offset would agree with itself.
        # `hold_one_out` is its grader instead.
        cls, basis = type_of(site, cells, fields, same, seen, tables,
                             slot_set=False, reached_fields=reached_fields,
                             given=given)
        if cls is None:
            continue
        if shuffle:
            cls = random.choice(pool)
        hit = site["offset"] - site.get("shift", 0) in tables[cls]
        inside += hit
        outside += not hit
        per_basis[basis][0 if hit else 1] += 1
    return {"inside": inside, "outside": outside, "per_basis": dict(per_basis)}


def hold_one_out(sites: list[dict], tables: dict, same: dict) -> dict:
    """Grade the slot-set basis on evidence it did not use.

    Testing it against the slots it was built from would agree with itself. So
    one slot is hidden, the class is chosen from the rest, and the class has to
    carry the slot it never saw.
    """
    seen = instances(sites)
    where = {}
    for site in sites:
        where.setdefault((site["key"], site["base"]), site["key"][0])
    right = wrong = declined = 0
    for instance, offsets in seen.items():
        if len(offsets) < 2:
            continue
        merged = {}
        for key in in_scope(tables, where[instance]):
            merged.setdefault(same[key], tables[key])
        for held in sorted(offsets):
            rest = offsets - {held}
            fits = [k for k, table in merged.items() if rest <= set(table)]
            if len(fits) != 1:
                declined += 1
            elif held in merged[fits[0]]:
                right += 1
            else:
                wrong += 1
    return {"right": right, "wrong": wrong, "declined": declined}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--backtest", action="store_true")
    parser.add_argument("--classes", action="store_true")
    args = parser.parse_args()

    records = load_records()
    if not records:
        print("no records; run tools/decode_loop.py first")
        return 1
    tables = classes(records)
    same = canonical(tables)
    cells, fields = bindings(records, set(tables))
    _, reached_fields = bindings(records, set(tables), REACHED)
    given = handed_in(records, tables, install_object(records), same)
    sites = receivers(records)

    if args.classes:
        for key in sorted(tables):
            if same[key] != key:
                print(f"{key[0]:9s} 0x{key[1]:08X}  same table as "
                      f"{same[key][0]} 0x{same[key][1]:08X}")
                continue
            offsets = sorted(tables[key])
            print(f"{key[0]:9s} 0x{key[1]:08X}  {len(offsets):2d} slots  "
                  f"+0x{offsets[0]:X}..+0x{offsets[-1]:X}")
        return 0

    seen = instances(sites)
    counts: collections.Counter = collections.Counter()
    for site in sites:
        counts[type_of(site, cells, fields, same, seen, tables,
                       reached_fields=reached_fields, given=given)[1]] += 1
    total = len(sites)
    print(f"calls through an object slot: {total}")
    for basis in sorted(counts, key=lambda b: -counts[b]):
        print(f"  {basis:22s} {counts[basis]:5d} "
              f"({counts[basis] / max(total, 1):.0%})")
    print(f"object classes: {len({same[a] for a in tables})}; "
          f"global cells bound: {len(cells)}; field bindings: {len(fields)}")

    if args.backtest:
        real = grade(sites, tables, same, cells, fields,
                     reached_fields=reached_fields, given=given)
        random.seed(11)
        control = grade(sites, tables, same, cells, fields, shuffle=True,
                        reached_fields=reached_fields, given=given)
        answered = real["inside"] + real["outside"]
        print("\nback test -- the class must predict the slot the site calls")
        print(f"  typed sites graded:      {answered}")
        print(f"  slot is in that class:   {real['inside']}")
        print(f"  slot is NOT:             {real['outside']}")
        if answered:
            print(f"  precision:               "
                  f"{real['inside'] / answered:.1%}")
        # Each source is graded against ITS OWN cases under the control, not
        # against one pooled average: a source that is wrong more often than
        # chance stays invisible when a perfect source is averaged in with it.
        print("  per source -- answers, share right, and the same cases"
              " with the class drawn at random:")
        for basis, (hit, miss) in sorted(real["per_basis"].items(),
                                         key=lambda kv: -sum(kv[1])):
            shown = hit + miss
            chit, cmiss = control["per_basis"].get(basis, (0, 0))
            print(f"    {basis:20s} {shown:5d} answers  "
                  f"{hit / max(shown, 1):6.1%} right   "
                  f"random {chit / max(chit + cmiss, 1):6.1%}")
        out = hold_one_out(sites, tables, same)
        total = out["right"] + out["wrong"]
        print(f"  the slot-set basis, graded by hiding one slot: "
              f"{out['right']} right, {out['wrong']} wrong, "
              f"{out['declined']} declined"
              + (f" ({out['right'] / total:.1%})" if total else ""))
        held = control["inside"] + control["outside"]
        print(f"  CONTROL, class drawn at random: "
              f"{control['inside']}/{held} = "
              f"{control['inside'] / max(held, 1):.1%}")
        return 0

    if args.report:
        return 0

    rows: dict[tuple[str, int], list[dict]] = collections.defaultdict(list)
    for site in sites:
        cls, basis = type_of(site, cells, fields, same, seen, tables,
                             reached_fields=reached_fields, given=given)
        if cls is None:
            continue
        # A class whose table does not carry this slot contradicts the typing,
        # so the row records the disagreement instead of inventing a target.
        shift = site.get("shift", 0)
        target = tables[cls].get(site["offset"] - shift)
        row = {
            "at": site["at"],
            "object": f"{cls[0]} 0x{cls[1]:08X}",
            "slot": f"+0x{site['offset']:X}",
            "basis": basis,
            "confidence": CONFIDENCE.get(basis, "weak"),
            "target": f"0x{target:08X}" if target is not None else None,
            "contradicted": target is None,
        }
        if shift:
            # The class is embedded this far inside the thing the call names,
            # so the slot the caller writes is that far above the class's own.
            row["embedded_at"] = f"+0x{shift:X}"
        rows[site["key"]].append(row)
    written = 0
    for key in {(r["overlay"], r["address"]) for r in records.values()}:
        record = records[key]
        record["receiver"] = rows.get(key, [])
        record_path(*key).write_text(json.dumps(record, indent=1))
        written += 1
    named = [r for v in rows.values() for r in v if not r["contradicted"]]
    grades = collections.Counter(r["confidence"] for r in named)
    print(f"{written} records updated in {STATE.relative_to(ROOT)}; "
          f"{len(named)} calls now name a target through a typed receiver.")
    print("  by how far the source can be trusted: "
          + ", ".join(f"{g} {grades[g]}" for g in ("exact", "checked", "weak")
                      if grades[g]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
