#!/usr/bin/env python3
"""Turn a rig card-duel trace into a per-frame timeline of the duel's REAL state.

WHY THIS EXISTS. The card duel was compared to the disc by eye, and then by
whole-frame pixel diff against ten hand-picked screenshots. Both are the wrong
instrument. A pixel diff of a screen whose backdrop scrolls on a free-running
counter reports 25.9% difference for a frame whose artwork is bit-exact (proved
2026-08-26: the backdrop tile aligns at offset (14,14) with 0.0% of tile pixels
differing), and it reports one bounding box for a board whose cards are simply
at a different point in their tweens. It cannot name the field that is wrong.

The trace can. `tools/windows-rig/trace-cardgame-full-state5.lua` and its
siblings log, on every frame, every pooled card sprite that CHANGED:

    <frame> sprite <slot> x,y,dx,dy,sx,sy,state45,kind46,clip47,anim42,timer28,dur2c

which is exactly the field set of `CardSprite` in engine/systems/card-animation.ts.
Those are directly comparable as NUMBERS. No rendering, no pixels.

Positions are 8-bit fixed point: value >> 8 is the pixel coordinate. Slot 00 at
x=90112 is x=352 — off the right edge of the 320px screen, which is where the
deal enters from.

Sprite lines are emitted only for slots that changed, so this carries every slot
forward frame to frame and emits the full 40-slot pose per frame.

Usage:
  parse_cardduel_trace.py TRACE [-o OUT.jsonl] [--from N] [--to N] [--slots N]
"""

import argparse
import json

# From the trace header's own `# summary:` line, in order after the frame field.
SUMMARY_FIELDS = [
    "loaded", "anim", "round", "pend2f7", "cur2f8", "prev2f6", "msgpend2f4",
    "msgid421", "sub2f9", "sub574", "out302", "sub303", "scene0c", "busy54",
    "timer424", "score4e0", "play575", "result440", "p0_5a0", "p1_5a6", "p676",
    "lock", "move_lock",
]
# CAREFUL: the trace header names these columns "state45 kind46 clip47 anim42",
# which are the raw byte OFFSETS, and those names do NOT line up with the names
# engine/systems/card-animation.ts gives the same bytes:
#
#     trace column   byte    CardSprite field
#     state45        +0x45   renderKind
#     kind46         +0x46   badge
#     clip47         +0x47   effect
#     anim42         +0x42   state
#
# Comparing "state" to "state" across the two vocabularies compares +0x42 to
# +0x45 and is meaningless — it reported a 100% mismatch on 2026-08-26 before
# this was caught. These are named for the ENGINE field, so both sides of
# tools/diff_cardduel_sprites.mjs speak one language.
SPRITE_FIELDS = [
    "x", "y", "dx", "dy", "sx", "sy",
    "renderKind", "badge", "effect", "state", "timer", "dur",
]
FIXED_SHIFT = 8


def parse(path, slots=40):
    """Yield {frame, summary, sprites:[...]} for every frame the trace mentions."""
    pose = [None] * slots
    summary = {}
    cur = None
    out = []

    def emit():
        if cur is None:
            return
        out.append({
            "frame": cur,
            "summary": dict(summary),
            "sprites": [dict(s) if s else None for s in pose],
        })

    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        frame = int(parts[0])
        kind = parts[1]
        if frame != cur:
            emit()
            cur = frame
        if kind == "summary":
            vals = parts[2:]
            for name, v in zip(SUMMARY_FIELDS, vals):
                summary[name] = v
        elif kind == "sprite":
            slot = int(parts[2])
            nums = [int(n) for n in parts[3].split(",")]
            rec = dict(zip(SPRITE_FIELDS, nums))
            # Pixel coordinates alongside the raw fixed-point ones, so a reader
            # never has to remember the shift.
            rec["px"] = rec["x"] >> FIXED_SHIFT
            rec["py"] = rec["y"] >> FIXED_SHIFT
            rec["pdx"] = rec["dx"] >> FIXED_SHIFT
            rec["pdy"] = rec["dy"] >> FIXED_SHIFT
            rec["slot"] = slot
            if 0 <= slot < slots:
                pose[slot] = rec
    emit()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("trace")
    ap.add_argument("-o", "--out")
    ap.add_argument("--from", dest="lo", type=int, default=0)
    ap.add_argument("--to", dest="hi", type=int, default=10**9)
    ap.add_argument("--slots", type=int, default=40)
    a = ap.parse_args()

    rows = [r for r in parse(a.trace, a.slots) if a.lo <= r["frame"] <= a.hi]
    if a.out:
        with open(a.out, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        print(f"wrote {a.out}: {len(rows)} frames")
    else:
        live = [r for r in rows if any(
            s and (s["state"] or s["x"]) for s in r["sprites"])]
        print(f"frames: {len(rows)}   frames with a live sprite: {len(live)}")
        if live:
            r = live[0]
            print(f"first live frame {r['frame']} mode={r['summary'].get('cur2f8')}")
            for s in r["sprites"][:12]:
                if s:
                    print(f"  slot {s['slot']:02d} ({s['px']:4d},{s['py']:4d}) "
                          f"-> ({s['pdx']:4d},{s['pdy']:4d}) scale {s['sx']:5d},{s['sy']:5d} "
                          f"state={s['state']} renderKind={s['renderKind']} "
                          f"badge={s['badge']} effect={s['effect']} "
                          f"t={s['timer']}/{s['dur']}")


if __name__ == "__main__":
    main()
