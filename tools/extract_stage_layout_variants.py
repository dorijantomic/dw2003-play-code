#!/usr/bin/env python3
"""Stage layout variants — the stages that ship MORE THAN ONE type-7 room phase.

Most `wstag` stages register ONE type-7 story-trigger grid and install ONE
24-byte step program into the scene context (`scene+0x14`). A few register two:
a native event swaps the active grid and its paired step program, i.e. the room
changes phase. s810 (Undersea Base, the Gunslinger 1F teleport room) is the case
this tool exists for — its two native events 9000/9001 are inverse transactions
over the persistent field latch `D0x80048d34+0x26e4` (wstag810.s file 0xc4c and
0xcb0). The extractor for single-program stages
(`tools/extract_story_steps.py`) stops at the first program; this tool lifts
every one and pairs each with the type-7 resource registered in the same body,
so the second phase is data instead of a caveat.

The pairing is read from the overlay itself, not assumed by order:
  * each step-program store is `sw rt, <scene+0x14>` where the folded
    destination resolves to the absolute `0x80099D94` (scene_struct 0x80099D80
    + 0x14). Both call shapes occur — the common `sw rt,0x14(rs)` after a folded
    scene base, and s810's folded-displacement form `sw rt,-0x626c(rs)` with
    `rs = 0x800a0000`. Resolving the destination catches both.
  * the type-7 resource id is the nearest `lui $a1,0x06ed` / `ori $a1,N` fold
    seen before that store, inside the same native event body.
  * the grid for a layout is the type-7 registration whose id equals that
    resource, decoded by the verified zone-grid reader
    (`tools/extract_story_trigger_grids.py`).

Reads `~/ddw3/asm/dw2003/pro/*.s` and the disc; writes no repo file when run
without `--json`.

Usage:
  python3 tools/extract_stage_layout_variants.py            # report
  python3 tools/extract_stage_layout_variants.py --json     # write the data
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wstag_extract as W                      # noqa: E402
import extract_story_steps as S                # noqa: E402
import extract_story_trigger_grids as T        # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web/assets/data/stage_layout_variants.json"

BASE = 0x800A5DE0          # wstag overlay RAM base; file_offset = ram - BASE
SCENE_STRUCT = 0x80099D80  # the shared stage descriptor fieldstg reads
SCENE_PROGRAM = SCENE_STRUCT + 0x14   # +0x14 = the active 24-byte step program

# the resource ids the type-7 registrations and the swap bodies use are
# `0x06ed000N` — high half 0x06ed is the packed group, low half the file index.
RES_GROUP = 0x06ED


def _fold_stores(data: bytes):
    """Every `sw rt,<target>` whose folded destination is scene+0x14 and whose
    folded source parses as a step program. Yields (store_off, program_ptr,
    resource_or_None) in overlay order.

    A two-register constant fold over lui / addiu / ori, exactly the strategy
    `extract_story_steps.step_program_ptr` uses, extended to (a) resolve the
    STORE DESTINATION absolutely so the folded-displacement form is caught and
    (b) remember the most recent `0x06ed000N` fold as the paired resource."""
    regs: dict[int, int] = {}
    last_resource: int | None = None
    for o in range(0, len(data) - 4, 4):
        w = struct.unpack_from("<I", data, o)[0]
        op, rs, rt, imm = w >> 26, (w >> 21) & 31, (w >> 16) & 31, w & 0xFFFF
        simm = imm - 0x10000 if imm & 0x8000 else imm
        if op == 0x0F:                                   # lui rt, imm
            regs[rt] = imm << 16
            continue
        if op in (9, 0x0D) and rs in regs:               # addiu / ori rt, rs, imm
            regs[rt] = ((regs[rs] + simm) & 0xFFFFFFFF) if op == 9 else (regs[rs] | imm)
            v = regs[rt]
            if (v >> 16) == RES_GROUP and 0 < (v & 0xFFFF) <= 0xFF:
                last_resource = v
            continue
        if op == 0x2B:                                   # sw rt, off(rs)
            dst = regs.get(rs)
            src = regs.get(rt)
            if dst is not None and (dst + simm) == SCENE_PROGRAM \
                    and src is not None and BASE <= src < BASE + len(data) \
                    and S.read_step_program_at(data, src - BASE):
                yield o, src, last_resource
        for d in S._written_regs(w):
            regs.pop(d, None)


def _resource_to_grid(stage: str, disc) -> dict[int, dict]:
    """type-7 resource id -> decoded grid lookup, for every registration the
    stage's overlay makes."""
    out: dict[int, dict] = {}
    for fn, sub in T.type7_ids(stage):
        row = T.extract_one(disc, stage, fn, sub)
        if row is None or "error" in row:
            continue
        out[(fn << 16) | sub] = row["lookup"]
    return out


def extract(stage: str, disc) -> dict | None:
    data = W.overlay_bytes(stage)
    if data is None:
        return None
    grids = _resource_to_grid(stage, disc)
    layouts = []
    for _off, ptr, res in _fold_stores(data):
        # one layout per distinct program pointer (a body may store once)
        if any(l["program"] == ptr for l in layouts):
            continue
        recs = S.read_step_program_at(data, ptr - BASE)
        layouts.append({
            "resource": None if res is None else "0x%08x" % res,
            "program": "0x%08x" % ptr,
            "program_file": "0x%x" % (ptr - BASE),
            "steps": [
                {"cond_a": ca, "arg_a": aa, "cond_b": cb, "arg_b": ab, "op": op, "params": list(p)}
                for (ca, aa, cb, ab, op, p) in recs
            ],
            "grid": grids.get(res if res is not None else -1),
        })
    if len(layouts) < 2:
        return None
    return {"stage": stage, "layouts": layouts}


def main() -> int:
    args = sys.argv[1:]
    want = [a for a in args if a.lstrip("s").isdigit()]
    stages = want or [p.stem[5:] for p in sorted(W.ASM_DIR.glob("wstag*.s"))
                      if p.stem[5:].isdigit()]
    disc = T.G.Disc(T.G.DISC)
    out: dict[str, dict] = {}
    for st in stages:
        r = extract(st, disc)
        if r:
            out["s" + st] = {"layouts": r["layouts"]}

    # s810 is the stage this tool was written for: pin it so a decode regression
    # (a lost store, a mis-paired grid) fails loudly rather than quietly emitting
    # one layout. All four facts are read twice — here and in the test.
    s810 = out.get("s810")
    assert s810 and len(s810["layouts"]) == 2, "s810 must lift two type-7 layouts"
    assert [l["program_file"] for l in s810["layouts"]] == ["0x1ccc", "0x1fcc"], \
        s810["layouts"]
    assert [l["resource"] for l in s810["layouts"]] == ["0x06ed0003", "0x06ed0004"], \
        [l["resource"] for l in s810["layouts"]]
    # layout 0's step program carries op-8 start_event(9001) — the swap to
    # layout 1; layout 1's carries op-8 start_event(9000) — the swap back.
    def op8_event(layout):
        hits = [(i, s["params"][0]) for i, s in enumerate(layout["steps"]) if s["op"] == 8]
        return hits
    assert (31, 9001) in op8_event(s810["layouts"][0]), op8_event(s810["layouts"][0])
    assert (21, 9000) in op8_event(s810["layouts"][1]), op8_event(s810["layouts"][1])

    print(f"stage layout variants: {len(out)} stage(s) with >1 type-7 phase "
          f"({', '.join(sorted(out))})")
    for name, st in sorted(out.items()):
        for i, l in enumerate(st["layouts"]):
            n_op8 = [s["params"][0] for s in l["steps"] if s["op"] == 8]
            print(f"  {name} layout {i}: resource {l['resource']} program {l['program']} "
                  f"({l['program_file']}) steps={len(l['steps'])} grid={'yes' if l['grid'] else 'NO'} "
                  f"op8_events={n_op8}")

    if "--json" in args:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps({
            "_comment": ("Stages that ship more than one type-7 room phase: each layout "
                         "is a {resource, 24-byte step program} pair the stage's own "
                         "overlay declares, paired by the resource id folded in the same "
                         "native event body. s810 (Undersea Base) is the Gunslinger 1F "
                         "phase switch. Extracted by tools/extract_stage_layout_variants.py; "
                         "the swap events are ported in web/gunslinger-switch.js."),
            "stages": out,
        }, indent=1))
        print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
