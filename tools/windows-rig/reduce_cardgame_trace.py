#!/usr/bin/env python3
"""Condense a raw card-duel VSync trace into a reviewable capture.

Input is the artifact written by tools/windows-rig/trace-cardgame-full-state5.lua.
The raw log is per-frame and large; this reduces it to the frames where the duel
actually changes state, which is what the capture document cites.

Usage: reduce_cardgame_trace.py <raw.txt> [--out condensed.md]
       reduce_cardgame_trace.py <raw.txt> --timeline [--out timeline.md]

The default output is the state-field capture. `--timeline` instead correlates
the duel's mode machine with the animation sprite pool, which is what answers
"which duel event plays which animation, from where, to where, for how long" --
the one layer of the card duel that static reading never reached.
"""

import argparse
import collections
import sys

SUMMARY_FIELDS = [
    "loaded", "ctx", "duel", "pend2f7", "cur2f8", "prev2f6", "msgpend2f4",
    "msgid421", "sub2f9", "sub574", "out302", "sub303", "scene0c", "busy54",
    "timer424", "score4e0", "play575", "result440", "p0_5a0", "p1_5a6",
    "p676", "lock", "move_lock",
]

# fields whose every transition is worth a line in the condensed capture
WATCH = [
    "cur2f8", "pend2f7", "prev2f6", "msgid421", "sub2f9", "sub574",
    "out302", "scene0c", "result440", "p0_5a0", "p1_5a6", "p676", "play575",
]


def parse(path):
    frames = {}
    events = []
    anim_changes = collections.Counter()
    round_changes = collections.Counter()
    sprites = collections.defaultdict(list)
    raw_sprites = []
    header = []

    with open(path, "r", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if line.startswith("#"):
                header.append(line)
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                frame = int(parts[0])
            except ValueError:
                continue
            kind = parts[1]

            if kind == "summary" and len(parts) >= 2 + len(SUMMARY_FIELDS):
                frames[frame] = dict(zip(SUMMARY_FIELDS, parts[2:]))
            elif kind == "anim_change" and len(parts) >= 5:
                anim_changes[parts[2]] += 1
            elif kind == "round_change" and len(parts) >= 5:
                round_changes[parts[2]] += 1
            elif kind == "sprite" and len(parts) >= 4:
                sprites[int(parts[2])].append((frame, parts[3]))
                raw_sprites.append((frame, int(parts[2]), line))
            else:
                events.append((frame, line))
    return (header, frames, events, anim_changes, round_changes, sprites,
            raw_sprites)


def transitions(frames):
    out = []
    prev = None
    for frame in sorted(frames):
        cur = frames[frame]
        if prev is None:
            out.append((frame, "start", "", ""))
        else:
            for field in WATCH:
                if cur.get(field) != prev.get(field):
                    out.append((frame, field, prev.get(field), cur.get(field)))
        prev = cur
    return out


SPRITE_FIELDS = ["x", "y", "dx", "dy", "sx", "sy", "state", "kind", "clip",
                 "anim", "timer", "dur"]

# state45 names, from the decoded twelve-state machine (F0x8009b890).
STATE_NAMES = {
    0: "off", 1: "idle", 2: "move", 3: "move2", 4: "flip", 5: "summon",
    6: "settle", 7: "shakeA", 8: "hold8", 9: "hold9", 10: "hold10",
    11: "holdEnd",
}


# How much of the duel's opening the timeline quotes verbatim. The deal and its
# flip wave both complete well inside this window in both captured runs.
DEAL_FRAMES = 400


def px(v):
    """8.8 fixed point -> whole pixels, the way the original draws."""
    return v >> 8


def sprite_rows(sprites):
    """(frame, slot, {field: int}) for every logged sprite change."""
    out = []
    for slot, rows in sprites.items():
        for frame, packed in rows:
            vals = packed.split(",")
            if len(vals) < len(SPRITE_FIELDS):
                continue
            try:
                nums = [int(v) for v in vals[:len(SPRITE_FIELDS)]]
            except ValueError:
                continue
            out.append((frame, slot, dict(zip(SPRITE_FIELDS, nums))))
    out.sort(key=lambda r: (r[0], r[1]))
    return out


def duel_window(events):
    """Frames over which the duel object is live.

    The pool is only meaningful while the mode machine is running: once the
    duel ends the mode returns to 0 and the object is freed, after which the
    trace still samples the stale addresses and logs pure garbage. Everything
    at or after that frame is dropped rather than reported as animation.
    """
    start = None
    end = None
    for frame, line in events:
        parts = line.split()
        if len(parts) < 3 or parts[1] != "mode_change":
            continue
        new = parts[-1]
        if new != "00000000" and start is None:
            start = frame
        elif new == "00000000" and start is not None and end is None:
            end = frame
    return start or 0, end


def timeline(events, sprites):
    """Interleave mode transitions with sprite state changes."""
    lo, hi = duel_window(events)
    out = []
    for frame, line in events:
        parts = line.split()
        if len(parts) >= 3 and parts[1] == "mode_change":
            out.append((frame, 0, "MODE", " ".join(parts[2:])))
    last = {}
    for frame, slot, s in sprite_rows(sprites):
        if hi is not None and frame >= hi:
            continue
        if s["state"] != last.get(slot):
            was = last.get(slot)
            out.append((frame, 1, "ANIM", "slot %02d  %-8s -> %-8s  "
                        "(%3d,%3d) -> (%3d,%3d)  scale %5d,%5d  "
                        "kind %d clip %d anim %d timer %d dur %d"
                        % (slot,
                           "-" if was is None else STATE_NAMES.get(was, str(was)),
                           STATE_NAMES.get(s["state"], str(s["state"])),
                           px(s["x"]), px(s["y"]), px(s["dx"]), px(s["dy"]),
                           s["sx"], s["sy"], s["kind"], s["clip"], s["anim"],
                           s["timer"], s["dur"])))
            last[slot] = s["state"]
    out.sort(key=lambda e: (e[0], e[1]))
    return out, lo, hi


def rest_positions(sprites, hi):
    """Every distinct resting position a slot settled at, grouped by row y.

    A slot at rest (state idle, no pending destination) is sitting on its
    authored board coordinate, so this recovers the real row origins and
    pitches without having to identify the layout helper's callers.
    """
    rows = collections.defaultdict(set)
    for frame, slot, s in sprite_rows(sprites):
        if hi is not None and frame >= hi:
            continue
        if s["state"] != 1 or s["dx"] != s["x"] or s["dy"] != s["y"]:
            continue
        if s["x"] == 0 and s["y"] == 0:
            continue
        rows[px(s["y"])].add(px(s["x"]))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("--out")
    ap.add_argument("--timeline", action="store_true",
                    help="emit the mode/animation correlation instead")
    args = ap.parse_args()

    (header, frames, events, anim_changes, round_changes, sprites,
     raw_sprites) = parse(args.raw)

    if args.timeline:
        rows, lo, hi = timeline(events, sprites)
        lines = []
        lines.append("# Card-duel event -> animation timeline")
        lines.append("")
        lines.append("Raw source: `%s`" % args.raw)
        lines.append("")
        lines.append("Duel object live over frames %s..%s; "
                     "sprite samples at or after the mode returns to 0 are "
                     "stale-address garbage and are dropped."
                     % (lo, "end" if hi is None else hi))
        lines.append("")
        lines.append("## Resting positions by row")
        lines.append("")
        lines.append("| row y | resting x | pitch |")
        lines.append("|---|---|---|")
        for y, xs in sorted(rest_positions(sprites, hi).items()):
            xl = sorted(xs)
            gaps = sorted({b - a for a, b in zip(xl, xl[1:])})
            lines.append("| %d | %s | %s |"
                         % (y, ", ".join(str(v) for v in xl),
                            ", ".join(str(g) for g in gaps) or "-"))
        lines.append("")
        lines.append("## Timeline")
        lines.append("")
        lines.append("```")
        for frame, _, kind, text in rows:
            lines.append("%5d %-4s %s" % (frame, kind, text))
        lines.append("```")
        lines.append("")
        lines.append("## Verbatim samples: the opening deal")
        lines.append("")
        lines.append("Every raw sprite line of the first %d frames of the duel,"
                     " unreduced, so the per-frame tween and scale values are"
                     " citable without the out-of-repo raw log." % DEAL_FRAMES)
        lines.append("")
        lines.append("```")
        for frame, slot, line in raw_sprites:
            if lo <= frame < lo + DEAL_FRAMES:
                lines.append(line)
        lines.append("```")
        lines.append("")
        lines.append("## Verbatim samples: scale activity at rest")
        lines.append("")
        lines.append("Every raw line where a sprite is in the idle state (45 = 1)"
                     " and yet its x scale is not unity -- i.e. it is animating"
                     " while nominally at rest, which a still card would never"
                     " do. Restricted to slots that reach a resting position, and"
                     " to the frames after the opening deal.")
        lines.append("")
        lines.append("```")
        for frame, slot, line in raw_sprites:
            if frame < lo + DEAL_FRAMES or (hi is not None and frame >= hi):
                continue
            vals = line.split()[3].split(",")
            if len(vals) < len(SPRITE_FIELDS):
                continue
            try:
                nums = [int(v) for v in vals[:len(SPRITE_FIELDS)]]
            except ValueError:
                continue
            f = dict(zip(SPRITE_FIELDS, nums))
            if f["state"] == 1 and f["sx"] not in (0, 0x1000):
                lines.append(line)
        lines.append("```")
        text = "\n".join(lines) + "\n"
        if args.out:
            with open(args.out, "w") as fh:
                fh.write(text)
            print("wrote %s (%d lines)" % (args.out, len(lines)))
        else:
            sys.stdout.write(text)
        return

    lines = []
    lines.append("# Card-duel runtime capture (condensed)")
    lines.append("")
    lines.append("Raw source: `%s`" % args.raw)
    lines.append("")
    lines.append("## Trace header")
    lines.append("")
    lines.append("```")
    lines.extend(header[:12])
    lines.append("```")
    lines.append("")

    lines.append("## Frames observed: %d" % len(frames))
    lines.append("")

    lines.append("## Duel field transitions")
    lines.append("")
    lines.append("| frame | field | old | new |")
    lines.append("|---|---|---|---|")
    for frame, field, old, new in transitions(frames):
        lines.append("| %d | `%s` | `%s` | `%s` |" % (frame, field, old, new))
    lines.append("")

    lines.append("## Non-summary events")
    lines.append("")
    lines.append("```")
    for frame, line in events:
        lines.append(line)
    lines.append("```")
    lines.append("")

    lines.append("## Most frequently written context offsets (ctx+off)")
    lines.append("")
    lines.append("| offset | writes |")
    lines.append("|---|---|")
    for off, n in anim_changes.most_common(40):
        lines.append("| `+0x%s` | %d |" % (off, n))
    lines.append("")

    lines.append("## Most frequently written duel offsets (duel+off)")
    lines.append("")
    lines.append("| offset | writes |")
    lines.append("|---|---|")
    for off, n in round_changes.most_common(40):
        lines.append("| `+0x%s` | %d |" % (off, n))
    lines.append("")

    lines.append("## Sprite activity")
    lines.append("")
    lines.append("| slot | state changes | first frame | last frame |")
    lines.append("|---|---|---|---|")
    for slot in sorted(sprites):
        rows = sprites[slot]
        lines.append("| %d | %d | %d | %d |"
                     % (slot, len(rows), rows[0][0], rows[-1][0]))
    lines.append("")

    text = "\n".join(lines) + "\n"
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(text)
        print("wrote %s (%d lines)" % (args.out, len(lines)))
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
