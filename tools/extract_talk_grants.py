#!/usr/bin/env python3
"""
Extract the TALK-give item map: NPCs that grant a key item when you talk to them.

Source of truth (already decoded — see docs/research/field/npc-decode.md §talk-handler
and the blue-card-gondola-questline memory): a field NPC grants an item by writing a
*collection-bank* flag in its dialogue-state `on_close` set_flag table (the F0x80016988
applier). A set_flag id whose bank ((id>>8)&0xfe) is in 0x80..0x9e is a collection write;
the item id is the low 9 bits (id & 0x1ff). This is the SAME bank semantics the cutscene
gives use (tools/extract_item_grants.py) — but those live on wstag event `on_complete`,
while these live on the scene NPC's talk `on_close`. The converter mines cutscene gives
already; this adds the talk gives so BOTH paths fill the bag in the engine.

Proven cases this recovers:
  s425 npc 64 (Tricky Guilmon) on_close 0x818f → item 399 _8lueCard (the FAKE card)
  s365 npc 64 (Tricky Guilmon) on_close 0x818e → item 398 BlueCard   (the REAL card)

FALSIFIED lead (do not re-chase): s360/s550 npc 21 (sprite p041grdr, a "Guardromon
SAVE OFFICER") on_close writes flag 0x9011, NOT 0x8011 — bank 0x90 is the
"ACCESSING MATRIX DRIVE" save-UI launcher (`D0x8008bfa4`, exe `F0x800165ac`
dispatch), not a collection write. estalk06 idx 360/362 confirm it is a pure save
point ("I AM SAVE OFFICER GUADROMON... IF YOU WANT TO SAVE THEN TALK TO US!"),
with no item mentioned. This NPC is NOT DEKnowledge's producer; is_collection()
correctly filters it out. 2026-07-26 key-item-producer sweep found NO decodable
talk/cutscene/ptrB producer for DEKnowledge or 22 other key items whose only
listed source is the dead/unreferenced STITSHOP shop_id 30 (the s735 DEKnowledge
`story_robot` hole remains open — flag it for the orchestrator's report, do not
fabricate a producer).

Output: web/assets/data/talk_item_grants.json
  { "grants": [ {stage, npc_id, item_id, item_name, key, gate:[{id,expected}],
                 also_sets:[{id,val}], dialogue:{file,index}}, ... ] }
"""

import os
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
SCENES = ROOT / "web/assets/scenes"
OUT = ROOT / "web/assets/data/talk_item_grants.json"

KEY_RE = re.compile(r"DDNA|Card|Pass|Badge|Egg|DE(Sincerity|Knowledge)|Mask|"
                    r"Trophy|Pack|Suit|Herb|Mike|FolderBag|ID$|Mod|Trophy")


def item_names() -> list[str]:
    src = (DDW3 / "rust/types/src/item_id.rs").read_text()
    return re.findall(r"^\t(\w+),", src, re.M)


def is_collection(fid: int) -> bool:
    # Storage banks are EXACTLY 0x80..0x8E. The original set_flag dispatcher
    # F0x800165ac computes `var_v0 = bank - 0x80; if (var_v0 < 0xF)` and only then
    # routes to the collection handler F0x800161d8. Banks 0x90/0x92/0x94 fall
    # through to UI launchers instead:
    #   0x90 -> D0x8008bfa4  (fieldstg 0x8008bfa4: save / "MATRIX DRIVE" + shop UI)
    #   0x92 -> F0x80016314
    #   0x94 -> D0x8008b770  (STGTRAIN gym launcher -- ledger GYM-C009/GYM-C010)
    # Treating those as possession writes invented ~249 phantom item grants that the
    # converter turned into real GiveItem events. Corroborated by the NPCs' own
    # dialogue: every bank-0x94 case is a Zanbamon gym greeter, and the bank-0x90
    # cases are Guardromon save officers ("ACCESSING MATRIX DRIVE") and shopkeepers.
    return 0x80 <= ((fid >> 8) & 0xFE) <= 0x8E


def main() -> None:
    names = item_names()
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
            for ds in npc.get("dialogue_states", []) or []:
                closes = ds.get("on_close", []) or []
                # the collection writes in this state's on_close = the item(s) granted
                items = [c for c in closes if c.get("expected") == 1 and is_collection(c.get("id", 0))]
                if not items:
                    continue
                also = [{"id": c["id"], "val": c.get("expected", 1)}
                        for c in closes if not is_collection(c.get("id", 0))]
                for c in items:
                    item_id = c["id"] & 0x1FF
                    if item_id == 0:
                        continue  # Null
                    name = names[item_id] if item_id < len(names) else f"item#{item_id}"
                    grants.append({
                        "stage": stage,
                        "npc_id": nid,
                        "item_id": item_id,
                        "item_name": name,
                        "key": bool(KEY_RE.search(name)) or 1 <= item_id <= 42,
                        "flag_id": c["id"],
                        "gate": ds.get("gate", []) or [],
                        "also_sets": also,
                        "dialogue": ds.get("dialogue"),
                    })
    grants.sort(key=lambda g: (g["stage"], g["npc_id"], g["item_id"]))
    OUT.write_text(json.dumps({"grants": grants}, indent=2, ensure_ascii=False))
    keyn = sum(1 for g in grants if g["key"])
    print(f"Wrote {len(grants)} talk-give grants ({keyn} key items) → {OUT}")
    for g in grants:
        if g["item_id"] in (17, 398, 399):
            print(f"  {g['stage']:5} npc {g['npc_id']:>3}  {g['item_name']} (#{g['item_id']})  "
                  f"gate={g['gate']}")


if __name__ == "__main__":
    main()
