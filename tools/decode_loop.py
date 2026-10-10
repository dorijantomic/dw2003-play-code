#!/usr/bin/env python3
"""Decode every queued function deterministically, at zero token cost.

This file used to run the Claude CLI twice per function and compare the replies.
That cost about 1,850 model runs for the 924-function queue, and on 2026-08-09 a
batch decoded 58 functions in three hours before it hit the account session
limit and halted.

Everything the model was asked for is written in the instructions, so rules read
it instead. tools/mips_decode.py derives the facts, tools/decode_shapes.py names
the shape, and this file is only the driver: queue, records, status.

Gone with the model path: the prompt, the two-pass agreement measure, the
credential breaker, the consecutive-failure halt, --jobs, --timeout and the stop
file. Every one of those existed to survive a slow, paid, unreliable service.

Usage:
  tools/decode_loop.py                  # decode every function in the program
  tools/decode_loop.py --limit 5        # smoke run
  tools/decode_loop.py --status         # progress
  tools/decode_loop.py --coverage       # where the analyzer fell short
"""

from __future__ import annotations

import argparse
import datetime
import functools
import json
import re
import sqlite3
import time
from pathlib import Path

if __package__ in (None, ""):      # run as `tools/decode_loop.py`, not just -m
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.decode_shapes import match_shape
from tools.mips_decode import decode_function
from tools.mips_parse import parse_line

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / ".dw3-research/index.sqlite3"
FINGERPRINTS = ROOT / "docs/generated/function-fingerprints.json"
STATE = ROOT / ".dw3-research/decode-static"
ADDRESS = re.compile(r"0x(8[0-9a-fA-F]{7})(?![0-9a-fA-F])")
TOOL_VERSION = 1


@functools.lru_cache(maxsize=1)
def fingerprints() -> dict:
    """The 3.3 MB fingerprint file, parsed once."""
    return json.loads(FINGERPRINTS.read_text())


@functools.lru_cache(maxsize=1)
def function_index() -> dict[tuple[str, int], tuple[str, dict]]:
    index: dict[tuple[str, int], tuple[str, dict]] = {}
    for path, items in fingerprints()["functions"].items():
        for item in items:
            index[(item["overlay"], item["address"])] = (path, item)
    return index


def record_path(overlay: str, address: int) -> Path:
    """One file per (overlay, address).

    The address alone is NOT unique: overlays share the same RAM range, so 35
    addresses in the queue of 924 name a different function in each of two
    overlays. Keying the file on the address alone silently overwrote 64 results.
    """
    return STATE / f"{overlay}-{address:08x}.json"


def load_done() -> set[tuple[str, int]]:
    """Targets that need no retry. An `error` record did NOT decode."""
    done: set[tuple[str, int]] = set()
    for path in STATE.glob("*.json"):
        try:
            row = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if row.get("status") == "error":
            continue
        if "overlay" in row and "address" in row:
            done.add((row["overlay"], row["address"]))
    return done


def load_targets(overlay: str | None, limit: int,
                 queue_only: bool = False) -> list[dict]:
    """Every function in the program, or only the old undecoded queue.

    The queue existed because decoding cost about 1,850 model runs and three
    hours, so it was worth guessing which functions were worth the money. It
    costs nothing now, and the filter was doing harm: it dropped 950 functions
    as "already decoded", of which only 137 rest on a claim anchored to five
    functions or fewer. The other 813 were excluded because some wide claim's
    evidence happens to pass through them -- one claim alone spans 493
    functions. Among the functions that filter hid is the most-called routine in
    the game, with 94 callers.
    """
    if queue_only:
        rows = list(fingerprints()["queue"])
    else:
        seen: set[tuple[str, int]] = set()
        rows = []
        for items in fingerprints()["functions"].values():
            for item in items:
                key = (item["overlay"], item["address"])
                if key not in seen:
                    seen.add(key)
                    rows.append({"overlay": item["overlay"],
                                 "address": item["address"],
                                 "shapes": item.get("shapes", []),
                                 # Carried through from the extents: the symbol
                                 # the assembly names, where there is one.
                                 "name": item.get("name")})
        rows.sort(key=lambda row: (row["overlay"], row["address"]))
    if overlay:
        rows = [row for row in rows if row["overlay"] == overlay]
    return rows[:limit]


def load_lines(conn: sqlite3.Connection) -> dict[str, dict[int, str]]:
    """Every indexed assembly line, keyed by source then address.

    Loaded in one pass. The per-function query this replaces scanned the whole
    evidence table 924 times and did not finish inside two minutes.
    """
    lines: dict[str, dict[int, str]] = {}
    for row in conn.execute("SELECT source_path, locator, exact FROM evidence"):
        found = ADDRESS.search(row["locator"] or "")
        if found:
            lines.setdefault(row["source_path"], {})[int(found.group(1), 16)] = \
                (row["exact"] or "").strip()
    return lines


@functools.lru_cache(maxsize=1)
def real_path_of_overlay() -> dict[str, str]:
    """The assembly file each overlay really lives in.

    Nine indexed "sources" claim to be `fns.s`: one is the file, the rest are
    ledger evidence `source` fields written as prose or with an unexpanded `~`,
    which the index holds as separate sources. An extent filed under one of
    those keys finds no lines, and `fns` 0x800143DC -- 90 direct callers -- was
    refused for exactly that reason, not because the assembly lacks it. The file
    that exists on disk wins; ties go to the one carrying the most functions.
    """
    best: dict[str, tuple[int, int, str]] = {}
    for path, items in fingerprints()["functions"].items():
        rank = (1 if Path(path).expanduser().is_file() else 0, len(items))
        for item in items:
            current = best.get(item["overlay"])
            if current is None or rank > current[:2]:
                best[item["overlay"]] = (*rank, path)
    return {overlay: row[2] for overlay, row in best.items()}


def function_body(sources: dict[str, dict[int, str]], overlay: str,
                  address: int) -> list[str]:
    """The function's instruction lines, in address order."""
    found = function_index().get((overlay, address))
    if found is None:
        raise KeyError(f"{overlay} 0x{address:08x} not in fingerprints")
    path, item = found
    source = sources.get(path) or sources.get(str(Path(path).expanduser()), {})
    if item["address"] not in source:
        # The extent is filed under a phantom source. Fall back to the file the
        # overlay is really in rather than reporting the assembly as missing.
        real = real_path_of_overlay().get(overlay)
        if real is not None:
            source = sources.get(real) or sources.get(
                str(Path(real).expanduser()), source)
    return [f"{at:08x}  {source[at]}" for at in sorted(source)
            if item["address"] <= at < item["end"]]


def data_words(lines: dict[int, str]) -> frozenset[int]:
    """Addresses this source's data holds as code pointers.

    A computed `jr $reg` jumps to one of them. The walk needs them to step past
    a dispatch; without them 32 functions stopped at their jump table.

    Read with the parser, not a pattern. A switch table is written
    `.word F0x8002cedc` as often as `.word 0x800843a0`, and a pattern that
    accepts only the bare-number form found NONE of them in fns.s.
    """
    found: set[int] = set()
    for at, text in lines.items():
        if ".word" not in text:
            continue
        insn = parse_line(f"{at:08x}  {text}")
        if insn is None or insn.mnemonic != ".word" or not insn.operands:
            continue
        value = insn.operands[0].value
        if value is None:
            value = insn.operands[0].symbol
        if value is not None and 0x80000000 <= value < 0x80800000:
            found.add(value)
    return frozenset(found)


def decode_one(target: dict, lines: list[str],
               jump_targets: frozenset[int] = frozenset(),
               reached: dict[int, int] | None = None) -> dict:
    """Decode one function. Never raises: a bad target becomes an error record."""
    record = {"overlay": target["overlay"], "address": target["address"],
              "shapes": target.get("shapes", []),
              "generated": datetime.datetime.now(datetime.UTC).isoformat(),
              "tool_version": TOOL_VERSION}
    if not lines:
        # A hand-annotated function has no `.L0x…:` labels, so the indexer --
        # which keys a line by the address in its label -- holds none of its
        # body. That is not a decode failure: the 47 such functions in fns.s
        # are the PS1 library stubs and they arrive already NAMED, which is
        # worth more than a mechanical reading of `j 0xA0`. Synthesising their
        # addresses by counting instructions was rejected: `la_` is a macro
        # that assembles to two, so the arithmetic would invent offsets.
        if target.get("name"):
            record["status"] = "named-only"
            record["name"] = target["name"]
            record["reason"] = ("declared and named in the assembly; its body "
                                "carries no address label, so the index holds "
                                "no line to decode")
            return record
        record["status"] = "error"
        record["reason"] = "no indexed instructions for this address"
        return record
    # You cannot decode a function whose first instruction you do not have.
    # Nine extents in the index carry a body that starts somewhere else: their
    # source path is written with an unexpanded `~`, which makes a second,
    # phantom copy of a real assembly file holding only ledger evidence rows.
    # Some of those rows quote PROSE, and decoding them produced field accesses
    # derived from an English sentence. An error record is the honest result.
    first = int(lines[0].split("  ", 1)[0], 16)
    if first != record["address"]:
        record["status"] = "error"
        record["reason"] = (f"the index has no instruction at this address; the "
                            f"first indexed line here is 0x{first:08X}, so this "
                            f"body is not this function")
        return record
    try:
        decoded = decode_function(lines, jump_targets, reached)
    except Exception as error:            # one bad target must not stop a batch
        record["status"] = "error"
        record["reason"] = f"{type(error).__name__}: {error}"
        return record
    record.update(decoded)
    record["shape"] = match_shape(decoded["proven"])
    record["status"] = "decoded"
    return record


def typed_targets() -> dict[str, dict[int, int]]:
    """Per overlay, the call sites receiver typing says reach a named function.

    Read BEFORE any decoding, because a re-decode rewrites each record from
    scratch and drops the `receiver` rows this is built from. A contradicted
    row is left out: it is the one place the typing states its own answer is
    wrong.
    """
    found: dict[str, dict[int, int]] = {}
    for path in STATE.glob("*.json"):
        row = json.loads(path.read_text())
        for entry in row.get("receiver", []):
            if entry.get("contradicted") or not entry.get("target"):
                continue
            found.setdefault(row["overlay"], {})[entry["at"]] = \
                int(entry["target"], 16)
    return found


def decode_extent(target: dict, lines: list[str],
                  jump_targets: frozenset[int] = frozenset(),
                  reached: dict[int, int] | None = None) -> list[dict]:
    """Decode every function inside one extent.

    An extent is not always one function. 156 of the 924 hold two or more, and
    reading only the first reported the rest as an unreachable gap. Each one
    gets its own record, keyed on its own entry address, and carries
    `found_inside` naming the extent it was hiding in.
    """
    records = [decode_one(target, lines, jump_targets, reached)]
    while True:
        boundary = records[-1].get("coverage", {}).get("next_function")
        if boundary is None or len(records) > 16:
            return records
        rest = [line for line in lines
                if int(line.split("  ", 1)[0], 16) >= boundary]
        if not rest:
            return records
        found = decode_one({"overlay": target["overlay"], "address": boundary},
                           rest, jump_targets, reached)
        found["found_inside"] = f"0x{target['address']:08X}"
        records.append(found)


def stale_records(rows: dict[tuple[str, int], dict]) -> list[tuple[str, int]]:
    """Records the driver would no longer produce.

    Every function it writes is either a queue extent or is reached from one by
    following `next_function` through the records. Anything no chain reaches is
    left over: the driver rewrites records but never removes one, so a change
    that moves a function boundary orphans the old address. Two such files
    survived the boundary work on 2026-08-10 and made the count read 1339 where
    1337 were current.

    Reads records only -- no decoding, no database. It reports and never
    deletes: removing a file is the operator's call, not the tool's.
    """
    live: set[tuple[str, int]] = set()
    for key in {(t["overlay"], t["address"]) for t in load_targets(None, 1_000_000)}:
        while key in rows and key not in live:
            live.add(key)
            boundary = rows[key].get("coverage", {}).get("next_function")
            if boundary is None:
                break
            key = (key[0], boundary)
    return sorted(key for key in rows if key not in live)


def report(rows: list[dict], detailed: bool) -> int:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.get("status", "?")] = counts.get(row.get("status", "?"), 0) + 1
    decoded = [r for r in rows if r.get("status") == "decoded"]
    print(f"records={len(rows)} "
          + " ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    stale = stale_records({(r["overlay"], r["address"]): r for r in rows
                           if "overlay" in r and "address" in r})
    if stale:
        print(f"stale: {len(stale)} record(s) left over from an earlier run, "
              f"not deleted. Move or remove them yourself:")
        for overlay, address in stale[:10]:
            print(f"  {record_path(overlay, address).relative_to(ROOT)}")
        if len(stale) > 10:
            print(f"  ...and {len(stale) - 10} more")
    if not decoded:
        return 0
    clean = sum(1 for r in decoded if not r["coverage"]["unmodelled"]
                and not r["coverage"]["unreached"])
    print(f"clean (no gap, no unknown instruction): {clean}/{len(decoded)} "
          f"({clean / len(decoded):.0%})")
    shapes: dict[str, int] = {}
    for row in decoded:
        name = row.get("shape", {}).get("rule", "?")
        shapes[name] = shapes.get(name, 0) + 1
    print("shapes: " + ", ".join(f"{k}={v}" for k, v in
                                 sorted(shapes.items(), key=lambda kv: -kv[1])))
    if detailed:
        gaps = sum(1 for r in decoded if r["coverage"]["unreached"])
        unknown = sum(1 for r in decoded if r["coverage"]["unmodelled"])
        capped = sum(1 for r in decoded if r["coverage"]["capped"])
        print(f"reachability gaps: {gaps}   unknown instruction: {unknown}   "
              f"loop-capped: {capped}")
        totals: dict[str, int] = {}
        for row in decoded:
            for key in ("fields", "globals", "hardware", "tables", "calls",
                        "conditions"):
                totals[key] = totals.get(key, 0) + len(row["proven"][key])
        print("facts: " + ", ".join(f"{k}={v}" for k, v in sorted(totals.items())))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0,
                        help="0 decodes the whole queue")
    parser.add_argument("--overlay")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--coverage", action="store_true")
    parser.add_argument("--force", action="store_true",
                        help="re-decode targets that already have a record")
    parser.add_argument("--queue-only", action="store_true",
                        help="only the old undecoded queue, not every function")
    parser.add_argument("--use-typed-targets", action="store_true",
                        help="second pass: let a call through an object slot "
                             "name its callee, from the `receiver` rows an "
                             "earlier tools/type_receivers.py run wrote")
    args = parser.parse_args()

    STATE.mkdir(parents=True, exist_ok=True)
    if args.status or args.coverage:
        return report([json.loads(p.read_text()) for p in STATE.glob("*.json")],
                      args.coverage)

    reached = typed_targets() if args.use_typed_targets else {}
    if args.use_typed_targets:
        print(f"typed call sites fed back: "
              f"{sum(len(v) for v in reached.values())} "
              f"over {len(reached)} overlays")
    done = set() if args.force else load_done()
    targets = [t for t in load_targets(args.overlay, 1_000_000, args.queue_only)
               if (t["overlay"], t["address"]) not in done]
    if args.limit:
        targets = targets[:args.limit]
    if not targets:
        print("nothing to do")
        return 0

    started = time.time()
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        sources = load_lines(conn)
    finally:
        conn.close()

    words = {path: data_words(lines) for path, lines in sources.items()}

    failed = written = extra = 0
    for target in targets:
        try:
            lines = function_body(sources, target["overlay"], target["address"])
            path = function_index()[(target["overlay"], target["address"])][0]
        except KeyError:
            lines, path = [], None        # decode_one turns this into an error
        for record in decode_extent(target, lines, words.get(path, frozenset()),
                                    reached.get(target["overlay"])):
            failed += record["status"] == "error"
            extra += "found_inside" in record
            written += 1
            record_path(record["overlay"], record["address"]).write_text(
                json.dumps(record, indent=1))
    print(f"{len(targets)} extents -> {written} functions decoded "
          f"({extra} found inside another extent) in {time.time() - started:.1f}s, "
          f"{failed} error(s). Results in {STATE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
