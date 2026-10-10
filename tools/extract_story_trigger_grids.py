#!/usr/bin/env python3
"""Story-trigger grids — the per-stage type-7 position→step-index map (WS4 step VM).

The story-step VM (docs/research/field-script-engine-verified.md §WS4.1) picks the
active step from the player's position:

    byte     = zonecheck(type=7, player_x, player_y)   # type-7 grid-pyramid
    step_idx = byte & 0x1f   # index into the step program (top 3 bits = facing group)

This is the SAME grid-pyramid format the encounter zone map (type-4) uses, so it reuses
the verified decoder in `extract_zone_grids.py` — only the resource *type* differs
(`set_resource(7, id)` vs `(4, id)`). Verified: `byte & 0x1f` lands inside each stage's
step-program length (s205 8 steps→idx 0..6; s331 26→0..24; s735 14→0..12).

Output: `web/assets/data/story_trigger_grids.json`
  per stage: {"uniform": idx}  (every sampled cell is the same step) or
             {"cell": px, "w": cols, "h": rows, "grid": [step_idx row-major]}
  sample as  step_idx = grid[(y//cell)*w + (x//cell)]  (uniform → constant).

Usage:
  python3 tools/extract_story_trigger_grids.py          # report
  python3 tools/extract_story_trigger_grids.py --json   # write the json
"""
import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
import extract_zone_grids as G  # Disc, wstag_words, parse_pyramid, make_zc, CELL

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "web/assets/data/story_trigger_grids.json"))
# Full trigger byte is stored: low 5 bits = step index, TOP 3 BITS = required
# approach-facing group (step-load 0x80088288: the player must face within ±1
# of the group direction — 8x8 eligibility table @0x80097624). Consumers mask
# `& 0x1f` for the step index and `>> 5` for the facing group.
BYTE_MASK = 0xFF
# Sub-sample stride (world px) within each output cell. 4 px comfortably resolves
# the ~20-40 px doorway trigger patches (zc leaves are per-pixel); see extract().
SUB = 4


def type7_ids(stage):
    """Every (file#, sub) this overlay registers as a type-7 story-trigger grid.

    Two call shapes name the same resource. The common one builds the id AFTER the
    type is set (`li $a0,7` then `lui $a1,HI` … `jalr`, `ori $a1,LO` in the delay
    slot). wstag810.s uses the other order: `lui $a1,HI / ori $a1,LO / lui $v0 /
    lw $v0,-0x48fc($v0) / jalr $v0` with `li $a0,7` in the delay slot — scanning
    only forwards from the `li` missed it, which is why s810 shipped with no grid
    at all and its step program (installed by the same two stubs, into the stage
    descriptor's +0x14) was never reachable."""
    path = f"{G.WSTAG_DIR}/wstag{stage}.s"
    if not os.path.exists(path):
        return []
    w = G.wstag_words(path)
    out = []
    for i, word in enumerate(w):
        if word != 0x24040007:                                   # li $a0,7
            continue
        # shape A: id built after the type
        hi = None
        for j in range(i + 1, min(i + 6, len(w))):
            x = w[j]
            if x is not None and (x & 0xFFFF0000) == 0x3C050000:  # lui $a1,HI
                hi = x & 0xFFFF
                window = w[i + 2:i + 6]
                if not any(y is not None and (y >> 26) == 0x23 and ((y >> 16) & 31) == 2
                           and (y & 0xFFFF) == 0x40 for y in window):
                    continue
                if 0x0040F809 not in window:
                    continue
                k = w.index(0x0040F809, i + 2, i + 6)
                idv = (hi << 16) | G._sub_lo(w[k + 1] if k + 1 < len(w) else None, 7)
                out.append((idv >> 16, idv & 0xFFFF))
        # shape B: id built BEFORE the call, type in the jalr delay slot
        back = w[max(0, i - 6):i]
        jpos = next((j for j in range(len(back) - 1, -1, -1) if back[j] == 0x0040F809), None)
        if jpos is None:
            continue
        head = back[:jpos]
        hi = next((x & 0xFFFF for x in head
                   if x is not None and (x & 0xFFFF0000) == 0x3C050000), None)   # lui $a1,HI
        if hi is None:
            continue
        lo = next((x for x in reversed(head)
                   if x is not None and (x & 0xFFFF0000) in (0x34A50000, 0x34A00000)), None)
        idv = (hi << 16) | G._sub_lo(lo, 7)
        out.append((idv >> 16, idv & 0xFFFF))
    seen, uniq = set(), []
    for pair in out:
        if pair not in seen:
            seen.add(pair)
            uniq.append(pair)
    return uniq


def type7_id(stage):
    """(file#, sub) for the stage's type-7 story-trigger grid, or None — the first
    registration, which is the variant the stage's own step program is paired with."""
    ids = type7_ids(stage)
    return ids[0] if ids else None


def compact_lookup(grid, cell, w, h):
    """Keep spatial data unless every sampled cell has the same byte.

    A grid with zero-valued background plus one non-zero trigger byte is not
    uniform: collapsing it loses the trigger's position and forces scene-gen to
    guess an exit rectangle from the reciprocal spawn.  Only a genuinely
    constant grid can use the compact representation.
    """
    values = set(grid)
    if len(values) == 1:
        return {"uniform": grid[0]}
    return {"cell": cell, "w": w, "h": h, "grid": grid}


def extract(disc, stage, steps=None):
    ids = type7_ids(stage)
    if not ids:
        return None                                              # stage has no type-7 grid
    # An overlay may register SEVERAL type-7 grids, each paired with its own step-program
    # variant by the same stub (wstag810.s .L0xc4c installs grid 0x6ed003 + program
    # 0x800a7aac/file 0x1ccc; .L0xcb0 installs 0x6ed004 + program 0x800a7dac/file
    # 0x1fcc). The story grid is the one wired to a program that can actually start an
    # event: only 0x6ed003 has a cell whose byte&0x1f lands on an op-8 record (27..31,
    # 53) — 0x6ed004 addresses spawn records only. So parse each in registration order
    # and take the first whose sampled cells reach an op-8 step of THIS stage's program;
    # with no step program to check against, fall back to the first that parses.
    best = None
    for fn, sub in ids:
        row = extract_one(disc, stage, fn, sub)
        if row is None or "error" in row:
            if best is None:
                best = row
            continue
        if steps is None:
            best = row
            break
        n = len(steps.get("steps") or [])
        evs = {e["event_id"] for e in steps.get("events") or []}
        seen = row.pop("seen", {})
        hits = [idx for idx in seen
                if 1 <= (idx & 0x1F) < n
                and (steps["steps"][idx & 0x1F]["op"] == 8
                     and steps["steps"][idx & 0x1F]["params"][0] in evs)]
        row["seen"] = seen
        row["variant"] = {"file": fn, "sub": sub, "event_steps": len(hits)}
        if hits:
            return row
        if best is None:
            best = row
    return best


def extract_one(disc, stage, fn, sub):
    fs = (fn, sub)
    if not fs:
        return None                                              # stage has no type-7 grid
    arch, lba, ln = disc.file_bytes(fn)
    if arch is None:
        return dict(stage=stage, error="unmapped file %#x" % fn)
    pr = G.parse_pyramid(arch, sub)
    if not pr:
        return dict(stage=stage, error="bad pyramid header")
    res, off = pr
    w, h, zc = G.make_zc(res, off)
    if w == 0 or h == 0:
        return dict(stage=stage, error="degenerate grid %dx%d" % (w, h))
    cell = G.CELL
    wc, hc = (w * 128) // cell, (h * 128) // cell
    grid, seen = [], Counter()
    try:
        # Sub-sample each output cell at SUB-px granularity rather than reading a
        # single cell-centre pixel: the interior warp/doorway trigger regions are
        # only ~20-40 px wide and frequently do NOT contain the 32-px cell centre,
        # so centre-only sampling silently dropped them (64 of 204 op=1 warp steps
        # game-wide had no cell, leaving their exits to float off-door — see
        # docs/todo/2026-07-09-interior-door-warp-binding-resolver.md). zc() is the
        # game's exact per-pixel zonecheck (`(*[0x8009b708])(7,x,y)`); a cell that
        # any sub-sample reports as a trigger IS a trigger, so we assign the cell
        # the most-frequent NON-ZERO byte it covers (0 only if wholly untriggered).
        for cy in range(hc):
            for cx in range(wc):
                sub_c = Counter()
                for yy in range(0, cell, SUB):
                    for xx in range(0, cell, SUB):
                        sub_c[zc(cx * cell + xx, cy * cell + yy) & BYTE_MASK] += 1
                nz = {b: n for b, n in sub_c.items() if b}
                idx = max(nz, key=nz.get) if nz else 0
                grid.append(idx)
                seen[idx] += 1
    except IndexError:
        return dict(stage=stage, error="traversal OOB (compressed/misparsed?)")
    lookup = compact_lookup(grid, cell, wc, hc)
    return dict(stage=stage, w=w, h=h, max_idx=max(seen), lookup=lookup, seen=dict(sorted(seen.items())))


def main():
    import glob
    args = sys.argv[1:]
    want = [a for a in args if a.isdigit()]
    stages = want or [re.search(r"wstag(\d+)", f).group(1)
                      for f in sorted(glob.glob(f"{G.WSTAG_DIR}/wstag*.s"))]
    disc = G.Disc(G.DISC)
    steps = json.load(open(os.path.join(os.path.dirname(__file__), "..",
                                       "web/assets/data/story_steps.json")))["stages"]
    rows = [r for s in stages if (r := extract(disc, s, steps.get(str(s))))]
    ok = [r for r in rows if "error" not in r]
    bad = [r for r in rows if "error" in r]
    print(f"type-7 story-trigger grids: {len(rows)} registered  parsed OK: {len(ok)}  errors: {len(bad)}")
    for r in bad:
        print(f"  s{r['stage']}: {r['error']}")

    # Cross-check against the step programs (verified relationship): every step_idx the
    # grid yields must be a valid index into that stage's step program.
    inrange = oob = 0
    for r in ok:
        prog = steps.get(r["stage"])
        if not prog:
            continue
        n = len(prog["steps"])
        for idx in r["seen"]:
            if (idx & 0x1F) < n:
                inrange += 1
            else:
                oob += 1
    print(f"step_idx ↔ program cross-check: {inrange} in-range, {oob} out-of-range")

    if "--json" in args:
        doc = {"_comment": ("Per-stage type-7 story-trigger grids (WS4 step VM). step_idx = "
                            "(uniform) or grid[(y//cell)*w + (x//cell)]; selects the record in "
                            "story_steps.json[stage].steps. Decoded via the zonecheck grid-pyramid "
                            "(byte & 0x1f). See docs/research/field-script-engine-verified.md §WS4.1."),
               "stages": {r["stage"]: r["lookup"] for r in ok}}
        json.dump(doc, open(OUT, "w"))
        u = sum(1 for r in ok if "uniform" in r["lookup"])
        print(f"wrote {OUT}: {len(ok)} stages ({u} uniform, {len(ok) - u} gridded)")


if __name__ == "__main__":
    main()
