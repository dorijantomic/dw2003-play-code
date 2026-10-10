#!/usr/bin/env python3
"""What the disc's duel ACTUALLY does, beat by beat, versus what the walker does.

WHY THIS EXISTS. The question that matters about the card duel is not how fast
things move — it is WHICH animation plays WHEN. That question was never asked
mechanically. It is answerable, because both halves already exist in the repo:

  * the disc's real script — a rig trace logs the message id at +0x421 on every
    frame, so the exact sequence of beats a real duel issues can be recovered
    (tools/parse_cardduel_trace.py);
  * what each beat means — docs/research/card/cardgame-opcode-registry.json has
    all 174 opcodes with their enter/update callees, authority 2, cross-read
    against ~/ddw3/asm/dw2003/pro/cardgame.s, with every one of the 96 jal
    targets attributed.

This joins them and marks which opcodes `beatStarted()` in web/cardduel.js
actually has a case for. Everything else falls to its `default:` arm, which
calls syncSprites() — one generic "make the sprites match the model" in place
of whatever the disc's own callee does.

Usage:
  map_cardduel_opcodes.py TRACE [--registry PATH]
"""

import argparse
import collections
import json
import re

# The cases in beatStarted(), web/cardduel.js. Anything absent hits `default:`.
DISPATCHED = {0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa7, 0x98, 0x12}
SOURCE = "web/cardduel.js"


def dispatched_from_source(path=SOURCE):
    """Read the case labels out of beatStarted() so this cannot drift."""
    try:
        src = open(path, encoding="utf-8").read()
    except OSError:
        return DISPATCHED
    m = re.search(r"function beatStarted\(op\)\s*\{(.*?)\n  \}", src, re.S)
    if not m:
        return DISPATCHED
    return {int(h, 16) for h in re.findall(r"case 0x([0-9a-fA-F]+):", m.group(1))}


def disc_sequence(trace):
    """Every message id the duel issued, in order, from the trace's summary rows."""
    seq, prev = [], None
    for line in open(trace, encoding="utf-8", errors="replace"):
        parts = line.split()
        if len(parts) < 3 or not parts[0].isdigit() or parts[1] != "summary":
            continue
        # summary column order is the trace header's own: the 8th value after
        # the frame is msgid421.
        vals = parts[2:]
        if len(vals) < 8:
            continue
        mid = vals[7]
        if mid != "00" and mid != prev:
            seq.append((int(parts[0]), int(mid, 16)))
        prev = mid
    return seq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("trace")
    ap.add_argument("--registry",
                    default="docs/research/card/cardgame-opcode-registry.json")
    a = ap.parse_args()

    reg = json.load(open(a.registry))["opcodes"]
    dispatched = dispatched_from_source()
    seq = disc_sequence(a.trace)
    cnt = collections.Counter(op for _, op in seq)

    print(f"{'op':>5} {'issued':>6}  {'walker':<9} enter-callee(s)")
    print("-" * 72)
    for op, n in cnt.most_common():
        e = (reg.get(f"0x{op:02X}") or {}).get("enter") or {}
        callees = ",".join(e.get("callees") or []) or (
            "(convergence no-op)" if e.get("is_convergence_noop") else "-")
        print(f" 0x{op:02x} {n:6d}  "
              f"{'dispatch' if op in dispatched else 'DEFAULT':<9} {callees}")
    print("-" * 72)
    handled = sum(n for op, n in cnt.items() if op in dispatched)
    print(f"issued beats with a specific walker case: {handled} of {sum(cnt.values())}")
    print(f"distinct opcodes with a specific case:    "
          f"{len([o for o in cnt if o in dispatched])} of {len(cnt)}")
    missing = [o for o in cnt if o not in dispatched]
    print(f"\nfalling to default: "
          + " ".join(f"0x{o:02x}" for o in sorted(missing, key=lambda o: -cnt[o])))


if __name__ == "__main__":
    main()
