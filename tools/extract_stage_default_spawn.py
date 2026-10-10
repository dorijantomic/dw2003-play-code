#!/usr/bin/env python3
"""
Stage default-spawn extractor — where you stand when a stage loads without a warp.

WHAT IT IS.  A stage entered by a warp positions you from the warp record, but a
stage entered directly (first load, or a scripted hand-off) uses the scene
descriptor's own default spawn.  The walker centred the player when no warp
spawn was supplied; the original uses per-stage descriptor fields.

DECODE (fieldstg F0x8009116c, the field-character constructor; corrected
2026-09-13):

  exe-decomp/fieldstg_c/F0x8009116c.c:61-70 seeds the leader from the scene
  descriptor (0x80099D80):
      +0x50 <- descriptor+0x2C    (X)
      +0x54 <- descriptor+0x30    (Y)
      +0x60 <- descriptor+0x34    (facing)
      +0x58 = +0x50 >> 8          (map pixel X)
      +0x5C = +0x54 >> 8          (map pixel Y)
  so the descriptor stores 24.8 fixed-point, and the map pixel is `raw >> 8`
  with no origin or stage-cell term.  Measured: 273/273 stages that have an
  extracted map and collision put `raw >> 8` on a walkable cell (74% of the grid
  is blocked, so a wrong divisor/offset would land on walls).  The two
  exceptions, s415 and s815, have no proper map pack in the walker (one is a
  cutscene backdrop, one has a known-wrong manifest size).

The 2026-08-05 doc's "does not convert" section is contradicted: its
counterexample coordinates belong to wstag895 (map 1152x768), not s415, and the
call it cited at descriptor+0x7C is the encounter-selector picker, whose two
coordinate arguments are never read (fieldstg F0x800921E4 reads only the table
and key).  See claim stage-default-spawn-is-descriptor-raw-shift-8-2026-09-13.

Output: web/assets/data/stage_default_spawn.json
    { "s200": {"x": 256, "y": 224, "facing": 0}, ... }
`facing` is the descriptor's raw +0x34; 0 means "not authored" and the walker
keeps its own default.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DESCRIPTORS = ROOT / "docs" / "generated" / "stage-descriptors.json"
OUT = ROOT / "web" / "assets" / "data" / "stage_default_spawn.json"

HEX = re.compile(r"0x[0-9a-fA-F]+$")


def s32(value: int) -> int:
    value &= 0xFFFFFFFF
    return value - 0x100000000 if value >= 0x80000000 else value


def parse_hex(text: object) -> int | None:
    text = str(text)
    return int(text, 16) if HEX.match(text) else None


def main() -> int:
    if not DESCRIPTORS.exists():
        print(f"missing {DESCRIPTORS}", file=sys.stderr)
        return 1
    descriptors = json.loads(DESCRIPTORS.read_text())

    out: dict[str, dict[str, int]] = {}
    for entry in descriptors:
        stage = entry.get("stage", "")
        if not stage.startswith("wstag"):
            continue
        fields = entry.get("fields", {})
        raw_x, raw_y = parse_hex(fields.get("2C")), parse_hex(fields.get("30"))
        if raw_x is None or raw_y is None:
            continue
        # 24.8 fixed point -> map pixels (fieldstg F0x8009116c +0x58/+0x5C).
        x, y = s32(raw_x) >> 8, s32(raw_y) >> 8
        facing = parse_hex(fields.get("34")) or 0
        out[stage.replace("wstag", "s")] = {"x": x, "y": y, "facing": facing}

    OUT.write_text(json.dumps(dict(sorted(out.items())), indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(out)} stages with a default spawn")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
