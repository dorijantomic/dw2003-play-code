#!/usr/bin/env python3
"""
Extract NPC PARTNER grants -> web/assets/data/bank70_partner_grants.json.

Bank-0x70 `set_flag` writes are REWARD/ACTION dispatches (see
docs/research/field/bank70-reward-dispatch-2026-07-26.md). Opcode 0x10 case 3
(`F0x80015820`) is one of the two mutating cases: it writes
`roster_owned[slot] = slot + 3` -- i.e. it records the partner Digimon for that
roster slot as OBTAINED. Eight table keys resolve to it (0x7031-0x7039 except
0x7036), and every one of them is written from an NPC dialogue-state `on_close`,
so these are the script-side "you receive this partner" events.

Unlike extract_talk_grants.py this does NOT require a co-occurring collection
write: 19 of the 33 producer states hand over a partner and no item at all (the
main-story handovers in s330/s375/s405/s420/s635). The 14 that DO also write a
collection flag are emitted here too; the converter's talkGrants loop emits the
item and drops the bank-0x70 entry from its `also_sets`, so the partner is
emitted exactly once, from this list.

Source: web/assets/data/roster_predicate_table.json (records whose decoded
`semantics.kind == "grant_partner"`) x web/assets/scenes/*.json.

Output: web/assets/data/bank70_partner_grants.json
  { "grants": [ {stage, npc_id, invisible, slot, species_id, flag_id, key,
                 gate:[{id,expected}], also_sets:[{id,val}], dialogue:{...}}, ...] }

Run: tools/extract_bank70_partner_grants.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENES = ROOT / "web/assets/scenes"
TABLE = ROOT / "web/assets/data/roster_predicate_table.json"
OUT = ROOT / "web/assets/data/bank70_partner_grants.json"


def main() -> None:
    table = json.loads(TABLE.read_text())
    grant_by_flag_id = {}
    for r in table["records"]:
        sem = r.get("semantics")
        if sem and sem.get("kind") == "grant_partner":
            grant_by_flag_id[r["flag_id"]] = sem
    # The dispatch table has exactly 8 case-3 records, one per roster slot; assert
    # rather than silently emitting a partial set if the extractor upstream changes.
    assert len(grant_by_flag_id) == 8, f"expected 8 grant_partner records, got {len(grant_by_flag_id)}"
    assert sorted(s["slot"] for s in grant_by_flag_id.values()) == list(range(8))

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
                partner = [c for c in closes
                           if c.get("expected") == 1 and c.get("id") in grant_by_flag_id]
                if not partner:
                    continue
                also = [{"id": c["id"], "val": c.get("expected", 1)}
                        for c in closes if c not in partner]
                for c in partner:
                    sem = grant_by_flag_id[c["id"]]
                    grants.append({
                        "stage": stage,
                        "npc_id": nid,
                        "invisible": invisible,
                        "flag_id": c["id"],
                        "key": c["id"] & 0x1FF,
                        "slot": sem["slot"],
                        "species_id": sem["species_id"],
                        "gate": ds.get("gate", []) or [],
                        "also_sets": also,
                        "dialogue": ds.get("dialogue"),
                    })
    grants.sort(key=lambda g: (g["stage"], g["npc_id"], g["flag_id"]))
    OUT.write_text(json.dumps({"grants": grants}, indent=2, ensure_ascii=False))
    slots = sorted({g["slot"] for g in grants})
    print(f"Wrote {len(grants)} bank-0x70 partner grants (slots {slots}) -> {OUT}")
    for g in grants:
        print(f"  {g['stage']:5} npc {g['npc_id']:>3}  flag {g['flag_id']:#06x}  "
              f"-> roster slot {g['slot']} (species {g['species_id']})")


if __name__ == "__main__":
    main()
