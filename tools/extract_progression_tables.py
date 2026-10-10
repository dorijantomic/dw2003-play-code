#!/usr/bin/env python3
"""Extract the decoded EXP / level-up / battle-reward / gym-training tables.

Sources (checked-in decomp data, byte-exact overlay contents):
  ~/ddw3/rust/dw2003_pro_stfgtrep/src/data.rs
    STFGTREP_D0x00003dd8 @ 0x80086a88: [u32; 1005]
      = 335 battle-id records x 3 words: [dvexp_base, exp_base, bits_base].
        Battle id == encounter screen id (field_encounters.json key; [0x80042b2c]).
    STFGTREP_D0x0000638c @ 0x8008903c: [u32; 155]
      holds the level-up tables (see offsets below).
  ~/ddw3/rust/dw2003_pro_stgtrain/src/data.rs
    STGTRAIN_D0x00009574 (overlay file offset 0x9574)
      holds the gym TP costs, per-rank drill menus and gain/loss row tables.

Decode provenance: docs/research/battle/exp-levelup-rewards-decoded-2026-07-10.md
(stfgtrep.s fn 0x80086184 exp/level-up, 0x80085e3c stat rolls, 0x80086924/0x800865c0
DVEXP; stgtrain.s appliers 0x800861bc/0x800862d0/0x800863d4/0x800865a0).

Output: web/assets/data/progression.json
"""

import os
import json
import re
import sys
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
OUT = Path(__file__).resolve().parent.parent / "web" / "assets" / "data" / "progression.json"


def load_u32_array(path: Path, name: str) -> list[int]:
    src = path.read_text()
    i = src.index(name)
    blob = src[i : src.index("];", i)]
    return [int(m, 16) for m in re.findall(r"0x([0-9a-fA-F]{8}),", blob)]


def s32(v: int) -> int:
    return v - (1 << 32) if v >= 1 << 31 else v


def main() -> None:
    rep = load_u32_array(
        DDW3 / "rust/dw2003_pro_stfgtrep/src/data.rs", "STFGTREP_D0x00003dd8"
    )
    assert len(rep) == 1005, len(rep)
    battle_rewards = [rep[i * 3 : i * 3 + 3] for i in range(335)]

    lvl = load_u32_array(
        DDW3 / "rust/dw2003_pro_stfgtrep/src/data.rs", "STFGTREP_D0x0000638c"
    )
    assert len(lvl) == 155, len(lvl)

    # RAM 0x8008903c is index 0; helper for RAM-addressed slices.
    def lvl_at(ram: int, n: int) -> list[int]:
        o = (ram - 0x8008903C) // 4
        return [s32(v) for v in lvl[o : o + n]]

    level_up = {
        # threshold(L) = growth_xp*(L^3+5L-6)/10 + exp_tier_const[tier(L)]
        # tier(L): L<5 -> 0, L<20 -> 1, L<40 -> 2, L<100 -> 3  (level cap 99)
        "exp_tier_bounds": [5, 20, 40, 100],
        "exp_tier_const": lvl_at(0x8008916C, 4),
        # maxHP/MP roll: growth - hpmp_tier_adj[tier] + hpmp_rand9[rand%9]
        "hpmp_tier_adj": lvl_at(0x8008917C, 4),
        "hpmp_rand9": lvl_at(0x8008918C, 9),
        # core stats (str,def,spt,wis,spd,chr):
        #   core_table[tier6(L)][growth + rand%5]; tier6: <5,<20,<40,<60,<80,else
        "core_tier_bounds": [5, 20, 40, 60, 80],
        "core_table": [lvl_at(0x800891B0 + t * 36, 9) for t in range(6)],
        # elemental resists, only while new level < 41:
        #   elem_table[growth + rand%4]
        "elem_level_limit": 41,
        "elem_table": lvl_at(0x80089288, 8),
        "exp_cap": 999999,
        "level_cap": 99,
        # stat-roll clamps (fn 0x80085e3c): maxHP/maxMP 9999, core + elemental 999
        "hpmp_cap": 9999,
        "stat_cap": 999,
        "tp_per_level": 5,
        "tp_cap": 99,
        "dvexp_cap": 9999999,
    }

    gym = extract_gym()

    OUT.write_text(
        json.dumps(
            {
                "_comment": (
                    "Decoded progression tables. battle_rewards[screen_id] = "
                    "[dvexp_base, exp_base, bits_base] (stfgtrep 0x80086a88); "
                    "level_up = stfgtrep level-up tables (0x8008903c block); "
                    "gym = stgtrain drill tables. See docs/research/battle/"
                    "exp-levelup-rewards-decoded-2026-07-10.md"
                ),
                "battle_rewards": battle_rewards,
                "level_up": level_up,
                "gym": gym,
            },
            indent=1,
        )
    )
    print(f"wrote {OUT} ({len(battle_rewards)} battle reward records)")


def extract_gym() -> dict:
    words = load_u32_array(
        DDW3 / "rust/dw2003_pro_stgtrain/src/data.rs", "STGTRAIN_D0x00009574"
    )
    assert len(words) == 1081, len(words)

    def at(file_off: int, n: int) -> list[int]:
        o = (file_off - 0x9574) // 4
        return words[o : o + n]

    def rows(file_off: int, n: int) -> list[list[int]]:
        w = at(file_off, n * 2)
        return [[w[i * 2], w[i * 2 + 1]] for i in range(n)]

    # Per-rank drill menus: 14 groups x 16 entries x 8 bytes at 0x8008c4e4
    # (file 0x9834). entry = (drill_id, packed) ; packed low16 = primary effect,
    # high16 = secondary effect (effect ids: 1-5 core gain/loss by applier,
    # 8-14 elemental, 15 maxHP, 16 maxMP).
    rank_menus = []
    for g in range(14):
        block = at(0x9834 + g * 0x80, 32)
        menu = []
        for j in range(0, 32, 2):
            drill, packed = block[j], block[j + 1]
            if drill == 0 and packed == 0:
                continue
            menu.append(
                {
                    "drill": drill,
                    "primary": packed & 0xFFFF,
                    "secondary": (packed >> 16) & 0xFFFF,
                }
            )
        rank_menus.append(menu)

    # Elemental gain pointer table 0x8008c454 (file 0x97a4):
    # 5 growth values x 3 current-stat brackets (<100, <300, >=300) -> row table.
    ptr_names = {0x8008C37C: "low", 0x8008C3C4: "mid", 0x8008C40C: "high"}
    ptrs = at(0x97A4, 15)
    elem_ptr = [
        [ptr_names[p] for p in ptrs[g * 3 : g * 3 + 3]] for g in range(5)
    ]

    return {
        # TP menu costs (0x8008c4d8): TP 1 / TP 5 / TP10
        "tp_costs": at(0x9828, 3),
        "rank_menus": rank_menus,
        # (base, rand_range) rows; gain = base + (range ? rand%range : 0).
        # core (0x8008c304): idx = (drill>=13 ? 6 : 0) + ultra*3 + tp_choice
        "core_rows": rows(0x9654, 12),
        # loss (0x8008c364): idx = tp_choice (secondary stat loss)
        "loss_rows": rows(0x96B4, 3),
        # elemental: table = elem_ptr[growth-1][bracket]; idx = variant + tp_choice*3
        # variant: 0 normal, 1 ultra+normal drill, 2 ultra+super drill
        "elem_tables": {
            "low": rows(0x96CC, 9),
            "mid": rows(0x9714, 9),
            "high": rows(0x975C, 9),
        },
        "elem_ptr": elem_ptr,
        "elem_brackets": [100, 300],
        # maxHP/maxMP (0x8008c490): idx = variant + tp_choice*3 (same variant rule)
        "hpmp_rows": rows(0x97E0, 9),
    }


if __name__ == "__main__":
    sys.exit(main())
