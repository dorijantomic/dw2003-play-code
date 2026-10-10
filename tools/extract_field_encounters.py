"""
Extracts the authentic field encounter / enemy-party table from FIELDSTG_PRO.

Every field battle (random encounter *and* story boss) is selected by a global
*screen id*. The engine resolves it through the per-screen record table at RAM
0x80094680 (FIELDSTG overlay): record[screen_id] holds three enemy-slot pointers
(+0/+4/+8), each pointing at a 3-word (12-byte) enemy struct:

    { id:u16 @+0, level:u16 @+4, hp:u16 @+6, mp:u16 @+8, ?:u16 @+10 }

The id is the runtime enemy id (Kuwagamon = 0x33); names come from
~/ddw3/rust/types/src/enemy_id.rs. This is the real source the hand-authored
web/assets/data/encounters.json was faking.

The same 28-byte screen record owns the per-battle effect gates. FIELDSTG
0x8008b798 copies record bytes +0xc..+0x19 to 0x80042b58..0x80042b65.
FIGHTSTG consumes +0x0e..+0x18 as the Poison/Frozen/Confusion/Sleep/KO and
battle-item gates. These bytes are therefore encounter configuration, not a
universal boss classification.

The ddw3 repo only disassembles FIELDSTG's first ~64KB (ends file 0x10154); the
record table (file 0x119d0) and the enemy structs (≈file 0x10d04) live in the
data tail, so the canonical source is the raw disc image. FIELDSTG_PRO is hidden
(not in the ISO filesystem), addressed by LBA table index 358 → sector 560.

Provenance + full RE: docs/research/battle-invocation.md (Step 7). The chain is
data-verified: screen 0xc8 (Genji) → id 51 / hp 100 / mp 9999, reproduced from
the disc and matching the live Genji→Kuwagamon battle RAM dump.

Output is keyed by screen_id (NOT stage); mapping screen_id→stage needs each
wstag's 0x800a6428 trigger table (a separate sweep) before this can replace the
game's stage-keyed encounters.json.

Usage:
  python3 tools/extract_field_encounters.py            # writes web/assets/data/field_encounters.json
  python3 tools/extract_field_encounters.py --print    # table to stdout
"""

import os
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
ENEMY_ID_RS = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "rust/types/src/enemy_id.rs"
OUT = ROOT / "web/assets/data/field_encounters.json"

SECTOR_RAW = 2352   # MODE2/2352 raw sector
SECTOR_DATA = 2048
DATA_OFFSET = 24    # user data after sync+header+subheader

FIELDSTG_LBA_START = 560   # LBA_OFFSETS[358]
FIELDSTG_SECTORS = 50      # LBA_LEN_SECTORS[358] — covers the table + structs
FIELDSTG_BASE = 0x80082cb0  # RAM load address; file_off = ram - base

RECORD_TABLE = 0x80094680  # per-screen record table
RECORD_STRIDE = 0x1c       # 28 bytes
SCREEN_MAX = 0x200         # hard ceiling; the real run ends ~334, bounded below


def extract_file(disc_bytes, lba_start, sectors):
    return b"".join(
        disc_bytes[(lba_start + s) * SECTOR_RAW + DATA_OFFSET:]
        [:SECTOR_DATA] for s in range(sectors))


def parse_enemy_names(rs_text):
    """{id: name} from enemy_id.rs `Name = 0x.. ,` enum entries."""
    return {int(v, 0): name for name, v in
            re.findall(r"(\w+)\s*=\s*(0x[0-9a-fA-F]+|\d+)\s*,", rs_text)}


class Overlay:
    def __init__(self, blob):
        self.blob = blob

    def _off(self, ram):
        return ram - FIELDSTG_BASE

    def inrange(self, ram):
        o = self._off(ram)
        return 0 <= o <= len(self.blob) - 4

    def w(self, ram):
        return struct.unpack_from("<I", self.blob, self._off(ram))[0]

    def h(self, ram):
        return struct.unpack_from("<H", self.blob, self._off(ram))[0]

    def b(self, ram):
        return self.blob[self._off(ram)]

    def enemy_struct(self, ram):
        """{ id, level, hp, mp, f10 } from a 12-byte enemy struct, or None."""
        if not self.inrange(ram + 10):
            return None
        return dict(id=self.h(ram), level=self.h(ram + 4), hp=self.h(ram + 6),
                    mp=self.h(ram + 8), f10=self.h(ram + 10))


def extract(overlay, id2name):
    """({screen_id: [enemy, ...]}, {screen_id: config}) for the valid run.

    Stops at the first screen whose slot-0 enemy is empty (id 0) or an id not in
    the enum — that boundary is past-table garbage (verified: real run = 1..334).
    """
    table = {}
    configs = {}
    for sid in range(1, SCREEN_MAX):
        rec = RECORD_TABLE + sid * RECORD_STRIDE
        if not overlay.inrange(rec + 8):
            break
        ptrs = [overlay.w(rec + i) for i in (0, 4, 8)]
        slot0 = overlay.enemy_struct(ptrs[0]) if overlay.inrange(ptrs[0]) else None
        if not slot0 or slot0["id"] == 0 or slot0["id"] not in id2name:
            break  # end of the valid table
        enemies = []
        for p in ptrs:
            if not overlay.inrange(p):
                continue
            s = overlay.enemy_struct(p)
            if not s or s["id"] == 0:
                continue
            enemies.append({
                "name": id2name.get(s["id"], f"Unknown_{s['id']}"),
                "id": s["id"], "level": s["level"],
                "hp": s["hp"], "mp": s["mp"],
                # Enemy-instance +0x0a is copied to descriptor +0x22. The
                # effective-stat builder multiplies species STR/DEF/SPT/WIS/SPD
                # by this value / 16 (fightstg 0x8009f4fc..0x8009f520).
                "stat_scale": s["f10"],
            })
        if enemies:
            table[sid] = enemies
            raw = [overlay.b(rec + 0xc + i) for i in range(14)]
            configs[sid] = {
                "raw_2b58_2b65": raw,
                "effect_gates": {
                    "poison": raw[2], "frozen": raw[3],
                    "confuse": raw[4], "sleep": raw[5], "ko": raw[6],
                    "direct_hp": raw[7], "cursed_puppet": raw[10],
                    "charm_gas": raw[11], "spider_web": raw[12],
                },
            }
    return table, configs


def main(argv=None):
    do_print = "--print" in (argv if argv is not None else sys.argv[1:])
    if not DISC.exists():
        print(f"disc image not found: {DISC}", file=sys.stderr)
        return 1
    id2name = parse_enemy_names(ENEMY_ID_RS.read_text())
    overlay = Overlay(extract_file(DISC.read_bytes(), FIELDSTG_LBA_START,
                                   FIELDSTG_SECTORS))
    table, configs = extract(overlay, id2name)
    if not table:
        print("no encounter records found — table layout changed?", file=sys.stderr)
        return 1

    # sanity: the Genji keystone must hold (screen 0xc8 = Kuwagamon L1 hp100)
    genji = table.get(0xc8)
    assert genji and genji[0]["name"] == "Kuwagamon" and genji[0]["hp"] == 100, \
        f"keystone check failed: screen 0xc8 = {genji}"

    distinct = sorted({e["id"] for v in table.values() for e in v})
    payload = {
        "_comment": ("Authentic field encounter table from FIELDSTG_PRO record table "
                     "0x80094680, keyed by global screen_id. id->name via "
                     "~/ddw3/rust/types/src/enemy_id.rs. See "
                     "docs/research/battle-invocation.md Step 7. NOT yet stage-keyed."),
        "screens": {str(sid): enemies for sid, enemies in sorted(table.items())},
        "battle_config": {str(sid): config for sid, config in sorted(configs.items())},
    }
    if do_print:
        for sid, enemies in sorted(table.items()):
            desc = ", ".join(f"{e['name']} L{e['level']} (hp{e['hp']}/mp{e['mp']})"
                             for e in enemies)
            print(f"  {sid:>3} (0x{sid:03x}): {desc}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(table)} screens, "
          f"{len(distinct)} distinct enemies")
    return 0


if __name__ == "__main__":
    sys.exit(main())
