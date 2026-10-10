#!/usr/bin/env python3
"""
Extract NPC/search-point MONEY (BIT) grants -> web/assets/data/bank70_money_grants.json.

Bank 0x70 `set_flag` writes are REWARD/ACTION dispatches (tools/extract_bank70_rewards.py),
not possession flags -- see the ledger claim `bank70-reward-dispatch-table`. A scene NPC's
(or invisible search-point actor's) dialogue-state `on_close` table that writes a bank-0x70
flag whose reward-table entry is opcode 0x20 arg0==1 (CURRENCY ADD) is a real "you get N BIT"
reward, exactly like a collection-bank on_close write is a real "you get item N"
(extract_talk_grants.py) -- except money grants are NOT gated on carrying an item, so they
can appear on NPCs/search points that grant no item at all (e.g. the s235 Asuka Inn shelf
search point: on_close 0x708c, no item write anywhere in that dialogue state).

Source: web/assets/data/bank70_rewards.json (`wireable: true` records) x web/assets/scenes/*.json
(every npc, VISIBLE or invisible -- search-point actors are real bank70-reward-dispatch-table
`search-points-are-invisible-npc-records` producers, ledger-confirmed).

Output: web/assets/data/bank70_money_grants.json
  { "grants": [ {stage, npc_id, invisible, amount, flag_id, key, gate:[{id,expected}],
                 also_sets:[{id,val}], dialogue:{file,index}}, ... ] }
`also_sets` = every other on_close entry in the same dialogue state (item collection writes,
stored-bank story flags, other un-modelled bank-0x70 writes), left for the converter to
classify exactly like extract_talk_grants.py's also_sets.

Run: tools/extract_bank70_money_grants.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENES = ROOT / "web/assets/scenes"
REWARDS = ROOT / "web/assets/data/bank70_rewards.json"
OUT = ROOT / "web/assets/data/bank70_money_grants.json"


def main() -> None:
    rewards = json.loads(REWARDS.read_text())
    add_by_flag_id = {r["flag_id"]: r["resolved_action"]["amount"]
                       for r in rewards["records"] if r["wireable"]}

    grants = []
    for f in sorted(SCENES.glob("s*.json")):
        stage = f.stem
        try:
            scene = json.loads(f.read_text())
        except Exception:
            continue
        for npc in scene.get("npcs", []):
            nid = npc.get("npc_id")
            if nid is None:
                continue
            invisible = bool(npc.get("invisible"))
            for ds in npc.get("dialogue_states", []) or []:
                closes = ds.get("on_close", []) or []
                money = [c for c in closes if c.get("expected") == 1 and c.get("id") in add_by_flag_id]
                if not money:
                    continue
                also = [{"id": c["id"], "val": c.get("expected", 1)}
                        for c in closes if c not in money]
                for c in money:
                    grants.append({
                        "stage": stage,
                        "npc_id": nid,
                        "invisible": invisible,
                        "flag_id": c["id"],
                        "key": c["id"] & 0x1FF,
                        "amount": add_by_flag_id[c["id"]],
                        "gate": ds.get("gate", []) or [],
                        "also_sets": also,
                        "dialogue": ds.get("dialogue"),
                    })
    grants.sort(key=lambda g: (g["stage"], g["npc_id"], g["flag_id"]))
    OUT.write_text(json.dumps({"grants": grants}, indent=2, ensure_ascii=False))
    total = sum(g["amount"] for g in grants)
    print(f"Wrote {len(grants)} bank-0x70 currency-ADD grants (sum {total} BIT across all producers) -> {OUT}")
    for g in grants:
        print(f"  {g['stage']:5} npc {g['npc_id']:>3}{' (invisible)' if g['invisible'] else '':13} "
              f"flag {g['flag_id']:#06x}  +{g['amount']} BIT")


if __name__ == "__main__":
    main()
