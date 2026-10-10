#!/usr/bin/env python3
"""
Extract every shop's stock list from the decompiled STITSHOP overlay.

Source of truth:
  ~/ddw3/rust/dw2003_pro_stitshop/src/data.rs
    - Shop array `[Shop { len, items: &STITSHOP_ITEMS_N[0] }]` (the shop directory)
    - per-shop `STITSHOP_ITEMS_N: [ItemId; k]` stock arrays
    - STITSHOP_D0x00009df8 [u32;68] @ 0x8008caa8: entries 38..67 are the
      shop_id -> esshpnam string-id table (the shop's on-screen name).
      Runtime-verified 2026-07-10 on the Windows rig: [0x8008cb40 + shop_id*4]
      held 4 ("Suzaku Pawn Shop") with live shop_id 8 and 12 ("Suzaku Item
      Shop") with shop_id 9 ([0x8004b404] = current shop_id).
  ~/ddw3/lang_file/dw2003/eng/esshpnam.toml — the shop-name string bank
  ~/ddw3/rust/types/src/item_id.rs — ItemId enum (name → id)

Output: web/assets/data/shops.json
  { "shops": [ { "shop_id": n, "count": len, "name": str, "items": [{id, name}, ...] }, ... ] }
"""

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
SHOP_RS = DDW3 / "rust/dw2003_pro_stitshop/src/data.rs"
OUT = ROOT / "web/assets/data/shops.json"


def item_name_to_id() -> dict[str, int]:
    names = re.findall(r"^\t(\w+),", (DDW3 / "rust/types/src/item_id.rs").read_text(), re.M)
    return {n: i for i, n in enumerate(names)}


def shop_names() -> dict[int, tuple[int, str]]:
    """shop_id -> (esshpnam string id, name). Table tail = entries 38..67 of
    the 68-u32 stitshop table (see module docstring)."""
    src = SHOP_RS.read_text()
    m = re.search(r'STITSHOP_D0x00009df8[^=]*=\s*\[(.*?)\];', src, re.S)
    words = [int(w, 16) for w in re.findall(r"0x([0-9a-fA-F]{8}),", m.group(1))]
    assert len(words) == 68, len(words)
    name_ids = words[38:68]
    toml = (DDW3 / "lang_file/dw2003/eng/esshpnam.toml").read_text()
    strings = re.findall(r'"((?:[^"\\]|\\.)*)"', toml)
    return {sid: (nid, strings[nid]) for sid, nid in enumerate(name_ids)}


def main() -> None:
    name_to_id = item_name_to_id()
    shop_name_map = shop_names()
    src = SHOP_RS.read_text()

    # per-shop stock arrays: STITSHOP_ITEMS_N = [ ItemId::Foo, ... ]
    arrays: dict[int, list[str]] = {}
    for m in re.finditer(r"STITSHOP_ITEMS_(\d+)\s*@[^=]*=\s*\[(.*?)\];", src, re.S):
        n = int(m.group(1))
        arrays[n] = re.findall(r"ItemId::(\w+)", m.group(2))

    # the Shop directory: Shop { len: 0xNN, items: ...STITSHOP_ITEMS_N[0]... }
    shops = []
    for sid, m in enumerate(re.finditer(
            r"Shop\s*\{\s*len:\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*items:[^}]*STITSHOP_ITEMS_(\d+)\s*\[",
            src)):
        length = int(m.group(1), 0)
        arr_n = int(m.group(2))
        names = arrays.get(arr_n, [])[:length]
        items = [{"id": name_to_id.get(nm, -1), "name": nm} for nm in names]
        nid, nm_str = shop_name_map.get(sid, (0, ""))
        shops.append({"shop_id": sid, "array": arr_n, "count": length,
                      "name_id": nid, "name": nm_str, "items": items})

    OUT.write_text(json.dumps({"shops": shops}, indent=2, ensure_ascii=False))
    print(f"Wrote {len(shops)} shops ({sum(len(s['items']) for s in shops)} stock entries) → {OUT}")
    for s in shops[:6]:
        names = ", ".join(i["name"] for i in s["items"][:6])
        print(f"  shop {s['shop_id']:2} ({s['count']} items): {names}{' …' if s['count'] > 6 else ''}")


if __name__ == "__main__":
    main()
