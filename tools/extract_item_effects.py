#!/usr/bin/env python3
"""
Extract the REAL per-item effect records for all 403 items from the decomp.

Decoded 2026-07-10 (see docs/research/ui/item-system-decoded-2026-07-10.md).
The master item table `D0x80041844: [Unknown1; 402]` (row i = ItemId i+1) carries
`f0` = pointer to the item's effect/stat record. The pointer target CLASSIFIES the item:

  f0 == null                      -> key/story item (51 items; no use-effect)
  f0 -> D0x8005cb54[[u16;2]; 49]  -> consumable  (items 43..91): [type_code, value]
  f0 -> D0x80040244[Unknown0;200] -> equipment   (items 92..291): stat record
  f0 -> D0x800411e4[Unknown2; 68] -> accessory   (items 292..359): effect record
  f0 -> D0x8005cc18[[u16;2]; 34]  -> card booster(items 361..394)
  (item 360 CardGame? check output; item 91 Booster01a is a consumable-table row type 4)

Consumable pair [type_code, value] (type_code = lo byte usability, hi byte effect):
  0x0103 = HP restore (field+battle), value = amount: Power/Super/Ultra/Max Charge
           = 500/2000/5000/9999  (falsifies the old items.json 200/500/1000/2000 guesses)
  0xNN01 = permanent boost applied on field use; NN selects the stat:
           02 maxHP +v, 03 maxMP +v, 04 STR, 05 DEF, 06 SPT, 07 WIS, 08 SPD, 09 CHR,
           0a..10 elemental resist (fire..dark) +v, 11 = TrainChip (value = TP amount)
  0x0002 = battle-only item (disks/plugs/throwables); value = battle magnitude
           (DVPlug 200 = runtime-confirmed gauge add; MachPlug 32, PowerPlug/GuardPlug 64,
            ChaosWave 96, SpiderWeb 32; 0 = effect is table-driven elsewhere/status)
  0x0004 = booster pack (opens card draw)

Accessory Unknown2 {f0:u16,f1:u8,f2:u8,f3:u16,f4:u16,f5:u16,f6:u16}:
  f4 = magnitude (gems +10 / rings +20 on the first 12 rows), f5 = effect selector,
  f3 = 255 rows are battle-proc accessories (census: hit-rate) — kept raw here.

Also emits per-item buy/sell price (Unknown1.f1/f2), family code (f4),
and `two_handed` for equipment (Unknown0 byte@2 == 7, proven by exe f10.s unequip).

Output: web/assets/data/item_effects.json
"""

import os
import json
import re
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
ROOT = Path(__file__).parent.parent
OUT = ROOT / "web/assets/data/item_effects.json"

DATA_RS = (DDW3 / "rust/dw2003_exe_data/src/data.rs").read_text()
NAMES = re.findall(r"^\t(\w+),", (DDW3 / "rust/types/src/item_id.rs").read_text(), re.M)

CONSUMABLE_EFFECT = {
    0x01: ("hp", "restore HP"),
    0x02: ("stat_hp", "max HP +"),
    0x03: ("stat_mp", "max MP +"),
    0x04: ("stat_str", "STR +"),
    0x05: ("stat_def", "DEF +"),
    0x06: ("stat_spt", "SPT +"),
    0x07: ("stat_wis", "WIS +"),
    0x08: ("stat_spd", "SPD +"),
    0x09: ("stat_chr", "CHR +"),
    0x0A: ("elem_fire", "fire resist +"),
    0x0B: ("elem_water", "water resist +"),
    0x0C: ("elem_ice", "ice resist +"),
    0x0D: ("elem_wind", "wind resist +"),
    0x0E: ("elem_thunder", "thunder resist +"),
    0x0F: ("elem_machine", "machine resist +"),
    0x10: ("elem_dark", "dark resist +"),
    0x11: ("tp", "TP +"),
}


def parse_pair_table(addr: str, count: int) -> list[tuple[int, int]]:
    m = re.search(
        r'@ "%s": \[\[u16; 2\]; %d\] = \[(.*?)\];' % (addr, count), DATA_RS, re.S)
    pairs = re.findall(r"\[\s*(\w+)\s*,\s*(\w+)\s*\]", m.group(1))
    assert len(pairs) == count, (addr, len(pairs))
    return [(int(a, 0), int(b, 0)) for a, b in pairs]


def parse_struct_rows(marker: str, struct: str) -> list[dict]:
    m = re.search(re.escape(marker) + r".*?=\s*(?:unsafe\s*\{\s*)?\[(.*?)\]\s*\}?;",
                  DATA_RS, re.S)
    rows = []
    for body in re.findall(struct + r"\s*\{(.*?)\}", m.group(1)):
        fields = {}
        for fm in re.finditer(r"(f\d+):\s*([^,]+?)(?:,|$)", body):
            fields[fm.group(1)] = fm.group(2).strip()
        rows.append(fields)
    return rows


def num(s: str) -> int:
    return int(s, 0)


def main() -> None:
    cb54 = parse_pair_table("0x8005cb54", 49)   # consumables, items 43..91
    # boosters: declared [u32;34]; each u32 packs [u16 code, u16 value] little-endian
    m32 = re.search(r'@ "0x8005cc18": \[u32; 34\] = \[(.*?)\];', DATA_RS, re.S)
    words = [int(w, 0) for w in re.findall(r"(0x[0-9a-fA-F]+|\d+)\s*,", m32.group(1))]
    assert len(words) == 34, len(words)
    cc18 = [(w & 0xFFFF, w >> 16) for w in words]
    u2 = parse_struct_rows("D0x800411e4", "Unknown2")   # accessories
    u0 = parse_struct_rows("D0x80040244", "Unknown0")   # equipment
    u1 = parse_struct_rows("D0x80041844", "Unknown1")   # master, row i = item i+1
    assert len(u1) == 402 and len(u0) == 200 and len(u2) == 68

    items = []
    for i, r in enumerate(u1):
        item_id = i + 1
        name = NAMES[item_id] if item_id < len(NAMES) else f"item{item_id}"
        f0 = r["f0"]
        rec: dict = {
            "id": item_id,
            "name": name,
            "buy": num(r["f1"]),
            "sell": num(r["f2"]),
            "f3": num(r["f3"]),
            "family": num(r["f4"]),
        }
        idx_m = re.search(r"\[(0x[0-9a-fA-F]+|\d+)\]", f0)
        k = int(idx_m.group(1), 0) if idx_m else None
        if "null" in f0:
            rec["category"] = "key"
        elif "0x8005cb54" in f0:
            code, value = cb54[k]
            usability, eff = code & 0xFF, (code >> 8) & 0xFF
            rec["category"] = "consumable"
            rec["effect_raw"] = [code, value]
            if usability == 3 or (usability == 1 and eff in CONSUMABLE_EFFECT):
                kind = CONSUMABLE_EFFECT.get(eff)
                if kind:
                    rec["effect"] = kind[0]
                    rec["value"] = value
            elif usability == 2:
                rec["effect"] = "battle"
                rec["value"] = value
            elif usability == 4:
                rec["effect"] = "booster"
        elif "0x80040244" in f0:
            s = u0[k]
            rec["category"] = "equipment"
            rec["equip_stats_raw"] = {f: s[f] for f in sorted(s)}
            rec["two_handed"] = num(s["f1"]) == 7
        elif "0x800411e4" in f0:
            s = u2[k]
            rec["category"] = "accessory"
            rec["accessory_raw"] = {f: num(s[f]) if s[f].lstrip("-").isdigit()
                                    or s[f].startswith("0x") else s[f]
                                    for f in sorted(s)}
        elif "0x8005cc18" in f0:
            code, value = cc18[k]
            rec["category"] = "booster"
            rec["effect_raw"] = [code, value]
        else:
            rec["category"] = "unknown"
            rec["f0"] = f0
        items.append(rec)

    OUT.write_text(json.dumps({"items": items}, indent=1, ensure_ascii=False))
    from collections import Counter
    c = Counter(it["category"] for it in items)
    print(f"Wrote {len(items)} items -> {OUT}")
    print(dict(c))
    for it in items:
        if it["name"] in ("PowerCharge", "SuperCharge", "UltraCharge", "MaxCharge",
                          "HPChip", "TrainChip1", "DVPlug"):
            print(" ", it["name"], it.get("effect"), it.get("value"), it["buy"], it["sell"])


if __name__ == "__main__":
    main()
