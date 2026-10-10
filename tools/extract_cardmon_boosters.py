#!/usr/bin/env python3
"""
Cardmon booster extractor — which Booster pack a defeated Cardmon leaves.

WHAT IT IS.  Beat a Cardmon (the Card-Battle-themed enemy you meet in the water
stages and by fishing) and the result screen hands you a Booster pack.  That is
NOT the ordinary drop: the Cardmon's sprite-table records carry drop_rate 0 and
a Null item.  The pack comes from a separate enemy-id branch in the battle
setup, chosen by the field screen you fought on.

DECODE (original assembly, ~/ddw3/asm/dw2003/pro/fieldstg.s, overlay RAM base
0x80082cb0; battle setup F0x8008B798):

  - Gate: `(enemy_id - 0x1C9) < 8` -- the Cardmon family 0x1C9..0x1D0
    (457..464; the names Cardmon..Cardmon8 map 1:1 in that order).
  - Enemy-id PARITY picks the table: odd ids use RAM 0x80082F08 (file 0x258)
    over screens 0x21D..0x2CE; even ids use 0x800831D0 (file 0x520) over
    0x201..0x2CE.
  - RAND_U16 ([0x8004dc0c]) masked to 0x1f (odd) or 0xf (even) indexes it.  A
    few arms also test the master progress word [0x8004b370] == 0x2d.
  - Out of range, and every arm, resolves to one of two packs: `rand != 0`
    (common) or `rand == 0`.  No screen yields a single fixed pack.

Output: web/assets/data/cardmon_boosters.json
    { "odd":  { "554": {"nz": 377, "z": 390}, ... },
      "even": { "564": {"nz": 376, "z": 390}, ... },
      "default": {"nz": 375, "z": 390} }
Values are NUMERIC item ids (0x177..0x18A); the runtime item table resolves the
display name. Keys are the DECIMAL field screen number (mapId "s554" -> "554").
"""

from __future__ import annotations
import os

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm" / "dw2003" / "pro" / "fieldstg.s"
OUT = ROOT / "web" / "assets" / "data" / "cardmon_boosters.json"

BASE = 0x80082CB0
ODD_TABLE = 0x80082F08  # RAM
EVEN_TABLE = 0x800831D0
ODD_SCREENS = 0x21D
EVEN_SCREENS = 0x201
ODD_COUNT = 0xB2
EVEN_COUNT = 0xCE
TAIL = 0x926C  # shared tail: li $v0, 0x18a (RBooster05)

LINE_RE = re.compile(r"^\.L0x([0-9a-f]{8}):\s+([^#\n]+)", re.M)
WORD_RE = re.compile(r"^\.L0x([0-9a-f]{8}): \.word 0x([0-9a-f]{8})", re.M)


def load_asm() -> tuple[dict[int, str], dict[int, int]]:
    text = ASM.read_text()
    ins = {int(m.group(1), 16): m.group(2).strip() for m in LINE_RE.finditer(text)}
    words = {int(m.group(1), 16): int(m.group(2), 16) for m in WORD_RE.finditer(text)}
    return ins, words


def imm_at(ins: dict[int, str], offset: int) -> int | None:
    text = ins.get(offset, "")
    m = re.match(r"li \$v0, (-?0x[0-9a-f]+)", text) or re.match(r"li \$v0, (-?\d+)", text)
    if not m:
        return None
    value = m.group(1)
    return int(value, 16) if value.startswith(("0x", "-0x")) else int(value)


def parse_arm(ins: dict[int, str], offset: int) -> list[tuple[dict[str, bool], int]]:
    """Resolve one dispatch arm to (condition, booster id) pairs.

    Conditions: `nz` = RAND_U16 & mask != 0, `story2d` = [0x8004b370] == 0x2d.
    """
    out: list[tuple[dict[str, bool], int]] = []
    for _ in range(60):
        text = ins.get(offset, "")
        if not text:
            return out
        m = re.match(r"(beqz|bnez) \$a0, \.L0x([0-9a-f]{8})", text)
        if m:
            target = int(m.group(2), 16)
            nonzero = m.group(1) == "beqz"
            out += [(dict(c, nz=nonzero), v) for c, v in parse_arm(ins, offset + 4)]
            if target == TAIL:
                out.append(({"nz": not nonzero}, 0x18A))
            else:
                out += [(dict(c, nz=not nonzero), v) for c, v in parse_arm(ins, target)]
            return out
        m = re.match(r"beq \$v1, \$v0, \.L0x([0-9a-f]{8})", text)
        if m:
            target = int(m.group(1), 16)
            out += [(dict(c, story2d=False), v) for c, v in parse_arm(ins, offset + 4)]
            out += [(dict(c, story2d=True), v) for c, v in parse_arm(ins, target)]
            return out
        if "j 0x8008bf24" in text:
            value = imm_at(ins, offset + 4)
            if value is not None:
                out.append(({}, value))
            return out
        offset += 4
    return out


def arm_map(ins, words, table_ram: int, count: int) -> dict[int, dict]:
    entries: dict[int, dict] = {}
    for i in range(count):
        ptr = words.get(table_ram - BASE + 4 * i)
        if not ptr:
            continue
        resolved: dict[str, dict] = {"base": {}, "story2d": {}}
        for cond, value in parse_arm(ins, ptr - BASE):
            if value is None:
                continue
            bucket = "story2d" if cond.get("story2d") else "base"
            resolved[bucket]["z" if cond.get("nz") is False else "nz"] = value
        entries[i] = resolved
    return entries


def main() -> int:
    ins, words = load_asm()
    def shape(entry: dict) -> dict:
        # Numeric item ids, not names: the runtime item table resolves the
        # display name (item-names.ts), which differs from items.json's spelling.
        out = {"nz": entry["base"]["nz"], "z": entry["base"]["z"]}
        story = entry["story2d"]
        if story:
            out["story2d"] = {"nz": story["nz"], "z": story["z"]}
        return out

    odd = arm_map(ins, words, ODD_TABLE, ODD_COUNT)
    even = arm_map(ins, words, EVEN_TABLE, EVEN_COUNT)
    result = {
        "odd": {str(ODD_SCREENS + i): shape(e) for i, e in odd.items()},
        "even": {str(EVEN_SCREENS + i): shape(e) for i, e in even.items()},
        "default": {"nz": 0x177, "z": 0x186},
    }
    OUT.write_text(json.dumps(result, indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)}: odd={len(result['odd'])} even={len(result['even'])} screens")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
