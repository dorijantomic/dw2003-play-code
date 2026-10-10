#!/usr/bin/env python3
"""
Extract the eight per-line digivolution trees from the disc's own overlay image.

Source:
  web/assets/native/screens/pro_stfgtrep.bin  (pro/stfgtrep, loaded at 0x80082CB0)

The digivolution unlock routine is pro/stfgtrep.s file 0x369C-0x390C (RAM
0x8008634C). It picks the line by ROSTER SLOT out of the eight pointers at
0x8008903C (`sll $v0,$s4,0x2` / `addu $v0,$v1` / `lw $s7,($v0)` at file
0x36C8-0x36EC) and scans that line's 44 records of 0x10 bytes in TABLE ORDER,
restarting at record 0 on every call (file 0x38C8: `addiu $s3,0x10`, bound
`addiu $v0,$s7,0x2c0` / `slt $s3,$v0` at 0x38CC-0x38D0). One record is:

  +0x00 u32  to        DigimonId it grants   (`lw $v0,($s3)`, then 88*(id-1) off 0x8003EF5C)
  +0x04 u16  req0 evo  a DigimonId, 0 = no gate  (`lh 0x4($s0)`, `beqz` at 0x3750)
  +0x06 u16  req0 SkillLV  its ledger entry's form level (`lh 0x6($s0)`)
  +0x08 u16  req1 evo  the loop steps $s0 by 4 (`addiu $s0,0x4`, file 0x37BC) and runs twice
  +0x0A u16  req1 SkillLV
  +0x0C u16  kind      0 none | 1..6 str,def,spt,wis,spd,chr | 7 the line's own level
                       | 8..14 the seven elements   (`lh 0xc($s3)`, 0x37C8-0x3850)
  +0x0E u16  threshold compared `>=` (`slt $v0,$v0,$v1` + `beqz` at 0x385C)

Output schema, one entry per roster slot in slot order:
  {
    "lines": [
      { "slot": 0, "digimonId": 1, "records": [
          {"to": 9, "req0": 0, "req0Level": 1, "req1": 0, "req1Level": 1,
           "kind": 7, "threshold": 5},
          ... 44 rows ...
      ]},
      ... 8 lines ...
    ]
  }

`to`, `req0` and `req1` are DigimonIds, which are the 1-based indices of the
55-row species table at 0x8003EF5C — the same rows, in the same order, as
web/assets/data/digimon.json (tests/lane-b/dna-command.test.js:198). The
walker's form ledger is keyed by that DigimonId, so no name lookup happens here
and nothing in this file can be spelled wrong.
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCREENS = ROOT / "web/assets/native/screens"
OVERLAY = SCREENS / "pro_stfgtrep.bin"
OUT = ROOT / "web/assets/data/evolutions.json"

LOAD_BASE = 0x80082CB0
# `lui $v1,0x8009` / `addiu $v1,-0x6fc4` = 0x8008903C (file 0x36C0-0x36C4).
TREE_GROUP_TABLE = 0x8008903C
LINE_COUNT = 8           # the eight roster slots the table has one pointer each for
RECORD_SIZE = 0x10       # `addiu $s3,0x10` (file 0x38C8)
GROUP_BYTES = 0x2C0      # `addiu $v0,$s7,0x2c0` (file 0x38CC); 0x2C0 / 0x10 = 44 records
RECORD_COUNT = GROUP_BYTES // RECORD_SIZE
SPECIES_TABLE = 0x8003EF5C
SPECIES_STRIDE = 0x58    # `sll $v1,$v0,0x3` of 11*(id-1) (file 0x3708-0x3718)
SPECIES_ROWS = 55        # the table is contiguous from row 1 to row 55


def read_lines(image: bytes) -> list[dict]:
    dv = memoryview(image)
    lines = []
    for slot in range(LINE_COUNT):
        at = TREE_GROUP_TABLE - LOAD_BASE + 4 * slot
        group = struct.unpack_from("<I", dv, at)[0]
        start = group - LOAD_BASE
        end = start + GROUP_BYTES
        if end > len(image):
            raise ValueError(
                f"line {slot} runs to file 0x{end:x}, past the {len(image)}-byte image"
            )
        records = []
        for i in range(RECORD_COUNT):
            off = start + RECORD_SIZE * i
            to, req0, req0_level, req1, req1_level, kind, threshold = struct.unpack_from(
                "<IHHHHHH", dv, off
            )
            records.append({
                "to": to,
                "req0": req0,
                "req0Level": req0_level,
                "req1": req1,
                "req1Level": req1_level,
                "kind": kind,
                "threshold": threshold,
            })
        # `rosterSlotDigimonId` is slot + 1 (engine/dw3/roster.ts:54): the eight
        # starters are species rows 1..8.
        lines.append({"slot": slot, "digimonId": slot + 1, "records": records})
    return lines


def main(argv=None) -> int:
    image = OVERLAY.read_bytes()
    payload = {"lines": read_lines(image)}
    # The unlock routine converts `to`, `req0` and `req1` through the species table
    # (88*(id-1) off 0x8003EF5C), so an id outside it could never be looked up. The
    # row count is the length of the contiguous block the pointer table covers.
    used = sorted({r[f] for line in payload["lines"] for r in line["records"]
                   for f in ("to", "req0", "req1")} - {0})
    if used and (used[0] < 1 or used[-1] > SPECIES_ROWS):
        raise ValueError(
            f"tree names DigimonId {used[-1]} but the species table has {SPECIES_ROWS} rows"
        )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    total = sum(len(line["records"]) for line in payload["lines"])
    print(
        f"Wrote {OUT.relative_to(ROOT)}: {LINE_COUNT} lines, {RECORD_COUNT} records "
        f"each ({total} rows)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())