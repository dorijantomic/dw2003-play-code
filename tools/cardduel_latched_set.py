#!/usr/bin/env python3
"""Which opcodes the CAPTURED duel latches, and for how long.

WHY THIS EXISTS. "The disc issues 38 beats and we issue 30" is a pair of counts,
and counts hide which opcodes they mean: on 2026-08-27 the difference was ten,
not eight, because two of ours are opcodes the capture never dealt. This prints
the SET, so the comparison is a set difference and not arithmetic.

The latch is `duel+0x421`, the pending-opcode byte the dispatcher reads
(`CARD-LATCH-LOAD`, ~/ddw3/asm/dw2003/pro/cardgame.s:1459) and the shared exit
clears (cardgame.s:2187). The rig trace logs it in the `msgid421` column.

The other half of the comparison is printed by
`tools/verify_cardduel_program_beats.mjs` as "the set:".

Usage:
  python3 tools/cardduel_latched_set.py [--trace PATH] [--against "0x12 0x13 ..."]
"""
import argparse, collections

DEFAULT_TRACE = "/mnt/c/dw3-rig/dumps/cardgame_full_state1_trace.txt"
MSGID_COLUMN = 7          # frame summary ... msgpend2f4 msgid421 <- this one


def segments(path):
    """(opcode, first_frame, last_frame) for every run of a non-zero latch."""
    out, cur, start, prev = [], None, None, None
    for line in open(path, encoding="utf-8", errors="replace"):
        p = line.split()
        if len(p) < 10 or not p[0].isdigit() or p[1] != "summary":
            continue
        frame, mid = int(p[0]), p[2:][MSGID_COLUMN]
        if mid != cur:
            if cur not in (None, "00"):
                out.append((int(cur, 16), start, prev))
            cur, start = mid, frame
        prev = frame
    if cur not in (None, "00"):
        out.append((int(cur, 16), start, prev))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trace", default=DEFAULT_TRACE)
    ap.add_argument("--against", default="",
                    help='the walker\'s set, e.g. "0x12 0x13 0x14"')
    a = ap.parse_args()

    segs = segments(a.trace)
    count = collections.Counter(op for op, _, _ in segs)
    dwell = collections.defaultdict(list)
    for op, s, e in segs:
        dwell[op].append(e - s + 1)

    h = lambda s: " ".join(f"0x{v:02X}" for v in sorted(s))
    print(f"{len(count)} distinct, {len(segs)} beats")
    print("the set:", h(count))
    print("by frequency:", "  ".join(
        f"0x{op:02X}({n})" for op, n in count.most_common()))

    # A latch that never outlives one frame is a signal, not a duration. If this
    # ever prints something longer, the pacing reading of +0x421 changes.
    longest = max(max(v) for v in dwell.values())
    print(f"longest dwell: {longest} frame(s)"
          + ("" if longest == 1 else "  <- NOT a one-frame signal any more"))

    if a.against:
        ours = {int(x, 16) for x in a.against.replace(",", " ").split()}
        disc = set(count)
        print(f"\nours {len(ours)}  disc {len(disc)}  in both {len(disc & ours)}")
        print("only the disc:", h(disc - ours) or "(none)")
        print("only ours    :", h(ours - disc) or "(none)")


if __name__ == "__main__":
    main()
