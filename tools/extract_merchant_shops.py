#!/usr/bin/env python3
"""
Extract the per-stage merchant -> shop_id binding (decoded 2026-07-10).

Mechanism (instruction-proven, docs/research/ui/item-system-decoded-2026-07-10.md):
NPC dialogue-state `on_close` entries in flag bank 0x7a are NOT stored flags —
resident `set_flag` (F0x800165ac @ .L0x80016848+) dispatches bank 0x7a to the UI
launcher `[D0x8008b770]`:

  index < 0x1e            -> launch_ui(0xf00, index)  = ITEM SHOP, shop_id = index
  0x31..0x43, 0x46..0x4a  -> launch_ui(0x1300, index) = CARD SHOP, stock_id = index
  0x1e..0x30              -> D0x8008c000()            = launch id 0x1002 (rest)

CORRECTED 2026-08-08. The 0x31..0x4a range was labelled "card_trade" and the
0x1e..0x30 range "card_shop". That was backwards for the first and unproven for
the second:

  * 0x1300 IS the card shop screen (STCDSP, see `dw3-research screens`), and
    `index` is its launch parameter. That parameter is what the shop stores in
    obj+0xA0 and feeds to the stock lookup F0x80089160 -- so these 26 indices
    are exactly the 24 STOCK SET ids decoded in tools/extract_card_shops.py
    (0x44/0x45 are unused in both). Binding them to scenes resolves the
    long-open "which shop id is which location" question: 11 stages, and the
    per-stage counts match the shipped stock variants one for one.
  * D0x8008c000 is now read (fieldstg .L0x00009350). It takes NO index: it
    hardcodes launch id 0x1002, and first sets scene_struct+0x50 and +0x58 (the
    transition-in-progress guards). So every index in 0x1e..0x30 does the SAME
    thing, which alone rules out "card shop" -- a card shop must select stock.
    The stages carrying these indices are dominated by the five inn pairs the
    header below already names (s235/236, s360/361, s470/471, s505/506,
    s700/701), plus a few rest-ish spots (Pelche Oasis, Mirage Hall, Chamber
    Room) and four city stages. A rest/stay flow fits the evidence; the label
    stays mechanical rather than assuming it.

Bank 0x7c on_close = DRI desk: idx 0 -> launch_ui(0xd00) = SWITCH-DIGIMON screen
(Digimon Lab s220/s221 + city Piximon officers), idx 1 -> launch_ui(0xb00) =
Digimon NAME-CHANGE screen (s475 Shaman House Baronmon only). The old "inn"
label was wrong — none of the firing stages is an inn (falsified 2026-07-10;
inns are s235/236, s360/361, s470/471, s505/506, s700/701). Banks
0x74/0x76/0x78/0x90/0x92/0x94 are other launcher banks (see the doc).

So per-stage "who sells what" = scene NPC on_close 0x7aNN -> STITSHOP shop NN
(inventories in web/assets/data/shops.json, extract_shops.py).

Reads:  web/assets/scenes/s*.json, web/assets/data/shops.json
Output: web/assets/data/merchant_shops.json
"""

import glob
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web/assets/data/merchant_shops.json"

SHOPS = {s["shop_id"]: s for s in
         json.loads((ROOT / "web/assets/data/shops.json").read_text())["shops"]}


def classify(index: int) -> str | None:
    if index < 0x1e:
        return "item_shop"
    if 0x1e <= index <= 0x30:
        # D0x8008c000 -> launch id 0x1002, index ignored. Mostly inns.
        return "launch_0x1002"
    if 0x31 <= index <= 0x43 or 0x46 <= index <= 0x4a:
        return "card_shop"
    return None


def main() -> None:
    merchants = []
    dri_desks = []
    seen = set()
    for f in sorted(glob.glob(str(ROOT / "web/assets/scenes/s*.json"))):
        stage = Path(f).stem
        scene = json.loads(Path(f).read_text())
        for npc in scene.get("npcs", []):
            for ds in npc.get("dialogue_states") or []:
                for oc in ds.get("on_close") or []:
                    fid = oc["id"]
                    bank = (fid >> 8) & 0xFE
                    index = fid & 0x1FF
                    key = (stage, npc.get("npc_id"), fid)
                    if key in seen:
                        continue
                    if bank == 0x7A:
                        kind = classify(index)
                        rec = {
                            "stage": stage,
                            "npc_id": npc.get("npc_id"),
                            "sprite": npc.get("sprite"),
                            "flag_id": fid,
                            "kind": kind,
                        }
                        if kind == "item_shop":
                            rec["shop_id"] = index
                            shop = SHOPS.get(index)
                            rec["stock"] = [it["name"] for it in shop["items"]] if shop else []
                        else:
                            rec["ui_index"] = index
                        merchants.append(rec)
                        seen.add(key)
                    elif bank == 0x7C:
                        dri_desks.append({
                            "stage": stage, "npc_id": npc.get("npc_id"),
                            "sprite": npc.get("sprite"), "flag_id": fid,
                            "kind": "switch_digimon" if index == 0 else "name_change",
                        })
                        seen.add(key)

    OUT.write_text(json.dumps({"merchants": merchants, "dri_desks": dri_desks},
                              indent=1, ensure_ascii=False))
    n_shop = sum(1 for m in merchants if m["kind"] == "item_shop")
    ids = sorted({m["shop_id"] for m in merchants if m["kind"] == "item_shop"})
    print(f"Wrote {len(merchants)} merchant bindings ({n_shop} item-shop, "
          f"{len(dri_desks)} DRI desk) -> {OUT}")
    print("item shop_ids covered:", ids)


if __name__ == "__main__":
    main()
