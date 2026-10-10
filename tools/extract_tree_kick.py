"""TreeBoots tree-kicking extractor -- which trees you can kick, and what falls out.

WHAT IT IS.  Once you own the TreeBoots, every palm/tree decoration on a stage
becomes kickable.  Walk up to one, press the action button, and Junior kicks it.
Only ONE tree on the stage is "active" at a time: kicking that one drops an
encounter and the active marker jumps to another tree; kicking any other one
just shakes it and puts a radar card on screen telling you how far away the
active tree is.

DECODE (original assembly, ~/ddw3/asm/dw2003/pro/fieldstg.s, overlay RAM base
0x80082cb0; write-up docs/research/field/tree-boots-kicking-decoded-2026-07-29.md,
state machine ported in engine/systems/tree-kick.ts).

  THE TREES ARE POINT SPRITES.  The point-sprite renderer's init (file 0x63d0)
  counts the stage's 18-byte point records whose atlasFlag byte (+0x01) is 0xFF
  -- the FIELDCOM-atlas records, i.e. the trees -- and if there is at least one
  it builds the type-0x0B tree manager, F0x8008ccc8 (file 0xa018), with that
  count.  The manager allocates count * 0x14 bytes and copies each 0xFF record's
  x (+0x0a) and y (+0x0c) into its own record {sprite, pointIndex, x, y, active}.
  Both loops walk the point table until a record's y is zero.

  So the kickable trees ARE the stage's FIELDCOM point records, in table order,
  and their coordinates are already in web/assets/data/point_sprites.json --
  this tool just republishes the manager's view of them.  Cross-check: s485's
  16 records reproduce the 2026-07-29 runtime capture exactly (record 3 at
  (544,207), the active record 8 at (976,143), the relocation target 6 at
  (816,159)).

  WHAT FALLS OUT.  On the active tree the manager rolls `rand() & 0x7f` and
  dispatches encounter index 3 when that is below 0x66 (102/128) and index 6
  otherwise (26/128), through the live field function pointer at 0x8009b6a4 =
  F0x800927a0 (file 0xfaf0).  That is the SAME scripted (rate-0) encounter block
  the ambush tiles and fishing read -- `rec = [[scene+0x20] + 0x18] + 4 + 4*index`
  -- so the two parties come out of the stage's own data, not a drop table.

Output: web/assets/data/tree_kick.json
    { "s485": { "gateFlag": 32772,
                "trees": [ {"rec", "x", "y"}, ... ],
                "encounters": { "3": {"screenId", "param", "music"},
                                "6": {...} } }, ... }

Run: python3 tools/extract_tree_kick.py
     python3 tools/extract_tree_kick.py --print
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
POINTS = ROOT / "web/assets/data/point_sprites.json"
ENCOUNTERS = ROOT / "web/assets/data/field_encounters.json"
OUT = ROOT / "web/assets/data/tree_kick.json"

BASE = W.OVERLAY_BASE
BOOTS_FLAG = 0x8004      # TreeBoots possession (bank 0x80, item id 4)
TREE_ATLAS_FLAG = 0xFF   # point record +0x01: FIELDCOM atlas == a kickable tree
SCENE_FIELD = 0x20       # scene_struct offset the stage init stores P into
BLOCK_FIELD = 0x18       # P+0x18 -> the scripted (rate-0) encounter block
KICK_SLOTS = (3, 6)      # the two indices the active-tree roll dispatches


def catch_records(stage: str, data: bytes):
    """`{slot: {screenId, param, music}}` for the two active-tree roll outcomes."""
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
    for slot in KICK_SLOTS:
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


def stage_trees(records: list[dict]) -> list[dict]:
    """The manager's record list: every atlasFlag-0xFF point record, in order.

    Termination is the MANAGER's, not the renderer's: both its counting loop
    (file 0x63d8) and its copy loop (file 0xa078) stop at the first record whose
    y is zero, which is not necessarily where the renderer's size-0 terminator
    is. Walking the same way keeps the index numbering identical to the runtime's.
    """
    trees = []
    for i, r in enumerate(records):
        if r["y"] == 0:
            break
        if r["atlasFlag"] == TREE_ATLAS_FLAG:
            trees.append({"rec": i, "x": r["x"], "y": r["y"]})
    return trees


def main() -> int:
    points = json.loads(POINTS.read_text())
    screens = json.loads(ENCOUNTERS.read_text())["screens"]

    out, no_block = {}, []
    for stage, s in sorted(points.items(), key=lambda kv: int(kv[0][1:])):
        trees = stage_trees(s["records"])
        if not trees:
            continue
        data = W.overlay_bytes(stage[1:])
        catch = catch_records(stage[1:], data) if data else None
        if catch is None:
            # The manager is still built (the kick and the radar work), but this
            # stage's scripted block could not be read, so nothing is claimed
            # about what its active tree drops.
            no_block.append(stage)
        out[stage] = {"gateFlag": BOOTS_FLAG, "trees": trees, "encounters": catch}

    OUT.write_text(json.dumps(out, indent=2) + "\n")
    total = sum(len(v["trees"]) for v in out.values())
    print(f"wrote {OUT.relative_to(ROOT)}: {total} trees on {len(out)} stages"
          + (f"; {len(no_block)} without a readable encounter block" if no_block else ""))
    if "--print" in sys.argv:
        names = json.loads((ROOT / "data/stage_names.json").read_text())
        for k, v in out.items():
            who = []
            for slot in ("3", "6"):
                rec = (v["encounters"] or {}).get(slot)
                party = screens.get(str(rec["screenId"])) if rec else None
                who.append("/".join(e["name"] for e in (party or [])) or "-")
            print(f"  {k:6s} {names.get(k, '?'):34s} {len(v['trees']):2d} trees  "
                  f"near {who[0]:24s} far {who[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
