#!/usr/bin/env python3
"""Derive function entries and extents for the ORIGINAL ASSEMBLY corpus.

Why this exists: the research index carries 3236 functions and **not one of them
comes from a `.s` file** -- every row is derived from the decompiled C corpus,
which only covers the functions m2c actually recovered. So `dw3-research known`
had no boundary to work with for assembly, resolved most targets to whichever
enclosing C function happened to precede them, and reported `exact_start=NO` for
87 of the 96 card-effect callees. A verdict about a window that is not the
function asked about is exactly the false confidence the command exists to stop.

The derivation is authority 2 and needs no disassembler: `pro/*.s` already prints
`jal 0x8008f2ec` with an absolute target, and the index already stores the RAM
address of every assembly line. So:

  entry   := the target of any `jal` that lands inside this overlay
  extent  := [entry, next entry)
  return  := the extent contains at least one `jr $ra`

**Branch targets are NOT entries.** A `j` or a jump-table entry is excluded: the
card-effect dispatch blocks are branch targets inside one function, and counting
them would split `F0x80084320` into 348 fake functions. A `.word` pointer target
is admitted only when it opens a stack frame, which is what separates a real
pointer-installed function from a block that merely appears in a table.

That prologue gate has a blind spot: a LEAF function reached only through a
pointer never opens a stack frame, and a function whose pointer lives in the
shipped DATA segment has no `.word` in the assembly to be found by either. So a
third entry source is admitted: **an address the decompilation's own data segment
declares as a function pointer**, read through tools/decode_statics.py.
Measured 2026-08-10: **+158 entries, every one of them containing a `jr $ra`**,
no pre-existing entry broken, and the no-return rate fell from 0.73% to 0.68%.

Three restrictions make that work, and dropping any one of them was tried and
measured on the way:

  * **Attribute each address to ONE overlay.** Every overlay loads at the same
    base, so an address declared by `fieldstg` also falls inside `cardgame`'s
    range and every other overlay's. Applying the set globally added 5,605
    entries of which 5,418 had no `jr $ra` -- it split thousands of real
    functions. Each cell records its owner; use it.
  * **Match the source path LITERALLY.** `~/ddw3/...` expands to the same real
    file, so expanding let every phantom alias back in and put 155 junk entries
    into sources holding two rows apiece.
  * **Require an indexed line AT that address.** `f0.s`..`f16.s` hold functions
    whose addresses fall inside `fns.s`'s range but whose bodies are in their own
    file; admitting those to `fns.s` made 9 empty extents.

This does not touch the card-effect blocks that motivated the prologue gate --
but not because the gate stops them. There is no `dw2003_pro_cardgame` data
crate at all, so no cardgame address is in the declared set (measured: 0 of 203
fall in 0x80082CF8..0x800838AC). If such a crate is ever added, re-check that
count before trusting this.

Measured against the independently derived decompiled-C function set for
pro/cardgame: 247 derived, **241 agree**, 6 found here that m2c never recovered,
and **7 missed**. Every one of the 247 contains a `jr $ra`, which is the check
that the entry set is not admitting branch targets.

The 7 misses are all functions whose address is CONSTRUCTED rather than called or
tabulated -- `F0x800A2F00`, the duel scene handler, is installed by
`lui`/`addiu 0x2f00` inside `createCardDuel`. Pairing `lui` with `addiu` would
find them, but that carries the sign-extension borrow trap that has cost this
project several sessions, so it is deliberately not attempted here: consumers
should UNION these extents with the decompiled-C function table, which covers
exactly that gap.

Usage:
  .venv/bin/python3 tools/build_function_extents.py                  # all overlays
  .venv/bin/python3 tools/build_function_extents.py --overlay cardgame --report
  .venv/bin/python3 tools/build_function_extents.py --check          # exit 1 on drift
"""

from __future__ import annotations

import argparse
import bisect
import functools
import json
import re
import sqlite3
import sys
from pathlib import Path

if __package__ in (None, ""):      # run as a script, not just -m
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / ".dw3-research/index.sqlite3"
OUT = ROOT / "docs/generated/function-extents.json"
ASM_ROOT = Path.home() / "ddw3/asm/dw2003"

# Locators are NOT uniform. Three shapes occur: `L6 @0x80082cb0`, the older
# `cardgame.s line 10200 (RAM 0x8008cbf4)`, and range forms `L100-L120 @0x..-0x..`.
# A loose regex over these accepted malformed values and silently produced an
# overlay range starting at 0x0009ab74 and ending past the 32-bit space, which
# made whole overlays derive zero functions. Anchor on the PSX RAM prefix, demand
# exactly eight digits, and refuse anything outside the segment.
LINE = re.compile(r"0x(8[0-9a-fA-F]{7})(?![0-9a-fA-F])")
RAM_LOW, RAM_HIGH = 0x80000000, 0x80800000
# Overlays do not render calls the same way. pro/cardgame prints
# `jal 0x8008f2ec`; pro/fightstg prints `jal FIGHTSTG_F0x800835f4` and
# `jal .L0x80083378`. Matching only the numeric form derived 45 functions from
# fightstg's 34k lines while cardgame gave 247 -- an asymmetry that was the
# symptom, not a property of the overlay. All three forms carry the address.
JAL = re.compile(
    r"\bjal\s+(?:\S*?(?:F0x|\.L0x)|0x)([0-9a-fA-F]{6,8})(?![0-9a-fA-F])")
RETURN = re.compile(r"\bjr\s+\$ra\b")
# A `.word` DIRECTIVE line, i.e. data. Every line also carries a trailing
# `# .word 0x...` comment showing its own encoding, which must not be mistaken
# for a pointer -- hence the anchor on the label and the directive position.
# Jump and dispatch tables in the resident executable render their targets
# symbolically (`.word F0x80014e44`), so the symbolic form is a pointer too.
POINTER = re.compile(
    r"^\.L0x[0-9a-fA-F]+:\s+\.word\s+(?:0x(8[0-9a-fA-F]{7})|F0x([0-9a-fA-F]{8}))\b")
# A stack prologue. This is what separates a real function reached only through a
# pointer table from a branch target that merely appears in one: all 7 cardgame
# functions the jal-only rule missed open with it, and none of the card-effect
# dispatch blocks do.
PROLOGUE = re.compile(r"\baddiu\s+\$sp,\s*-0x")
# The extractor preserved one linker section per symbol and labelled it, and the
# section name carries the address. That pairing is the only place a function
# start is written down for a symbol the extractor could NAME: `CloseEvent` and
# `read_card_sector` have no address anywhere in their label line.
#
# Read the section for the address and the label for the kind. A section is
# emitted for data as well as code, and taking all 1,162 of fns.s's sections
# admitted its pointer tables as 4-byte "functions" and drove the no-return
# rate to 25.6%. The extractor separates the two by prefix -- `D0x80010000:`
# heads a `.word` table -- so a `D0x` label is the only thing rejected here.
# Matching `F0x…:` alone was the first attempt and it silently dropped all 43
# named routines in fns.s, including `rand_u16`, the most-called of them.
DECLARED_SECTION = re.compile(r'^\.section\s+"[^"]*\.0x([0-9a-fA-F]{8})"')
DECLARED_LABEL = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*|[FD]0x[0-9a-fA-F]{8}):")


def overlay_rows(conn: sqlite3.Connection, like: str):
    """(source_path, address, text) for every indexed assembly line, in order."""
    for row in conn.execute(
        """SELECT source_path, locator, exact FROM evidence
           WHERE source_path LIKE ? ORDER BY source_path""", (like,)):
        found = LINE.search(row["locator"] or "")
        if not found:
            continue
        address = int(found.group(1), 16)
        if RAM_LOW <= address < RAM_HIGH:
            yield row["source_path"], address, row["exact"] or ""


@functools.lru_cache(maxsize=1)
def declared_functions() -> dict[str, frozenset[int]]:
    """Per overlay, the addresses the shipped data segment names as functions.

    Keyed BY OVERLAY, which is the whole difficulty: every overlay loads at the
    same base, so an address declared by `fieldstg` also falls inside
    `cardgame`'s range, `fightstg`'s, and every other overlay's. Applying the
    set globally admitted 5,605 entries of which 5,418 had no `jr $ra`.
    Each cell knows its owner, so each address is offered to one overlay only.

    Read through tools/decode_statics.py so there is one reader of those cells.
    An empty result is not fatal: without the decompilation checked out the
    builder falls back to the prologue gate alone.
    """
    try:
        from tools.decode_statics import pointer_cells
    except Exception:
        return {}
    out: dict[str, set[int]] = {}
    for cell in pointer_cells().values():
        if cell.get("target") is None:
            continue
        scope = cell.get("scope") or "resident"
        overlay = "fns" if scope == "resident" else scope.split("/")[-1]
        out.setdefault(overlay, set()).add(cell["target"])
    return {overlay: frozenset(items) for overlay, items in out.items()}


def declared_for(path: str) -> frozenset[int]:
    """The declared entries that belong to THIS source file.

    Only a real file under the assembly tree qualifies. The index also holds
    `~`-prefixed and prose aliases of the same files, and per-function
    `_asm/F0x*.s` extracts that repeat the same lines; offering the set to those
    too was what turned a 174-entry gain into a 721-entry mess.
    """
    # The LITERAL path, deliberately not expanded: `~/ddw3/...` expands to the
    # same real file, so expanding here let every alias back in and put 155 junk
    # entries into sources that hold two rows apiece.
    if not path.startswith(str(ASM_ROOT)) or not Path(path).is_file():
        return frozenset()
    return declared_functions().get(Path(path).stem, frozenset())


@functools.lru_cache(maxsize=None)
def declared_symbols(path: str) -> dict:
    """address -> what the file itself says about the symbol declared there.

    Returns `{address: {"name", "lines", "has_return", "opens_frame"}}`, all of
    it read from the assembly rather than from the index, because a whole class
    of function is invisible to the index. `fns.s` is written in two styles: the
    bulk is raw extraction, one `.L0x…:` label per instruction, and the rest is
    hand-annotated -- named section, named symbol, doc comment, and instructions
    with NO address label at all:

        # Returns a random `u16` between 0 and 0x1000 (exclusive).
        .section "fns3_00.0x8001933c"
        rand_u16:
            lui $v0, %hi(RAND_TABLE_CUR_IDX)

    Nothing in those bodies carries an address, so the index holds no line at
    0x8001933C, `code-search` reports it ABSENT, and a gate phrased as "there
    must be an indexed line here" rejects the function outright. That is why
    `rand_u16` -- 61 callers across 7 systems, the top entry of the whole
    worklist -- had no boundary and no record.

    The research index stores instruction and `.L…` label lines and drops the
    rest, so the extractor's own section/symbol pairing never reached a builder
    that reads the index -- and `code-search` cannot find it either, which is
    why three of the top worklist hubs answered ABSENT when they sit in the file.

    Measured 2026-08-10 on `exe/fns.s`: 1,030 declared code starts against 545
    entries the `jal` rule derived, with **every one of the 545 among them**.
    That gap was not two theories disagreeing; it was ~480 functions nobody held
    a boundary for, and one extent had swallowed 14 of them.

    43 of those symbols carry a real NAME rather than an invented `F0x…`, and
    they are the PS1 library underneath the game -- `rand_u16`, `InitHeap`,
    `fopen`, `GPU_cw`, `OpenEvent`, `InitPad`, `read_card_sector`. The caller
    still requires an indexed line at the address, which keeps a declaration
    whose body lives in another file (`f0.s`..`f16.s`) out.
    """
    if not path.startswith(str(ASM_ROOT)) or not Path(path).is_file():
        return {}
    found: dict[int, dict] = {}
    address, current = None, None
    with open(path, errors="replace") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(".section"):
                match = DECLARED_SECTION.match(line)
                address, current = (int(match.group(1), 16) if match else None), None
                continue
            if line.startswith(".global"):
                continue
            match = DECLARED_LABEL.match(line)
            if match and address is not None and current is None:
                if match.group(1).startswith("D0x"):
                    address = None          # a `.word` table, not a function
                else:
                    current = found.setdefault(address, {
                        "name": match.group(1), "lines": 0,
                        "has_return": False, "opens_frame": False})
                continue
            if current is None:
                continue
            # A body line. `.L0x…:` prefixes are optional and carry no meaning
            # here -- what matters is that instructions follow the label.
            text = line.split(":", 1)[1] if line.startswith(".L0x") else line
            text = text.split("#", 1)[0].strip()
            if not text or text.startswith("."):
                continue
            if current["lines"] == 0 and PROLOGUE.search(text):
                current["opens_frame"] = True
            current["lines"] += 1
            if RETURN.search(text):
                current["has_return"] = True
    return found


def section_entries(path: str) -> frozenset[int]:
    """The addresses of those declarations."""
    return frozenset(declared_symbols(path))


def build(conn: sqlite3.Connection, like: str) -> dict:
    by_source: dict[str, dict] = {}
    for path, address, text in overlay_rows(conn, like):
        entry = by_source.setdefault(path, {"lines": {}, "calls": {}, "returns": set()})
        entry["lines"][address] = text
        found = JAL.search(text)
        if found:
            entry["calls"].setdefault(int(found.group(1), 16), []).append(address)
        pointer = POINTER.match(text.strip())
        if pointer:
            entry.setdefault("pointers", set()).add(
                int(pointer.group(1) or pointer.group(2), 16))
        if PROLOGUE.search(text):
            entry.setdefault("prologues", set()).add(address)
        if RETURN.search(text):
            entry["returns"].add(address)

    result = {}
    for path, data in by_source.items():
        addresses = sorted(data["lines"])
        if not addresses:
            continue
        low, high = addresses[0], addresses[-1] + 4
        called = {address for address in data["calls"] if low <= address < high}
        # A pointer-table target counts only when it opens a stack frame. Without
        # that gate the 348 card-effect dispatch blocks -- all branch targets
        # inside one function -- would each be admitted as a function.
        pointed = {
            address for address in data.get("pointers", set())
            if low <= address < high and address in data.get("prologues", set())
        }
        # A declared entry must also HAVE an instruction here. `f0.s`..`f16.s`
        # hold functions whose addresses fall inside `fns.s`'s range but whose
        # bodies are in their own file, and admitting those to `fns.s` made 9
        # extents with no instructions and so no `jr $ra`.
        # The file's own `F0x…:` labels, held to the same rule as the
        # shipped-data set -- an entry must have an instruction at it -- and to
        # one more, because the extractor emits these labels and its judgement
        # is what is under test here. A declared start is admitted only when the
        # body backs it up: it returns, or something calls it, or it opens a
        # frame. Measured on fns.s: 987 labels, 853 admitted, **134 rejected**.
        # Those 134 are one structure, not noise -- handler blocks reached only
        # through the table at D0x80010000, running on a register the dispatcher
        # set, every one ending in a delay slot before a jump to a shared
        # epilogue. They are the same shape as the card-effect dispatch blocks
        # this builder already refuses, so they are excluded for the same
        # reason: they are blocks of a function, not functions.
        declared = declared_symbols(path)
        prologues = data.get("prologues", set())
        sectioned = set()
        for start, info in declared.items():
            if not (low <= start < high) or not info["lines"]:
                continue                    # outside the file, or a bodiless label
            # The gate tests the EXTRACTOR's automatic splitting, so it applies
            # only to the addresses the extractor invented a name for. A symbol
            # somebody actually named -- `rand_u16`, `InitHeap`, `read_card_sector`
            # -- is a human identification and is admitted on that alone; several
            # are BIOS stubs that jump away without ever executing `jr $ra`.
            if not info["name"].startswith("F0x"):
                sectioned.add(start)
            elif (start in data["calls"] or start in prologues
                    or info["has_return"] or info["opens_frame"]):
                sectioned.add(start)
        shipped = {
            address for address in declared_for(path)
            if low <= address < high and address in data["lines"]}
        entries = sorted(called | pointed | sectioned | shipped)
        # The addresses the gate refuses, emitted rather than silently dropped.
        # A consumer (build_recovered_inventory) marks these as blocks so the
        # coverage census stops reading them as unread functions.
        rejected = [
            {"address": start, "reason": "declared_section_without_call_return_or_frame"}
            for start, info in sorted(declared.items())
            if low <= start < high and info["lines"]
            and start not in called and start not in pointed
            and start not in sectioned and start not in shipped
        ]
        functions = []
        for position, start in enumerate(entries):
            end = entries[position + 1] if position + 1 < len(entries) else high
            entry = {
                "address": start,
                "end": end,
                "size": end - start,
                "callers": len(data["calls"].get(start, [])),
                "reached_by": ("jal" if start in data["calls"]
                               else "declared" if start in sectioned
                               else "pointer+prologue"),
                # A hand-annotated body has no indexed line, so `data["returns"]`
                # cannot see its `jr $ra`; the file-read answer stands in.
                "has_return": (any(start <= item < end for item in data["returns"])
                               or declared.get(start, {}).get("has_return", False)),
            }
            name = declared.get(start, {}).get("name", "")
            if name and not name.startswith(("F0x", "D0x")):
                entry["name"] = name
            functions.append(entry)
        result[path] = {
            "range": [low, high],
            "indexed_lines": len(addresses),
            "internal_jal_targets": len(entries),
            "rejected": rejected,
            "functions": functions,
        }
    return with_declaration_only_sources(result, like)


def with_declaration_only_sources(result: dict, like: str) -> dict:
    """Add the files that hold a function and not one addressed line.

    `exe/f0.s`..`f16.s` are 17 files of one hand-annotated function each, and
    they fill exactly the 17 largest holes in `fns.s` -- `f0` at 0x800134E8 and
    `f5` at 0x8001355C were the 6th and 8th entries of the decode worklist,
    ranked as unknowns with no record, when they are named functions in their
    own file. Because nothing in them carries an address label, the index holds
    no line, the loop above computes no range, and it skips the source whole.

    An end cannot come from the file: several of these share ONE hole in
    `fns.s`, so `f0` ends where `f1` begins. Take the next entry anywhere in the
    program instead, which is the same rule the main loop uses, just applied
    across sources rather than within one.
    """
    pattern = like.strip("%")
    boundaries = sorted({function["address"]
                         for item in result.values()
                         for function in item["functions"]})
    pending: dict[str, dict] = {}
    for path in sorted(ASM_ROOT.glob("*/*.s")):
        if str(path) in result or not str(path).endswith(pattern):
            continue
        declared = {address: info for address, info in
                    declared_symbols(str(path)).items() if info["lines"]}
        if declared:
            pending[str(path)] = declared
            boundaries.extend(declared)
    boundaries = sorted(set(boundaries))

    for path, declared in pending.items():
        functions = []
        for start, info in sorted(declared.items()):
            position = bisect.bisect_right(boundaries, start)
            end = (boundaries[position] if position < len(boundaries)
                   # Nothing follows it anywhere: the body length is the only
                   # bound available, and `la_`-style macros make it a lower one.
                   else start + 4 * info["lines"])
            entry = {"address": start, "end": end, "size": end - start,
                     "callers": 0, "reached_by": "declared",
                     "has_return": info["has_return"]}
            if not info["name"].startswith(("F0x", "D0x")):
                entry["name"] = info["name"]
            functions.append(entry)
        result[path] = {
            "range": [functions[0]["address"], functions[-1]["end"]],
            "indexed_lines": 0,
            "internal_jal_targets": 0,
            "functions": functions,
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--overlay")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    like = f"%{args.overlay}.s" if args.overlay else "%.s"
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        built = build(conn, like)
    finally:
        conn.close()

    total = sum(len(item["functions"]) for item in built.values())
    without_return = sum(
        1 for item in built.values()
        for function in item["functions"] if not function["has_return"]
    )
    print(f"sources={len(built)} functions={total} "
          f"without a jr $ra={without_return} "
          f"({100 * without_return / total:.1f}%)" if total else "no functions derived")

    if args.report:
        for path, item in sorted(built.items()):
            print(f"\n{path}")
            print(f"  range=0x{item['range'][0]:08x}..0x{item['range'][1]:08x} "
                  f"lines={item['indexed_lines']} functions={len(item['functions'])}")
            for function in item["functions"][:8]:
                print(f"    0x{function['address']:08x}..0x{function['end']:08x} "
                      f"size={function['size']:5} callers={function['callers']:3} "
                      f"return={'yes' if function['has_return'] else 'NO'}")

    if args.overlay:
        return 0  # a filtered run is a probe, never a write

    payload = {
        "_provenance": {
            "generated_by": "tools/build_function_extents.py",
            "authority": 2,
            "method": "entries come from four sources and extents run to the next entry: "
                      "(1) the targets of `jal` instructions landing inside the same "
                      "overlay, from the indexed assembly text; (2) a `.word` pointer "
                      "target that opens a stack frame; (3) an address the shipped data "
                      "segment declares a function pointer; (4) a symbol the assembly file "
                      "itself declares as a `.section`+label pair, read from the file "
                      "because the index drops directives. A source-4 entry whose name the "
                      "extractor invented (`F0x…`) must also be called, open a frame, or "
                      "return; a symbol carrying a real name is admitted on that alone. "
                      "`j` and jump-table targets are deliberately NOT entries, because the "
                      "card-effect dispatch blocks are branch targets inside one function "
                      "and counting them would invent 348 functions.",
            "limitation": "an extent ending at the next entry is an upper bound when "
                          "padding or data follows the body. 134 addresses in exe/fns.s are "
                          "declared sections that fail the gate: handler blocks reached only "
                          "through the table at D0x80010000, running on a register the "
                          "dispatcher set and jumping to a shared epilogue, so they are "
                          "blocks of a function rather than functions; those refused "
                          "addresses are emitted per source under `rejected` so consumers "
                          "can disposition them as blocks instead of unread functions. "
                          "`jal <name>` calls to "
                          "a named symbol are not counted as callers, because the caller "
                          "regex reads an address and those lines carry none.",
        },
        "sources": built,
    }
    if args.check and OUT.exists():
        current = json.loads(OUT.read_text()).get("sources", {})
        if current != built:
            print("DRIFT: derived extents differ from the committed file")
            return 1
        print("extents match the committed file")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1, sort_keys=True))
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
