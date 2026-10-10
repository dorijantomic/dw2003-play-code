#!/usr/bin/env python3
"""Census of the field scene system's per-place GATE OBJECTS — the whole family.

A wstag overlay allocates its own objects and hands the shared allocator
(F0x80014504 / F0x800143DC) the ADDRESS OF EACH OBJECT'S OWN TICK. When such a tick's
routine calls the shared starter `start_event` (jal 0x800853f8) it is a gate object:
something the disc runs to choose which scene this place starts. Those routines fall
into exactly three groups, and this script measures all three straight out of the
overlays so no member can be lost:

  reset_band  the stage's ENTRY object. Its gate reads the object's own phase word at
              +0xc and runs the chain on 0 / negative / >= 4
              (pro/wstag200.s:24-34, pro/wstag305.s:196-203). Ported by
              tools/extract_arrival_candidates.py + engine/systems/scene-arrival.ts.
  phase1_band a place's SECOND gate object, which runs the chain on phase 1 exactly
              (pro/wstag795.s:0x5b4-0x5d0, pro/wstag800.s:0x8c0-0x8dc). Same port.
  controllers a routine that can hand the starter a CHOICE of two or more event ids
              (pro/wstag220.s:0x488-0x490 `li $a0,0x5e9` / `li $a0,0x35` into one start
              block) — the interactive help-menu / yes-no controllers, a different shared
              system (engine/dw3/ui/native/*) whose event comes from the player's answer.
              A gate object starts AT MOST ONE event per pass, so one literal is the test.

Anything else is reported as `unknown`, which is a failure, not a shrug.

Prints one JSON object. Nothing is written.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from extract_arrival_candidates import (  # noqa: E402
    ASM_DIR,
    JAL_START_EVENT,
    OVERLAY_BASE,
    decode,
    find_ticks,
    load_image,
    phase_gate_of,
    routine_end,
)


MAX_EVENT_ID = 0xFFF


def event_literals(ws, idx, end) -> set:
    """Every literal the body can hand start_event as $a0 (a bare `li $a0, imm` with
    imm inside the plausible event-id range)."""
    out = set()
    for j in range(idx, end):
        d = decode(ws[j])
        if d[0] == "addiu" and d[1] == 4 and d[2] == 0 and 0 <= (d[3] & 0xFFFF) <= MAX_EVENT_ID:
            out.add(d[3] & 0xFFFF)
    return out


def ambient_updater(ws, idx, end, base) -> int | None:
    """A phase-1 gate object calls its overlay's OWN ambient updater (the one call in the
    body that is neither the shared starter nor a known resident entry) and then reads a
    3-byte counter that updater owns. That updater belongs to a different shared system, so
    the oracle stubs it; find its address so the test can, and so the stub can never land
    on an instruction of the routine under test."""
    for j in range(idx, end):
        d = decode(ws[j])
        if d[0] != "jal":
            continue
        target = d[1]
        if target == JAL_START_EVENT or not (base <= target < base + len(ws) * 4):
            continue
        return target
    return None


def main() -> int:
    out = {
        "total": 0,
        "reset_band": 0,
        "phase1_band": 0,
        "controllers": 0,
        "unknown": 0,
        "stages_with_two": 0,
        "overlays": 0,
        "rows": [],
    }
    for path in sorted(ASM_DIR.glob("wstag*.s")):
        num = path.stem[len("wstag"):]
        ws, lines = load_image(path)
        if not ws:
            continue
        out["overlays"] += 1
        sid = "s%s" % num
        per_stage = []
        for site, off, alloc in find_ticks(ws):
            idx = off // 4
            end = routine_end(ws, idx)
            if JAL_START_EVENT not in ws[idx:end]:
                continue
            pg = phase_gate_of(ws, idx, end, lines, "pro/wstag%s.s" % num)
            lits = sorted(event_literals(ws, idx, end))
            kind = ("%s_band" % pg["band"]) if pg else (
                "controllers" if len(lits) >= 2 else "unknown")
            out["total"] += 1
            out[kind] = out.get(kind, 0) + 1
            row = {"stage": sid, "tick": "0x%08x" % (OVERLAY_BASE + off),
                   "kind": kind, "line": lines.get(off), "instructions": end - idx,
                   "event_literals": lits}
            if kind == "phase1_band":
                row["ambient_updater"] = "0x%08x" % (ambient_updater(ws, idx, end, OVERLAY_BASE) or 0)
            out["rows"].append(row)
            per_stage.append(row)
        if len(per_stage) > 1:
            out["stages_with_two"] += 1
    json.dump(out, sys.stdout, indent=1)
    sys.stdout.write("\n")
    return 1 if out["unknown"] else 0


if __name__ == "__main__":
    raise SystemExit(main())