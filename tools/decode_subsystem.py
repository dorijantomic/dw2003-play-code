#!/usr/bin/env python3
"""Which part of the game a function belongs to, decided by who it talks to.

Naming a function from its own body scores 0.0 precision on this corpus. Naming
it from its NEIGHBOURS is a different question and a much easier one: a routine
that 41 card-battle functions call is card-battle's, and a routine that
card-battle, the field and the title screen all call is not gameplay code at
all -- it is the resident library underneath them.

So this reads the call graph the decoder already built, seeds it with the
systems the evidence ledger has established, and lets the labels spread. Two
directions, and they answer different questions:

  * DOWN, a hub from its callers. 61 functions call 0x8001933C and nothing is
    established about it. If those 61 all belong to one system, so does it.
  * UP, a caller from its hubs. Once the hub is named, every function that
    calls it gains a hint for free -- which is the whole point of naming hubs
    first.

Nothing here is evidence. A vote is a lead, exactly like decode_corpus's
`GUESS:` lines, and the report always prints the tally that produced it so a
reader can see how thin it is. Three things keep it honest:

  * Only claims narrow enough to be about one function seed a label. One live
    claim in this ledger spans 493 functions; seeding from it would paint half
    the program in a single colour.
  * Edges are weighted by how they were proven. A `jal` names its target. A
    pointer call resolved by absolute address is good. A pointer call resolved
    by offset alone is weak enough that it once put two phantom routines at the
    top of the worklist -- see tools/decode_dispatch.candidates_for.
  * SPREAD is reported next to every verdict. A hub used by many systems is not
    a badly-labelled gameplay routine, it is a service, and the report says so
    instead of picking whichever system happens to lead.

Usage:
  tools/decode_subsystem.py --hubs 25        # unestablished hubs, and who calls them
  tools/decode_subsystem.py --propagate      # every function a vote can label
  tools/decode_subsystem.py 0x8001933C       # one function, both directions
"""

from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path

if __package__ in (None, ""):      # run as `tools/decode_subsystem.py`
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.decode_audit import NARROW, call_graph, declared_names, described
from tools.decode_corpus import (LEDGER, build_corpus, function_ranges,
                                 load_records, path_of_overlay)

# What proved the edge, and how much a vote through it is worth. A `jal` names
# its target outright; the rest are inferences of decreasing strength, and the
# weakest was wrong often enough to cost 304 answers on 2026-08-10.
WEIGHT = {"direct": 4, "same-global": 3, "shared-table": 1, "slot-only": 1}
# Below this share of the vote the answer is a coin toss and is not printed.
MAJORITY = 0.6
# At or above this many systems voting, the function is used across the program
# and calling it "belongs to" the leader would be false.
SERVICE = 4


def seeds(records: dict, breadth_limit: int = NARROW) -> dict:
    """Every function a narrow ledger claim puts in a named system.

    Breadth is the guard. `decode_audit` measured ten claims anchored on more
    than a hundred functions each; a claim that wide records that the
    investigation passed through, not what any one function does.
    """
    ledger = json.loads(LEDGER.read_text())
    system_of = {claim["id"]: claim.get("system") for claim in ledger["claims"]}
    starts: dict[str, set[int]] = {}
    overlay_path = path_of_overlay()
    for (overlay, address), record in records.items():
        if "found_inside" in record and overlay in overlay_path:
            starts.setdefault(overlay_path[overlay], set()).add(address)
    corpus = build_corpus(ledger, function_ranges(starts))

    breadth: collections.Counter = collections.Counter()
    for anchor in corpus.values():
        for claim in anchor.claims:
            breadth[claim.id] += 1
    out: dict[tuple, collections.Counter] = {}
    for key, anchor in corpus.items():
        votes: collections.Counter = collections.Counter()
        for claim in anchor.claims:
            if breadth[claim.id] <= breadth_limit and system_of.get(claim.id):
                votes[system_of[claim.id]] += 1
        if votes:
            out[key] = votes

    # Most of this ledger reaches a function through its PROSE, not through an
    # evidence anchor: 96 called functions are reconstructed in a statement that
    # names their address and anchors nothing there. Seeding from anchors alone
    # threw those away and left the graph with 260 labels instead of 500+.
    by_address: dict[int, list] = collections.defaultdict(list)
    for overlay, address in records:
        by_address[address].append((overlay, address))
    for address, ids in described(breadth_limit).items():
        for key in by_address.get(address, []):
            votes = out.setdefault(key, collections.Counter())
            for claim_id in ids:
                if system_of.get(claim_id):
                    votes[system_of[claim_id]] += 1
    return {key: votes for key, votes in out.items() if votes}


def edges(records: dict) -> tuple[dict, dict]:
    """Caller -> callees and callee -> callers, each edge keyed by its basis."""
    out: dict[tuple, collections.Counter] = collections.defaultdict(
        collections.Counter)
    back: dict[int, collections.Counter] = collections.defaultdict(
        collections.Counter)
    for key, record in records.items():
        if record.get("status") != "decoded":
            continue
        for call in record["proven"]["calls"]:
            target = call.get("target")
            if isinstance(target, str) and target.startswith("0x"):
                out[key][(int(target, 16), "direct")] += 1
                back[int(target, 16)][(key, "direct")] += 1
        for row in record.get("dispatch", []):
            if not row.get("resolved"):
                continue
            target = int(row["candidates"][0], 16)
            out[key][(target, row["basis"])] += 1
            back[target][(key, row["basis"])] += 1
    return out, back


def tally(neighbours: collections.Counter, label: dict,
          by_address: dict) -> collections.Counter:
    """Weighted votes from labelled neighbours, one vote per neighbour.

    Counted per neighbouring FUNCTION, not per call site: a loop that calls the
    same routine forty times is one function's opinion, not forty.
    """
    votes: collections.Counter = collections.Counter()
    seen: set = set()
    for entry in neighbours:
        who, basis = entry
        keys = [who] if isinstance(who, tuple) else by_address.get(who, [])
        for key in keys:
            if (key, basis) in seen:
                continue
            seen.add((key, basis))
            for system, count in label.get(key, {}).items():
                votes[system] += WEIGHT.get(basis, 1) * min(count, 2)
    return votes


def verdict(votes: collections.Counter) -> tuple[str, float, int]:
    """The leading system, its share of the vote, and how many systems voted."""
    if not votes:
        return ("", 0.0, 0)
    total = sum(votes.values())
    system, top = votes.most_common(1)[0]
    return (system, top / total, len(votes))


def describe(votes: collections.Counter) -> str:
    system, share, spread = verdict(votes)
    if not system:
        return "no labelled neighbour"
    joined = ", ".join(f"{s} {n}" for s, n in votes.most_common(4))
    if spread >= SERVICE:
        return f"SERVICE, used by {spread} systems ({joined})"
    if share < MAJORITY:
        return f"split ({joined})"
    return f"{system} {share:.0%} ({joined})"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", nargs="?")
    parser.add_argument("--hubs", type=int)
    parser.add_argument("--propagate", action="store_true")
    parser.add_argument("--breadth", type=int, default=NARROW)
    parser.add_argument("--min-callers", type=int, default=4)
    args = parser.parse_args()

    records = load_records()
    if not records:
        print("no records; run tools/decode_loop.py first")
        return 1
    by_address: dict[int, list] = collections.defaultdict(list)
    for key in records:
        by_address[key[1]].append(key)

    label = seeds(records, args.breadth)
    forward, back = edges(records)
    callers, _, _ = call_graph(records)
    print(f"{len(label)} functions seeded from narrow claims; "
          f"{len(back)} functions are called by somebody.\n")

    if args.target:
        address = int(args.target, 16)
        print(f"0x{address:08X}")
        print(f"  from its {len(callers[address])} callers: "
              f"{describe(tally(back[address], label, by_address))}")
        out: collections.Counter = collections.Counter()
        for key in by_address.get(address, []):
            out += tally(forward[key], label, by_address)
        print(f"  from what it calls:  {describe(out)}")
        named = collections.Counter()
        for entry in back[address]:
            for system in label.get(entry[0], {}):
                named[system] += 1
        for system, count in named.most_common(8):
            print(f"      {count:4d} callers established as {system}")
        return 0

    if args.hubs:
        rows = []
        for address, who in callers.items():
            if len(who) < args.min_callers:
                continue
            if any(key in label for key in by_address.get(address, [])):
                continue                     # already established, not a gap
            votes = tally(back[address], label, by_address)
            if votes:
                rows.append((len(who), address, votes))
        rows.sort(key=lambda r: -r[0])
        names = declared_names()
        print(f"{'callers':>7}  {'function':<12}  {'name':<18}  what its callers are")
        for count, address, votes in rows[:args.hubs]:
            print(f"{count:7d}  0x{address:08X}  {names.get(address, '-'):<18}  "
                  f"{describe(votes)}")
        return 0

    if args.propagate:
        rows = []
        for address, who in callers.items():
            if any(key in label for key in by_address.get(address, [])):
                continue
            votes = tally(back[address], label, by_address)
            system, share, spread = verdict(votes)
            if system and share >= MAJORITY and spread < SERVICE:
                rows.append((len(who), address, system, share, votes))
        rows.sort(key=lambda r: -r[0])
        print(f"{len(rows)} unestablished functions a caller vote assigns to one "
              f"system at >= {MAJORITY:.0%}, no service spread.\n")
        print(f"{'callers':>7}  {'function':<12}  {'system':<22} share")
        for count, address, system, share, _ in rows:
            print(f"{count:7d}  0x{address:08X}  {system:<22} {share:.0%}")
        return 0

    parser.error("give an address, or --hubs N, or --propagate")


if __name__ == "__main__":
    raise SystemExit(main())
