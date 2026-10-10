#!/usr/bin/env python3
"""
NPC confirm-box half-widths — how close and how square-on you must be to talk.

WHAT IT IS.  The field confirm button picks its target by computing an action
point a step in front of the player and asking "which actor's box contains this
point?".  The box is not a fixed radius: it comes from a per-npc_id size byte.

DECODE (fieldstg; corrected 2026-09-13):

  - Action point: F0x80090F70 adds the 8-entry offset table 0x80097CCC to the
    character's position — 16 px straight ahead, 11 px on a diagonal.
  - Probe F0x8008E210 returns the first resident class-5 actor whose box
    contains that point: |px - x| <= +0x80 and |py - y| <= (+0x80 >> 1).
  - The box half-width +0x80 is set once in the constructor F0x8009116C:
    `+0x80 = F0x800920F8(npc_id) >> 1`.  F0x800920F8 is a byte table at
    0x8009A458 indexed by npc_id, so half-width = table[npc_id] >> 1.

Output: web/assets/data/npc_confirm_box.json
    { "1": 16, "12": 16, "48": 12, ... }   npc_id -> box half-width (>= 0)
Ids the table has no entry for are omitted; the caller then falls back to the
radius the walker already used.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMAGE = ROOT / "web" / "assets" / "native" / "fieldstg.bin"
OUT = ROOT / "web" / "assets" / "data" / "npc_confirm_box.json"

# fieldstg loads at 0x80082CB0; the size byte table sits at 0x8009A458.
TABLE_OFFSET = 0x8009A458 - 0x80082CB0


def main() -> int:
    if not IMAGE.exists():
        print(f"missing {IMAGE}", file=sys.stderr)
        return 1
    blob = IMAGE.read_bytes()
    if TABLE_OFFSET + 256 > len(blob):
        print("fieldstg image is too short for the size table", file=sys.stderr)
        return 1
    table = blob[TABLE_OFFSET:TABLE_OFFSET + 256]
    boxes = {str(npc_id): size >> 1 for npc_id, size in enumerate(table) if size}
    OUT.write_text(json.dumps(dict(sorted(boxes.items(), key=lambda kv: int(kv[0]))), indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(boxes)} npc ids with a confirm box")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
