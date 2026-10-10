#!/usr/bin/env python3
"""Extract the card-shop STOCK table from pro/stcrdshp.

Decoded 2026-08-08 from ~/ddw3/asm/dw2003/pro/stcrdshp.s (authority 2).

How the shop picks its stock
----------------------------
On open, the shop calls the routine held at 0x8008CB98 with the shop id in
`obj+0xA0`, and stores the result in `obj+0xA8` (`.L0x00004dcc`):

    v0 = *(0x8008CB98)          # = F0x80089160
    [obj+0xA8] = v0([obj+0xA0])

It then copies SIX card ids out of `[[obj+0xA8]+0x8]` into `obj+0x74`, and
divides the record's count by six (the 0x2AAAAAAB magic) at `.L0x00004e20`.

`F0x80089160` (offset 0x64B0) linear-searches a 0xC-stride record table at
0x8008CDD4 for a record whose first word equals the shop id, terminated by a
record whose id is -1. **If no record matches it falls back to index 0**
(`.L0x00006504`). Having found one it zeroes `rec+0x04` and walks the card
array at `rec+0x08`, incrementing `rec+0x04` for each non-zero halfword --
so the record is:

    +0x00 u32 shopId
    +0x04 u32 count      <- RUNTIME SCRATCH, always 0 in the disc image
    +0x08 u32 pointer to a zero-terminated u16 card-id array

The count being zero on disc is correct, not a parse failure: the game derives
it by counting the array at lookup time.

CAUTION -- the borrow. `lui 0x8009` + `lw -0x322c` is
`0x80090000 - 0x322c = 0x8008CDD4`, NOT `0x8009CDD4`; likewise `-0x3468` is
`0x8008CB98`. Getting this wrong puts the tables outside the overlay and sends
you to the emulator for nothing. Cross-check: the arrays run 0x8008CBA0 at
stride 0x10 for 24 shops, which lands exactly on 0x8008CD20 -- the start of the
price table extract_card_prices.py reads. The regions abut, so the addresses
are right.

Every shop stocks exactly six cards, though the array has room for eight.
A "shop" here is one STOCK SET, not one location: a location's stock changes
with story progress, and each variant is its own record. Ids run 0x31..0x43
and 0x46..0x4A.

Verification: all 24 stock sets match the eleven shop lists (with their story
conditions) in a community guide, card for card and in order. The guide is not
evidence (see reference-external/README.md); it is a cross-check.

RESOLVED 2026-08-08 -- which shopId is which location. NPC dialogue-state
`on_close` in flag bank 0x7a dispatches `launch_ui(0x1300, index)` for
index 0x31..0x4A, and 0x1300 is the card-shop screen (STCDSP). That `index` IS
the shop id, arriving in obj+0xA0. Joining the scene data gives 11 stages --
s270 s271 s425 s426 s500 s501 s675 s760 s761 s935 s957 -- and the per-stage
count of stock sets matches the shipped variants one for one (s270 has six,
s425 and s500 four each). Emitted here as `stages`.

tools/extract_merchant_shops.py had this range labelled "card_trade" and had
"card_shop" on 0x1e..0x30 instead; both were corrected in the same session.

STILL OPEN: WHICH set of a multi-set stage is active at a given point in the
story. The sets are ordered by progress, but the gate that selects one is not
decoded. Also open: shop 0x49 is in the table but no NPC opens it in any scene.

Usage: .venv/bin/python3 tools/extract_card_shops.py [--out PATH]
"""

from __future__ import annotations
import os

import argparse
import json
import re
from pathlib import Path

ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro/stcrdshp.s"
LOAD_BASE = 0x80082CB0
#: holds the shop-record lookup routine
PTR_SLOT = 0x8008CB98
#: the routine that slot is expected to hold
LOOKUP_FN = 0x80089160
#: base of the 0xC-stride shop-record table
TABLE_ADDR = 0x8008CDD4
RECORD_STRIDE = 0xC
#: the card array has room for eight ids; every shipped shop uses six
MAX_CARDS = 8
CATALOG_SIZE = 316

WORD = re.compile(r"^\.L0x([0-9a-fA-F]+):\s+\.word\s+(?:D0x([0-9a-fA-F]+)|0x([0-9a-fA-F]+))")


def read_words(path: Path) -> dict[int, int]:
    out: dict[int, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = WORD.match(line.strip())
        if m:
            out[int(m.group(1), 16)] = int(m.group(2) or m.group(3), 16)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/assets/data/card_shops.json")
    ap.add_argument("--asm", default=str(ASM))
    ap.add_argument("--catalog", default="web/assets/data/card_catalog.json")
    ap.add_argument("--merchants", default="web/assets/data/merchant_shops.json")
    args = ap.parse_args()

    words = read_words(Path(args.asm).expanduser())
    warnings: list[str] = []

    def word(addr: int) -> int | None:
        return words.get(addr - LOAD_BASE)

    def half(addr: int) -> int | None:
        w = word(addr & ~3)
        if w is None:
            return None
        return (w >> 16) & 0xFFFF if (addr & 2) else w & 0xFFFF

    held = word(PTR_SLOT)
    if held != LOOKUP_FN:
        print(f"FATAL: {PTR_SLOT:#010x} holds {held if held is None else f'{held:#010x}'}, "
              f"expected the lookup {LOOKUP_FN:#010x}; layout changed -- re-derive")
        return 1

    shops = []
    index = 0
    while True:
        rec = TABLE_ADDR + index * RECORD_STRIDE
        shop_id = word(rec)
        if shop_id is None:
            warnings.append(f"record {index} at {rec:#x} is not word data; stopped")
            break
        if shop_id == 0xFFFFFFFF:
            break
        ptr = word(rec + 8)
        if ptr is None:
            warnings.append(f"shop {shop_id:#x}: card pointer missing")
            index += 1
            continue
        cards, truncated = [], False
        for slot in range(MAX_CARDS):
            v = half(ptr + slot * 2)
            if v is None:
                warnings.append(f"shop {shop_id:#x}: slot {slot} is not data")
                break
            if v == 0:
                break
            if not 0 < v <= CATALOG_SIZE:
                warnings.append(f"shop {shop_id:#x}: card id {v} outside 1..{CATALOG_SIZE}")
            cards.append(v)
        else:
            # Ran the full array with no zero terminator -- the game would keep
            # counting into the next shop's array, so say so loudly.
            truncated = True
            warnings.append(f"shop {shop_id:#x}: no zero terminator within {MAX_CARDS} slots")
        rec_out = {"shopId": shop_id, "record": f"{rec:#010x}",
                   "cards": f"{ptr:#010x}", "cardIds": cards}
        if truncated:
            rec_out["unterminated"] = True
        shops.append(rec_out)
        index += 1

    cat_path = Path(args.catalog)
    if cat_path.exists():
        by_id = {c["id"]: c["name"] for c in json.loads(cat_path.read_text())["cards"]}
        for s in shops:
            s["cardNames"] = [by_id.get(c, f"?{c}") for c in s["cardIds"]]
            for c in s["cardIds"]:
                if c not in by_id:
                    warnings.append(f"shop {s['shopId']:#x}: card id {c} not in the catalog")

    # Which stage opens each stock set. The binding is NPC dialogue-state
    # on_close in flag bank 0x7a: an index of 0x31..0x4A dispatches
    # launch_ui(0x1300, index), and that index IS the shop id this table keys on.
    # See tools/extract_merchant_shops.py. Resolved 2026-08-08; the range used to
    # be mislabelled "card_trade" there.
    merch_path = Path(args.merchants)
    if merch_path.exists():
        bind: dict[int, list[str]] = {}
        for m in json.loads(merch_path.read_text()).get("merchants", []):
            if m.get("kind") == "card_shop":
                bind.setdefault(m["ui_index"], []).append(m["stage"])
        for s in shops:
            stages = sorted(set(bind.get(s["shopId"], [])))
            s["stages"] = stages
            if not stages:
                warnings.append(f"shop {s['shopId']:#x} is in the table but no NPC opens it")
    else:
        warnings.append(f"{merch_path} missing; stock sets left unbound to stages")

    sizes = {len(s["cardIds"]) for s in shops}
    doc = {
        "_source": f"pro/stcrdshp, {RECORD_STRIDE:#x}-stride record table {TABLE_ADDR:#010x} "
                   f"via {LOOKUP_FN:#010x}, reached through the pointer at {PTR_SLOT:#010x}",
        "_note": (
            "One record is one STOCK SET, not one location: a shop's stock changes with "
            "story progress and each variant is a separate record. The record's +0x04 "
            "count is runtime scratch (zero on disc); the game derives it by counting "
            "non-zero ids in the array. An unknown shop id falls back to record 0."
        ),
        "_bound": "RESOLVED 2026-08-08. `stages` is which stage's NPC opens this "
                  "stock set, via flag-bank 0x7a on_close -> launch_ui(0x1300, id). "
                  "Eleven stages; a stage with several sets swaps stock with story "
                  "progress. WHICH set is active WHEN is still not decoded.",
        "recordStride": RECORD_STRIDE,
        "maxCards": MAX_CARDS,
        "fallbackShopIndex": 0,
        "shops": shops,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")

    every = sorted({c for s in shops for c in s["cardIds"]})
    print(f"shops={len(shops)} cards-per-shop={sorted(sizes)} distinct-cards={len(every)}")
    print(f"shop ids: {[hex(s['shopId']) for s in shops]}")
    for w in warnings:
        print("WARN:", w)
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
