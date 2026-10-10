#!/usr/bin/env python3
"""Story-trigger ZONES — the EXACT per-pixel type-7 zone map the step VM reads.

The step VM picks a step from the player's exact pixel:

    byte = zonecheck(7, player_x, player_y)   # step-load 0x80088288, fieldstg.s:5514

`zonecheck` (`0x80092914`, ported as `extract_zone_grids.make_zc`) descends a
quadtree to an 8x8 leaf and then indexes `leaf[n*64 + (y&7)*8 + (x&7)]` — i.e.
the value varies PIXEL by pixel, not per 32 px cell. `story_trigger_grids.json`
quantises that to 32 px cells, which fires a step up to a cell early (the
Protocol Ruins tunnel hide began before the passage, and the restore did not
land where the original brings the player back — playtest, 2026-10-07).

This tool emits the SAME zonecheck, decimised only by horizontal run length:
for every row, maximal runs of a constant non-zero byte. That is exact (a
lookup returns the byte at any pixel) and small — the whole game is ~70k runs.

Output: `web/assets/data/story_trigger_zones.json`
  {"stages": {"<id>": [[x0, x1, y, byte], ...]}}
  byte at (x,y) = the run with x0 <= x <= x1 and that y, else 0.

The variant choice (which type-7 grid a stage owns) is taken from
`extract_story_trigger_grids.extract`, so this file and the cell grid can never
disagree about a stage's grid.

Usage:
  python3 tools/extract_story_trigger_zones.py          # report
  python3 tools/extract_story_trigger_zones.py --json   # write the json
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
import extract_zone_grids as G
import extract_story_trigger_grids as T

OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..",
                                    "web/assets/data/story_trigger_zones.json"))
STEPS = os.path.normpath(os.path.join(os.path.dirname(__file__), "..",
                                      "web/assets/data/story_steps.json"))


def _leaf_reader(res, off, w, h):
    """The 64-byte sec5 leaf for the 8x8 block whose top-left pixel is (bx,by).

    Mirrors make_zc's quadtree descent (`extract_zone_grids`) but stops at the
    leaf, so a caller can test ALL 64 pixels of the block at once. That matters
    because the leaf value varies PER PIXEL inside the block — `zc(x,y)` indexes
    `sec5[n*64 + (y&7)*8 + (x&7)]` — so a single corner sample cannot tell
    whether the block holds any non-zero pixel at all.
    """
    def leaf(bx, by):
        tx, ty = bx >> 7, by >> 7
        if tx < 0 or ty < 0 or tx >= w or ty >= h:
            return b""
        n = res[off[0] + 2 + ty * w + tx]
        n = res[off[1] + n * 4 + (2 if by & 0x40 else 0) + (1 if bx & 0x40 else 0)]
        n = struct.unpack_from("<H", res, off[2] + (n * 4 + (2 if by & 0x20 else 0) + (1 if bx & 0x20 else 0)) * 2)[0]
        n = struct.unpack_from("<H", res, off[3] + (n * 4 + (2 if by & 0x10 else 0) + (1 if bx & 0x10 else 0)) * 2)[0]
        n = struct.unpack_from("<H", res, off[4] + (n * 4 + (2 if by & 0x08 else 0) + (1 if bx & 0x08 else 0)) * 2)[0]
        return res[off[5] + n * 64: off[5] + n * 64 + 64]
    return leaf


def runs_for(disc, stage, steps):
    """[[x0, x1, y, byte], ...] for the stage's chosen type-7 grid, or None.

    The 8 px pre-scan bounds the 1 px walk: no non-zero pixel can sit outside a
    block the pre-scan flags. The pre-scan must therefore flag a block when ANY
    of its 64 pixels is non-zero, not just its corner — the old `zc(bx,by)` test
    sampled one pixel per block and silently dropped every block whose non-zero
    pixels sat away from its corner, so the 1 px walk never visited them and up
    to a full block of a region's edge disappeared (measured: s375/s376/s949
    each lost 20 px of the op-5 hide, byte 1). Reading the whole leaf fixes the
    edge exactly at the same loop count.
    """
    row = T.extract(disc, stage, steps.get(stage))
    if not row or "error" in row:
        return None
    fn, sub = row["variant"]["file"], row["variant"]["sub"]
    arch, _, _ = disc.file_bytes(fn)
    if arch is None:
        return None
    pr = G.parse_pyramid(arch, sub)
    if not pr:
        return None
    res, off = pr
    w, h, zc = G.make_zc(res, off)
    W, H = w * 128, h * 128
    # 8 px bounding box of the non-zero region: a block is in bounds iff ANY of
    # its 64 leaf pixels is non-zero (NOT only its corner pixel).
    leaf = _leaf_reader(res, off, w, h)
    x0b, x1b, y0b, y1b = W, -1, H, -1
    for by in range(0, H, 8):
        for bx in range(0, W, 8):
            if any(leaf(bx, by)):
                if bx < x0b:
                    x0b = bx
                if bx > x1b:
                    x1b = bx
                if by < y0b:
                    y0b = by
                if by > y1b:
                    y1b = by
    if x1b < 0:
        return []
    x0b, y0b = max(0, x0b), max(0, y0b)
    x1b, y1b = min(W - 1, x1b + 7), min(H - 1, y1b + 7)
    runs = []
    for y in range(y0b, y1b + 1):
        x = x0b
        while x <= x1b:
            b = zc(x, y) & 0xff
            if b == 0:
                x += 1
                continue
            x0 = x
            while x <= x1b and (zc(x, y) & 0xff) == b:
                x += 1
            runs.append([x0, x - 1, y, b])
    return runs


def main():
    import glob
    import re
    args = sys.argv[1:]
    want = [a for a in args if a.isdigit()]
    stages = want or [re.search(r"wstag(\d+)", f).group(1)
                      for f in sorted(glob.glob(f"{G.WSTAG_DIR}/wstag*.s"))]
    disc = G.Disc(G.DISC)
    steps = json.load(open(STEPS))["stages"]
    out = {}
    errs = []
    for s in stages:
        try:
            r = runs_for(disc, s, steps)
        except (IndexError, struct.error) as e:
            errs.append((s, type(e).__name__))
            continue
        if r is None:
            continue
        out[s] = r
    n_runs = sum(len(v) for v in out.values())
    print(f"type-7 story-trigger zones: {len(out)} stages, {n_runs} runs, "
          f"{len(errs)} errors")
    for s, e in errs[:10]:
        print(f"  s{s}: {e}")
    if "--json" in args:
        doc = {
            "_comment": ("Exact per-pixel type-7 story-trigger zones (zonecheck 7). "
                         "Per stage a list of [x0, x1, y, byte] horizontal runs; "
                         "byte at (x,y) = the run covering it, else 0. The low 5 "
                         "bits of the byte are the step index and the top 3 the "
                         "required approach-facing group (step-load 0x80088288). "
                         "Decoded by extract_zone_grids.make_zc; see "
                         "docs/research/field/field-actor-draw-bucket-2026-10-07.md."),
            "stages": out,
        }
        json.dump(doc, open(OUT, "w"), separators=(",", ":"))
        print(f"wrote {OUT}: {len(out)} stages")


if __name__ == "__main__":
    main()
