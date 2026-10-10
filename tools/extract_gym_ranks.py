#!/usr/bin/env python3
"""
Extract the per-gym training rank-menu binding (decoded 2026-07-26, GYM-Q001).

Mechanism (instruction-proven; docs/research/battle/gym-entry-and-rank-chain-2026-07-08.md
§"2026-07-26"):

A gym greeter's NPC dialogue-state `on_close` writes flag bank 0x94. Bank 0x94 is
not storage — resident `set_flag` F0x800165ac dispatches it (guard at
`.L0x80016848`, bank literal `li $v0, 0x94` at `.L0x80016844`) to the fieldstg
screen launcher:

    launch_ui(0xa00, index)          # a0 = 0xa00 (STGTRAIN), a1 = index

`launch_ui` (F0x8008b770 -> F0x8008b6d4, fieldstg file 0x8a24) fetches the type-7
transition actor and writes `screen_id -> actor+0x5c`, `index -> actor+0x60`, then
drives the actor to state 2 — the same handoff the battle trigger uses at
F0x8008b798 (`0x600`/`0xe0a` -> +0x5c, 0 -> +0x60). The resident transition
manager carries them as pending selector `[0x8004b3fc] = 0xa00` and param
`[0x8004b404] = index` (F0x80016b88, the only writer of either field), which
F0x80016b28 commits to `[0x8004b3f8] = 0xa00` / engine lib `0x0a` — exactly the
2026-07-11 live capture.

`index` is the 0-based group in the already-decoded 14-group rank-menu table
`0x8008c4e4` (progression.json `gym.rank_menus`, extract_progression_tables.py).
Which group a greeter launches is chosen by the gym ID-CARD items, held in the
bank-0x80 possession flags (bank-0x80 index == item id):

    0x8028 = item 40 SilverID      0x8029 = item 41 GoldID
    0x802a = item 42 PlatinumID    (the greeter's spawn_flags, so the PlatinumID
                                    record replaces the gated one entirely)

Reads:  web/assets/scenes/s*.json
Output: web/assets/data/gym_ranks.json
"""

import glob
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web/assets/data/gym_ranks.json"

LAUNCH_BANK = 0x94       # set_flag bank that launches STGTRAIN (screen 0xa00)
POSSESSION_BANK = 0x80   # bank whose index is an item id (ID cards live here)


def bank_of(flag_id: int) -> int:
    return (flag_id >> 8) & 0xFE


def requirements(conds) -> list[dict] | None:
    """Scene gate/spawn_flags -> [{item, owned}]. None if any cond is not bank 0x80."""
    out = []
    for c in conds or []:
        if bank_of(c["id"]) != POSSESSION_BANK:
            return None
        out.append({"item": c["id"] & 0x1FF, "owned": bool(c["expected"])})
    return out


def main() -> None:
    gyms = []
    for f in sorted(glob.glob(str(ROOT / "web/assets/scenes/s*.json"))):
        stage = Path(f).stem
        scene = json.loads(Path(f).read_text())
        by_npc: dict[int, list[dict]] = {}
        for npc in scene.get("npcs", []):
            spawn = requirements(npc.get("spawn_flags"))
            for ds in npc.get("dialogue_states") or []:
                groups = [oc["id"] & 0x1FF for oc in (ds.get("on_close") or [])
                          if bank_of(oc["id"]) == LAUNCH_BANK]
                if not groups:
                    continue
                gate = requirements(ds.get("gate"))
                if spawn is None or gate is None:
                    # A non-possession condition would need its own predicate
                    # evaluation; record it so the gap is visible, not silent.
                    raise SystemExit(
                        f"{stage} npc {npc.get('npc_id')}: bank-0x94 state with a "
                        f"non-bank-0x80 condition (spawn={npc.get('spawn_flags')} "
                        f"gate={ds.get('gate')}) — extractor needs extending"
                    )
                for g in groups:
                    by_npc.setdefault(npc.get("npc_id"), []).append({
                        "group": g,
                        "requires": spawn + gate,
                        "sprite": npc.get("sprite"),
                    })
        for npc_id, opts in sorted(by_npc.items()):
            sprite = opts[0]["sprite"]
            # Most-specific first: more conditions = a later unlock (the PlatinumID
            # record is unconditional in its own right but replaces the gated NPC,
            # so its spawn requirement makes it the most specific option).
            opts.sort(key=lambda o: -len(o["requires"]))
            gyms.append({
                "stage": stage,
                "npc_id": npc_id,
                "sprite": sprite,
                "options": [{"group": o["group"], "requires": o["requires"]}
                            for o in opts],
            })

    out = {
        "_comment": (
            "Per-gym STGTRAIN rank-menu binding. group = 0-based index into "
            "progression.json gym.rank_menus, launched by the greeter's on_close "
            "flag-bank-0x94 write (resident set_flag F0x800165ac -> "
            "launch_ui(0xa00, index)). requires = bank-0x80 item possession "
            "(SilverID 40 / GoldID 41 / PlatinumID 42); options are ordered "
            "most-specific-first, so the first fully satisfied option wins. "
            "Decoded 2026-07-26 — docs/research/battle/"
            "gym-entry-and-rank-chain-2026-07-08.md."
        ),
        "gyms": gyms,
    }
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(gyms)} gym greeters, "
          f"{sum(len(g['options']) for g in gyms)} options")


if __name__ == "__main__":
    main()
