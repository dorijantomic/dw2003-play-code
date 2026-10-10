"""
Fishing-spot extractor — where you can fish, and what bites.

WHAT IT IS.  Once you own the FishingPole, the water's edge of forty-six stages
grows fishing spots.  Stand on one and a bobber goes out; a marker sweeps back
and forth along a bar; press CIRCLE to strike.  Where the sweep stops decides
whether anything was on the line -- and what comes up is not an item, it is a
FIGHT.  On the water stages that is usually a Cardmon.

DECODE (original assembly, ~/ddw3/asm/dw2003/pro/fieldstg.s, overlay RAM base
0x80082cb0; the bobber state machine itself is ported in
engine/systems/fishing.ts and written up in
docs/research/field/fishing-system-decoded-2026-07-11.md).

  THE SPOTS.  A fishing spot is a step-VM record with opcode 7, gated
  `get_flag(0x8005) == 1` -- flag 0x8005 is FishingPole possession (bank 0x80,
  item id 5).  Every op-7 record in the whole corpus carries that gate and no
  other, so op 7 IS "fishing spot" and the census below is exact.  op-7's
  exec#1 handler (file 0x5894 -> the shared tail at 0x58e0) tags the step's
  scene controller mode 5; exec#2 (file 0x5b58) calls that controller's +0x120
  slot, F0x8008f304 (file 0xc654), which spawns the bobber at
  `([ctrl+0x58] + params[0], [ctrl+0x5c] + params[1])`.  So params[0..1] are the
  bobber's spawn offset from the spot -- a signed u16 pair.  params[2..6] are
  zero in all 212 records.

  WHAT BITES.  On a hit the bobber calls [0x8009b6a4] = F0x800927a0 (file
  0xfaf0) with an index, and that routine reads the stage's SCRIPTED (rate-0)
  encounter block -- `rec = [[scene+0x20] + 0x18] + 4 + 4*index` -- copies the
  record's param/music into the battle globals at 0x80042b1c and hands the
  screen id to F0x8008b798, the ordinary battle-setup path.  This is the same
  block, reached the same way, as the ambush tiles in
  tools/extract_forced_encounters.py; they take the fixed slot 5, fishing takes
  slot 4 or slot 7 depending on which of the two hit codes the sweep landed on.

Output: web/assets/data/fishing_spots.json
    { "s485": { "gateFlag": 32773,
                "spots": [ {"stepIndex", "dx", "dy"}, ... ],
                "catch": { "4": {"screenId", "param", "music"},
                           "7": {"screenId", "param", "music"} } }, ... }

Run: python3 tools/extract_fishing_spots.py
     python3 tools/extract_fishing_spots.py --print
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
ENCOUNTERS = ROOT / "web/assets/data/field_encounters.json"
OUT = ROOT / "web/assets/data/fishing_spots.json"

BASE = W.OVERLAY_BASE
SPOT_OP = 7              # step opcode that builds a fishing spot
POLE_FLAG = 0x8005       # FishingPole possession; the only gate op 7 ever carries
SCENE_FIELD = 0x20       # scene_struct offset the stage init stores P into
BLOCK_FIELD = 0x18       # P+0x18 -> the scripted (rate-0) encounter block
CATCH_SLOTS = (4, 7)     # the two hit codes the bobber's sweep can land on


def signed16(v: int) -> int:
    return v - 0x10000 if v >= 0x8000 else v


def catch_records(stage: str, data: bytes):
    """`{slot: {screenId, param, music}}` for the two fishing hit slots."""
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
    out = {}
    for slot in CATCH_SLOTS:
        rec = u32(block + 4 + 4 * slot)
        if rec is None or not W.is_overlay_ptr(rec, data):
            return None
        fields = [u32(rec + 4 * i) for i in range(3)]
        if any(f is None for f in fields):
            return None
        out[str(slot)] = {
            "screenId": fields[0], "param": fields[1], "music": "0x%08x" % fields[2],
        }
    return out


def main() -> int:
    steps = json.loads(STEPS.read_text())["stages"]
    screens = json.loads(ENCOUNTERS.read_text())["screens"]

    out, problems = {}, []
    for stage, prog in sorted(steps.items(), key=lambda kv: int(kv[0])):
        spots = []
        for idx, step in enumerate(prog["steps"]):
            if step["op"] != SPOT_OP:
                continue
            # The gate is READ off the record, never assumed -- if a future
            # extraction turns up an op-7 record gated on something other than
            # the pole, that is a finding, not a spot to emit silently.
            if (step["cond_a"], step["arg_a"]) != (POLE_FLAG, 1):
                problems.append(
                    f"s{stage} step {idx}: op 7 gated "
                    f"0x{step['cond_a']:04x}={step['arg_a']}, expected "
                    f"0x{POLE_FLAG:04x}=1")
                continue
            if any(step["params"][2:]):
                problems.append(f"s{stage} step {idx}: op 7 params[2..6] not zero")
                continue
            spots.append({
                "stepIndex": idx,
                "dx": signed16(step["params"][0]),
                "dy": signed16(step["params"][1]),
            })
        if not spots:
            continue

        data = W.overlay_bytes(stage)
        catch = catch_records(stage, data) if data else None
        if catch is None:
            problems.append(f"s{stage}: scripted encounter block unreadable")
            continue
        out["s" + stage] = {"gateFlag": POLE_FLAG, "spots": spots, "catch": catch}

    if problems:
        print("fishing-spot extraction problems:", file=sys.stderr)
        for p in problems:
            print("  " + p, file=sys.stderr)
        return 1

    OUT.write_text(json.dumps(out, indent=2) + "\n")
    total = sum(len(v["spots"]) for v in out.values())
    print(f"wrote {OUT.relative_to(ROOT)}: {total} spots on {len(out)} stages")
    if "--print" in sys.argv:
        names = json.loads((ROOT / "data/stage_names.json").read_text())
        for k, v in out.items():
            who = []
            for slot in ("4", "7"):
                party = screens.get(str(v["catch"][slot]["screenId"])) or []
                who.append("/".join(e["name"] for e in party) or "-")
            print(f"  {k:6s} {names.get(k, '?'):34s} {len(v['spots']):2d} spots  "
                  f"hit1 {who[0]:24s} hit2 {who[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
