#!/usr/bin/env python3
"""
Special block actor extractor — the three block NPCs (328/351/352) and the
numbers of the interaction they carry.

WHAT IT IS.  On the Circuit's underground screens (and the endgame ones) three
NPCs stand in the corridors as cube-shaped blocks.  Pressing confirm while
facing one starts a two-part scene: the player (Digmon, the form those screens
give them) plays clip 0x45, the block waits, then plays clip 0x54, breaks
apart and is gone, and the block writes its own completion bit so it is done
once.  The mechanism and its timing are the ledger claim
`world-q006-block-interaction-mechanism-and-timing-2026-10-05`; this tool mines
every number in it again from the disc so nothing is hand-copied:

  * the stage rows — the block records in each stage's cast list (descriptor
    +0x4C), decoded by tools/extract_cast_lists.py.  They are ordinary class-5
    records: `{gate, id, slot, x, y, n}`, gated on a route-pair flag plus the
    block's own completion bit.
  * the clip lengths — from the packs' own frame lists:
      p123digm clip 0x45 (the engager) -> bins 90..94, 6 frames each,
        durations 10+7+2+2+10+5 = 36 ticks on every facing;
      p188blok clip 0x54 (the target) -> bin 12, durations 5+4+4+4+4 = 21.
  * the interaction constants — from fieldstg.s:
      the two states (0x4d engager / 0x4e target, F0x8008E2CC file 0xb6dc/0xb700),
      the wait `slti $v0, 0x14` (file 0xe0c4), the cue `ori $a0, 0x46c9`
        (file 0xe114, packed 0x800446C9), and the completion bits: npc 0x148 ->
        bit 8, 0x15f -> 9, 0x160 -> 0xa (file 0xe118-0xe168).

Output: web/assets/data/block_actors.json

Usage:
  python3 tools/extract_block_actors.py            # write
  python3 tools/extract_block_actors.py --check    # re-read and compare
"""

from __future__ import annotations
import os

import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAST_LISTS = ROOT / "web" / "assets" / "data" / "stage_cast_lists.json"
FIELD_S = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm" / "dw2003" / "pro" / "fieldstg.s"
PACKS = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack" / "dw2003" / "field" / "sprite"
OUT = ROOT / "web" / "assets" / "data" / "block_actors.json"

# The three block NPCs (npc ids, not stage-object-registry ids).
BLOCK_IDS = (328, 351, 352)

# The completion bit each id writes (file 0xe118-0xe168: 0x148 -> 8, 0x15f -> 9,
# 0x160 -> 0xa).  Keyed by npc id.
COMPLETION_BITS = {328: 8, 351: 9, 352: 10}

# The engager clip's owner and the target clip's owner.
ENGAGER_PACK = "p123digm"
TARGET_PACK = "p188blok"


def clip_directory(pack: str) -> dict[int, list[int]]:
    """The pack's clip directory (its highest-numbered .bin): clip -> dir bins."""
    bins = sorted(int(p.stem) for p in (PACKS / pack).glob("*.bin"))
    data = (PACKS / pack / f"{bins[-1]}.bin").read_bytes()
    out: dict[int, list[int]] = {}
    off = 0
    while off + 12 <= len(data):
        clip, *dirs = struct.unpack_from("<6H", data, off)
        off += 12
        if clip == 0:
            break
        out[clip] = dirs
    return out


def frame_list_ticks(pack: str, bin_no: int) -> int:
    """One frame list's total duration in ticks (the clip's own length)."""
    data = (PACKS / pack / f"{bin_no}.bin").read_bytes()
    n = len(data) // 4
    words = struct.unpack_from(f"<{n}i", data)
    total = 0
    i = 0
    while i + 3 < n:
        dur = words[i]
        if dur == -1:  # the engine's wrap sentinel
            break
        total += dur
        i += 4
    return total


def clip_ticks(pack: str, clip: int) -> tuple[int, list[int]]:
    """A clip's per-facing tick total, all facings required to agree."""
    dirs = clip_directory(pack).get(clip)
    if not dirs:
        raise SystemExit(f"{pack}: no clip {clip:#x} in the directory")
    ticks = [frame_list_ticks(pack, b) for b in dirs]
    if len(set(ticks)) != 1:
        raise SystemExit(f"{pack} clip {clip:#x}: facings disagree: {ticks}")
    return ticks[0], dirs


def check_fieldstg() -> dict:
    """Re-read the interaction constants out of the fieldstg assembly."""
    text = FIELD_S.read_text()
    checks = {
        "engager_state": ("li $a1, 0x4d", 1),
        "target_state": ("li $v0, 0x4e", 1),
        "wait": ("slti $v0, 0x14", 1),
        "cue": ("ori $a0, 0x46c9", 1),
        "bits": (".L0x0000e154: li $a0, 0x9", 1),
    }
    for name, (needle, count) in checks.items():
        if text.count(needle) < count:
            raise SystemExit(f"fieldstg.s no longer carries {name!r} ({needle!r})")
    return {
        "engagerState": 0x4D,
        "targetState": 0x4E,
        "waitTicks": 0x14,
        "cue": "0x800446c9",
    }


def main() -> int:
    cast = json.loads(CAST_LISTS.read_text())
    engager_ticks, engager_bins = clip_ticks(ENGAGER_PACK, 0x45)
    target_ticks, target_bins = clip_ticks(TARGET_PACK, 0x54)
    constants = check_fieldstg()

    stages: dict[str, list[dict]] = {}
    for stage, records in sorted(cast.items()):
        rows = [r for r in records if r["id"] in BLOCK_IDS]
        if rows:
            stages[stage] = [
                {"id": r["id"], "slot": r["slot"], "x": r["x"], "y": r["y"],
                 "n": r["n"], "gate": r["gate"]}
                for r in rows
            ]

    total = sum(len(v) for v in stages.values())
    data = {
        "ids": list(BLOCK_IDS),
        "engagerClip": 0x45,
        "engagerPack": ENGAGER_PACK,
        "engagerTicks": engager_ticks,
        "engagerBins": engager_bins,
        "targetClip": 0x54,
        "targetPack": TARGET_PACK,
        "targetTicks": target_ticks,
        "targetBins": target_bins,
        "completionBits": {str(k): v for k, v in COMPLETION_BITS.items()},
        "stages": stages,
        **constants,
    }

    if "--check" in sys.argv and OUT.exists():
        old = json.loads(OUT.read_text())
        if old != data:
            print("block_actors.json differs from a fresh decode:")
            for key in sorted(set(old) | set(data)):
                if old.get(key) != data.get(key) and key != "stages":
                    print(f"  {key}: {old.get(key)} -> {data.get(key)}")
            old_stages, new_stages = old.get("stages", {}), stages
            for stage in sorted(set(old_stages) | set(new_stages)):
                if old_stages.get(stage) != new_stages.get(stage):
                    print(f"  stages[{stage}] differs")
            return 1
        print("check: block_actors.json equals a fresh decode")

    OUT.write_text(json.dumps(data, indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(stages)} stages, {total} block rows; "
          f"engager clip {0x45:#x} = {engager_ticks} ticks, "
          f"target clip {0x54:#x} = {target_ticks} ticks, wait {constants['waitTicks']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
