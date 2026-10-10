#!/usr/bin/env python3
"""
Build web/assets/data/equipment.json — the real weapon/armor/accessory catalog,
decoded from ~/ddw3's static disasm data (no emulator needed, all compile-time tables).

Sources:
  ~/ddw3/rust/types/src/item_id.rs                — 403 named items (ItemId enum, 0-indexed)
  ~/ddw3/rust/dw2003_exe_data/src/data.rs
    D0x80041844: [Unknown1; 402]  @ 0x80041844     — master item table (price/sell/type/family)
     D0x80040244: [Unknown0; 200]  @ 0x80040244     — equip-stat table (per-item stat record)

Every gear item's stat record is emitted as `stat_bytes`, the raw 20 (Unknown0) or 12
(Unknown2) bytes, because the game reads it BY BYTE OFFSET and what an offset means
changes with the item's family byte. The two readers are:
  stitshop F0x80088a64 + F0x80088db8 — the shop's effect card and every displayed stat
    (claim EQUIP-C016-shop-gear-stat-contributions): family 2-14 adds u16 @+0x0A into
    POW and treats bytes @+0x0C/@+0x0D as two (stat code, i16 @+0x06/@+0x08) pairs;
    family 15-20 adds u16 @+0x0C into DEF and treats @+0x0A/@+0x0B as those code bytes;
    family 21-24 uses (@+0x08 code, u16 @+0x06); and all three add u16 @+0x00 into CHR.
  FIGHTSTG_F0x8009ec94 — the battle pools (claim EQUIP-C009): byte @+0x0E -> combatant
    +0x3a to-hit for family 2-14, byte @+0x10 -> +0x3b to-evade otherwise.

Disasm cross-check (this session, 2026-07-04): FIGHTSTG_F0x8009ec94 (fightstg.s ~29185-29807)
is the battle combatant-init equip loop. It walks the 6 Unknown4Items slots (head/body/right/
left/acc0/acc1, +0x3c0..+0x3ca) and, for head/body/right/left:

  - resolves each equipped ItemId's Unknown1 entry (table lookup via [0x80042b98])
  - reads the family/type byte at offset+9 of the resolved record == Unknown1.f4
  - if f4 in [2,14]: adds stat-record byte +0x0E to combatant record +0x3a
  - else (f4 >= 15): adds stat-record byte +0x10 to combatant record +0x3b
  (2026-08-10 correction, claims EQUIP-C006/EQUIP-C009: those two combatant bytes are the
  to-hit and to-evade pools — the only consumers outside the initializer are inside the
  physical hit roll FIGHTSTG_F0x800a06ac. They are NOT weapon power / armor defense.)
Then acc0 is checked against specific hardcoded ItemIds (each pair -> a specific record byte):
  331/332 Glasses/Goggles      -> +0x27 (flat damage reduction; CONFIRMS the existing
                                   battle-formula-leaves.md note "items 0x14b/0x14c = equipment
                                   armor" — now traced to its exact mechanism)
  333/334 DanceFeather/Wing    -> +0x3a (the pair-shift correction to these two ladder rungs
                                   is recorded as EQUIP-C008; the pool semantics as EQUIP-C009)
  335/336 RunnerSandal/Shoes   -> +0x3b
  337/338 TrainingBook/Brace   -> +0x3c (new pool, meaning not yet pinned)
  339-359 *Power items         -> +0x2b (elem-type index 1-8) / +0x2c (magnitude) — CORRECTS
                                  the prior items.json assumption that these are consumed
                                  permanent boosts (build_items.py's "elem_fire" effect): the
                                  disasm reads them straight out of the EQUIPPED acc0 slot at
                                  battle start, i.e. they are re-equippable accessories, not
                                  one-shot consumables.
  316-320 Crests (partial)     -> +0x37/+0x38/... (MultiCrest/SearchCrest seen; full mapping
                                  for all 5 not traced this session)

Full precision on every crest's exact effect is NOT claimed here beyond what's read
above — this script emits the REAL f0-f10 fields from Unknown0/Unknown1 verbatim plus the
raw stat-record bytes (so nothing is fabricated and no offset is pre-labelled for the
wrong reader) plus a slot assignment that is DERIVED from the ItemId name ranges in
item_id.rs (verified against the ~0x02-0x11 family codes seen in the data) — see
SLOT_RANGES below.
"""

import os
import json
import re
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
OUT = Path(__file__).parent.parent / "web" / "assets" / "data" / "equipment.json"


def parse_item_ids() -> list[str]:
    src = (DDW3 / "rust/types/src/item_id.rs").read_text()
    return [v.strip() for v in re.findall(r"^\t(.+),", src, re.MULTILINE)]


def _u16(v: int) -> bytes:
    return (v & 0xFFFF).to_bytes(2, "little")


def _u8(v: int) -> bytes:
    assert -256 <= v <= 255, f"value {v} does not fit a byte"
    return bytes([v & 0xFF])


def pack_unknown0(u: dict) -> list[int]:
    """The 20-byte Unknown0 equip-stat record, as the game's own byte loads see it.

    Layout (~/ddw3/rust/dw2003_exe_data/src/data.rs:134 `struct Unknown0`):
      +0x00 f0 u16 | +0x02 f1 u8 | +0x03 f2 u8 | +0x04 f3 u16 | +0x06 f4 i16
      +0x08 f5 i16 | +0x0A f6 u16 | +0x0C f7[2] | +0x0E f8[2] | +0x10 f9[2] | +0x12 f10 u16

    The bytes are emitted instead of pre-labelled fields on purpose: stitshop
    F0x80088a64 (the shop effect-card stat builder) reads them BY OFFSET and what an
    offset means changes with the item's family byte — +0x0A is the displayed POW bonus
    for a family 2-14 weapon and a pair of stat CODES for a family 15-20 armour piece.
    The rule lives in engine/dw3/equipment.ts `gearStatContributions`.
    """
    b = bytearray()
    b += _u16(u["f0"]) + _u8(u["f1"]) + _u8(u["f2"])
    b += _u16(u["f3"]) + _u16(u["f4"]) + _u16(u["f5"]) + _u16(u["f6"])
    b += _u8(u["f7"][0]) + _u8(u["f7"][1])
    b += _u8(u["f8"][0]) + _u8(u["f8"][1])
    b += _u8(u["f9"][0]) + _u8(u["f9"][1])
    b += _u16(u["f10"])
    assert len(b) == 0x14, len(b)
    return list(b)


def pack_unknown2(u: dict) -> list[int]:
    """The 12-byte Unknown2 accessory record (data.rs:158 `struct Unknown2`)."""
    b = bytearray()
    b += _u16(u["f0"]) + _u8(u["f1"]) + _u8(u["f2"])
    b += _u16(u["f3"]) + _u16(u["f4"]) + _u16(u["f5"]) + _u16(u["f6"])
    assert len(b) == 0x0C, len(b)
    return list(b)


def parse_unknown0(data_rs: str) -> list[dict]:
    start = data_rs.index("pub static mut D0x80040244")
    end = data_rs.index("\tpub static mut", start + 40)
    block = data_rs[start:end]
    rows = []
    pat = re.compile(
        r"f0:\s*(-?\d+)\s*,\s*f1:\s*(-?\d+)\s*,\s*f2:\s*(-?\d+)\s*,\s*f3:\s*(-?\d+)\s*,\s*"
        r"f4:\s*(-?\d+)\s*,\s*f5:\s*(-?\d+)\s*,\s*f6:\s*(-?\d+)\s*,\s*"
        r"f7:\s*\[(-?\d+)\s*,\s*(-?\d+)\s*\]\s*,\s*f8:\s*\[(-?\d+)\s*,\s*(-?\d+)\s*\]\s*,\s*"
        r"f9:\s*\[(-?\d+)\s*,\s*(-?\d+)\s*\]\s*,\s*f10:\s*(-?\d+)"
    )
    for m in pat.finditer(block):
        g = [int(x) for x in m.groups()]
        rows.append({
            "f0": g[0], "f1": g[1], "f2": g[2], "f3": g[3], "f4": g[4], "f5": g[5],
            "f6": g[6], "f7": [g[7], g[8]], "f8": [g[9], g[10]], "f9": [g[11], g[12]],
            "f10": g[13],
        })
    return rows


def parse_unknown2(data_rs: str) -> list[dict]:
    """D0x800411e4: [Unknown2; 68] — the ACCESSORY effect table (items 292-359).

    Field decode (2026-07-10, data-clustered against the esitminf descriptions —
    docs/research/battle/accessory-effects-decoded-2026-07-10.md):
      f1 = handler class: 6 = stat/resist ring-gem, 8 = behavioral accessory
      f5 (f1==6) = target code: 1-5 str/def/spt/wis/spd; 8-14 elemental resist
                   fire..dark; 17-21 status resist poison/paralyze/confuse/sleep/ko
      f2 (f1==8) = effect opcode: 1 multi_attack, 2 crit_up, 3 counter, 4 no_flee,
                   5 regen, 6 exp_up, 7 bit_up, 8 mp_cost_down, 9 damage_down,
                   10 steal_up, 11 gauge_up, 12 accuracy_up, 13 evade_up,
                   14 escape_up, 15 training, 16 elem_attack
      f4 = magnitude; f0 = small per-item value (empirically the charisma/style
           bonus — Charisma Gem/Ring carry 20/30 here and nothing else); f3 = 255
           (constant), f6 = 0 (constant).
    """
    start = data_rs.index("pub static mut D0x800411e4")
    end = data_rs.index("\tpub static mut", start + 40)
    block = data_rs[start:end]
    pat = re.compile(
        r"Unknown2 \{ f0: (-?\d+)\s*,\s*f1: (-?\d+)\s*,\s*f2: (-?\d+)\s*,\s*f3: (-?\d+)\s*,\s*"
        r"f4: (-?\d+)\s*,\s*f5: (-?\d+)\s*,\s*f6: (-?\d+)")
    rows = []
    for m in pat.finditer(block):
        g = [int(x) for x in m.groups()]
        rows.append({"f0": g[0], "f1": g[1], "f2": g[2], "f3": g[3],
                     "f4": g[4], "f5": g[5], "f6": g[6]})
    return rows


STAT_CODES = {1: "str", 2: "def", 3: "spt", 4: "wis", 5: "spd"}
ELEM_CODES = {8: "fire", 9: "water", 10: "ice", 11: "wind", 12: "thunder",
              13: "machine", 14: "dark"}
STATUS_CODES = {17: "poison", 18: "paralyze", 19: "confuse", 20: "sleep", 21: "ko"}
OPCODES = {1: "multi_attack", 2: "crit_up", 3: "counter", 4: "no_flee", 5: "regen",
           6: "exp_up", 7: "bit_up", 8: "mp_cost_down", 9: "damage_down",
           10: "steal_up", 11: "gauge_up", 12: "accuracy_up", 13: "evade_up",
           14: "escape_up", 15: "training", 16: "elem_attack"}
# elem_attack (opcode 16) element by item-id triplet, matching the equip-loop's
# +0x2b elem-type index for 339-359 (fire..dark, 3 tiers each).
POWER_ELEMS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"]


def accessory_effect(item_id: int, u2: dict) -> dict:
    eff = {"raw": u2}
    if u2["f1"] == 6:
        code = u2["f5"]
        if code in STAT_CODES:
            eff.update(kind="stat", stat=STAT_CODES[code], amount=u2["f4"])
        elif code in ELEM_CODES:
            eff.update(kind="elem_resist", element=ELEM_CODES[code], amount=u2["f4"])
        elif code in STATUS_CODES:
            eff.update(kind="status_resist", status=STATUS_CODES[code], amount=u2["f4"])
        else:  # Charisma Gem/Ring: f4=f5=0, the bonus rides in f0
            eff.update(kind="stat", stat="chr", amount=u2["f0"])
    elif u2["f1"] == 8:
        kind = OPCODES.get(u2["f2"], f"op{u2['f2']}")
        eff.update(kind=kind, amount=u2["f4"])
        if kind == "elem_attack":
            eff["element"] = POWER_ELEMS[(item_id - 339) // 3]
    return eff


def parse_unknown1(data_rs: str) -> list[dict]:
    start = data_rs.index("pub static mut D0x80041844")
    end = data_rs.index("pub static mut D0x80042b1c")
    block = data_rs[start:end]
    rows = []
    # f0 is either core::ptr::null() or a reference into D0x80040244[idx] / D0x8005cb54[idx].
    num = r"(-?0x[0-9a-fA-F]+|-?\d+)"
    pat = re.compile(
        r"Unknown1 \{ f0: (core::ptr::null\(\)|&(D0x\w+)\[(0x[0-9a-fA-F]+)\][^,]*), "
        rf"f1:\s*{num}\s*,\s*f2:\s*{num}\s*,\s*f3:\s*{num}\s*,\s*"
        rf"f4:\s*{num}\s*,\s*f5:\s*{num}\s*\}}"
    )

    def to_int(s):
        return int(s, 16) if "0x" in s else int(s)

    for m in pat.finditer(block):
        ptr_table = m.group(2)
        ptr_idx = int(m.group(3), 16) if m.group(3) else None
        rows.append({
            "ptr_table": ptr_table, "ptr_idx": ptr_idx,
            "f1_buy": to_int(m.group(4)), "f2_sell": to_int(m.group(5)),
            "f3": to_int(m.group(6)), "f4_family": to_int(m.group(7)),
            "f5": to_int(m.group(8)),
        })
    return rows


# ItemId name-range -> equip slot. Derived from item_id.rs's grouping (verified: the names
# in each range are thematically consistent — e.g. 190-198 are LongBow..PositronCannon, all
# ranged weapons) and cross-checked against the Unknown1.f4 family-code column (each named
# range maps to a small contiguous run of family codes, confirming the boundaries are real
# structure, not coincidence).
SLOT_RANGES = [
    (92, 189, "right"),     # swords/glaives/gloves/guns/rods/fangs/heavy-blades - main-hand
    (190, 214, "right"),    # bows/cannons/guard-gauntlets/horns - also main-hand per family<15 rule... [see note]
    (215, 248, "head"),     # bandanna..crown..helmet
    (249, 274, "body"),     # coat/suit/robe/armor/mail
    (275, 291, "left"),     # buckler/shield/barrier - off-hand
    (292, 315, "accessory"),  # gem/ring
    (316, 338, "accessory"),  # crest/adapter/proxy/hack/glasses/goggles/feather/wing/sandal/shoes/book/brace
    (339, 359, "accessory"),  # elemental "Power" items — equip accessory, NOT consumable (see module docstring)
]


def slot_for(item_id: int) -> str | None:
    for lo, hi, slot in SLOT_RANGES:
        if lo <= item_id <= hi:
            return slot
    return None


def main():
    names = parse_item_ids()
    data_rs = (DDW3 / "rust/dw2003_exe_data/src/data.rs").read_text()
    unknown0 = parse_unknown0(data_rs)
    unknown1 = parse_unknown1(data_rs)
    unknown2 = parse_unknown2(data_rs)

    assert len(unknown1) == 402, f"expected 402 Unknown1 rows, got {len(unknown1)}"
    assert len(unknown0) == 200, f"expected 200 Unknown0 rows, got {len(unknown0)}"
    assert len(unknown2) == 68, f"expected 68 Unknown2 rows, got {len(unknown2)}"

    out = []
    # Master-table indexing: Unknown1 row i belongs to ItemId i+1 (ItemId 0 = Null;
    # verified against extract_item_effects.py's price columns — the previous
    # `item_id = i` pairing shifted the WHOLE catalog by one item; fixed 2026-07-10).
    for row_idx, row in enumerate(unknown1):
        item_id = row_idx + 1
        slot = slot_for(item_id)
        if slot is None:
            continue
        entry = {
            "id": item_id,
            "name": names[item_id] if item_id < len(names) else f"Item{item_id}",
            "slot": slot,
            "family": row["f4_family"],
            "buy_price": row["f1_buy"],
            "sell_price": row["f2_sell"],
        }
        if row["ptr_table"] == "D0x80040244" and row["ptr_idx"] is not None:
            u0 = unknown0[row["ptr_idx"]]
            assert "f3" in u0, f"item {item_id}: Unknown0 row has no f3"
            entry["stats_raw"] = u0  # verbatim Unknown0 fields — nothing invented past here
            entry["stat_bytes"] = pack_unknown0(u0)
            # Shop gear-access bitmask (claim EQUIP-C015-shop-gear-access-bitmask):
            # stat-record byte +0x04 == f3; its low byte is the 8-bit per-starter-line
            # wear mask.
            entry["wear_mask"] = u0["f3"] & 0xff
            # The two battle pools, from FIGHTSTG_F0x8009ec94 (fightstg.s ~29185-29807,
            # the combatant-init equip loop over the head/body/right/left slots) as
            # re-traced by claim EQUIP-C009-3a-3b-are-accuracy-and-evade-pools: family
            # (Unknown1 byte +0x9) in [2,14] adds stat-record byte +0x0E into the
            # combatant's +0x3a TO-HIT pool; every other family adds byte +0x10 into the
            # +0x3b EVADE pool. The 2026-07-04 pass read those same two bytes as
            # "weapon power" and "armor defense" — EQUIP-C006/C009 falsified that: the
            # only consumers outside the initializer are the physical hit roll
            # FIGHTSTG_F0x800a06ac, where +0x3a is added to and +0x3b subtracted from the
            # attacker's SPD term. These are therefore NOT the numbers the shop card and
            # status screen show as POW/DEF; those come from the offsets read per family
            # by stitshop F0x80088a64 (see claim EQUIP-C016 below).
            fam = row["f4_family"]
            if slot != "accessory":
                if 2 <= fam <= 14:
                    entry["acc_pool"] = entry["stat_bytes"][0x0E]
                elif 15 <= fam <= 20:
                    entry["evade_pool"] = entry["stat_bytes"][0x10]
        elif row["ptr_table"] == "D0x800411e4" and row["ptr_idx"] is not None:
            u2 = unknown2[row["ptr_idx"]]
            assert "f3" in u2, f"item {item_id}: Unknown2 row has no f3"
            entry["effect"] = accessory_effect(item_id, u2)
            entry["stat_bytes"] = pack_unknown2(u2)
            # Accessories carry wear mask in Unknown2.f3 (always 255 => any line may wear).
            entry["wear_mask"] = u2["f3"] & 0xff
        out.append(entry)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"equipment": out}, indent=1) + "\n")
    print(f"wrote {len(out)} equipment entries -> {OUT}")


if __name__ == "__main__":
    main()
