#!/usr/bin/env python3
"""Extract the underground/maze EXIT-RECORD tables from the wstag overlays.

The self-warp maze stages were long believed to carry no real exits: their
`scene_struct+0x14` step program holds only self-warps to their own screen, and a
2026-07-09 rig harvest was read as proof that the real tables are assembled at
runtime. Both readings were wrong. The step program is the ARRIVAL-PAD list (where
other stages drop you INTO this one); the exit graph is a separate, fully static
16-byte record table elsewhere in the same overlay:

    struct MazeExit {            // 16 bytes
        u16 screen;              // destination screen id
        u16 key;                 // route pair, [0x80048d78]  (0 = leaves the maze)
        u16 companion;           // route pair, [0x80048d7a]
        u16 x, y;                // arrival position
        u16 dir;                 // arrival facing, 0/1/3/5/7
        u32 script;              // 0 or an in-overlay pointer
    };

The records are grouped into blocks, one block per maze SECTION: walking a given
direction out of section (key, companion) lands you in another section of the same
screen, which is what makes the wrap maze a maze. The route pair the record carries
is what the field engine stores on the transition, and what bank 0x7E reads back to
pick which NPC stands in the stage's single occupant slot -- so the section you are
in decides who you meet and which chest is there.

VALIDATION: this extractor reproduces all 33 runtime-captured exits in
web/assets/data/maze_exits.json exactly (screen, x, y, dir), across all 12 stages
that harvest covered. Run with --check to re-assert that.

Usage:
  python3 tools/extract_maze_exits.py --check          # validate against the capture
  python3 tools/extract_maze_exits.py --write          # emit maze_exit_records.json
  python3 tools/extract_maze_exits.py s875 s880        # dump specific stages
"""
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wstag_extract as W  # noqa: E402

BASE = 0x800A5DE0
REC = 16
DIRS = {0, 1, 3, 5, 7}
OUT = Path("web/assets/data/maze_exit_records.json")
OUT_SECTIONS = Path("web/assets/data/maze_sections.json")
CAPTURE = Path("web/assets/data/maze_exits.json")

# The stages whose step program is self-warps only: the wrap mazes.
MAZE_STAGES = ["635", "636", "640", "641",
               "825", "830", "835", "840", "845", "850", "855", "860",
               "865", "870", "875", "880", "885", "890", "895",
               "960", "961", "962", "963", "964", "965", "966", "967",
               "968", "969", "970", "971", "972", "973", "974"]


def plausible(data, off, screens):
    """One 16-byte record that could be a maze exit."""
    if off + REC > len(data):
        return None
    scr, key, comp, x, y, dr, plo, phi = struct.unpack_from("<8H", data, off)
    ptr = plo | (phi << 16)
    if scr not in screens or dr not in DIRS:
        return None
    if not (0 < x < 4096 and 0 < y < 4096):
        return None
    if key >= 64 or comp >= 64:
        return None
    if ptr and not (BASE <= ptr < BASE + len(data)):
        return None
    return {"screen": scr, "key": key, "companion": comp,
            "x": x, "y": y, "dir": dr, "script": ptr or None}


def sections(stage, screens):
    """The maze graph with SECTION identity: [{key, companion, exits: [...]}].

    The records of one section form a backward-linked chain -- record[0] has
    script == 0 and every later record points at its predecessor -- and the chain
    is followed by an 8-byte trailer {u16 key, u16 companion, u32 tail} naming the
    section the chain belongs to and pointing at its LAST record. So the
    block-to-section index is in the data; nothing has to be inferred.

    Proven on the one stage with an independent ground truth: s635's first chain
    is trailed by (1, 1), and its four exits are exactly the four the 2026-07-09
    rig captured after entering s635 from s630, whose warp record carries
    key=1, companion=1.
    """
    data = W.overlay_bytes(stage)
    if data is None:
        return []
    recs = {r["offset"]: r for r in exit_records(stage, screens)}
    out = []
    for off in sorted(recs):
        if recs[off]["script"] is not None:
            continue                      # not a chain head
        chain = [recs[off]]
        o = off + REC
        while o in recs and recs[o]["script"] == BASE + (o - REC):
            chain.append(recs[o])
            o += REC
        tail = o                          # the 8-byte trailer sits after the chain
        if tail + 8 > len(data):
            continue
        key, comp, plo, phi = struct.unpack_from("<2H2H", data, tail)
        ptr = plo | (phi << 16)
        if ptr != BASE + (o - REC):
            continue                      # trailer must point at the chain's last record
        out.append({"key": key, "companion": comp, "offset": off,
                    "exits": [{k: r[k] for k in ("screen", "key", "companion", "x", "y", "dir")}
                              for r in chain]})
    return out


def exit_records(stage, screens, min_run=2):
    """Every maze-exit record, as runs of >= min_run consecutive 16-byte records.

    A lone plausible record is far more likely to be coincidence than a run is, so
    the run requirement is the false-positive control; it costs nothing on real
    tables, which are always blocks of 2-8.
    """
    data = W.overlay_bytes(stage)
    if data is None:
        return []
    out, seen = [], set()
    for start in range(0, len(data) - REC, 2):
        run = []
        off = start
        while True:
            r = plausible(data, off, screens)
            if r is None:
                break
            run.append((off, r))
            off += REC
        if len(run) >= min_run and run[0][0] not in seen:
            for o, r in run:
                if o in seen:
                    continue
                seen.add(o)
                r["offset"] = o
                out.append(r)
    if not out and min_run > 1:
        # A stage with exactly ONE exit has no run to find (s860 is the only case).
        # Fall back rather than report it as exitless -- the alternative is a false
        # negative on a stage the runtime capture proves has an exit.
        return exit_records(stage, screens, min_run=1)
    return sorted(out, key=lambda r: r["offset"])


def check(screens):
    cap = json.loads(CAPTURE.read_text())["stages"]
    dirmap = {"up": 5, "down": 1, "left": 3, "right": 7, 0: 0}
    total = matched = 0
    misses = []
    for stage, exits in cap.items():
        recs = exit_records(stage, screens)
        have = {(r["screen"], r["x"], r["y"], r["dir"]) for r in recs}
        for e in exits:
            total += 1
            key = (e["screen"], e["spawnX"], e["spawnY"], dirmap.get(e.get("dir")))
            if key in have:
                matched += 1
            else:
                misses.append((stage, e.get("dir"), e["to"], key))
    for m in misses:
        print("  MISS", m)
    print(f"check: {matched} of {total} runtime-captured maze exits reproduced statically")
    return 0 if matched == total else 1


def main():
    screens = {int(k) for k in W.load_screens()}
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--check" in sys.argv:
        sys.exit(check(screens))
    stages = [a.lstrip("s") for a in args] or MAZE_STAGES
    out = {}
    for stage in stages:
        recs = exit_records(stage, screens)
        if recs:
            out[stage] = recs
    secs = {}
    for stage in stages:
        got = sections(stage, screens)
        if got:
            secs[stage] = got
    if "--write" in sys.argv:
        OUT_SECTIONS.write_text(json.dumps({
            "_comment": (
                "The maze GRAPH with section identity, extracted by tools/extract_maze_exits.py. "
                "Each section is one (key, companion) route pair -- the pair the field engine holds "
                "in [0x80048d78]/[0x80048d7a] -- and its exits are the 16-byte records of one "
                "backward-linked chain, which the 8-byte trailer {key, companion, tail} names. "
                "dir 0 = a hole out to the surface (destination key/companion are 0, i.e. the pair "
                "clears); dir 1 = south, dir 5 = north inside the maze. Validated: s635 section "
                "(1,1) is exactly the exit table the 2026-07-09 rig captured after entering s635 "
                "from s630, whose warp record carries key=1, companion=1. "
                "See docs/research/field/route-pair-underground-network-2026-07-27.md."),
            "stages": secs,
        }, indent=1) + "\n")
        print(f"wrote {OUT_SECTIONS} ({len(secs)} stages, "
              f"{sum(len(v) for v in secs.values())} sections)")
        OUT.write_text(json.dumps({
            "_comment": (
                "Static maze EXIT-RECORD tables, extracted by tools/extract_maze_exits.py. "
                "16-byte records {screen, key, companion, x, y, dir, script} grouped into "
                "one block per maze section; key/companion are the route pair written on the "
                "transition and read back by bank 0x7E to pick the stage's occupant. "
                "Reproduces all 33 runtime-captured exits in maze_exits.json exactly. "
                "See docs/research/field/route-pair-underground-network-2026-07-27.md."),
            "stages": out,
        }, indent=1) + "\n")
        print(f"wrote {OUT} ({len(out)} stages, {sum(len(v) for v in out.values())} records)")
    else:
        for stage, recs in out.items():
            dests = sorted({r["screen"] for r in recs})
            print(f"s{stage}: {len(recs)} records -> screens {dests}")


if __name__ == "__main__":
    main()
