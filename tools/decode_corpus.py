#!/usr/bin/env python3
"""Phase 2: suggest what a queued function is, from work already decoded.

Phase 1 (tools/mips_decode.py) reports only what the instructions prove. This
file adds the `suggested` block: for a function nobody has decoded, it looks for
a function somebody HAS decoded that is built the same way, touches the same
data, or sits beside it in a dispatch table.

Everything here is a guess and is labelled `GUESS:`. Nothing here reads or
changes the `proven` block, so a wrong suggestion cannot corrupt a fact.

Three rules keep it from drifting away from the code:

  * A suggestion never joins the corpus. The corpus is only addresses carrying a
    live anchored claim in the evidence ledger, so guesses are never built on
    guesses.
  * Ties are never broken. When the twins carry claims that disagree, the record
    lists all of them and marks the suggestion unresolved. Two identical bodies
    are often NOT the same function -- FLIRT documents the same failure mode.
  * Rarity decides weight, not likeness. A skeleton shared by 88 functions says
    almost nothing; one shared by 2 says a lot. Ghidra BSim separates these two
    numbers and so does this file: `similarity` is how alike, `confidence` is how
    much that likeness is worth.

Usage:
  tools/decode_corpus.py                 # write `suggested` into every record
  tools/decode_corpus.py --report        # measure, write nothing
  tools/decode_corpus.py --function 0x8002cb2c   # show one function's suggestions
"""

from __future__ import annotations

import argparse
import bisect
import collections
import datetime
import json
import math
import re
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path

if __package__ in (None, ""):      # run as `tools/decode_corpus.py`, not just -m
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.decode_loop import (DB, ROOT, STATE, fingerprints, load_lines,
                               record_path)
from tools.mips_decode import decode_function
from tools.mips_parse import parse_line

LEDGER = ROOT / "docs/research/evidence/ledger.json"
ADDRESS = re.compile(r"0x(8[0-9a-fA-F]{7})(?![0-9a-fA-F])")
CORPUS_VERSION = 1

# A claim that is `contradicted` is not weak evidence, it is refuted evidence.
# 32 claims hold that status today and none of them may anchor a suggestion.
STATUS_WEIGHT = {"verified": 1.0, "partially_verified": 0.7, "candidate": 0.4}
LIVE = frozenset(STATUS_WEIGHT)

# A near twin differs by at most this fraction of the longer body, measured as
# instruction-level edit distance. One constant, and the measured distance is in
# every record, so it can be tuned against the cross-check corpus.
NEAR_TWIN_RATIO = 0.10
# Below this length every body looks like every other body: `jr $ra` plus a
# couple of moves. Rarity weighting scores them near zero anyway; excluding them
# keeps hundreds of worthless ties out of the records.
MIN_BODY = 6
# A tie wider than this is reported by count, not by listing every twin.
MAX_TWINS = 8
# Each derived step halves the weight, and nothing propagates past three.
HOP_DECAY = 0.5
MAX_HOPS = 3
# A suggestion this weak does not become an anchor for the next pass.
ANCHOR_FLOOR = 2.0


@dataclass(frozen=True)
class Claim:
    id: str
    status: str
    statement: str


@dataclass(frozen=True)
class Anchor:
    """What a function is believed to be, and how far that belief travelled.

    `hops` 0 means the evidence ledger says so. Anything above 0 was derived by
    an earlier pass of this file and is never a corpus member.
    """

    claims: tuple[Claim, ...]
    hops: int = 0


@dataclass(frozen=True)
class Body:
    overlay: str
    address: int
    skeleton: tuple[str, ...]
    loose: tuple[str, ...] = ()
    callees: frozenset = frozenset()      # resolved (overlay, address) keys
    reads: frozenset[int] = frozenset()
    writes: frozenset[int] = frozenset()

    @property
    def key(self) -> tuple[str, int]:
        return (self.overlay, self.address)

    def graded(self, grade: str) -> tuple[str, ...]:
        return self.skeleton if grade == "exact" else self.loose


@dataclass
class Stats:
    """Rarity across the whole program, computed once."""

    total: int = 0
    skeletons: collections.Counter = field(default_factory=collections.Counter)
    loose: collections.Counter = field(default_factory=collections.Counter)
    globals: collections.Counter = field(default_factory=collections.Counter)
    claims: collections.Counter = field(default_factory=collections.Counter)
    callers: collections.Counter = field(default_factory=collections.Counter)

    def idf(self, count: int) -> float:
        """Inverse document frequency: rare shared features weigh more."""
        return math.log(max(self.total, 1) / max(count, 1))

    def group(self, body: Body, grade: str) -> int:
        counter = self.skeletons if grade == "exact" else self.loose
        return counter[body.graded(grade)]


def measure(bodies: dict[tuple[str, int], Body],
            corpus: dict[tuple[str, int], Anchor] | None = None) -> Stats:
    stats = Stats(total=len(bodies))
    for anchor in (corpus or {}).values():
        for claim in anchor.claims:
            stats.claims[claim.id] += 1
    for body in bodies.values():
        stats.skeletons[body.skeleton] += 1
        stats.loose[body.loose] += 1
        for address in body.reads | body.writes:
            stats.globals[address] += 1
        for callee in body.callees:
            stats.callers[callee] += 1
    return stats


# --------------------------------------------------------------------------- #
# Normalisation
# --------------------------------------------------------------------------- #

def normalise(lines: list[str]) -> tuple[str, ...]:
    """One token per instruction, with the linker's work masked out.

    Masked: symbols, `%hi`/`%lo` addresses, call targets and branch labels --
    everything a relocation rewrites, which is what FLIRT masks too. Two copies
    of the same routine at different addresses must produce the same tokens.

    Kept: register names, memory displacements and immediates. Those are what
    the source wrote. Keeping them makes a skeleton twin mean "the same code
    modulo linked addresses" rather than "vaguely similar", and the near-twin
    pass exists to catch the cousins that differ only in a struct offset.
    """
    tokens: list[str] = []
    for line in lines:
        insn = parse_line(line)
        if insn is None:
            continue
        parts: list[str] = []
        for operand in insn.operands:
            if operand.kind == "reg":
                parts.append(f"${operand.reg}")
            elif operand.kind == "mem":
                parts.append(f"{operand.offset:#x}(${operand.base})")
            elif operand.kind == "imm":
                parts.append(f"{operand.value}")
            elif operand.kind == "label":
                parts.append("L")
            else:
                parts.append("@")
        tokens.append(f"{insn.mnemonic}|{','.join(parts)}")
    return tuple(tokens)


NUMBER = re.compile(r"(?<![\w$])(-?(?:0x[0-9a-fA-F]+|\d+))")


def loosen(skeleton: tuple[str, ...]) -> tuple[str, ...]:
    """The same tokens with every constant masked as well.

    Strict normalisation answers "the same code, relinked". Measured over the
    whole program it matches almost nothing: only 27 of the 924 queued functions
    share a strict skeleton with any other function, and none of those twins is
    anchored. Masking the constants too finds 152, at the cost of no longer
    distinguishing a routine that adds 4 from one that adds 8.

    Nothing is fudged to make the weaker grade look as good as the stronger one.
    Its rarity is counted over loose skeletons, and a loose group is always at
    least as large as the strict group inside it, so a loose match scores lower
    by construction rather than by a hand-tuned penalty.
    """
    return tuple(NUMBER.sub("#", token) for token in skeleton)


def edit_distance(left: tuple[str, ...], right: tuple[str, ...], cap: int) -> int:
    """Levenshtein distance, abandoned once every path exceeds `cap`.

    Returns `cap + 1` for "further apart than cap", which is all the caller
    needs and stops a 300-instruction pair costing 90,000 cells.
    """
    if abs(len(left) - len(right)) > cap:
        return cap + 1
    previous = list(range(len(right) + 1))
    for i, x in enumerate(left, 1):
        current = [i]
        best = i
        for j, y in enumerate(right, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1,
                               previous[j - 1] + (x != y)))
            best = min(best, current[-1])
        if best > cap:
            return cap + 1
        previous = current
    return previous[-1]


# --------------------------------------------------------------------------- #
# Corpus
# --------------------------------------------------------------------------- #

def function_ranges(extra: dict[str, set[int]] | None = None
                    ) -> dict[str, list[tuple[int, int, str]]]:
    """Per source file, the function extents in address order.

    An extent is not always one function: 413 of the 924 queued extents hold a
    second one, which phase 1 now finds and records separately. Any such entry
    subdivides its extent here too, so a body is one function and a claim lands
    on the function its evidence is actually inside.
    """
    ranges: dict[str, list[tuple[int, int, str]]] = {}
    for path, items in fingerprints()["functions"].items():
        rows: list[tuple[int, int, str]] = []
        for item in items:
            starts = sorted({item["address"]} |
                            {a for a in (extra or {}).get(path, ())
                             if item["address"] < a < item["end"]})
            bounds = starts[1:] + [item["end"]]
            rows.extend((start, bounds[n], item["overlay"])
                        for n, start in enumerate(starts))
        ranges[path] = sorted(rows)
    return ranges


def path_of_overlay() -> dict[str, str]:
    """The real assembly file for each overlay.

    NINE "source files" in the index claim to be `fns.s`. One is the file; the
    rest are ledger evidence `source` fields written as prose or with an
    unexpanded `~`, which the index holds as separate sources and the extent
    builder then invents functions across. A plain dict comprehension keeps
    whichever came last, and it kept a prose blob -- so every discovered
    function start was filed under a key with no extents, the real file's
    extents were never subdivided, and a claim anchored on the enclosing extent
    instead of the function its evidence quotes. Six claims recorded on
    2026-08-10 landed that way and none of the functions they describe counted
    as established.

    The file that exists on disk wins; ties go to the one carrying the most
    functions, because a phantom carries only the handful of addresses some
    evidence row happened to mention.
    """
    best: dict[str, tuple[int, int, str]] = {}
    for path, items in fingerprints()["functions"].items():
        real = 1 if Path(path).expanduser().is_file() else 0
        rank = (real, len(items))
        for item in items:
            current = best.get(item["overlay"])
            if current is None or rank > current[:2]:
                best[item["overlay"]] = (real, len(items), path)
    return {overlay: row[2] for overlay, row in best.items()}


def containing(ranges: list[tuple[int, int, str]], address: int) -> tuple[int, str] | None:
    index = bisect.bisect_right(ranges, (address, 1 << 62, "")) - 1
    if index < 0:
        return None
    start, end, overlay = ranges[index]
    return (start, overlay) if start <= address < end else None


def build_corpus(ledger: dict,
                 ranges: dict[str, list[tuple[int, int, str]]],
                 ) -> dict[tuple[str, int], Anchor]:
    """Functions carrying a live anchored claim. These are the only anchors.

    An evidence entry whose source is an indexed assembly file names its own
    overlay, which matters because 35 addresses name a different function in
    each of two overlays. Evidence from anywhere else can only be matched on the
    address, so it lands on every overlay holding that address.
    """
    evidence = {item["id"]: item for item in ledger.get("evidence", [])}
    found: dict[tuple[str, int], dict[str, Claim]] = {}
    for claim in ledger.get("claims", []):
        if claim.get("status") not in LIVE:
            continue
        entry = Claim(claim["id"], claim["status"], claim.get("statement", ""))
        for eid in claim.get("evidence", []):
            item = evidence.get(eid)
            if item is None:
                continue
            source = str(item.get("source", ""))
            paths = [p for p in ranges if source.endswith(p) or p.endswith(source)]
            for hit in ADDRESS.findall(str(item.get("locator", ""))):
                address = int(hit, 16)
                for path in (paths or ranges):
                    site = containing(ranges[path], address)
                    if site is not None:
                        found.setdefault((site[1], site[0]), {})[entry.id] = entry
    return {key: Anchor(tuple(claims.values()), 0) for key, claims in found.items()}


# --------------------------------------------------------------------------- #
# Scoring
# --------------------------------------------------------------------------- #

def status_weight(claims: tuple[Claim, ...]) -> float:
    return max((STATUS_WEIGHT.get(c.status, 0.0) for c in claims), default=0.0)


def claim_weight(claims: tuple[Claim, ...], stats: Stats) -> float:
    """What a claim is worth as an identification: status times its rarity.

    Measured on the real ledger, one claim -- `ice-dungeon-op13-launch-teleport`
    -- is anchored on 493 of the 950 corpus functions, and five more sit above
    350. Their evidence cites hundreds of addresses across the overlay, so
    carrying one says the investigation passed through this function, not what
    the function does. Rarity is already how this file weighs a shared feature;
    the same measure applied to the claim keeps a corpus-wide claim from
    outranking one anchored on two functions.
    """
    return max((STATUS_WEIGHT.get(c.status, 0.0) * stats.idf(stats.claims[c.id])
                for c in claims), default=0.0)


def brief(statement: str, limit: int = 150) -> str:
    """The claim's first sentence, so a record stays readable."""
    text = " ".join(statement.split())
    stop = text.find(". ")
    if 0 < stop < limit:
        text = text[:stop + 1]
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def twin_summary(twins: list[tuple[Body, Anchor]]) -> dict:
    """Shared fields for a body-matching suggestion, tie rule included."""
    claims: dict[str, Claim] = {}
    hops = 0
    for _, anchor in twins:
        hops = max(hops, anchor.hops)
        for claim in anchor.claims:
            claims[claim.id] = claim
    shown = sorted(twins, key=lambda pair: -status_weight(pair[1].claims))[:MAX_TWINS]
    # A tie is twins that DISAGREE. One twin carrying several claims is not a
    # disagreement -- claims describe a function from several angles, and
    # treating that as a tie discarded almost every usable suggestion when it
    # was first measured (14 of 336 survived).
    positions = {frozenset(c.id for c in anchor.claims) for _, anchor in twins}
    return {
        "twins": [{"overlay": body.overlay, "address": f"0x{body.address:08X}",
                   "claims": [c.id for c in anchor.claims],
                   "status": [c.status for c in anchor.claims]}
                  for body, anchor in shown],
        "twin_count": len(twins),
        "claims": sorted(claims),
        "unresolved": len(positions) != 1 or not claims,
        "hops": min(hops + 1, MAX_HOPS),
        "_claims": tuple(claims.values()),
    }


def describe(prefix: str, summary: dict, stats: Stats) -> str:
    """The sentence a reader sees. Always a guess, and always says how broad the
    claim it leans on is, because a claim anchored on 493 functions identifies
    none of them."""
    claims = summary["_claims"]
    if summary["unresolved"]:
        names = ", ".join(sorted(c.id for c in claims)) or "no claim"
        return (f"GUESS: {prefix}. The twins disagree ({names}), so this is a tie "
                f"and is left unresolved.")
    best = max(claims, key=lambda c: STATUS_WEIGHT.get(c.status, 0.0)
               * stats.idf(stats.claims[c.id]))
    breadth = stats.claims[best.id]
    span = f", itself anchored on {breadth} functions" if breadth > 1 else ""
    tail = ""
    if len(claims) > 1:
        rest = sorted(c.id for c in claims if c.id != best.id)
        shown = ", ".join(rest[:4])
        more = f" and {len(rest) - 4} more" if len(rest) > 4 else ""
        tail = f" It also carries {shown}{more}."
    return (f"GUESS: {prefix}, which {best.id} ({best.status}{span}) records as: "
            f"{brief(best.statement)}{tail}")


# --------------------------------------------------------------------------- #
# The four passes, strongest first
# --------------------------------------------------------------------------- #

def skeleton_pass(targets: dict[tuple[str, int], Body],
                  bodies: dict[tuple[str, int], Body],
                  anchors: dict[tuple[str, int], Anchor],
                  stats: Stats, grade: str = "exact") -> dict[tuple[str, int], dict]:
    """Identical normalised body to an anchored function.

    `grade` selects the normalisation: "exact" masks only what a relocation
    rewrites, "loose" masks the constants as well. See `loosen`.
    """
    grouped: dict[tuple[str, ...], list[tuple[str, int]]] = {}
    for key, anchor in anchors.items():
        body = bodies.get(key)
        if body is not None and len(body.skeleton) >= MIN_BODY:
            grouped.setdefault(body.graded(grade), []).append(key)

    out: dict[tuple[str, int], dict] = {}
    for key, body in targets.items():
        if len(body.skeleton) < MIN_BODY:
            continue
        twins = [(bodies[t], anchors[t]) for t in grouped.get(body.graded(grade), [])
                 if t != key]
        if not twins:
            continue
        summary = twin_summary(twins)
        shared_callees = any(twin.callees == body.callees for twin, _ in twins)
        rarity = stats.idf(stats.group(body, grade))
        # A long body that few functions share is the strongest signal available;
        # a short common one is worth almost nothing even at similarity 1.0.
        confidence = (rarity * math.log1p(len(body.skeleton))
                      * claim_weight(summary["_claims"], stats)
                      * HOP_DECAY ** (summary["hops"] - 1))
        # Masking call targets is what makes two different routines look alike.
        # Matching callees says the masked names agreed as well.
        if shared_callees:
            confidence *= 1.5
        wording = ("identical body" if grade == "exact"
                   else "identical body once the constants are masked")
        text = describe(
            f"{wording} to {twins[0][0].overlay} 0x{twins[0][0].address:08X} "
            f"({len(body.skeleton)} instructions"
            + (", same callees" if shared_callees else "") + ")", summary, stats)
        if grade == "loose" and not summary["unresolved"]:
            # Measured on the strongest match in the whole run: two 15-instruction
            # stage thunks alike in every instruction, differing only in the
            # address they load and one immediate. The SHAPE carries across; the
            # particular op, mode or target does not, because those are precisely
            # the constants that were masked to make the match.
            text += (" The constants differ, so this shares the twin's shape, "
                     "not necessarily what it acts on.")
        out[key] = finish(
            "skeleton-twin" if grade == "exact" else "skeleton-twin-loose",
            summary, 1.0, confidence, text,
            {"callees_match": shared_callees, "grade": grade})
    return out


def near_twin_pass(targets: dict[tuple[str, int], Body],
                   bodies: dict[tuple[str, int], Body],
                   anchors: dict[tuple[str, int], Anchor],
                   stats: Stats) -> dict[tuple[str, int], dict]:
    """Bodies within NEAR_TWIN_RATIO of each other by edit distance."""
    pool = [(bodies[key], anchor) for key, anchor in anchors.items()
            if key in bodies and len(bodies[key].skeleton) >= MIN_BODY]
    pool.sort(key=lambda pair: len(pair[0].skeleton))
    lengths = [len(body.skeleton) for body, _ in pool]

    out: dict[tuple[str, int], dict] = {}
    for key, body in targets.items():
        size = len(body.skeleton)
        if size < MIN_BODY:
            continue
        cap = int(size * NEAR_TWIN_RATIO)
        if cap < 1:
            continue
        # Only bodies whose length is already within the cap can be near twins.
        low = bisect.bisect_left(lengths, size - cap)
        high = bisect.bisect_right(lengths, size + cap)
        best: list[tuple[int, Body, Anchor]] = []
        for twin, anchor in pool[low:high]:
            if twin.key == key or twin.skeleton == body.skeleton:
                continue
            distance = edit_distance(body.skeleton, twin.skeleton, cap)
            if distance <= cap:
                best.append((distance, twin, anchor))
        if not best:
            continue
        closest = min(distance for distance, _, _ in best)
        best = [item for item in best if item[0] == closest]
        summary = twin_summary([(twin, anchor) for _, twin, anchor in best])
        longer = max(size, len(best[0][1].skeleton))
        similarity = 1.0 - closest / longer
        rarity = stats.idf(stats.skeletons[best[0][1].skeleton])
        confidence = (rarity * math.log1p(size) * similarity
                      * claim_weight(summary["_claims"], stats)
                      * HOP_DECAY ** (summary["hops"] - 1))
        out[key] = finish("near-twin", summary, similarity, confidence, describe(
            f"body differs from {best[0][1].overlay} 0x{best[0][1].address:08X} "
            f"by {closest} of {longer} instructions", summary, stats),
            {"distance": closest, "threshold": cap})
    return out


def shared_data_pass(targets: dict[tuple[str, int], Body],
                     bodies: dict[tuple[str, int], Body],
                     anchors: dict[tuple[str, int], Anchor],
                     stats: Stats) -> dict[tuple[str, int], dict]:
    """This function writes a global an anchored function reads, or the reverse.

    Direction is kept because it is the informative part: the writer produces
    what the reader consumes, and the record names both sides.
    """
    readers: dict[int, list[tuple[str, int]]] = {}
    writers: dict[int, list[tuple[str, int]]] = {}
    for key in anchors:
        body = bodies.get(key)
        if body is None:
            continue
        for address in body.reads:
            readers.setdefault(address, []).append(key)
        for address in body.writes:
            writers.setdefault(address, []).append(key)

    out: dict[tuple[str, int], dict] = {}
    for key, body in targets.items():
        partners: dict[tuple[str, int], list[tuple[int, str]]] = {}
        # `None` is an address the analyzer could not resolve. Two functions it
        # failed on share nothing; matching them there is matching on ignorance.
        for address in body.writes:
            for other in readers.get(address, []):
                if other != key and address is not None:
                    partners.setdefault(other, []).append((address, "reads"))
        for address in body.reads:
            for other in writers.get(address, []):
                if other != key and address is not None:
                    partners.setdefault(other, []).append((address, "writes"))
        if not partners:
            continue
        # Rarity again: a global touched by 300 functions identifies nobody.
        scored = {other: sum(stats.idf(stats.globals[a]) for a, _ in shared)
                  for other, shared in partners.items()}
        top = max(scored.values())
        chosen = [other for other, score in scored.items() if score == top]
        summary = twin_summary([(bodies[o], anchors[o]) for o in chosen])
        partner = bodies[chosen[0]]
        address, direction = partners[chosen[0]][0]
        union = (body.reads | body.writes) | (partner.reads | partner.writes)
        similarity = len(partners[chosen[0]]) / max(len(union), 1)
        confidence = (top * claim_weight(summary["_claims"], stats)
                      * HOP_DECAY ** (summary["hops"] - 1))
        out[key] = finish("shared-data", summary, similarity, confidence, describe(
            f"shares data at 0x{address:08X} with {partner.overlay} "
            f"0x{partner.address:08X}, which {direction} it", summary, stats),
            {"shared": [f"0x{a:08X}" for a, _ in sorted(partners[chosen[0]])],
             "direction": direction})
    return out


def position_pass(targets: dict[tuple[str, int], Body],
                  bodies: dict[tuple[str, int], Body],
                  anchors: dict[tuple[str, int], Anchor],
                  tables: dict[tuple[str, int], list[tuple[str, int]]],
                  stats: Stats) -> dict[tuple[str, int], dict]:
    """The address sits at index N of a dispatch table, so it is handler N.

    The position is proven by the table data, not guessed. Only the ROLE is a
    guess, and only when a sibling entry carries a claim -- so the text keeps
    the two apart.
    """
    out: dict[tuple[str, int], dict] = {}
    for key, body in targets.items():
        for (overlay, base), entries in tables.items():
            if key not in entries:
                continue
            index = entries.index(key)
            siblings = [(bodies[sib], anchors[sib]) for sib in entries
                        if sib != key and sib in anchors and sib in bodies]
            fact = (f"entry {index} of the {len(entries)}-entry table at "
                    f"0x{base:08X} (proven from the table data)")
            if not siblings:
                out[key] = finish("table-position",
                                  {"twins": [], "twin_count": 0, "claims": [],
                                   "unresolved": True, "hops": 1, "_claims": ()},
                                  None, 0.0,
                                  f"{fact}. No other entry carries a claim.",
                                  {"table": f"0x{base:08X}", "index": index,
                                   "entries": len(entries)})
                continue
            summary = twin_summary(siblings)
            confidence = (math.log1p(len(siblings))
                          * claim_weight(summary["_claims"], stats)
                          * HOP_DECAY ** (summary["hops"] - 1))
            text = describe(f"{fact}, and {len(siblings)} sibling entries are "
                            f"decoded", summary, stats)
            out[key] = finish("table-position", summary, None, confidence, text,
                              {"table": f"0x{base:08X}", "index": index,
                               "entries": len(entries)})
            break
    return out


def call_graph_pass(targets: dict[tuple[str, int], Body],
                    bodies: dict[tuple[str, int], Body],
                    anchors: dict[tuple[str, int], Anchor],
                    stats: Stats) -> dict[tuple[str, int], dict]:
    """Related to an anchored function through a call edge.

    This is the weakest of the passes and runs last, but it is the only one that
    reaches a function with a body like nothing else and no data in common.
    Measured on the 588 functions the other four passes left untouched: 179 are
    called BY an anchored function, 45 call one, and 165 share a callee with
    one -- 269 in total.

    A call edge places a function in a neighbourhood; it does not say what the
    function does, and the text says so. Rarity does the rest of the work: being
    called by a routine that calls two things is informative, being called by
    one that calls forty is not, and sharing a heavily used utility is worth
    nothing at all.
    """
    calls_into: dict[tuple[str, int], list[tuple[str, int]]] = {}
    for key, body in bodies.items():
        for callee in body.callees:
            calls_into.setdefault(callee, []).append(key)

    out: dict[tuple[str, int], dict] = {}
    for key, body in targets.items():
        options: list[tuple[float, str, list[tuple[str, int]], dict]] = []

        callers = [k for k in calls_into.get(key, []) if k in anchors]
        if callers:
            # Rarity of being called at all: one anchored caller out of one
            # caller is a strong pointer; one out of thirty is not.
            weight = stats.idf(len(calls_into.get(key, [])))
            options.append((weight, "called-by", callers, {}))

        calls = [k for k in body.callees if k in anchors]
        if calls:
            weight = max(stats.idf(stats.callers[k]) for k in calls)
            options.append((weight, "calls", calls, {}))

        siblings: dict[tuple[str, int], set] = {}
        for callee in body.callees:
            for other in calls_into.get(callee, []):
                if other != key and other in anchors:
                    siblings.setdefault(other, set()).add(callee)
        if siblings:
            scored = {other: sum(stats.idf(stats.callers[c]) for c in shared)
                      for other, shared in siblings.items()}
            top = max(scored.values())
            chosen = [o for o, score in scored.items() if score == top]
            union = body.callees | bodies[chosen[0]].callees
            options.append((top, "shared-callee", chosen,
                            {"shared_callees": len(siblings[chosen[0]]),
                             "similarity": len(siblings[chosen[0]]) / max(len(union), 1)}))

        if not options:
            continue
        weight, link, related, extra = max(options, key=lambda item: item[0])
        summary = twin_summary([(bodies[k], anchors[k]) for k in related
                                if k in bodies])
        if not summary["twins"]:
            continue
        confidence = (weight * claim_weight(summary["_claims"], stats)
                      * HOP_DECAY ** (summary["hops"] - 1))
        first = bodies[related[0]]
        wording = {
            "called-by": f"called by {first.overlay} 0x{first.address:08X}",
            "calls": f"calls {first.overlay} 0x{first.address:08X}",
            "shared-callee": (f"calls the same routine as {first.overlay} "
                              f"0x{first.address:08X}"),
        }[link]
        text = describe(wording, summary, stats)
        if not summary["unresolved"]:
            text += (" A call edge shows where this belongs, not what it does.")
        out[key] = finish("call-graph", summary, extra.pop("similarity", None),
                          confidence, text, {"link": link, **extra})
    return out


def finish(source: str, summary: dict, similarity: float | None,
           confidence: float, text: str, extra: dict) -> dict:
    row = {"source": source, "similarity": similarity,
           "confidence": round(confidence, 2), "hops": summary["hops"],
           "unresolved": summary["unresolved"], "claims": summary["claims"],
           "twins": summary["twins"], "twin_count": summary["twin_count"],
           "text": text}
    row.update(extra)
    row["_claims"] = summary["_claims"]
    return row


PASSES = ("skeleton-twin", "skeleton-twin-loose", "near-twin", "shared-data",
          "table-position", "call-graph")


def suggest(bodies: dict[tuple[str, int], Body],
            corpus: dict[tuple[str, int], Anchor],
            queue: set[tuple[str, int]],
            tables: dict[tuple[str, int], list[int]],
            ) -> dict[tuple[str, int], list[dict]]:
    """Run the four passes strongest first, promoting what each one settles.

    A function settled by an earlier pass becomes an anchor for the later ones
    at `hops + 1`. Passes never re-run, so a derived anchor can never feed the
    pass that produced it, and no derived anchor ever enters the corpus: the
    rarity weights come from `corpus` alone.
    """
    stats = measure(bodies, corpus)
    anchors = dict(corpus)
    out: dict[tuple[str, int], list[dict]] = {}

    for name in PASSES:
        targets = {key: bodies[key] for key in queue
                   if key in bodies and key not in anchors}
        if name in ("skeleton-twin", "skeleton-twin-loose"):
            found = skeleton_pass(targets, bodies, anchors, stats,
                                  "exact" if name == "skeleton-twin" else "loose")
        elif name == "near-twin":
            found = near_twin_pass(targets, bodies, anchors, stats)
        elif name == "shared-data":
            found = shared_data_pass(targets, bodies, anchors, stats)
        elif name == "table-position":
            found = position_pass(targets, bodies, anchors, tables, stats)
        else:
            found = call_graph_pass(targets, bodies, anchors, stats)
        for key, row in found.items():
            out.setdefault(key, []).append(row)
            if (not row["unresolved"] and row["confidence"] >= ANCHOR_FLOOR
                    and row["hops"] < MAX_HOPS):
                anchors[key] = Anchor(row["_claims"], row["hops"])
    for rows in out.values():
        rows.sort(key=lambda row: -row["confidence"])
        for row in rows:
            row.pop("_claims", None)
    return out


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #

MIN_TABLE = 3


def find_tables(sources: dict[str, dict[int, str]], overlay_of: dict[str, str],
                starts: set[tuple[str, int]],
                ) -> dict[tuple[str, int], list[tuple[str, int]]]:
    """Every run of `.word` entries that all point at the start of a function.

    Phase 1's `proven.tables` cannot supply this. It records the "base plus
    scaled index" arithmetic, which fires on data tables too: of the 70 bases it
    found, 17 are not word-aligned and the 9 that did resolve produced 210
    entries, NONE of which is a function. Reading the data itself is both
    stricter and simpler -- a run of pointers to function starts is a dispatch
    table, and nothing else in this program looks like one.

    An entry may name a function in the resident `fns` overlay rather than in
    the table's own overlay, so each entry resolves to its owning overlay.
    """
    tables: dict[tuple[str, int], list[tuple[str, int]]] = {}
    for path, lines in sources.items():
        overlay = overlay_of.get(path)
        if overlay is None:
            continue

        def resolve(value: int) -> tuple[str, int] | None:
            for candidate in ((overlay, value), ("fns", value)):
                if candidate in starts:
                    return candidate
            return None

        words: dict[int, tuple[str, int]] = {}
        for at, text in lines.items():
            insn = parse_line(f"{at:08x}  {text}")
            if insn is None or insn.mnemonic != ".word" or not insn.operands:
                continue
            value = insn.operands[0].value or insn.operands[0].symbol
            target = resolve(value) if value is not None else None
            if target is not None:
                words[at] = target

        run: list[int] = []
        for at in sorted(words):
            if run and at == run[-1] + 4:
                run.append(at)
                continue
            if len(run) >= MIN_TABLE:
                tables[(overlay, run[0])] = [words[a] for a in run]
            run = [at]
        if len(run) >= MIN_TABLE:
            tables[(overlay, run[0])] = [words[a] for a in run]
    return tables


def discover_starts(sources: dict[str, dict[int, str]],
                    ranges: dict[str, list[tuple[int, int, str]]],
                    records: dict[tuple[str, int], dict]) -> dict[str, set[int]]:
    """Second functions hiding inside extents nobody queued.

    Phase 1 splits the extents it decodes, but the anchored side has no records,
    so an anchored extent holding two functions would be compared as one body
    and match nothing a queued function looks like. Measured: leaving the corpus
    unsplit cost 84 suggestions.
    """
    found: dict[str, set[int]] = {}
    for path, rows in ranges.items():
        lines = sources.get(path, {})
        if not lines:
            continue
        order = sorted(lines)
        for start, end, overlay in rows:
            if (overlay, start) in records:
                continue
            low = bisect.bisect_left(order, start)
            high = bisect.bisect_left(order, end)
            at = start
            for _ in range(16):
                text = [f"{a:08x}  {lines[a]}" for a in order[low:high] if a >= at]
                if not text:
                    break
                try:
                    boundary = decode_function(text)["coverage"]["next_function"]
                except Exception:
                    break
                if boundary is None:
                    break
                found.setdefault(path, set()).add(boundary)
                at = boundary
    return found


def load_bodies(sources: dict[str, dict[int, str]],
                records: dict[tuple[str, int], dict],
                ranges: dict[str, list[tuple[int, int, str]]],
                ) -> tuple[dict[tuple[str, int], Body], dict[str, str], int]:
    """Every function's skeleton, the globals it touches, and who it calls.

    Queued functions take their globals from the phase 1 record. Anchored ones
    have no record -- they were never queued -- so they are decoded here, in
    memory, by the same analyzer. Nothing is written for them.

    Call targets come from each function's own decode. The fingerprint file
    lists them per EXTENT, which is wrong wherever an extent holds two
    functions, and 413 of them do.
    """
    starts = {(overlay, start)
              for rows in ranges.values() for start, _, overlay in rows}

    def resolve(overlay: str, address: int) -> tuple[str, int] | None:
        for candidate in ((overlay, address), ("fns", address)):
            if candidate in starts:
                return candidate
        return None

    bodies: dict[tuple[str, int], Body] = {}
    overlay_of: dict[str, str] = {}
    failed = 0
    for path, rows in ranges.items():
        lines = sources.get(path, {})
        if not lines:
            continue
        order = sorted(lines)
        for start, end, overlay in rows:
            overlay_of[path] = overlay
            key = (overlay, start)
            low = bisect.bisect_left(order, start)
            high = bisect.bisect_left(order, end)
            text = [f"{at:08x}  {lines[at]}" for at in order[low:high]]
            if not text:
                continue
            record = records.get(key)
            if record is None:
                try:
                    record = {"proven": decode_function(text)["proven"]}
                except Exception:            # an undecodable body is not fatal
                    failed += 1
                    record = {"proven": {"globals": [], "calls": []}}
            # A global the analyzer could not resolve is recorded with no
            # address. Keeping the None made every pair of functions holding one
            # look like they shared a global, and `shared-data` then crashed
            # formatting it -- the crash was the lucky part, because the same
            # None would otherwise have scored as a match between two functions
            # that have nothing in common but the analyzer's ignorance.
            reads = {g["address"] for g in record["proven"]["globals"]
                     if g["access"] == "read" and g.get("address") is not None}
            writes = {g["address"] for g in record["proven"]["globals"]
                      if g["access"] == "write" and g.get("address") is not None}
            skeleton = normalise(text)
            calls = set()
            for call in record["proven"]["calls"]:
                target = call.get("target", "")
                if isinstance(target, str) and target.startswith("0x"):
                    found = resolve(overlay, int(target, 16))
                    if found is not None:
                        calls.add(found)
            bodies[key] = Body(overlay, start, skeleton, loosen(skeleton),
                               frozenset(calls), frozenset(reads),
                               frozenset(writes))
    return bodies, overlay_of, failed


def load_records() -> dict[tuple[str, int], dict]:
    records: dict[tuple[str, int], dict] = {}
    for path in STATE.glob("*.json"):
        row = json.loads(path.read_text())
        if row.get("status") == "decoded":
            records[(row["overlay"], row["address"])] = row
    return records


def report(bodies: dict, corpus: dict, suggestions: dict, queue: set,
           failed: int) -> None:
    print(f"corpus: {len(corpus)} anchored functions of {len(bodies)}   "
          f"queue: {len(queue)}   undecodable bodies: {failed}")
    by_source: collections.Counter = collections.Counter()
    resolved = 0
    for rows in suggestions.values():
        for row in rows:
            by_source[row["source"]] += 1
        resolved += any(not row["unresolved"] for row in rows)
    print(f"functions with a suggestion: {len(suggestions)}/{len(queue)} "
          f"({len(suggestions) / max(len(queue), 1):.0%}), "
          f"of which {resolved} have at least one that is not a tie")
    print("by pass: " + ", ".join(f"{k}={v}" for k, v in by_source.most_common()))
    best = sorted(((row["confidence"], key, row)
                   for key, rows in suggestions.items() for row in rows
                   if not row["unresolved"]), key=lambda item: -item[0])[:5]
    for confidence, key, row in best:
        print(f"  {key[0]} 0x{key[1]:08X} c={confidence:5.1f} {row['text'][:120]}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", action="store_true",
                        help="measure and print, write nothing")
    parser.add_argument("--function", help="print one function's suggestions")
    args = parser.parse_args()

    started = time.time()
    records = load_records()
    if not records:
        print(f"no phase 1 records in {STATE.relative_to(ROOT)}; "
              f"run tools/decode_loop.py first")
        return 1
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        sources = load_lines(conn)
    finally:
        conn.close()

    starts_by_path: dict[str, set[int]] = {}
    for path in path_of_overlay().values():
        starts_by_path.setdefault(path, set())
    for (overlay, address), record in records.items():
        if "found_inside" in record:
            starts_by_path.setdefault(path_of_overlay()[overlay], set()).add(address)
    ranges = function_ranges(starts_by_path)
    for path, extra in discover_starts(sources, ranges, records).items():
        starts_by_path.setdefault(path, set()).update(extra)
    ranges = function_ranges(starts_by_path)
    bodies, overlay_of, failed = load_bodies(sources, records, ranges)
    corpus = build_corpus(json.loads(LEDGER.read_text()), ranges)
    # `key not in records` used to be safe because records covered only the
    # unanchored queue. Every function has a record now, so that test would
    # empty the corpus entirely.
    corpus = {key: anchor for key, anchor in corpus.items() if key in bodies}
    tables = find_tables(sources, overlay_of, set(bodies))
    print(f"dispatch tables read from the data: {len(tables)}, "
          f"{sum(len(entries) for entries in tables.values())} entries")
    suggestions = suggest(bodies, corpus, set(records), tables)

    if args.function:
        wanted = int(args.function, 16)
        for key, rows in sorted(suggestions.items()):
            if key[1] == wanted:
                print(f"{key[0]} 0x{key[1]:08X}")
                print(json.dumps(rows, indent=1))
        return 0

    report(bodies, corpus, suggestions, set(records), failed)
    if args.report:
        print(f"measured in {time.time() - started:.1f}s, nothing written")
        return 0

    stamp = datetime.datetime.now(datetime.UTC).isoformat()
    for key, record in records.items():
        record["suggested"] = suggestions.get(key, [])
        record["suggested_generated"] = stamp
        record["corpus_version"] = CORPUS_VERSION
        record_path(*key).write_text(json.dumps(record, indent=1))
    print(f"{len(records)} records updated in {time.time() - started:.1f}s, "
          f"zero tokens.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
