#!/usr/bin/env python3
"""THE COMPLETE PICTURE: what every one of the duel's 174 opcodes does.

The question "which animation plays when" was recorded as undecodable. It was
not; the search had simply been static. engine/systems/card-animation.ts says:

    "NOT decoded ... which duel event starts which animation. The commands are
     all decoded, but no `jal` or pointer-table entry in the original ..."

There IS a pointer table. It is built at RUNTIME: F0x8009D310 assigns 51
constant function pointers into the duel's view object, and every animation the
duel plays is invoked as `view->unkNNN(...)` through it. Nothing `jal`s those
targets, which is why static entry-point detection never labelled them and the
bulk decompiler never emitted C for them. Resolving the slots turns every
opcode handler into a concrete list of animations.

This joins three sources and emits one row per opcode:
  * docs/research/card/cardgame-opcode-registry.json — all 174 opcodes with
    their enter/update dispatch callees (authority 2, cross-read against
    ~/ddw3/asm/dw2003/pro/cardgame.s, all 96 jal targets attributed);
  * exe-decomp/cardgame_c/ — 270 decompiled functions, for the call graph and
    for the vtable assignment itself;
  * an optional rig trace, to mark which opcodes a REAL duel actually issues.

Every opcode lands in exactly one category:
  ANIMATES  reaches at least one vtable animation primitive
  LOGIC     has callees, reaches no animation primitive — rules, not pictures
  NOOP      a convergence no-op: the dispatch arm falls straight to the shared
            exit and does nothing

Usage:
  cardduel_opcode_atlas.py [--trace TRACE] [--markdown OUT.md]
"""

import argparse
import glob
import json
import os
import re
import collections

C_DIR = "exe-decomp/cardgame_c"
REGISTRY = "docs/research/card/cardgame-opcode-registry.json"
ANIM_TS = "engine/systems/card-animation.ts"


def vtable():
    """slot -> function address, from the runtime assignment in the decompiled C."""
    binds = {}
    for p in glob.glob(f"{C_DIR}/*.c"):
        s = open(p, encoding="utf-8", errors="replace").read()
        for slot, addr in re.findall(
                r"->\s*(unk[0-9A-Fa-f]+)\s*=\s*(0x8[0-9A-Fa-f]{7})\s*;", s):
            # normalised WITHOUT the 0x prefix, to match known_names() keys
            binds[slot] = addr.lower()[2:]
    return binds


def callgraph():
    slots, direct = {}, {}
    for p in glob.glob(f"{C_DIR}/*.c"):
        fn = os.path.basename(p)[:-2]
        s = open(p, encoding="utf-8", errors="replace").read()
        slots[fn] = re.findall(r"->\s*(unk[0-9A-Fa-f]+)\s*\(", s)
        direct[fn] = re.findall(r"\b(F0x[0-9a-f]{8})\s*\(", s)
    return slots, direct


def header_names(binds):
    """Names the decoded C header already gives the view's method slots.

    docs/research/card/cardduel.h annotates CardDuelView's function-pointer
    slots by offset (`/* 0xEA0 */ void (*setCounter)(...)`). Those offsets are
    the same slot numbers the runtime vtable assignment uses, so the header
    names resolve straight onto the addresses.
    """
    try:
        src = open("docs/research/card/cardduel.h", encoding="utf-8").read()
    except OSError:
        return {}
    out = {}
    for off, name in re.findall(
            r"/\*\s*(0x[0-9A-Fa-f]+)\s*\*/\s*void\s*\(\*(\w+)\)", src):
        slot = "unk" + off[2:].upper().lstrip("0").rjust(2, "0")
        for cand in (slot, "unk" + off[2:].upper()):
            if cand in binds:
                out[binds[cand]] = name
                break
    return out


def known_names():
    """Addresses the walker already has a decoded meaning for, from its own source."""
    try:
        src = open(ANIM_TS, encoding="utf-8", errors="replace").read()
    except OSError:
        return {}
    names = {}
    # Each command is documented as `/** 0x8009C9A0: ... */ export function foo`.
    # Walk to each exported function and take every address named in the doc
    # comment immediately above it.
    for m in re.finditer(r"export function (\w+)", src):
        head = src[max(0, m.start() - 700):m.start()]
        cut = head.rfind("/**")
        if cut < 0:
            continue
        for addr in re.findall(r"0x([0-9A-Fa-f]{8})", head[cut:]):
            names.setdefault(addr.lower(), m.group(1))
    return names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trace", action="append", default=[],
                    help="rig trace, to mark opcodes a real duel issues; repeatable")
    ap.add_argument("--markdown", help="write the full table here")
    a = ap.parse_args()

    binds = vtable()
    slots, direct = callgraph()
    names = known_names()
    # The C header's slot annotations are authority for names the walker's own
    # source has not got round to; they do not override a walker name.
    for addr, nm in header_names(binds).items():
        names.setdefault(addr, nm)

    def reach(fn, depth=8, seen=None):
        seen = seen or set()
        if fn in seen or depth < 0:
            return set()
        seen.add(fn)
        out = {binds[s] for s in slots.get(fn, []) if s in binds}
        for d in direct.get(fn, []):
            out |= reach(d, depth - 1, seen)
        return out

    # NOTE ON COVERAGE. The classification below is STATIC — it holds for all
    # 174 opcodes whether or not any capture ever issued them. Traces only mark
    # which ones a real duel was observed to reach: the three captures on the
    # rig exercise 53 of 174 between them, so 121 opcodes are classified here
    # but have never been seen to fire. That is a limit on the observations,
    # not on the atlas.
    issued = collections.Counter()
    for path in a.trace:
        prev = None
        for line in open(path, encoding="utf-8", errors="replace"):
            p = line.split()
            if len(p) < 10 or not p[0].isdigit() or p[1] != "summary":
                continue
            mid = p[2:][7]
            if mid != "00" and mid != prev:
                issued[int(mid, 16)] += 1
            prev = mid

    reg = json.load(open(REGISTRY))["opcodes"]
    rows = []
    for k, e in reg.items():
        op = int(k, 16)
        prims, callees, noop_arms, arms = set(), [], 0, 0
        for arm in ("enter", "update"):
            d = e.get(arm) or {}
            if not d:
                continue
            arms += 1
            if d.get("is_convergence_noop"):
                noop_arms += 1
            for c in (d.get("callees") or []):
                callees.append(c)
                prims |= reach(c)
        cat = "ANIMATES" if prims else ("NOOP" if callees == [] else "LOGIC")
        rows.append({
            "op": op, "cat": cat,
            "prims": sorted(prims),
            "named": sorted({names[p] for p in prims if p in names}),
            "callees": sorted(set(callees)),
            "issued": issued.get(op, 0),
        })
    rows.sort(key=lambda r: r["op"])

    tally = collections.Counter(r["cat"] for r in rows)
    print(f"174 opcodes: " + "  ".join(f"{k}={v}" for k, v in tally.most_common()))
    print(f"total = {sum(tally.values())}")
    if issued:
        seen = [r for r in rows if r["issued"]]
        print(f"\nissued by the captured duel: {len(seen)} distinct, "
              f"{sum(r['issued'] for r in seen)} beats")
        for c in ("ANIMATES", "LOGIC", "NOOP"):
            n = [r for r in seen if r["cat"] == c]
            print(f"  {c:9s} {len(n):3d} distinct  "
                  f"{sum(r['issued'] for r in n):4d} beats")
    cov = len([r for r in rows if r["named"]])
    print(f"\nopcodes whose animations the walker already has names for: {cov}")

    if a.markdown:
        with open(a.markdown, "w") as f:
            f.write("# Card-duel opcode atlas\n\n")
            f.write("Generated by `tools/cardduel_opcode_atlas.py`. One row per "
                    "opcode. `prims` are animation routines resolved through the "
                    "runtime method table built by `F0x8009D310`.\n\n")
            f.write("| op | category | issued | animation primitives | named | callees |\n")
            f.write("|---|---|---|---|---|---|\n")
            for r in rows:
                f.write(f"| 0x{r['op']:02x} | {r['cat']} | {r['issued'] or ''} | "
                        f"{' '.join('0x'+p for p in r['prims'])} | "
                        f"{' '.join(r['named'])} | {' '.join(r['callees'])} |\n")
        print(f"\nwrote {a.markdown}")


if __name__ == "__main__":
    main()
