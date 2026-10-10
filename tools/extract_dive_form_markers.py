#!/usr/bin/env python3
"""
Dive-form marker extractor — which underground screens you cross as Digmon or
Submarimon.

WHAT IT IS.  When you dive through a hole or a water surface the field cast is
rebuilt for the destination stage, and the player character is chosen from that
stage's OWN cast list.  A cast record whose id is 0x146 becomes Digmon
(p123digm), 0x147 becomes Submarimon (p122sbmm); with no such record you get
Junior.  So the traversal form is a property of the SCREEN, and it is declared
in the screen's own data — not in the door graph that led you there.

DECODE (original assembly, ~/ddw3/asm/dw2003/pro/wstag*.s, overlay RAM base
0x800a5de0 -- see tools/overlay_scan.py _stem_base):

  The scene descriptor's +0x4C field is a pointer to the stage's cast list, an
  array of 0-terminated pointers.  The cast rebuild F0x8008AE50 (fieldstg.s
  file 0x81a0, RAM 0x8008ae50) walks that list, reads each record's id as the
  signed halfword at record+0x8, and for 0x146/0x147 calls the field-character
  constructor F0x8009116c with that id (fieldstg.s:8321-8371).  For the player
  records the marker word0 is 0, so the spawn predicate is skipped and the
  marker is unconditional; that is the filter used here.

  The walker (engine/systems/dive-form.ts) used to derive the form from the
  exit graph.  That under-covers the native set: 30 screens carry a marker,
  but the exit graph sees only the ordinary exits and never the maze-resolved
  entries, so it missed 14 maze-entered screens where the player reverted to
  the walking Digimon.  See claim
  world-q001-dive-form-is-a-per-screen-cast-marker-2026-09-13.

Output: web/assets/data/dive_form_markers.json
    { "s825": 327, "s860": 327, "s875": 326, ... }   (screen -> sprite id)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASM = Path.home() / "ddw3" / "asm" / "dw2003" / "pro"
DESCRIPTORS = ROOT / "docs" / "generated" / "stage-descriptors.json"
OUT = ROOT / "web" / "assets" / "data" / "dive_form_markers.json"

# Every `wstag*` overlay loads here (tools/overlay_scan.py: `_stem_base`).
BASE = 0x800A5DE0

# The player-form cast ids: Digmon and Submarimon.
PLAYER_FORM_IDS = (0x146, 0x147)

LABEL_RE = re.compile(r"^\.L0x([0-9a-f]{8}): \.word 0x([0-9a-f]{8})", re.M)


def read_words(path: Path) -> dict[int, int]:
    """File offset -> word value, from the disassembly's `.L0x` directives."""
    words: dict[int, int] = {}
    for match in LABEL_RE.finditer(path.read_text()):
        words[int(match.group(1), 16)] = int(match.group(2), 16)
    return words


def cast_form(words: dict[int, int], cast_list_ram: int) -> int | None:
    """The unconditional Digmon/Submarimon marker in one stage's cast list."""
    array = cast_list_ram - BASE
    for i in range(64):
        record_ptr = words.get(array + 4 * i, 0)
        if record_ptr == 0:
            break
        record = record_ptr - BASE
        word0 = words.get(record)
        word8 = words.get(record + 8)
        if word8 is None:
            continue
        marker_id = word8 & 0xFFFF
        if marker_id in PLAYER_FORM_IDS and word0 == 0:
            return marker_id
    return None


def main() -> int:
    if not DESCRIPTORS.exists():
        print(f"missing {DESCRIPTORS}", file=sys.stderr)
        return 1
    descriptors = json.loads(DESCRIPTORS.read_text())

    markers: dict[str, int] = {}
    for entry in descriptors:
        stage = entry.get("stage", "")
        if not stage.startswith("wstag"):
            continue
        cast_list = entry.get("fields", {}).get("4C", "")
        if not re.fullmatch(r"0x[0-9a-fA-F]{8}", str(cast_list)):
            continue
        path = ASM / f"{stage}.s"
        if not path.exists():
            continue
        marker = cast_form(read_words(path), int(cast_list, 16))
        if marker is not None:
            markers[stage.replace("wstag", "s")] = marker

    OUT.write_text(json.dumps(dict(sorted(markers.items())), indent=2) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(markers)} screens carry a dive-form marker")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
