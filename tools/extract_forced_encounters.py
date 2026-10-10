"""
Ambush tiles — the scripted forced encounter a stage starts from a floor patch.

WHAT IT IS.  Fourteen stages mark a small patch of ground (3-13 grid cells)
whose story-step record starts an event handled not by that stage's overlay but
by a RESIDENT fieldstg routine, F0x8008bf38.  Walking onto the patch drops you
straight into a fight with one of that area's own monsters -- Kuwagamon in West
Wire Forest, Crabmon at Divermon's Lake, the red Numemon in the Fire Dungeon.
No cutscene, no NPC: you are simply jumped.

THE ENEMY.  F0x8008bf38 does not carry an enemy id.  It reaches one through the
stage's own encounter tables:

    scene_struct+0x20 -> P            (the stage init stores this pointer)
    P+0x18            -> B            the stage's LAST encounter block, the one
                                      whose leading rate word is 0 -- the block
                                      the random-encounter driver can never
                                      select, reserved for scripted fights
    B+0x18            -> R            slot 5 of that block's eight
    R  = { u32 screen_id, u32 param, u32 music_tag }

`screen_id` then indexes the global record table at 0x80094680, already
extracted to field_encounters.json -- so the party comes from the same authentic
table every random encounter uses.  The sibling routine F0x800927a0 takes the
slot as an argument (`a0 = [B + 4 + 4*index]`); F0x8008bf38 is the fixed-slot-5
entry point, which is why SLOT is a constant here and not per-stage data.

THE GATE.  Every one of these steps gates on `get_flag(0x0f) == 0`, and the
handler's last act is `set_flag(0x0f, 1)`.  The two are the same flag, so the
patches share ONE latch between them rather than owning one each.

The latch is PER VISIT.  Its mechanical job is to stop the step VM relaunching
the fight every tick while you stand on the patch; leave the area and come back
and the ambush is armed again.  That last part is the ONE piece of this mechanic
taken from play rather than from the disassembly -- Minotarumon meets you every
time you drop into Protocol Ruins (user, 2026-07-28) -- because nothing in the
corpus was found that clears the flag: `flag_setters.json` lists exactly one
writer of 0x0f (this handler, value 1), `li $a0, 0xf` occurs three times in all
590078 lines (twice in cardgame, once here), and no store lands in the bank-0
bitfield byte holding bit 15.  Read literally that would make the whole set a
single global one-shot, which it is not.  Neither query can see a clear made
through a computed register, so the clearing site is an OPEN QUESTION, not a
proven absence.  Two of these patches sitting in one room of the Jungle Shrine
is independent structural support for per-visit: a global one-shot would make
the second one pointless.

`set_flag`/`get_flag` for bank 0 resolve to the 12-byte bitfield at 0x80048abc
(EXE F0x800165ac -> F0x800155d4), immediately below the flag API's own function
pointers at +0xc/+0x10 -- so this is a small, session-scoped bitfield, not part
of the large stored save banks.

Output: web/assets/data/forced_encounters.json
    { "s350": {"gateFlag": 15, "eventId": 9000, "stepIndexes": [4],
               "screenId": 41, "param": 13, "music": "0x60080000"}, ... }

Run: python3 tools/extract_forced_encounters.py
"""

import os
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wstag_events as W
from extract_point_sprites import descriptor_stores

ROOT = Path(__file__).resolve().parent.parent
ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
STEPS = ROOT / "web/assets/data/story_steps.json"
EVENTS = ROOT / "web/assets/events/wstag_events.json"
ENCOUNTERS = ROOT / "web/assets/data/field_encounters.json"
OUT = ROOT / "web/assets/data/forced_encounters.json"

BASE = W.OVERLAY_BASE
HANDLER = 0x8008BF38     # resident fieldstg forced-encounter routine
SCENE_FIELD = 0x20       # scene_struct offset the stage init stores P into
BLOCK_FIELD = 0x18       # P+0x18 -> the scripted (rate-0) encounter block
SLOT_FIELD = 0x18        # B+0x18 -> slot 5 of the block's eight
GATE_FLAG = 0x0F         # the shared latch, read by the step and set by handler


def battle_record(stage: str, data: bytes):
    """`{screenId, param, music}` the handler would launch on `stage`, or None."""
    path = ASM / f"wstag{stage}.s"
    if not path.exists():
        return None
    p = (descriptor_stores(path).get(SCENE_FIELD) or [None])[0]
    if p is None:
        return None

    def u32(addr):
        off = addr - BASE
        if off < 0 or off + 4 > len(data):
            return None          # the overlay's data section is past the disasm
        return struct.unpack_from("<I", data, off)[0]

    block = u32(p + BLOCK_FIELD)
    if block is None or not W.is_overlay_ptr(block, data):
        return None
    rec = u32(block + SLOT_FIELD)
    if rec is None or not W.is_overlay_ptr(rec, data):
        return None
    fields = [u32(rec + 4 * i) for i in range(3)]
    if any(f is None for f in fields):
        return None
    return {"screenId": fields[0], "param": fields[1], "music": "0x%08x" % fields[2]}


def main() -> int:
    steps = json.loads(STEPS.read_text())["stages"]
    events = json.loads(EVENTS.read_text())
    screens = json.loads(ENCOUNTERS.read_text())["screens"]

    out, problems = {}, []
    for stage, prog in sorted(steps.items(), key=lambda kv: int(kv[0])):
        by_id = {e["id"]: e for e in events.get("s" + stage, [])}
        # A trigger is recognised STRUCTURALLY: an op-8 step whose event is
        # handled by the resident routine. The gate is then read off the step
        # rather than assumed, and cross-checked below.
        hits = {}
        for idx, step in enumerate(prog["steps"]):
            if step["op"] != 8:
                continue
            ev = by_id.get(step["params"][0])
            if not ev or ev.get("native_fn_ram") != HANDLER:
                continue
            hits.setdefault(step["params"][0], {"stepIndexes": [], "gates": set()})
            hits[step["params"][0]]["stepIndexes"].append(idx)
            hits[step["params"][0]]["gates"].add((step["cond_a"], step["arg_a"]))
        if not hits:
            continue
        if len(hits) > 1:
            problems.append(f"s{stage}: {len(hits)} forced-encounter events, expected 1")
            continue
        ev_id, hit = next(iter(hits.items()))
        if hit["gates"] != {(GATE_FLAG, 0)}:
            problems.append(
                f"s{stage} event {ev_id}: gate {sorted(hit['gates'])}, "
                f"expected only flag 0x{GATE_FLAG:x} clear")
            continue

        data = W.overlay_bytes(stage)
        rec = battle_record(stage, data) if data else None
        if rec is None:
            problems.append(f"s{stage} event {ev_id}: battle record unreadable")
            continue
        if not screens.get(str(rec["screenId"])):
            # An empty slot means the handler would start nothing. Only report
            # it if a step actually reaches the event.
            problems.append(
                f"s{stage} event {ev_id}: slot is screen {rec['screenId']}, "
                f"which has no party in field_encounters.json")
            continue
        out["s" + stage] = {
            "gateFlag": GATE_FLAG,
            "eventId": ev_id,
            "stepIndexes": sorted(hit["stepIndexes"]),
            **rec,
        }

    if problems:
        print("forced-encounter extraction problems:", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        return 1

    OUT.write_text(json.dumps(out, indent=2) + "\n")
    names = json.loads((ROOT / "data/stage_names.json").read_text())
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} ambush tiles")
    for k, v in out.items():
        who = ", ".join(f"{e['name']} L{e['level']}"
                        for e in screens[str(v["screenId"])])
        print(f"  {k:6s} {names.get(k, '?'):38s} screen {v['screenId']:>4}  {who}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
