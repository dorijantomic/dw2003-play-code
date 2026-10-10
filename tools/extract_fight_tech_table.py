#!/usr/bin/env python3
"""Extract the full 18-byte tech record table @0x80042bca (stride 0x12, 443 techs).

Source: ~/ddw3/rust/dw2003_exe_data/src/data.rs `D0x80042bdc: [Unknown3; 443]`
(declared from tech index 1; the record at 0x80042bca itself = index 0, unused).
Field map decoded in docs/research/fight-3d/tech-effects-decode.md.

Output: web/assets/data/fight_tech_table.json  { "1": {mp,power,category,elem1,elem2,
  dispatch,crit,effect,motion,clip,...raw}, ... }
"""
import os
import json
import re
import sys
from pathlib import Path

DATA_RS = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "rust/dw2003_exe_data/src/data.rs"
OUT = Path(__file__).resolve().parent.parent / "web/assets/data/fight_tech_table.json"


def main() -> int:
    rows = []
    for line in DATA_RS.read_text().splitlines():
        m = re.match(r"\s*Unknown3 \{ (.+) \},", line)
        if m:
            d = {k.strip(): int(v, 16) for k, v in (p.split(":") for p in m.group(1).split(","))}
            rows.append(d)
    assert len(rows) == 443, f"expected 443 tech rows, got {len(rows)}"
    out = {}
    for i, r in enumerate(rows):
        tech = i + 1  # table declared from index 1
        out[str(tech)] = {
            "mp": r["f0"],            # +0x00 u16
            "power": r["f1"],         # +0x02 u16
            "category": r["f2"],      # +0x04 (2=phys, 3=magic, ..6)
            "f3": r["f3"],            # +0x05 unknown
            "elemCtx": r["f4"] & 0xFF,     # +0x06
            "elem1": (r["f4"] >> 8) & 0xFF,  # +0x07
            "scalar": r["f5"],        # +0x08
            "elem2": r["f6"],         # +0x09
            "dispatch": r["f7"],      # +0x0a special-op code
            "f8": r["f8"],            # +0x0b unknown
            "crit": r["f9"],          # +0x0c
            "sigEffect": r["f10"],    # +0x0d (33..54; candidate per-model effect slot)
            "effect": r["f11"],       # +0x0e op3 effect type (0..65)
            "motion": r["f12"],       # +0x0f attack motion id -> actor +0x68
            "clip": r["f13"],         # +0x10 action-script clip
            "f14": r["f14"],          # +0x11 unknown (1..4)
        }
    OUT.write_text(json.dumps(out))
    # sanity: shipped heuristic must hold for the walker's 104 story techs
    bad = [t for t in range(1, 53) if out[str(t)]["clip"] != 5]
    bad += [t for t in range(53, 105) if out[str(t)]["clip"] != 11]
    print(f"wrote {OUT} ({len(out)} techs); clip-rule mismatches in 1..104: {bad}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
